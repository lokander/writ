<script lang="ts">
  import { onMount } from "svelte";
  import { Notepad, Plus, LockSimple } from "phosphor-svelte";

  import TaskEditModal from "./lib/TaskEditModal.svelte";
  import { writState } from "./lib/state.svelte";
  import { indexTags, tagStyle } from "./lib/tag-color";
  import type { Task } from "../../shared/types";

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

  const childrenByParent = $derived.by(() => {
    const map: Record<string, Task[]> = {};
    for (const t of writState.tasks) {
      if (t.parentId === null) continue;
      (map[t.parentId] ??= []).push(t);
    }
    return map;
  });

  const childCount = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const t of writState.tasks) {
      if (t.parentId === null) continue;
      counts[t.parentId] = (counts[t.parentId] ?? 0) + 1;
    }
    return counts;
  });

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  const colorByTag = $derived(indexTags(writState.tags));

  const topLevelInActiveColumn = $derived(
    activeColumnId === null
      ? []
      : writState.tasks.filter((t) => t.parentId === null && t.columnId === activeColumnId),
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
    const created = await writState.createTask({ title: newTaskTitle });
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
      {#each topLevelInActiveColumn as task (task.id)}
        {@render taskNode(task, null, 0)}
      {:else}
        <p class="text-sm italic opacity-40">No tasks here.</p>
      {/each}
    </div>
  {/if}

  {#snippet taskNode(task: Task, parentColumnId: string | null, depth: number)}
    {@const n = childCount[task.id] ?? 0}
    {@const showColumnBadge =
      depth > 0 && parentColumnId !== null && task.columnId !== parentColumnId}
    <button
      type="button"
      class="card flex flex-row items-baseline gap-3 bg-base-200 px-4 py-2 text-left text-sm hover:bg-base-300"
      style:margin-left="{depth * 1.5}rem"
      onclick={() => (editingTaskId = task.id)}
    >
      <span class="font-mono text-xs opacity-50">{task.id.slice(-6)}</span>
      <span class="flex-1">{task.title}</span>
      {#if task.blockedBy.length > 0}
        <span
          class="text-warning"
          title="Blocked by {task.blockedBy.length} open task{task.blockedBy.length === 1
            ? ''
            : 's'}"
        >
          <LockSimple size={14} weight="fill" />
        </span>
      {/if}
      {#each task.tags as tag (tag)}
        {@const ts = tagStyle(tag, colorByTag[tag] ?? null)}
        <span class="badge badge-sm {ts.className}" style:background-color={ts.inlineBg}>
          {tag}
        </span>
      {/each}
      {#if showColumnBadge}
        <span class="badge badge-outline badge-sm">{columnNameById[task.columnId] ?? "?"}</span>
      {/if}
      {#if n > 0}
        <span class="badge badge-sm" title="{n} subtask{n === 1 ? '' : 's'}">{n}</span>
      {/if}
    </button>
    {#each childrenByParent[task.id] ?? [] as child (child.id)}
      {@render taskNode(child, task.columnId, depth + 1)}
    {/each}
  {/snippet}

  {#if editingTask}
    {#key editingTaskId}
      <TaskEditModal
        task={editingTask}
        onClose={() => (editingTaskId = null)}
        onSwitch={(id) => (editingTaskId = id)}
      />
    {/key}
  {/if}
</main>
