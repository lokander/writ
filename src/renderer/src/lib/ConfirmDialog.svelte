<script lang="ts">
  import { portal } from "./portal";

  interface Props {
    title: string;
    /** Optional secondary line under the title. Use for context — "this can't
     *  be undone", "you have unsaved edits", etc. */
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** `danger` colors the confirm button red, used for destructive actions
     *  (delete, discard). `default` uses the primary button color. */
    variant?: "default" | "danger";
    onConfirm: () => void;
    onCancel: () => void;
  }

  const {
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "default",
    onConfirm,
    onCancel,
  }: Props = $props();

  // Esc cancels, Enter confirms. stopPropagation so the underlying modal's
  // svelte:window keydown handler doesn't also fire.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Portaled to <body> so it escapes the underlying modal-box's transform
     containment. z-[1100] sits above the modal (DaisyUI z-999) and above
     Combobox dropdowns (z-[1000]). -->
<div
  use:portal
  class="fixed inset-0 z-[1100] flex items-center justify-center p-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="confirm-dialog-title"
>
  <button
    type="button"
    class="absolute inset-0 bg-black/40 backdrop-blur-sm"
    aria-label="Cancel"
    onclick={onCancel}
  ></button>
  <div class="relative w-full max-w-sm rounded-box bg-base-100 p-6 shadow-2xl">
    <h3 id="confirm-dialog-title" class="text-lg font-semibold">{title}</h3>
    {#if message}
      <p class="mt-2 text-sm opacity-70">{message}</p>
    {/if}
    <div class="mt-6 flex justify-end gap-2">
      <button type="button" class="btn btn-ghost btn-sm" onclick={onCancel}>
        {cancelLabel}
      </button>
      <button
        type="button"
        class="btn btn-sm {variant === 'danger' ? 'btn-error' : 'btn-primary'}"
        onclick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
