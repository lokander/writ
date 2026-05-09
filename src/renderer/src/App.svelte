<script lang="ts">
  import { onMount } from "svelte";
  import { NotepadIcon, PlusIcon, XIcon } from "phosphor-svelte";

  import AddTaskModal from "./lib/AddTaskModal.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import KanbanView from "./lib/KanbanView.svelte";
  import ListView from "./lib/ListView.svelte";
  import TagChip from "./lib/TagChip.svelte";
  import TaskContextMenu from "./lib/TaskContextMenu.svelte";
  import TaskEditModal from "./lib/TaskEditModal.svelte";
  import { writState } from "./lib/state.svelte";
  import { indexTags } from "./lib/tag-color";
  import type { Priority, Task } from "../../shared/types";

  type StateFilter = "any" | "ready" | "blocked";
  type View = "kanban" | "list";
  const STATE_FILTERS: StateFilter[] = ["any", "ready", "blocked"];
  const VIEWS: View[] = ["kanban", "list"];
  const FILTER_STORAGE_KEY = "writ:filter";
  const VIEW_STORAGE_KEY = "writ:view";

  let activeColumnId = $state<string | null>(null);
  let editingTaskId = $state<string | null>(null);
  // Captured fresh each time the modal opens; the modal reads it once on
  // mount via untrack. Card clicks land in "view"; context-menu Edit lands
  // in "edit".
  let editingInitialMode = $state<"view" | "edit">("view");
  let showAddModal = $state(false);
  let view = $state<View>("kanban");

  // Right-click context menu. Holds the target task and the cursor position
  // captured at right-click time. Cleared on action / outside-click / Esc.
  let contextMenuFor = $state<{ taskId: string; x: number; y: number } | null>(null);
  let contextMenuDeleteFor = $state<string | null>(null);

  const contextMenuTask = $derived(
    contextMenuFor === null
      ? null
      : (writState.tasks.find((t) => t.id === contextMenuFor!.taskId) ?? null),
  );
  const contextMenuDeleteTask = $derived(
    contextMenuDeleteFor === null
      ? null
      : (writState.tasks.find((t) => t.id === contextMenuDeleteFor) ?? null),
  );
  const contextMenuDeleteChildCount = $derived(
    contextMenuDeleteFor === null
      ? 0
      : writState.tasks.filter((t) => t.parentId === contextMenuDeleteFor).length,
  );

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
      localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ tags: filterTags, state: stateFilter }),
      );
    } catch {
      // ignore — UI continues to work, filters just won't survive a reload
    }
  });

  // Same persistence dance for the active view (kanban vs list).
  $effect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // ignore
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
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
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
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      if (v && (VIEWS as string[]).includes(v)) view = v as View;
    } catch {
      // ignore
    }

    // Live-reload on window focus regain. Covers the common "tab to terminal,
    // run a CLI / MCP command, tab back to the app" flow without making the
    // user manually refresh. Real-time push (writ task 4G1C0D, Phase 7) is
    // the long-term answer; this is the cheap interim.
    const onFocus = (): void => {
      writState.loadAll();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  function onTaskCreated(task: Task): void {
    // Jump to whichever column the task landed in, so the user sees what
    // they just authored.
    activeColumnId = task.columnId;
    showAddModal = false;
  }

  function openTaskModal(id: string, mode: "view" | "edit" = "view"): void {
    editingInitialMode = mode;
    editingTaskId = id;
  }

  function openContextMenu(taskId: string, event: MouseEvent): void {
    contextMenuFor = { taskId, x: event.clientX, y: event.clientY };
  }

  function closeContextMenu(): void {
    contextMenuFor = null;
  }

  function cmEdit(): void {
    if (!contextMenuFor) return;
    openTaskModal(contextMenuFor.taskId, "edit");
    closeContextMenu();
  }

  function cmSetPriority(p: Priority): void {
    if (!contextMenuFor) return;
    void writState.updateTask(contextMenuFor.taskId, { priority: p });
    closeContextMenu();
  }

  function cmMove(columnId: string): void {
    if (!contextMenuFor) return;
    void writState.updateTask(contextMenuFor.taskId, { columnId });
    closeContextMenu();
  }

  function cmRequestDelete(): void {
    if (!contextMenuFor) return;
    contextMenuDeleteFor = contextMenuFor.taskId;
    closeContextMenu();
  }

  async function cmConfirmDelete(): Promise<void> {
    if (!contextMenuDeleteFor) return;
    const id = contextMenuDeleteFor;
    contextMenuDeleteFor = null;
    await writState.deleteTask(id);
  }
</script>

<main class="flex h-full flex-col bg-base-100 text-base-content">
  <header
    class="grid min-h-16 grid-cols-3 items-center gap-3 border-b border-base-300 bg-base-200 px-4"
  >
    <div class="flex min-w-0 items-center gap-3">
      <NotepadIcon size={24} weight="duotone" />
      <h1 class="text-lg font-semibold">writ</h1>
      {#if writState.project}
        <span class="truncate text-xs opacity-60" title={writState.project.root}>
          {writState.project.root}
        </span>
      {/if}
    </div>
    <div class="flex justify-center">
      {#if writState.project && !writState.loading && !writState.error}
        <div class="join">
          {#each VIEWS as v (v)}
            <button
              type="button"
              class="btn btn-primary btn-xs join-item w-16"
              class:btn-soft={view !== v}
              onclick={() => (view = v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="flex justify-end">
      {#if writState.project && !writState.loading && !writState.error}
        <button type="button" class="btn btn-primary btn-sm" onclick={() => (showAddModal = true)}>
          <PlusIcon size={14} weight="bold" />
          New task
        </button>
      {/if}
    </div>
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
      <div class="join">
        {#each STATE_FILTERS as opt (opt)}
          <button
            type="button"
            class="btn btn-primary btn-xs join-item"
            class:btn-soft={stateFilter !== opt}
            onclick={() => (stateFilter = opt)}
          >
            {opt === "any" ? "All" : opt[0].toUpperCase() + opt.slice(1)}
          </button>
        {/each}
      </div>

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

      {#if filtersActive}
        <button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={clearFilters}>
          <XIcon size={12} weight="bold" />
          Clear
        </button>
      {/if}
    </div>

    {#if view === "kanban"}
      <KanbanView
        columns={writState.columns}
        {visibleTasks}
        {colorByTag}
        {childCount}
        onTaskClick={(id) => openTaskModal(id)}
        onTaskContextMenu={openContextMenu}
        contextMenuTaskId={contextMenuFor?.taskId ?? null}
      />
    {:else}
      <ListView
        columns={writState.columns}
        {visibleTasks}
        {filtersActive}
        bind:activeColumnId
        {childrenByParent}
        {childCount}
        {columnNameById}
        {colorByTag}
        onTaskClick={(id) => openTaskModal(id)}
        onTaskContextMenu={openContextMenu}
        contextMenuTaskId={contextMenuFor?.taskId ?? null}
      />
    {/if}
  {/if}

  {#if editingTask}
    {#key editingTaskId}
      <TaskEditModal
        task={editingTask}
        initialMode={editingInitialMode}
        onClose={() => (editingTaskId = null)}
        onSwitch={(id) => openTaskModal(id)}
      />
    {/key}
  {/if}

  {#if showAddModal}
    <AddTaskModal onClose={() => (showAddModal = false)} onCreated={onTaskCreated} />
  {/if}

  {#if contextMenuFor && contextMenuTask}
    {#key contextMenuFor.taskId}
      <TaskContextMenu
        task={contextMenuTask}
        columns={writState.columns}
        x={contextMenuFor.x}
        y={contextMenuFor.y}
        onEdit={cmEdit}
        onSetPriority={cmSetPriority}
        onMove={cmMove}
        onDelete={cmRequestDelete}
        onClose={closeContextMenu}
      />
    {/key}
  {/if}

  {#if contextMenuDeleteTask}
    <ConfirmDialog
      title="Delete this task?"
      message={contextMenuDeleteChildCount > 0
        ? `This will also delete ${contextMenuDeleteChildCount} subtask${contextMenuDeleteChildCount === 1 ? "" : "s"}. Can't be undone.`
        : "Can't be undone."}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="danger"
      onConfirm={cmConfirmDelete}
      onCancel={() => (contextMenuDeleteFor = null)}
    />
  {/if}
</main>
