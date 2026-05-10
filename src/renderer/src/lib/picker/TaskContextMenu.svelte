<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { CaretRightIcon } from "phosphor-svelte";

  import type { Column, Priority, Task } from "../../../../shared/types";
  import { PRIORITY_NAMES } from "../../../../shared/types";

  import { portal } from "../portal";
  import { PRIORITY_DOT_CLASS } from "../priority-color";

  interface Props {
    task: Task;
    columns: Column[];
    /** Cursor location in viewport coordinates. */
    x: number;
    y: number;
    onEdit: () => void;
    onSetPriority: (p: Priority) => void;
    onMove: (columnId: string) => void;
    onDelete: () => void;
    onClose: () => void;
  }

  const { task, columns, x, y, onEdit, onSetPriority, onMove, onDelete, onClose }: Props = $props();

  let menuEl: HTMLDivElement;
  // Capture x/y once at mount; the parent re-creates the component on every
  // right-click (contextMenuFor toggles to null between cards), so a fresh
  // mount means a fresh cursor position. untrack() silences the Svelte
  // capture-on-mount warning.
  let position = $state(untrack(() => ({ left: x, top: y })));

  const PRIORITIES: Priority[] = [0, 1, 2, 3];

  // Submenu state. Hovering a trigger row opens the matching submenu next
  // to it; hovering any other top-level item closes whichever is open.
  let openSubmenu = $state<"priority" | "move" | null>(null);
  let submenuPos = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  let submenuEl: HTMLDivElement | undefined = $state();

  // Estimated submenu width (matches w-52 = 13rem on the main menu). Used
  // for the initial "flip left if it'd overflow" guess before we have a
  // real measurement; the post-mount pass below corrects with actuals.
  const SUBMENU_WIDTH = 208;

  onMount(() => {
    // Clamp to viewport. The menu measures itself once mounted; flipping to
    // the cursor's other side is overkill for v1, just nudge it inward.
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - margin;
    }
    if (top + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - margin;
    }
    position = {
      left: Math.max(margin, left),
      top: Math.max(margin, top),
    };

    // Auto-focus the first action so keyboard users can navigate immediately.
    menuEl.querySelector<HTMLButtonElement>("button")?.focus();
  });

  async function showSubmenu(name: "priority" | "move", trigger: HTMLElement): Promise<void> {
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();
    const margin = 8;

    // Initial guess: to the right of the main menu, top-aligned with the
    // trigger row. Horizontal flip if no room on the right.
    let left = menuRect.right + 4;
    if (left + SUBMENU_WIDTH > window.innerWidth) {
      left = menuRect.left - SUBMENU_WIDTH - 4;
    }
    let top = triggerRect.top;

    submenuPos = { left, top };
    openSubmenu = name;

    // Wait for the submenu to mount, then clamp using its actual rendered
    // size. The estimated SUBMENU_WIDTH is fine for "flip left", but the
    // height varies by item count (4 priorities vs N columns), and a
    // trigger near the bottom of the viewport would otherwise spill off.
    await tick();
    if (!submenuEl) return;
    const rect = submenuEl.getBoundingClientRect();
    if (top + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - margin;
    }
    if (left + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - margin;
    }
    submenuPos = {
      left: Math.max(margin, left),
      top: Math.max(margin, top),
    };
  }

  function hideSubmenu(): void {
    openSubmenu = null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (openSubmenu) hideSubmenu();
      else onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      // Only the visible top-level buttons cycle here. Submenus open on
      // hover for v1; keyboard-driven submenu nav is a future improvement.
      const buttons = Array.from(menuEl.querySelectorAll<HTMLButtonElement>("button"));
      if (buttons.length === 0) return;
      const focused = document.activeElement as HTMLElement | null;
      const idx = focused instanceof HTMLButtonElement ? buttons.indexOf(focused) : -1;
      const next =
        event.key === "ArrowDown"
          ? (idx + 1) % buttons.length
          : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Transparent backdrop that captures clicks outside the menu so the
     original mouse event doesn't also fire on whatever's beneath
     (a card opening a modal, a tab switching columns, etc.). Same
     pattern as <ConfirmDialog>. Right-click on the backdrop closes
     too — no auto-reopen on a different card; right-click again. -->
<button
  type="button"
  use:portal
  class="fixed inset-0 z-[1040] cursor-default"
  aria-label="Close menu"
  onclick={onClose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onClose();
  }}
  onmouseenter={hideSubmenu}
