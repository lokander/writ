<script lang="ts">
  import { onMount } from "svelte";
  import { LockSimpleIcon } from "phosphor-svelte";

  import type { Column, Task } from "../../../../shared/types";
  import { writState } from "../state.svelte";
  import { draggable, dropTarget, monitorForElements } from "../dnd/dnd";
  import HiddenDropZone from "../dnd/HiddenDropZone.svelte";
  import { PRIORITY_BORDER_CLASS } from "../priority-color";
  import TagChip from "../chip/TagChip.svelte";
  import TaskIdChip from "../chip/TaskIdChip.svelte";

  interface Props {
    columns: Column[];
    /** The post-filter task set. Kanban renders flat-per-column — every
     *  matching task surfaces, regardless of nesting. */
    visibleTasks: Task[];
    colorByTag: Record<string, string | null>;
    /** Subtask count per task id — shown as a badge so the user can see at a
     *  glance which cards have children (visible only via the modal). */
    childCount: Record<string, number>;
    /** False when a non-position sort is active. Disables card drag so the
     *  user doesn't reorder `position` while looking at a different sort —
     *  the move would be invisible until they switched sorts back. */
    dragEnabled: boolean;
    onTaskClick: (id: string) => void;
    onTaskContextMenu: (id: string, event: MouseEvent) => void;
    /** Id of the task whose context menu is currently open, if any. The
     *  matching card gets the hover styling pinned so the user keeps a
     *  visual link between the menu and its target. */
    contextMenuTaskId: string | null;
  }

  const {
    columns,
    visibleTasks,
    colorByTag,
    childCount,
    dragEnabled,
    onTaskClick,
    onTaskContextMenu,
    contextMenuTaskId,
  }: Props = $props();

  // Backlog and Archived are intentionally hidden from kanban — Backlog is
  // a pre-active staging list, Archived is post-resolved storage. Both stay
  // visible in list view. Archived gets a special drop zone at the right
  // edge that reveals on drag-from-Done; Backlog has no inline affordance
  // yet (see writ task `5X64HY5` for the planned mirror).
  const visibleColumns = $derived(
    columns.filter((c) => {
      const n = c.name.toLowerCase();
      return n !== "backlog" && n !== "archived";
    }),
  );

  const archivedColumn = $derived(columns.find((c) => c.name.toLowerCase() === "archived") ?? null);
  const backlogColumn = $derived(columns.find((c) => c.name.toLowerCase() === "backlog") ?? null);

  function tasksInColumn(colId: string): Task[] {
    return visibleTasks.filter((t) => t.columnId === colId);
  }

  function parentOf(parentId: string): Task | undefined {
    return writState.tasks.find((t) => t.id === parentId);
  }

  // Drag visual state. Single dragging-card id (passed to HiddenDropZone so
  // it can derive its own reveal state) and a hovered-column id for the
  // regular columns' tint.
  let draggingTaskId = $state<string | null>(null);
  let hoveredColumnId = $state<string | null>(null);

  /** "Append at bottom" position for the target column. Mirrors the domain's
   *  moveTask: max(positions in target column) + 1000. */
  function nextPositionInColumn(columnId: string): number {
    let max = 0;
    for (const t of writState.tasks) {
      if (t.columnId === columnId && t.position > max) max = t.position;
    }
    return max + 1000;
  }

  function onCardDrop(taskId: string, targetColumnId: string): void {
    const task = writState.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (task.columnId === targetColumnId) return; // same-column drop is a no-op

    // Snapshot pre-drop fields so we can roll back if the IPC fails — without
    // this, a thrown `tasks:update` leaves the card in its new column visually
    // while the DB still holds the old one.
    const previousColumnId = task.columnId;
    const previousPosition = task.position;
    const newPosition = nextPositionInColumn(targetColumnId);

    // Optimistic local update so the card jumps before the IPC round-trips.
    // On the ok / conflict paths writState.updateTask already replaces this
    // entry with the canonical row; only "missing" (IPC error or row gone)
    // needs an explicit revert.
    writState.tasks = writState.tasks.map((t) =>
      t.id === taskId ? { ...t, columnId: targetColumnId, position: newPosition } : t,
    );

    void writState
      .updateTask(taskId, { columnId: targetColumnId, position: newPosition })
      .then((outcome) => {
        if (outcome.kind !== "missing") return;
        writState.tasks = writState.tasks.map((t) =>
          t.id === taskId ? { ...t, columnId: previousColumnId, position: previousPosition } : t,
        );
      });
  }

  // One global monitor watches every drop in the kanban. Cleaner than
  // wiring a handler per drop target — Pragmatic recommends this pattern.
  onMount(() =>
    monitorForElements({
      onDrop: ({ source, location }) => {
        if (source.data.type !== "card") return;
        const target = location.current.dropTargets[0];
        if (!target || target.data.type !== "column") return;
        onCardDrop(source.data.taskId as string, target.data.columnId as string);
      },
    }),
  );
