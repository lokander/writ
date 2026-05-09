<script lang="ts">
  import { LockSimpleIcon } from "phosphor-svelte";

  import type { Column, Task } from "../../../shared/types";
  import { writState } from "./state.svelte";
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
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {#each colTasks as task (task.id)}
          {@const n = childCount[task.id] ?? 0}
          {@const parent = task.parentId ? parentOf(task.parentId) : undefined}
          <button
            type="button"
            class="card flex flex-col gap-1 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
            onclick={() => onTaskClick(task.id)}
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
