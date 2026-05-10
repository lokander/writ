<script lang="ts">
  import type { Task } from "../../../../shared/types";
  import { writState } from "../state.svelte";
  import Combobox from "./Combobox.svelte";
  import TaskIdChip from "../chip/TaskIdChip.svelte";
  import TaskRefRow from "../chip/TaskRefRow.svelte";

  interface Props {
    /** Bindable list of blocker task ids. */
    dependsOnIds: string[];
    /** When provided, the BFS rejects candidates whose dependsOn graph
     *  reaches this id — that would form a cycle. AddTaskModal omits this
     *  since the new task isn't in the graph yet, so no cycle is possible. */
    taskIdForCycleCheck?: string;
  }

  let { dependsOnIds = $bindable(), taskIdForCycleCheck }: Props = $props();

  // Mirrors the cycle check in domain — keeps invalid candidates from showing
  // in the picker so the user gets immediate feedback rather than a save-time
  // error.
  function wouldCycle(candidateId: string): boolean {
    if (!taskIdForCycleCheck) return false;
    if (candidateId === taskIdForCycleCheck) return true;
    const visited: Record<string, true> = {};
    const queue: string[] = [candidateId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === taskIdForCycleCheck) return true;
      if (visited[cur]) continue;
      visited[cur] = true;
      const row = writState.tasks.find((t) => t.id === cur);
      if (!row) continue;
      for (const depId of row.dependsOn) queue.push(depId);
    }
    return false;
  }

  const candidates = $derived(
    writState.tasks
      .filter((t) => t.id !== taskIdForCycleCheck)
      .filter((t) => !dependsOnIds.includes(t.id))
      .filter((t) => !wouldCycle(t.id))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  function depItemText(t: Task): string {
    return `${t.id.slice(-6)} ${t.title}`;
  }

  function onPickDependency(t: Task): void {
    if (!dependsOnIds.includes(t.id)) {
      dependsOnIds = [...dependsOnIds, t.id];
    }
  }

  function removeDependencyAt(index: number): void {
    dependsOnIds = dependsOnIds.filter((_, i) => i !== index);
  }
</script>

<div class="form-control mb-4 w-full">
  <span class="label label-text">Blocked by</span>

  {#if dependsOnIds.length > 0}
    <div class="mb-2 flex flex-col gap-1">
      {#each dependsOnIds as depId, i (depId)}
        {@const dep = writState.tasks.find((t) => t.id === depId)}
        {#if dep}
          <TaskRefRow
            task={dep}
            columnName={columnNameById[dep.columnId] ?? "?"}
            onRemove={() => removeDependencyAt(i)}
          />
        {/if}
      {/each}
    </div>
  {/if}

  <Combobox
    items={candidates}
    itemText={depItemText}
    itemKey={(t) => t.id}
    onSelect={onPickDependency}
    item={dependencyRow}
    placeholder="Search tasks…"
  />
</div>

{#snippet dependencyRow({ item: t }: { item: Task; active: boolean })}
  <TaskIdChip id={t.id} />
  <span class="ml-2">{t.title}</span>
  <span class="badge badge-outline badge-sm ml-2">
    {columnNameById[t.columnId] ?? "?"}
  </span>
{/snippet}
