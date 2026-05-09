<script lang="ts">
  import { onMount } from "svelte";
  import { LockSimpleIcon } from "phosphor-svelte";

  import type { Column, Task } from "../../../shared/types";
  import { writState } from "./state.svelte";
  import { draggable, dropTarget, monitorForElements } from "./dnd";
  import TagChip from "./TagChip.svelte";

  interface Props {
    columns: Column[];
    /** The post-filter task set. Kanban renders flat-per-column — every
     *  matching task surfaces, regardless of nesting. */
    visibleTasks: Task[];
    colorByTag: Record<string, string | null>;
    /** Subtask count per task id — shown as a badge so the user can see at a
     *  glance which cards have children (visible only via the modal). */
    childCount: Record<string, number>;
    onTaskClick: (id: string) => void;
  }

  const { columns, visibleTasks, colorByTag, childCount, onTaskClick }: Props = $props();

  // Backlog is intentionally hidden from kanban — it's a pre-active staging
  // list, not part of the in-flight pipeline. Still visible in list view.
  const visibleColumns = $derived(columns.filter((c) => c.name.toLowerCase() !== "backlog"));

  function tasksInColumn(colId: string): Task[] {
    return visibleTasks.filter((t) => t.columnId === colId);
  }

  function parentOf(parentId: string): Task | undefined {
    return writState.tasks.find((t) => t.id === parentId);
  }

  // Drag visual state. We don't try to be clever with per-element classes;
  // a single dragging-card id and hovered-column id are enough.
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

    const newPosition = nextPositionInColumn(targetColumnId);

    // Optimistic local update so the card jumps before the IPC round-trips.
    // The IPC's response will replace this with the canonical updated row.
    writState.tasks = writState.tasks.map((t) =>
      t.id === taskId ? { ...t, columnId: targetColumnId, position: newPosition } : t,
    );

    writState.updateTask(taskId, { columnId: targetColumnId, position: newPosition });
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
            class="card flex flex-col gap-1 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
            class:opacity-40={draggingTaskId === task.id}
            onclick={() => onTaskClick(task.id)}
            use:draggable={{
              data: { type: "card", taskId: task.id },
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
</div>
