<script lang="ts">
  import { onMount } from "svelte";
  import { Notepad, Plus } from "phosphor-svelte";

  import { writState } from "./lib/state.svelte";

  let newTaskTitle = $state("");

  onMount(() => {
    writState.loadAll();
  });

  async function handleAdd(): Promise<void> {
    if (newTaskTitle.trim().length === 0) return;
    await writState.addTask(newTaskTitle);
    newTaskTitle = "";
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    handleAdd();
  }
</script>

<main class="flex h-full flex-col bg-base-100 text-base-content">
  <header class="navbar gap-3 border-b border-base-300 bg-base-200 px-4">
    <Notepad size={24} weight="duotone" />
    <h1 class="text-lg font-semibold">writ</h1>
    {#if writState.project}
      <span class="truncate text-xs opacity-60" title={writState.project.root}>
        {writState.project.root}
      </span>
    {/if}
  </header>

  {#if writState.loading}
    <div class="flex flex-1 items-center justify-center text-base-content/60">Loading…</div>
  {:else if !writState.project}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <p>No writ project found.</p>
      <p class="text-sm opacity-60">
        Run <code class="kbd">writ init</code> in the directory you started the app from.
      </p>
    </div>
  {:else if writState.error}
    <div class="alert alert-error m-4">{writState.error}</div>
  {:else}
    <div class="border-b border-base-300 p-4">
      <form class="join w-full max-w-2xl" onsubmit={onSubmit}>
        <input
          type="text"
          class="input input-bordered join-item flex-1"
          placeholder="Add a task…"
          bind:value={newTaskTitle}
        />
        <button
          type="submit"
          class="btn btn-primary join-item"
          disabled={newTaskTitle.trim().length === 0}
        >
          <Plus size={16} weight="bold" />
          Add
        </button>
      </form>
    </div>

    <div class="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
      {#each writState.columns as col (col.id)}
        {@const tasksInCol = writState.tasks.filter(
          (t) => t.columnId === col.id && t.parentId === null,
        )}
        <section>
          <h2 class="mb-2 text-xs font-semibold tracking-wide uppercase opacity-60">
            {col.name}
            <span class="opacity-50">({tasksInCol.length})</span>
          </h2>
          <div class="space-y-2">
            {#each tasksInCol as task (task.id)}
              <div class="card bg-base-200 px-4 py-2 text-sm">{task.title}</div>
            {:else}
              <p class="text-xs italic opacity-40">No tasks</p>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</main>
