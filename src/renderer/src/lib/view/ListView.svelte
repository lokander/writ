<script lang="ts">
  import { LockSimpleIcon } from "phosphor-svelte";

  import type { Column, Task } from "../../../../shared/types";
  import { PRIORITY_BORDER_CLASS } from "../priority-color";
  import TagChip from "../chip/TagChip.svelte";
  import TaskIdChip from "../chip/TaskIdChip.svelte";

  interface Props {
    columns: Column[];
    /** Full (pre-filter) task set, already sorted by the active sort mode.
     *  Drives both tab counts and the hierarchical no-filter render — we
     *  read from this instead of `allTasks` directly so the sort
     *  applies in list view too. */
    allTasks: Task[];
    /** Post-filter, post-sort task set. Used in flat-render mode (filters
     *  active) for the cards shown in the active column. */
    visibleTasks: Task[];
    filtersActive: boolean;
    /** Bindable so the choice survives view toggles (App owns it). */
    activeColumnId: string | null;
    childrenByParent: Record<string, Task[]>;
    childCount: Record<string, number>;
    columnNameById: Record<string, string>;
    colorByTag: Record<string, string | null>;
    onTaskClick: (id: string) => void;
    onTaskContextMenu: (id: string, event: MouseEvent) => void;
    /** Id of the task whose context menu is currently open, if any. The
     *  matching row gets the hover styling pinned so the user keeps a
     *  visual link between the menu and its target. */
    contextMenuTaskId: string | null;
  }

  let {
    columns,
    allTasks,
    visibleTasks,
    filtersActive,
    activeColumnId = $bindable(),
    childrenByParent,
    childCount,
    columnNameById,
    colorByTag,
    onTaskClick,
    onTaskContextMenu,
    contextMenuTaskId,
  }: Props = $props();

  // Tab counts also reflect the filter — otherwise "Backlog (15)" with 3
  // visible tasks is confusing. When no filter is active, count top-level
  // tasks only (matches the hierarchical render below).
  const tasksByColumn = $derived.by(() => {
    const counts: Record<string, number> = {};
    if (filtersActive) {
      for (const t of visibleTasks) counts[t.columnId] = (counts[t.columnId] ?? 0) + 1;
    } else {
      for (const t of allTasks) {
        if (t.parentId !== null) continue;
        counts[t.columnId] = (counts[t.columnId] ?? 0) + 1;
      }
    }
    return counts;
  });

  // When filters are active, switch to flat-per-column rendering — every
  // matching task surfaces, even if its parent doesn't match (mirrors the
  // CLI's flat-render-when-filtered behavior).
  const tasksInActiveColumn = $derived.by(() => {
    if (activeColumnId === null) return [];
    if (filtersActive) {
      return visibleTasks.filter((t) => t.columnId === activeColumnId);
    }
    return allTasks.filter((t) => t.parentId === null && t.columnId === activeColumnId);
  });
</script>

<div role="tablist" class="tabs tabs-border bg-base-200 px-4">
  {#each columns as col (col.id)}
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

{#snippet taskNode(task: Task, parentColumnId: string | null, depth: number, recurse: boolean)}
  {@const n = childCount[task.id] ?? 0}
  {@const showColumnBadge =
    depth > 0 && parentColumnId !== null && task.columnId !== parentColumnId}
  <button
    type="button"
    class="card flex flex-row items-baseline gap-3 border-l-4 bg-base-200 px-4 py-2 text-left text-sm hover:bg-base-300 {PRIORITY_BORDER_CLASS[
      task.priority
    ]}"
    class:bg-base-300={contextMenuTaskId === task.id}
    style:margin-left="{depth * 1.5}rem"
    onclick={() => onTaskClick(task.id)}
    oncontextmenu={(e) => {
      e.preventDefault();
      onTaskContextMenu(task.id, e);
    }}
  >
    <TaskIdChip id={task.id} />
    <span class="flex-1">{task.title}</span>
    {#if task.blockedBy.length > 0}
      <span
        class="text-warning"
        title="Blocked by {task.blockedBy.length} open task{task.blockedBy.length === 1 ? '' : 's'}"
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
