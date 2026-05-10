<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  import { portal } from "../portal";

  interface Props {
    items: T[];
    itemText: (item: T) => string;
    itemKey: (item: T) => string;
    onSelect: (item: T) => void;
    placeholder?: string;
    item: Snippet<[{ item: T; active: boolean }]>;
    /** Optional virtual row appended after items (e.g. "Create new tag X").
     *  When both `extra` and `onExtraSelect` are provided it's keyboard-
     *  navigable as the last entry — Enter when active calls
     *  `onExtraSelect(currentInput)`. Pass them conditionally to omit. */
    extra?: Snippet<[{ query: string; active: boolean }]>;
    onExtraSelect?: (query: string) => void;
    /** Bindable input text. Action pickers (tag, depends-on) leave it cleared
     *  after each selection; single-value pickers (parent) get it set to the
     *  picked item's text on select. */
    value?: string;
    /** True for "action" pickers: clear input after each selection. False for
     *  single-value pickers: input mirrors the selected item's text. */
    clearOnSelect?: boolean;
    disabled?: boolean;
  }

  let {
    items,
    itemText,
    itemKey,
    onSelect,
    placeholder = "",
    item: itemSnippet,
    extra,
    onExtraSelect,
    value = $bindable(""),
    clearOnSelect = true,
    disabled = false,
  }: Props = $props();

  let open = $state(false);
  let activeIndex = $state(0);
  let inputEl: HTMLInputElement | null = $state(null);
  let inputRect = $state<DOMRect | null>(null);

  // Stable per-instance id so the input can advertise aria-controls pointing
  // at its own listbox.
  const listboxId = `cbx-${crypto.randomUUID()}`;

  function updateRect(): void {
    if (inputEl) inputRect = inputEl.getBoundingClientRect();
  }

  // While the dropdown is open, track the input's viewport position so the
  // portaled listbox stays glued to it (modal scroll, window resize, etc).
  $effect(() => {
    if (!open) return undefined;
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  });

  const filtered = $derived(
    value.trim().length === 0
      ? items
      : items.filter((it) => itemText(it).toLowerCase().includes(value.toLowerCase().trim())),
  );

  const hasExtra = $derived(extra !== undefined && onExtraSelect !== undefined);
  const totalRows = $derived(filtered.length + (hasExtra ? 1 : 0));

  $effect(() => {
    void filtered;
    activeIndex = 0;
  });

  $effect(() => {
    if (activeIndex >= totalRows) activeIndex = Math.max(0, totalRows - 1);
  });

  function pickAt(index: number): void {
    if (hasExtra && index === filtered.length) {
      onExtraSelect!(value.trim());
      if (clearOnSelect) value = "";
      open = false;
      return;
    }
    const picked = filtered[index];
    if (picked === undefined) return;
    onSelect(picked);
    if (clearOnSelect) value = "";
    else value = itemText(picked);
    open = false;
  }

  function pickActive(): void {
    if (totalRows === 0) return;
    pickAt(activeIndex);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open = true;
      activeIndex = Math.min(activeIndex + 1, totalRows - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      open = true;
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      if (open && totalRows > 0) {
        event.preventDefault();
        pickActive();
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        // Stop propagation so the modal-level Esc handler doesn't also close
        // the modal. When closed already, Esc falls through to the modal.
        event.stopPropagation();
        open = false;
      }
    }
  }

  // Items are <button>s — a normal mousedown on them would blur the input
  // before the click registers, closing the dropdown via onblur. preventDefault
  // on mousedown keeps focus on the input so onclick still fires.
  function onItemMousedown(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="w-full">
  <input
    bind:this={inputEl}
    type="text"
    class="input input-bordered input-sm w-full"
    {placeholder}
    {disabled}
    bind:value
    onfocus={() => (open = true)}
    oninput={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={onKeydown}
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={listboxId}
    role="combobox"
  />
  {#if open && totalRows > 0 && inputRect}
    <div
      use:portal
      id={listboxId}
      class="fixed z-[1000] max-h-60 overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-lg"
      style:top="{inputRect.bottom + 4}px"
      style:left="{inputRect.left}px"
      style:width="{inputRect.width}px"
      role="listbox"
    >
      {#each filtered as it, i (itemKey(it))}
        <button
          type="button"
          class="block w-full px-3 py-2 text-left text-sm hover:bg-base-200"
          class:bg-base-200={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
          onmousedown={onItemMousedown}
          onclick={() => pickAt(i)}
          onmouseenter={() => (activeIndex = i)}
        >
          {@render itemSnippet({ item: it, active: i === activeIndex })}
        </button>
      {/each}
      {#if hasExtra}
        {@const extraIndex = filtered.length}
        <button
          type="button"
          class="block w-full border-t border-base-300 px-3 py-2 text-left text-sm hover:bg-base-200"
          class:bg-base-200={extraIndex === activeIndex}
          role="option"
          aria-selected={extraIndex === activeIndex}
          onmousedown={onItemMousedown}
          onclick={() => pickAt(extraIndex)}
          onmouseenter={() => (activeIndex = extraIndex)}
        >
          {@render extra!({ query: value.trim(), active: extraIndex === activeIndex })}
        </button>
      {/if}
    </div>
  {/if}
</div>
