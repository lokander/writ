<script lang="ts">
  import { onMount } from "svelte";
  import { Notepad, Plus } from "phosphor-svelte";

  import TaskEditModal from "./lib/TaskEditModal.svelte";
  import { writState } from "./lib/state.svelte";

  let newTaskTitle = $state("");
  let activeColumnId = $state<string | null>(null);
  let editingTaskId = $state<string | null>(null);

  const editingTask = $derived(
    editingTaskId === null ? null : (writState.tasks.find((t) => t.id === editingTaskId) ?? null),
  );

  // If the task being edited disappears (e.g. deleted), close the modal.
  $effect(() => {
    if (editingTaskId !== null && editingTask === null) editingTaskId = null;
  });

  // Default the active tab to the first column once columns load. Re-runs if
  // the columns list changes; doesn't override an already-set active tab as
  // long as it still exists.
  $effect(() => {
    if (writState.columns.length === 0) return;
    const stillThere = writState.columns.some((c) => c.id === activeColumnId);
    if (!stillThere) activeColumnId = writState.columns[0]!.id;
  });

  const tasksInActiveColumn = $derived(
    activeColumnId === null
      ? []
      : writState.tasks.filter((t) => t.columnId === activeColumnId && t.parentId === null),
  );

  const tasksByColumn = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const t of writState.tasks) {
      if (t.parentId !== null) continue;
      counts[t.columnId] = (counts[t.columnId] ?? 0) + 1;
    }
    return counts;
  });

  onMount(() => {
    writState.loadAll();
  });

  async function handleAdd(): Promise<void> {
    if (newTaskTitle.trim().length === 0) return;
    const created = await writState.addTask(newTaskTitle);
    if (created) {
      // Jump to whichever column the task landed in (Backlog by default), so
      // the user sees what they just typed.
      activeColumnId = created.columnId;
      newTaskTitle = "";
    }
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
          placeholder="Add a task"
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

    <div role="tablist" class="tabs tabs-border bg-base-200 px-4">
      {#each writState.columns as col (col.id)}
        {@const count = tasksByColumn[col.id] ?? 0}
        <button
          type="button"
          role="tab"
          class="tab"
          class:tab-active={activeColumnId === col.id}
          onclick={() => (activeColumnId = col.id)}
        >
          {col.name}
          <span class="ml-2 text-xs opacity-60">{count}</span>
        </button>
      {/each}
    </div>

    <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      {#each tasksInActiveColumn as task (task.id)}
        <button
          type="button"
          class="card flex flex-row items-baseline gap-3 bg-base-200 px-4 py-2 text-left text-sm hover:bg-base-300"
          onclick={() => (editingTaskId = task.id)}
        >
          <span class="font-mono text-xs opacity-50">{task.id.slice(-6)}</span>
          <span>{task.title}</span>
        </button>
      {:else}
        <p class="text-sm italic opacity-40">No tasks here.</p>
      {/each}
    </div>
  {/if}

  {#if editingTask}
    <TaskEditModal task={editingTask} onClose={() => (editingTaskId = null)} />
  {/if}
</main>
