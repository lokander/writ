<script lang="ts">
  import { onMount } from "svelte";
  import { NotepadIcon, PlusIcon, LockSimpleIcon, XIcon } from "phosphor-svelte";

  import AddTaskModal from "./lib/AddTaskModal.svelte";
  import TagChip from "./lib/TagChip.svelte";
  import TaskEditModal from "./lib/TaskEditModal.svelte";
  import { writState } from "./lib/state.svelte";
  import { indexTags } from "./lib/tag-color";
  import type { Task } from "../../shared/types";

  type StateFilter = "any" | "ready" | "blocked";
  const STATE_FILTERS: StateFilter[] = ["any", "ready", "blocked"];
  const STORAGE_KEY = "writ:filter";

  let activeColumnId = $state<string | null>(null);
  let editingTaskId = $state<string | null>(null);
  let showAddModal = $state(false);

  // Filter state. Persisted to localStorage so a reload doesn't blow it away.
  // Single key for the whole user — only one project is open at a time and
  // tag names rarely collide cross-project.
  let filterTags = $state<string[]>([]);
  let stateFilter = $state<StateFilter>("any");

  const filtersActive = $derived(filterTags.length > 0 || stateFilter !== "any");

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

  // Persist filter state on every change. Wrapped so a localStorage failure
  // (private mode, full quota) doesn't break the UI.
  $effect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tags: filterTags, state: stateFilter }));
    } catch {
      // ignore — UI continues to work, filters just won't survive a reload
    }
  });

  function matchesFilters(task: Task): boolean {
    // AND across selected tag chips: every selected tag must be on the task.
    for (const want of filterTags) {
      if (!task.tags.includes(want)) return false;
    }
    if (stateFilter === "ready" && !task.isReady) return false;
    if (stateFilter === "blocked" && task.blockedBy.length === 0) return false;
    return true;
  }

  const visibleTasks = $derived(
    filtersActive ? writState.tasks.filter(matchesFilters) : writState.tasks,
  );

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

  // When filters are active, switch to flat-per-column rendering — every
  // matching task surfaces, even if its parent doesn't match (mirrors the
  // CLI's flat-render-when-filtered behavior).
  const tasksInActiveColumn = $derived.by(() => {
    if (activeColumnId === null) return [];
    if (filtersActive) {
      return visibleTasks.filter((t) => t.columnId === activeColumnId);
    }
    return writState.tasks.filter((t) => t.parentId === null && t.columnId === activeColumnId);
  });

  // Tab counts also reflect the filter — otherwise "Backlog (15)" with 3
  // visible tasks is confusing.
  const tasksByColumn = $derived.by(() => {
    const counts: Record<string, number> = {};
    if (filtersActive) {
      for (const t of visibleTasks) counts[t.columnId] = (counts[t.columnId] ?? 0) + 1;
    } else {
      for (const t of writState.tasks) {
        if (t.parentId !== null) continue;
        counts[t.columnId] = (counts[t.columnId] ?? 0) + 1;
      }
    }
    return counts;
  });

  function toggleTagFilter(name: string): void {
    if (filterTags.includes(name)) {
      filterTags = filterTags.filter((t) => t !== name);
    } else {
      filterTags = [...filterTags, name];
    }
  }

  function clearFilters(): void {
    filterTags = [];
    stateFilter = "any";
  }

  onMount(() => {
    writState.loadAll();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tags?: unknown; state?: unknown };
        if (Array.isArray(parsed.tags) && parsed.tags.every((v) => typeof v === "string")) {
          filterTags = parsed.tags;
        }
        if (
          typeof parsed.state === "string" &&
          (STATE_FILTERS as string[]).includes(parsed.state)
        ) {
          stateFilter = parsed.state as StateFilter;
        }
      }
    } catch {
      // ignore corrupted/missing localStorage
    }
  });

  function onTaskCreated(task: Task): void {
    // Jump to whichever column the task landed in, so the user sees what
    // they just authored.
    activeColumnId = task.columnId;
    showAddModal = false;
  }
</script>

<main class="flex h-full flex-col bg-base-100 text-base-content">
  <header class="navbar gap-3 border-b border-base-300 bg-base-200 px-4">
    <NotepadIcon size={24} weight="duotone" />
    <h1 class="text-lg font-semibold">writ</h1>
    {#if writState.project}
      <span class="truncate text-xs opacity-60" title={writState.project.root}>
        {writState.project.root}
      </span>
    {/if}
    {#if writState.project && !writState.loading && !writState.error}
      <button
        type="button"
        class="btn btn-primary btn-sm ml-auto"
        onclick={() => (showAddModal = true)}
      >
        <PlusIcon size={14} weight="bold" />
        New task
      </button>
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
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-base-300 bg-base-200 px-4 py-2"
    >
      {#if writState.tags.length > 0}
        <div class="flex flex-wrap items-center gap-1">
          {#each writState.tags as tag (tag.name)}
            {@const active = filterTags.includes(tag.name)}
            <button
              type="button"
              class="cursor-pointer transition-opacity"
              class:opacity-40={!active}
              aria-pressed={active}
              onclick={() => toggleTagFilter(tag.name)}
            >
              <TagChip name={tag.name} color={tag.color} />
            </button>
          {/each}
        </div>
      {/if}

      <div class="join ml-auto">
        {#each STATE_FILTERS as opt (opt)}
          <button
            type="button"
            class="btn btn-xs join-item"
            class:btn-primary={stateFilter === opt}
            onclick={() => (stateFilter = opt)}
          >
            {opt === "any" ? "All" : opt[0].toUpperCase() + opt.slice(1)}
          </button>
        {/each}
      </div>

      {#if filtersActive}
        <button type="button" class="btn btn-ghost btn-xs" onclick={clearFilters}>
          <XIcon size={12} weight="bold" />
          Clear
        </button>
      {/if}
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
        {@render taskNode(task, null, 0, !filtersActive)}
      {:else}
        <p class="text-sm italic opacity-40">
          {filtersActive ? "No tasks match the active filters." : "No tasks here."}
        </p>
      {/each}
    </div>
  {/if}

  {#snippet taskNode(task: Task, parentColumnId: string | null, depth: number, recurse: boolean)}
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
          <LockSimpleIcon size={14} weight="fill" />
        </span>
      {/if}
      {#each task.tags as tag (tag)}
        <TagChip name={tag} color={colorByTag[tag] ?? null} />
      {/each}
      {#if showColumnBadge}
        <span class="badge badge-outline badge-sm">{columnNameById[task.columnId] ?? "?"}</span>
      {/if}
      {#if n > 0}
        <span class="badge badge-sm" title="{n} subtask{n === 1 ? '' : 's'}">{n}</span>
      {/if}
    </button>
    {#if recurse}
      {#each childrenByParent[task.id] ?? [] as child (child.id)}
        {@render taskNode(child, task.columnId, depth + 1, true)}
      {/each}
    {/if}
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

  {#if showAddModal}
    <AddTaskModal onClose={() => (showAddModal = false)} onCreated={onTaskCreated} />
  {/if}
</main>
