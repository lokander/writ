<script lang="ts">
  import { PencilSimpleIcon, TrashIcon } from "phosphor-svelte";

  interface Props {
    mode: "view" | "edit";
    /** Live row is gone (CLI delete landed). Disables Delete since there's
     *  nothing left to delete. */
    taskGone: boolean;
    /** True when the edit form has dirty + valid edits worth saving. Drives
     *  the Save button's enabled state. */
    canSave: boolean;
    onEnterEdit: () => void;
    /** Cancel-from-edit. Parent wraps in tryDiscardingAction so unsaved
     *  edits prompt the discard confirm before the actual cancel runs. */
    onCancelEdit: () => void;
    onRequestDelete: () => void;
  }

  const { mode, taskGone, canSave, onEnterEdit, onCancelEdit, onRequestDelete }: Props = $props();
</script>

<!-- Rendered inside the parent <form>, so the Save button's type="submit"
     still triggers the form's onsubmit (which calls save()). -->
<div class="modal-action mt-6 flex items-center justify-between">
  <button
    type="button"
    class="btn btn-error btn-outline"
    onclick={onRequestDelete}
    disabled={taskGone}
  >
    <TrashIcon size={16} weight="bold" />
    Delete
  </button>
  <div class="flex gap-2">
    {#if mode === "view"}
      <button type="button" class="btn btn-primary" onclick={onEnterEdit}>
        <PencilSimpleIcon size={16} weight="bold" />
        Edit
      </button>
    {:else}
      <button type="button" class="btn btn-ghost" onclick={onCancelEdit}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={!canSave}>Save</button>
    {/if}
  </div>
</div>
