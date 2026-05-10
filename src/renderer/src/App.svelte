<script lang="ts">
  import { onMount } from "svelte";
  import {
    FlagIcon,
    FunnelIcon,
    KanbanIcon,
    ListIcon,
    NotepadIcon,
    PlusIcon,
    TagIcon,
    XIcon,
  } from "phosphor-svelte";

  import AddTaskModal from "./lib/AddTaskModal.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import KanbanView from "./lib/KanbanView.svelte";
  import ListView from "./lib/ListView.svelte";
  import TagChip from "./lib/TagChip.svelte";
  import TaskContextMenu from "./lib/TaskContextMenu.svelte";
  import TaskEditModal from "./lib/TaskEditModal.svelte";
  import { PRIORITY_DOT_CLASS } from "./lib/priority-color";
  import { writState } from "./lib/state.svelte";
  import { indexTags } from "./lib/tag-color";
  import { PRIORITY_NAMES, type Priority, type Task } from "../../shared/types";

  type StateFilter = "any" | "ready" | "blocked";
  type View = "kanban" | "list";
  const STATE_FILTERS: StateFilter[] = ["any", "ready", "blocked"];
  // Order matches the priority enum so the chip row reads urgent → low.
  const PRIORITY_CHIPS: { value: Priority; label: string; dotClass: string }[] = [
    { value: 0, label: PRIORITY_NAMES[0], dotClass: PRIORITY_DOT_CLASS[0] },
    { value: 1, label: PRIORITY_NAMES[1], dotClass: PRIORITY_DOT_CLASS[1] },
    { value: 2, label: PRIORITY_NAMES[2], dotClass: PRIORITY_DOT_CLASS[2] },
    { value: 3, label: PRIORITY_NAMES[3], dotClass: PRIORITY_DOT_CLASS[3] },
  ];
  const VIEWS: View[] = ["list", "kanban"];
  const FILTER_STORAGE_KEY = "writ:filter";
  const VIEW_STORAGE_KEY = "writ:view";

  let activeColumnId = $state<string | null>(null);
  let editingTaskId = $state<string | null>(null);
  // Inline rename for the project display name in the header. Click the
  // name → swap to an input. Enter / blur saves; Esc cancels; empty value
  // clears the override and falls back to the cwd basename.
  let renamingProject = $state(false);
  let renameValue = $state("");
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
  let filterPriorities = $state<Priority[]>([]);
  // How selected tag chips combine: "all" requires every selected tag on the
  // task (AND); "any" requires at least one (OR — parity with `--any-tag`).
  let tagMode = $state<"all" | "any">("all");
  let stateFilter = $state<StateFilter>("any");

  const filtersActive = $derived(
    filterTags.length > 0 || filterPriorities.length > 0 || stateFilter !== "any",
  );

  // The modal owns its own "task disappeared" handling — it can decide
  // whether to silently close (view mode / no unsaved edits) or stay open
  // with a "deleted by another writer" banner so the user doesn't lose
  // unsaved work to a CLI/MCP delete that lands mid-edit.

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
        JSON.stringify({
          tags: filterTags,
          tagMode,
          priorities: filterPriorities,
          state: stateFilter,
        }),
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
    if (filterTags.length > 0) {
      // tagMode picks the combinator: "all" → every selected tag on the task
      // (AND), "any" → at least one (OR, parity with CLI's --any-tag).
      if (tagMode === "any") {
        if (!filterTags.some((want) => task.tags.includes(want))) return false;
      } else {
        for (const want of filterTags) {
          if (!task.tags.includes(want)) return false;
        }
      }
    }
    // OR across selected priority chips: any match passes. Empty = no narrowing.
    if (filterPriorities.length > 0 && !filterPriorities.includes(task.priority)) {
      return false;
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

  // Tag chips are scoped to tags actually present in the user's current
  // view scope — kanban hides Backlog/Archived, list shows just the active
  // tab's column. Filtering by tag still narrows within that scope, but
  // the legend stops listing tags the user can't see anyway. Active filter
  // tags are always kept in the chip set so they remain togglable even
  // after the tasks they matched moved out of view.
  const tagsInView = $derived.by(() => {
    const seen: Record<string, true> = {};
    if (view === "kanban") {
      const hidden: Record<string, true> = {};
      for (const c of writState.columns) {
        const n = c.name.toLowerCase();
        if (n === "backlog" || n === "archived") hidden[c.id] = true;
      }
      for (const t of writState.tasks) {
        if (hidden[t.columnId]) continue;
        for (const name of t.tags) seen[name] = true;
      }
    } else if (activeColumnId !== null) {
      for (const t of writState.tasks) {
        if (t.columnId !== activeColumnId) continue;
        for (const name of t.tags) seen[name] = true;
      }
    }
    for (const name of filterTags) seen[name] = true;
    return seen;
  });

  const visibleTagChips = $derived(writState.tags.filter((t) => tagsInView[t.name]));

  function toggleTagFilter(name: string): void {
    if (filterTags.includes(name)) {
      filterTags = filterTags.filter((t) => t !== name);
    } else {
      filterTags = [...filterTags, name];
    }
  }

  function togglePriorityFilter(p: Priority): void {
    if (filterPriorities.includes(p)) {
      filterPriorities = filterPriorities.filter((x) => x !== p);
    } else {
      filterPriorities = [...filterPriorities, p];
    }
  }

  function clearFilters(): void {
    filterTags = [];
    filterPriorities = [];
    tagMode = "all";
    stateFilter = "any";
  }

  onMount(() => {
    writState.loadAll();
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          tags?: unknown;
          tagMode?: unknown;
          priorities?: unknown;
          state?: unknown;
        };
        if (Array.isArray(parsed.tags) && parsed.tags.every((v) => typeof v === "string")) {
          filterTags = parsed.tags;
        }
        if (parsed.tagMode === "all" || parsed.tagMode === "any") {
          tagMode = parsed.tagMode;
        }
        if (
          Array.isArray(parsed.priorities) &&
          parsed.priorities.every((v) => v === 0 || v === 1 || v === 2 || v === 3)
        ) {
          filterPriorities = parsed.priorities as Priority[];
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

    // Live-reload on push: main broadcasts `project:changed` when the
    // liveness socket receives a CLI / MCP ping, or fs.watch on `.writ/`
    // sees the DB change. Covers the "tab to terminal, run writ task add,
    // tab back" flow plus any third-party write that bypasses our tools.
    // `silent: true` skips the loading flicker so the main view stays
    // mounted across the refetch — keyed each blocks diff by id and only
    // changed rows actually re-render.
    return window.api.events.onProjectChanged(() => {
      writState.loadAll({ silent: true });
    });
  });

  function onTaskCreated(task: Task): void {
    // Jump to whichever column the task landed in, so the user sees what
    // they just authored.
    activeColumnId = task.columnId;
    showAddModal = false;
  }

  // Last segment of a path, regardless of separator. The renderer doesn't
  // import node:path; this is fine for both POSIX and Windows roots.
  function basenameOf(path: string): string {
    const segments = path.split(/[/\\]/).filter((s) => s.length > 0);
    return segments[segments.length - 1] ?? path;
  }

  function startRename(): void {
    renameValue = writState.project?.displayName ?? "";
    renamingProject = true;
  }

  async function commitRename(): Promise<void> {
    if (!renamingProject) return;
    const trimmed = renameValue.trim();
    renamingProject = false;
    await writState.setDisplayName(trimmed.length === 0 ? null : trimmed);
  }

  function cancelRename(): void {
    renamingProject = false;
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
    class="grid grid-cols-3 items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-2"
  >
    <div class="flex min-w-0 items-center gap-3">
      <span class="flex shrink-0 items-center">
        <NotepadIcon size={24} weight="duotone" />
        <h1 class="font-mono text-lg font-semibold ml-1">writ</h1>
      </span>
      {#if writState.project}
        {@const usingFallback = writState.project.displayName === null}
        {@const displayed = writState.project.displayName ?? basenameOf(writState.project.root)}
        <span class="shrink-0 font-mono text-lg opacity-30" aria-hidden="true">::</span>
        {#if renamingProject}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            class="min-w-0 flex-1 truncate rounded border border-base-content/30 bg-transparent px-2 py-0.5 font-mono text-lg outline-none focus:border-primary"
            placeholder={basenameOf(writState.project.root)}
            bind:value={renameValue}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onblur={commitRename}
            autofocus
          />
        {:else}
          <button
            type="button"
            class="shrink-0 cursor-pointer truncate font-mono text-lg hover:opacity-100"
            class:opacity-60={usingFallback}
            class:opacity-80={!usingFallback}
            title="Edit project name"
            onclick={startRename}
          >
            {displayed}
          </button>
          <span
            class="min-w-0 flex-1 truncate font-mono text-xs opacity-40"
            title={writState.project.root}
          >
            {writState.project.prettyRoot}
          </span>
        {/if}
      {/if}
    </div>
    <div class="flex justify-center">
      {#if writState.project && !writState.loading && !writState.error}
        <div class="join">
          {#each VIEWS as v (v)}
            <button
              type="button"
              class="btn btn-primary btn-xs join-item w-24"
              class:btn-soft={view !== v}
              onclick={() => (view = v)}
            >
              {#if v === "list"}
                <ListIcon size={14} weight="bold" />
              {:else}
                <KanbanIcon size={14} weight="bold" />
              {/if}
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="flex justify-end">
      {#if writState.project && !writState.loading && !writState.error}
        <button type="button" class="btn btn-primary btn-xs" onclick={() => (showAddModal = true)}>
          <PlusIcon size={12} weight="bold" />
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
  {:else}
    {#if writState.error}
      <!-- Non-destructive banner above the main view. Mutations that fail
           (drag rollback, modal save error) used to swap out the kanban
           entirely; surfacing the error inline here keeps the user's work
           visible while still flagging the failure. Cleared on the next
           successful loadAll (push refresh, manual reload). -->
      <div class="alert alert-error mx-4 mt-4">{writState.error}</div>
    {/if}
    <div
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 transition-colors {filtersActive
        ? 'border-primary/40 bg-primary/5'
        : 'border-base-300 bg-base-200'}"
    >
      <div class="flex items-center gap-2">
        <FunnelIcon size={20} class="ml-0.5 opacity-60" aria-label="Filter" />
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
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <FlagIcon size={14} class="opacity-50" aria-label="Priority" />
        {#each PRIORITY_CHIPS as chip (chip.value)}
          {@const active = filterPriorities.includes(chip.value)}
          <button
            type="button"
            class="flex items-center gap-1 rounded-full border border-base-content/20 px-2 py-0.5 text-xs transition-opacity"
            class:opacity-40={!active}
            aria-pressed={active}
            onclick={() => togglePriorityFilter(chip.value)}
          >
            <span class="inline-block h-2 w-2 rounded-full {chip.dotClass}"></span>
            <span class="capitalize">{chip.label}</span>
          </button>
        {/each}
      </div>

      {#if visibleTagChips.length > 0}
        <div class="flex flex-wrap items-center gap-2">
          <TagIcon size={14} class="opacity-50" aria-label="Tags" />
          <div class="join">
            {#each ["all", "any"] as const as mode (mode)}
              <button
                type="button"
                class="btn btn-primary btn-xs join-item"
                class:btn-soft={tagMode !== mode}
                title={mode === "all"
                  ? "Match tasks tagged with every selected tag"
                  : "Match tasks tagged with any of the selected tags"}
                onclick={() => (tagMode = mode)}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </button>
            {/each}
          </div>
          <div class="flex flex-wrap items-center gap-1">
            {#each visibleTagChips as tag (tag.name)}
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
        </div>
      {/if}

      {#if filtersActive}
        <button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={clearFilters}>
          <XIcon size={12} weight="bold" />
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

  {#if editingTaskId !== null}
    {#key editingTaskId}
      <TaskEditModal
        taskId={editingTaskId}
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
      task={{ title: contextMenuDeleteTask.title, id: contextMenuDeleteTask.id }}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="danger"
      onConfirm={cmConfirmDelete}
      onCancel={() => (contextMenuDeleteFor = null)}
    />
  {/if}
</main>
