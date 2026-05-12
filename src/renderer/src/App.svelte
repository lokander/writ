<script lang="ts">
  import { onMount } from "svelte";

  import AddTaskModal from "./lib/modal/AddTaskModal.svelte";
  import AppBar, { VIEWS, type View } from "./lib/bar/AppBar.svelte";
  import FilterBar from "./lib/bar/FilterBar.svelte";
  import ConfirmDialog from "./lib/modal/ConfirmDialog.svelte";
  import EmptyState from "./lib/view/EmptyState.svelte";
  import KanbanView from "./lib/view/KanbanView.svelte";
  import ListView from "./lib/view/ListView.svelte";
  import TaskContextMenu from "./lib/picker/TaskContextMenu.svelte";
  import TaskEditModal from "./lib/modal/TaskEditModal.svelte";
  import ToastStack from "./lib/toast/ToastStack.svelte";
  import { filters } from "./lib/filters.svelte";
  import { writState } from "./lib/state.svelte";
  import { toast } from "./lib/toast/toast.svelte";
  import type { Priority, Task } from "../../shared/types";

  const VIEW_STORAGE_KEY = "writ:view";

  let activeColumnId = $state<string | null>(null);

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

  function onViewChange(v: View): void {
    if (v === view) return;
    view = v;
    filters.clear();
  }

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

  // Persistence dance for the active view (kanban vs list).
  $effect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // ignore
    }
  });

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
    for (const name of filters.tags) seen[name] = true;
    return seen;
  });

  const visibleTagChips = $derived(writState.tags.filter((t) => tagsInView[t.name]));

  onMount(() => {
    writState.loadAll();
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
      const previousRoot = writState.project?.root ?? null;
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
      // Tag chips and tag-mode/state filters from the old project usually
      // don't carry meaning in the new one (different tag names, different
      // task pool). Reset so the user starts the new project unfiltered.
      const currentRoot = writState.project?.root ?? null;
      if (previousRoot !== null && currentRoot !== null && currentRoot !== previousRoot) {
        filters.clear();
      }
    } catch (e) {
      // Unexpected IPC failure during folder-pick — surface transiently;
      // the app state hasn't necessarily changed.
      toast.show(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  }
</script>

<main class="flex h-full flex-col bg-base-100 text-base-content">
  <AppBar
    {view}
    {onViewChange}
    onOpenProject={openProjectFolder}
    onNewTask={() => (showAddModal = true)}
  />

  {#if writState.loading || !writState.project}
    <EmptyState onOpenProject={openProjectFolder} />
  {:else}
    <!-- Mutation failures surface through <ToastStack /> at the bottom of
         the tree, not an inline banner. `writState.error` is now only the
         empty-state surface (handled in the !writState.project branch
         above). -->
    <FilterBar {visibleTagChips} />

    {#if view === "kanban"}
      <KanbanView
        columns={writState.columns}
        onTaskClick={(id) => openTaskModal(id)}
        onTaskContextMenu={openContextMenu}
        contextMenuTaskId={contextMenuFor?.taskId ?? null}
      />
    {:else}
      <ListView
        columns={writState.columns}
        bind:activeColumnId
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
