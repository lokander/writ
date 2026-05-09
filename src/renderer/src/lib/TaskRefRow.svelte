<script lang="ts">
  import { XIcon } from "phosphor-svelte";

  import type { Task } from "../../../shared/types";
  import TaskIdChip from "./TaskIdChip.svelte";

  interface Props {
    task: Task;
    columnName: string;
    /** When provided, the whole row becomes a button (used to switch the
     *  modal target, open a blocker, etc.). */
    onClick?: () => void;
    /** When provided AND `onClick` is not, render an X button at the right
     *  edge. We don't support both simultaneously — nesting a button inside
     *  a button is invalid HTML and none of the current call sites need it. */
    onRemove?: () => void;
    /** Visually dim + strike-through the title (used for "blocker that's
     *  already Done" in the view-mode Blocked-by list). */
    muted?: boolean;
  }

  const { task, columnName, onClick, onRemove, muted = false }: Props = $props();
</script>

{#if onClick}
  <button
    type="button"
    class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
    class:opacity-50={muted}
    onclick={onClick}
  >
    <TaskIdChip id={task.id} />
    <span class="flex-1" class:line-through={muted}>{task.title}</span>
    <span class="badge badge-outline badge-sm">{columnName}</span>
  </button>
{:else}
  <div
    class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-sm"
    class:opacity-50={muted}
  >
    <TaskIdChip id={task.id} />
    <span class="flex-1" class:line-through={muted}>{task.title}</span>
    <span class="badge badge-outline badge-sm">{columnName}</span>
    {#if onRemove}
      <button
        type="button"
        class="opacity-70 hover:opacity-100"
        aria-label="Remove"
        onclick={onRemove}
      >
        <XIcon size={12} weight="bold" />
      </button>
    {/if}
  </div>
{/if}
