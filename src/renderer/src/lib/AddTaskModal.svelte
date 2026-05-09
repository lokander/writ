<script lang="ts">
  import { XIcon } from "phosphor-svelte";

  import type { Priority, Task } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import { writState } from "./state.svelte";
  import DependsOnPicker from "./DependsOnPicker.svelte";
  import ParentPicker from "./ParentPicker.svelte";
  import TagPicker from "./TagPicker.svelte";

  interface Props {
    onClose: () => void;
    onCreated: (task: Task) => void;
  }

  const { onClose, onCreated }: Props = $props();

  let title = $state("");
  let description = $state("");
  let priority = $state<Priority>(2);
  let parentId = $state<string | null>(null);
  let tagSpecs = $state<string[]>([]);
  let dependsOnIds = $state<string[]>([]);
  let saving = $state(false);

  const canSave = $derived(title.trim().length > 0 && !saving);

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const created = await writState.createTask({
      title: title.trim(),
      description,
      priority,
      parentId,
      tags: tagSpecs.length > 0 ? tagSpecs : undefined,
      dependsOn: dependsOnIds.length > 0 ? dependsOnIds : undefined,
    });
    saving = false;
    if (created) onCreated(created);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    save();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  aria-labelledby="add-task-modal-title"
  tabindex="-1"
>
  <button type="button" class="modal-backdrop" aria-label="Close" onclick={onClose}></button>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 id="add-task-modal-title" class="text-lg font-semibold">New task</h2>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
        <XIcon size={16} weight="bold" />
      </button>
    </div>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Title</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" class="input input-bordered w-full" bind:value={title} autofocus />
    </label>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Description</span>
      <textarea class="textarea textarea-bordered w-full" rows="10" bind:value={description}
      ></textarea>
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

      <ParentPicker bind:parentId />
    </div>

    <TagPicker bind:tagSpecs />

    <DependsOnPicker bind:dependsOnIds />

    <div class="modal-action mt-6 flex justify-end gap-2">
      <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={!canSave}>Create</button>
    </div>
  </form>
</div>
