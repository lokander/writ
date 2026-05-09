<script lang="ts">
  import { XIcon } from "phosphor-svelte";

  import { tagStyle } from "./tag-color";

  interface Props {
    name: string;
    /** Color spec — hex (`#3b82f6`) or CSS named, or null to use the
     *  hash-derived DaisyUI palette slot. */
    color: string | null;
    /** When provided, render a small X button after the name. */
    onRemove?: () => void;
  }

  const { name, color, onRemove }: Props = $props();
  const ts = $derived(tagStyle(name, color));
</script>

<span class="badge badge-sm {ts.className}" style:background-color={ts.inlineBg}>
  {name}
  {#if onRemove}
    <button
      type="button"
      class="ml-1 opacity-70 hover:opacity-100"
      aria-label="Remove tag"
      onclick={onRemove}
    >
      <XIcon size={10} weight="bold" />
    </button>
  {/if}
</span>