</script>

<!-- Outer container: occupies remaining vertical space, scrolls horizontally
     when the column count overflows the viewport. overflow-y is hidden so
     each column's body owns its own vertical scrollbar (Trello pattern). -->
<div class="flex flex-1 gap-4 overflow-x-auto overflow-y-hidden p-4">
  <!-- Backlog drop zone (left edge): reveals on drag-from-Todo. Demote a
       card that turned out not to be next-up. -->
  {#if backlogColumn}
    <HiddenDropZone target={backlogColumn} fromColumnName="todo" label="Backlog" {draggingTaskId} />
  {/if}

  {#each visibleColumns as col (col.id)}
    {@const colTasks = tasksInColumn(col.id)}
    <div class="flex w-80 shrink-0 flex-col">
      <div class="mb-2 flex shrink-0 items-baseline justify-between">
        <h3 class="text-sm font-semibold">{col.name}</h3>
        <span class="text-xs opacity-60">{colTasks.length}</span>
      </div>
      <!-- min-h-0 lets this flex child shrink below content size so the
           overflow-y-auto actually engages. -->
      <div
        class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-1 transition-colors {hoveredColumnId ===
        col.id
          ? 'bg-primary/10'
          : ''}"
        use:dropTarget={{
          data: { type: "column", columnId: col.id },
          canDrop: ({ source }) => {
            // Hide drop feedback when the drag's source column is this
            // column — the drop would be a no-op.
            const srcId = source.data.taskId as string | undefined;
            const src = srcId ? writState.tasks.find((t) => t.id === srcId) : undefined;
            return !src || src.columnId !== col.id;
          },
          onDragEnter: () => (hoveredColumnId = col.id),
          onDragLeave: () => (hoveredColumnId = null),
          onDrop: () => (hoveredColumnId = null),
        }}
      >
        {#each colTasks as task (task.id)}
          {@const n = childCount[task.id] ?? 0}
          {@const parent = task.parentId ? parentOf(task.parentId) : undefined}
          <button
            type="button"
            class="card flex flex-col gap-1 border-l-4 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300 {PRIORITY_BORDER_CLASS[
              task.priority
            ]}"
            class:opacity-40={draggingTaskId === task.id}
            class:bg-base-300={contextMenuTaskId === task.id}
            onclick={() => onTaskClick(task.id)}
            oncontextmenu={(e) => {
              e.preventDefault();
              onTaskContextMenu(task.id, e);
            }}
            use:draggable={{
              data: { type: "card", taskId: task.id },
              disabled: !dragEnabled,
              onDragStart: () => (draggingTaskId = task.id),
              onDrop: () => (draggingTaskId = null),
            }}
          >
            {#if parent}
              <span class="truncate text-xs opacity-50" title="Subtask of {parent.title}">
                ↳ {parent.title}
              </span>
            {/if}
            <div class="flex items-baseline gap-2">
              <TaskIdChip id={task.id} />
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
            </div>
            {#if task.tags.length > 0 || n > 0}
              <div class="flex flex-wrap items-center gap-1">
                {#each task.tags as tag (tag)}
                  <TagChip name={tag} color={colorByTag[tag] ?? null} />
                {/each}
                {#if n > 0}
                  <span class="badge badge-sm" title="{n} subtask{n === 1 ? '' : 's'}">{n}</span>
                {/if}
              </div>
            {/if}
          </button>
        {:else}
          <p class="text-xs italic opacity-40">No tasks.</p>
        {/each}
      </div>
    </div>
  {/each}

  <!-- Archive drop zone (right edge): reveals on drag-from-Done. -->
  {#if archivedColumn}
    <HiddenDropZone
      target={archivedColumn}
      fromColumnName="done"
      label="Archive"
      {draggingTaskId}
    />
  {/if}
</div>