></button>

<!-- Portaled to <body> so the menu can render above modal-box / sticky
     headers without being clipped. z-[1050] sits above the backdrop
     (z-[1040]) and below the ConfirmDialog (z-[1100]) so a Delete →
     Confirm hand-off layers naturally.
     Plain styled <div> (not daisyUI's `menu` class) — the `menu`
     component's child-selector rules made it hard to mix non-li
     elements (section labels, dividers) without breaking layout. -->
<div
  bind:this={menuEl}
  use:portal
  class="rounded-box fixed z-[1050] flex w-52 flex-col gap-0.5 border border-base-300 bg-base-100 p-1 text-sm shadow-2xl"
  style:left="{position.left}px"
  style:top="{position.top}px"
  role="menu"
  aria-label="Task actions"
>
  <button
    type="button"
    class="rounded px-3 py-1.5 text-left hover:bg-base-200"
    onclick={onEdit}
    onmouseenter={hideSubmenu}
  >
    Edit task…
  </button>

  <button
    type="button"
    class="flex items-center justify-between rounded px-3 py-1.5 text-left hover:bg-base-200 {openSubmenu ===
    'priority'
      ? 'bg-base-200'
      : ''}"
    onmouseenter={(e) => showSubmenu("priority", e.currentTarget)}
    onfocus={(e) => showSubmenu("priority", e.currentTarget)}
  >
    <span>Priority</span>
    <CaretRightIcon size={12} weight="bold" class="opacity-50" />
  </button>

  <button
    type="button"
    class="flex items-center justify-between rounded px-3 py-1.5 text-left hover:bg-base-200 {openSubmenu ===
    'move'
      ? 'bg-base-200'
      : ''}"
    onmouseenter={(e) => showSubmenu("move", e.currentTarget)}
    onfocus={(e) => showSubmenu("move", e.currentTarget)}
  >
    <span>Move to</span>
    <CaretRightIcon size={12} weight="bold" class="opacity-50" />
  </button>

  <div class="my-1 border-t border-base-300"></div>
  <button
    type="button"
    class="rounded px-3 py-1.5 text-left text-error hover:bg-error/10"
    onclick={onDelete}
    onmouseenter={hideSubmenu}
  >
    Delete task…
  </button>
</div>

<!-- Submenus are separate portaled panels so they can render outside the
     main menu's bounds. Hover stays open even when the cursor leaves the
     trigger row, because the only "close" paths are: hovering a different
     top-level item, hovering the backdrop, clicking an item, or pressing
     Esc. -->
{#if openSubmenu === "priority"}
  <div
    bind:this={submenuEl}
    use:portal
    class="rounded-box fixed z-[1051] flex w-52 flex-col gap-0.5 border border-base-300 bg-base-100 p-1 text-sm shadow-2xl"
    style:left="{submenuPos.left}px"
    style:top="{submenuPos.top}px"
    role="menu"
    aria-label="Priority"
  >
    {#each PRIORITIES as p (p)}
      {@const current = task.priority === p}
      <button
        type="button"
        class="flex items-center gap-2 rounded px-3 py-1.5 text-left {current
          ? 'opacity-50'
          : 'hover:bg-base-200'}"
        disabled={current}
        onclick={() => onSetPriority(p)}
      >
        <span class="size-2 rounded-full {PRIORITY_DOT_CLASS[p]}" aria-hidden="true"></span>
        {PRIORITY_NAMES[p]}
      </button>
    {/each}
  </div>
{:else if openSubmenu === "move"}
  <div
    bind:this={submenuEl}
    use:portal
    class="rounded-box fixed z-[1051] flex w-52 flex-col gap-0.5 border border-base-300 bg-base-100 p-1 text-sm shadow-2xl"
    style:left="{submenuPos.left}px"
    style:top="{submenuPos.top}px"
    role="menu"
    aria-label="Move to column"
  >
    {#each columns as col (col.id)}
      {@const current = task.columnId === col.id}
      <button
        type="button"
        class="rounded px-3 py-1.5 text-left {current ? 'opacity-50' : 'hover:bg-base-200'}"
        disabled={current}
        onclick={() => onMove(col.id)}
      >
        {col.name}
      </button>
    {/each}
  </div>
{/if}
