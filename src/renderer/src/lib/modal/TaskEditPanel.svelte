<script lang="ts">
  import { XIcon } from "phosphor-svelte";

  import { PRIORITY_NAMES, type Priority, type Task } from "../../../../shared/types";
  import TaskIdChip from "../chip/TaskIdChip.svelte";
  import DependsOnPicker from "../picker/DependsOnPicker.svelte";
  import ParentPicker from "../picker/ParentPicker.svelte";
  import TagPicker from "../picker/TagPicker.svelte";

  interface Props {
    /** The task being edited — read for the id chip and for cycle-checking
     *  in DependsOnPicker. Not bindable; user-edited fields live in the
     *  bindables below. */
    task: Task;
    title: string;
    description: string;
    priority: Priority;
    parentId: string | null;
    tagSpecs: string[];
    dependsOnIds: string[];
    /** Tasks that can't be picked as parent (this task + descendants).
     *  Owner-derived so cycle prevention stays consistent with the rest
     *  of the modal's dependency machinery. Record shape matches
     *  ParentPicker's excludeIds prop. */
    descendantIds: Record<string, boolean>;
    /** Close callback. Parent wraps with tryDiscardingAction so unsaved
     *  edits surface the discard confirm before close actually fires. */
    onClose: () => void;
  }

  let {
    task,
    title = $bindable(),
    description = $bindable(),
    priority = $bindable(),
    parentId = $bindable(),
    tagSpecs = $bindable(),
    dependsOnIds = $bindable(),
    descendantIds,
    onClose,
  }: Props = $props();
</script>

<div class="mb-4 flex items-baseline justify-between gap-3">
  <h2 id="task-modal-title" class="text-lg font-semibold">Edit task</h2>
  <div class="flex shrink-0 items-baseline gap-2">
    <TaskIdChip id={task.id} />
    <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
      <XIcon size={16} weight="bold" />
    </button>
  </div>
</div>

<label class="form-control mb-3 w-full">
  <span class="label label-text">Title</span>
  <!-- svelte-ignore a11y_autofocus -->
  <input type="text" class="input input-bordered w-full" bind:value={title} autofocus />
</label>

<label class="form-control mb-3 w-full">
  <span class="label label-text">Description</span>
  <textarea class="textarea textarea-bordered w-full" rows="10" bind:value={description}></textarea>
</label>

<div class="mb-4 flex flex-wrap gap-4">
  <label class="form-control w-full max-w-xs">
    <span class="label label-text">Priority</span>
    <select class="select select-bordered" bind:value={priority}>
      {#each [0, 1, 2, 3] as p (p)}
        <option value={p}>{PRIORITY_NAMES[p as Priority]}</option>
      {/each}
    </select>
  </label>

  <ParentPicker bind:parentId excludeIds={descendantIds} />
</div>

<TagPicker bind:tagSpecs />

<DependsOnPicker bind:dependsOnIds taskIdForCycleCheck={task.id} />
