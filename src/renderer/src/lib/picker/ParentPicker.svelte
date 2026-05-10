<script lang="ts">
  import { XIcon } from "phosphor-svelte";

  import type { Task } from "../../../../shared/types";
  import { writState } from "../state.svelte";
  import Combobox from "./Combobox.svelte";
  import TaskIdChip from "../chip/TaskIdChip.svelte";

  interface Props {
    /** Bindable id of the chosen parent, or null for "no parent". */
    parentId: string | null;
    /** Task ids to exclude from candidates. TaskEditModal passes its
     *  descendant set (self + everything below) so the user can't make a
     *  cycle. AddTaskModal omits this — the new task isn't in the graph
     *  yet, so any task is a valid parent. */
    excludeIds?: Record<string, boolean>;
  }

  let { parentId = $bindable(), excludeIds = {} }: Props = $props();

  const parentOptions = $derived(
    writState.tasks
      .filter((t) => !excludeIds[t.id])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const parentTask = $derived(
    parentId === null ? null : (writState.tasks.find((t) => t.id === parentId) ?? null),
  );

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });
</script>

<div class="form-control w-full max-w-md">
  <span class="label label-text">Parent</span>
  <div class="flex flex-col gap-2">
    {#if parentTask}
      <div class="flex items-center gap-2">
        <span class="badge badge-outline">{parentTask.title}</span>
        <button
          type="button"
          class="opacity-70 hover:opacity-100"
          aria-label="Clear parent"
          onclick={() => (parentId = null)}
        >
          <XIcon size={12} weight="bold" />
        </button>
      </div>
    {:else}
      <span class="text-xs italic opacity-50">(no parent)</span>
    {/if}
    <Combobox
      items={parentOptions}
      itemText={(t) => t.title}
      itemKey={(t) => t.id}
      onSelect={(t) => (parentId = t.id)}
      placeholder="Search tasks…"
      item={parentRow}
    />
  </div>
</div>

{#snippet parentRow({ item: t }: { item: Task; active: boolean })}
  <TaskIdChip id={t.id} />
  <span class="ml-2">{t.title}</span>
  <span class="badge badge-outline badge-sm ml-2">
    {columnNameById[t.columnId] ?? "?"}
  </span>
{/snippet}
