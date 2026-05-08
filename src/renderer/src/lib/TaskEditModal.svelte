<script lang="ts">
  import { X, Trash } from "phosphor-svelte";

  import type { Priority, Task } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import { writState } from "./state.svelte";

  interface Props {
    task: Task;
    onClose: () => void;
  }

  const { task, onClose }: Props = $props();

  let title = $state(task.title);
  let description = $state(task.description);
  let priority = $state<Priority>(task.priority);
  let saving = $state(false);

  const dirty = $derived(
    title !== task.title || description !== task.description || priority !== task.priority,
  );

  const canSave = $derived(dirty && title.trim().length > 0 && !saving);

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const updated = await writState.updateTask(task.id, {
      title: title.trim(),
      description,
      priority,
    });
    saving = false;
    if (updated) onClose();
  }

  async function remove(): Promise<void> {
    const ok = await writState.deleteTask(task.id);
    if (ok) onClose();
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
  aria-labelledby="task-edit-title"
  tabindex="-1"
>
  <button type="button" class="modal-backdrop" aria-label="Close" onclick={onClose}></button>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 id="task-edit-title" class="text-lg font-semibold">Edit task</h2>
      <span class="font-mono text-xs opacity-50">{task.id.slice(-6)}</span>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
        <X size={16} weight="bold" />
      </button>
    </div>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Title</span>
      <input type="text" class="input input-bordered w-full" bind:value={title} autofocus />
    </label>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Description</span>
      <textarea class="textarea textarea-bordered w-full" rows="10" bind:value={description}
      ></textarea>
    </label>

    <label class="form-control mb-4 w-full max-w-xs">
      <span class="label label-text">Priority</span>
      <select class="select select-bordered" bind:value={priority}>
        {#each [0, 1, 2, 3] as p (p)}
          <option value={p}>{PRIORITY_NAMES[p as Priority]}</option>
        {/each}
      </select>
    </label>

    <div class="modal-action mt-6 flex items-center justify-between">
      <button type="button" class="btn btn-error btn-outline" onclick={remove}>
        <Trash size={16} weight="bold" />
        Delete
      </button>
      <div class="flex gap-2">
        <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled={!canSave}>Save</button>
      </div>
    </div>
  </form>
</div>
