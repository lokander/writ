<script lang="ts">
  import { onDestroy } from "svelte";

  interface Props {
    id: string;
    /** Extra utility classes appended after the defaults. */
    class?: string;
  }

  const { id, class: extraClass = "" }: Props = $props();

  const suffix = $derived(id.slice(-6));

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(event: MouseEvent | KeyboardEvent): Promise<void> {
    // Stop propagation so chips nested inside row/card buttons don't also
    // trigger the parent's click (open the modal, switch task, etc.).
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(suffix);
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copied = false;
        timer = null;
      }, 1000);
    } catch {
      // Clipboard write can reject (permissions, focus). Quietly no-op —
      // worst case the user falls back to text selection.
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copy(event);
    }
  }

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });
</script>

<!-- Span (not button) so the chip can sit inside row/card buttons without
     the nested-interactive-elements warning. role=button + tabindex + the
     keydown handler keep it keyboard-accessible. -->
<span
  role="button"
  tabindex="0"
  onclick={copy}
  onkeydown={onKeydown}
  class="cursor-pointer font-mono text-xs opacity-50 transition-opacity select-none hover:opacity-100 {copied
    ? 'text-success opacity-100'
    : ''} {extraClass}"
  title={copied ? "Copied!" : `Copy ${suffix}`}
>
  {copied ? "copied" : suffix}
</span>
