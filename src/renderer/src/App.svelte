<script lang="ts">
  import { onMount } from "svelte";
  import {
    FlagIcon,
    FolderOpenIcon,
    FunnelIcon,
    KanbanIcon,
    ListIcon,
    NotepadIcon,
    PlusIcon,
    TagIcon,
    XIcon,
  } from "phosphor-svelte";

  import AddTaskModal from "./lib/modal/AddTaskModal.svelte";
  import ConfirmDialog from "./lib/modal/ConfirmDialog.svelte";
  import KanbanView from "./lib/view/KanbanView.svelte";
  import ListView from "./lib/view/ListView.svelte";
  import TagChip from "./lib/chip/TagChip.svelte";
  import TaskContextMenu from "./lib/picker/TaskContextMenu.svelte";
  import TaskEditModal from "./lib/modal/TaskEditModal.svelte";
  import ToastStack from "./lib/toast/ToastStack.svelte";
  import { PRIORITY_DOT_CLASS } from "./lib/priority-color";
  import { writState } from "./lib/state.svelte";
  import { indexTags } from "./lib/tag-color";
  import { toast } from "./lib/toast/toast.svelte";
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
  // Inline rename for the project display name in the header. Click the
  // name → swap to an input. Enter / blur saves; Esc cancels; empty value
  // clears the override and falls back to the cwd basename.
  let renamingProject = $state(false);
  let renameValue = $state("");

  // Stack of open task modals. Each `onSwitch` (clicking a parent, blocker,
  // subtask, dependent, or markdown id chip) pushes a new entry; the prior
  // modal stays mounted underneath so its form state survives. Closing the
  // top entry pops it; closing the bottom collapses the stack to empty.
  // Capped at MAX_MODAL_STACK_DEPTH — a 6th push surfaces a toast rather
  // than silently swallowing the click.
  type ModalEntry = { taskId: string; initialMode: "view" | "edit"; uid: number };
  const MAX_MODAL_STACK_DEPTH = 5;
  let modalStack = $state<ModalEntry[]>([]);
  // Bumped on every push so {#each} keying remounts a fresh component when
  // the same task is pushed twice (cycle A → B → A lands a brand-new A on
  // top of the original A, not a re-use).
  let nextModalUid = 1;

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
    if (modalStack.length >= MAX_MODAL_STACK_DEPTH) {
      toast.show(
        `Modal stack at max depth (${MAX_MODAL_STACK_DEPTH}). Close one before opening another.`,
        { variant: "warning" },
      );
      return;
    }
    modalStack = [...modalStack, { taskId: id, initialMode: mode, uid: nextModalUid++ }];
  }

  function closeTopModal(): void {
    modalStack = modalStack.slice(0, -1);
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

  // Switch to a different writ project via native folder picker. Cancel is a
  // no-op. A folder without `.writ/writ.db` switches to the empty state with
  // the error rendered inline (main has already cleared currentProject). On
  // success, main has swapped currentProject; we refetch so the UI redraws.
  async function openProjectFolder(): Promise<void> {
    try {
      const result = await window.api.project.openFolder();
      if ("canceled" in result) return;
      if ("error" in result) {
        // Main skipped the broadcast on the error path so this silent refetch
        // doesn't race the error setter that follows it. Use the sticky
        // empty-state surface (not a toast) — picking a non-writ folder
        // leaves the app project-less, and the user needs the explanation
        // visible until they pick another folder or run `writ init`.
        await writState.loadAll({ silent: true });
        writState.error = result.error;
        return;
      }
      await writState.loadAll();
    } catch (e) {
      // Unexpected IPC failure during folder-pick — surface transiently;
      // the app state hasn't necessarily changed.
      toast.show(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
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
      {#if writState.project && !writState.loading}
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
    <div class="flex justify-end gap-1">
      {#if !writState.loading}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={openProjectFolder}
          title="Open another writ project…"
          aria-label="Open project"
        >
          <FolderOpenIcon size={14} weight="bold" />
        </button>
      {/if}
      {#if writState.project && !writState.loading}
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
    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      {#if writState.error}
        <div class="alert alert-error max-w-2xl">{writState.error}</div>
      {:else}
        <p>No writ project found.</p>
      {/if}
      <button type="button" class="btn btn-primary btn-sm" onclick={openProjectFolder}>
        <FolderOpenIcon size={14} weight="bold" />
        Open project…
      </button>
      <p class="text-sm opacity-60">
        Or run <code class="kbd">writ init</code> in a project directory.
      </p>
    </div>
  {:else}
    <!-- Mutation failures surface through <ToastStack /> at the bottom of
         the tree, not an inline banner. `writState.error` is now only the
         empty-state surface (handled in the !writState.project branch
         above). -->
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

  {#each modalStack as entry, i (entry.uid)}
    {@const isTop = i === modalStack.length - 1}
    <TaskEditModal
      taskId={entry.taskId}
      initialMode={entry.initialMode}
      {isTop}
      stackIndex={i}
      onClose={closeTopModal}
      onSwitch={(id) => openTaskModal(id)}
    />
  {/each}

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

  <ToastStack />
</main>
