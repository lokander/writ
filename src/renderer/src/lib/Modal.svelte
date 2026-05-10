<script lang="ts">
  import type { Snippet } from "svelte";
  import { portal } from "./portal";

  interface Props {
    /** Called when the user clicks the wrapper outside the modal content
     *  (the "click outside to close" gesture). Each caller decides what
     *  close means — TaskEditModal routes through `tryDiscardingAction` so
     *  unsaved edits prompt; AddTaskModal closes outright; ConfirmDialog
     *  treats it as Cancel. */
    onBackdropClick: () => void;
    /** Inline z-index. Omit for DaisyUI's default 999. TaskEditModal
     *  computes 900 + 10*stackIndex per stacked entry so deeper modals
     *  paint above shallower ones; ConfirmDialog uses 1100 to sit above
     *  the modal layer entirely. */
    zIndex?: number;
    /** When false, the modal subtree becomes `inert` — clicks, focus,
     *  screen readers ignore it. Stacked TaskEditModal entries set this
     *  false for everything except the top. Default true. */
    isTop?: boolean;
    /** id of the element labelling the modal, threaded through to
     *  aria-labelledby. */
    ariaLabelledBy?: string;
    children: Snippet;
  }

  const { onBackdropClick, zIndex, isTop = true, ariaLabelledBy, children }: Props = $props();

  function onWrapperClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      onBackdropClick();
    }
  }
</script>

<!-- Portaled to <body> so the modal escapes any ancestor with `transform`
     or `overflow: hidden` that would otherwise contain it. DaisyUI's own
     modal-box uses `translate` for its open animation, which would trap
     a nested modal (e.g. ConfirmDialog opened from inside TaskEditModal)
     to the parent's coordinate system. Body-portaling sidesteps the whole
     containing-block question.

     svelte-ignore tags: the wrapper is a click target (close on
     click-outside) but not a focusable element on its own; assistive tech
     reaches the modal content via the dialog role. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portal
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  aria-labelledby={ariaLabelledBy}
  tabindex="-1"
  inert={!isTop}
  style:z-index={zIndex}
  onclick={onWrapperClick}
>
  {@render children()}
</div>
