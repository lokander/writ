<script lang="ts">
  import { MagnifyingGlassIcon, XIcon } from "phosphor-svelte";

  interface Props {
    /** Bindable query string. Empty / whitespace = no narrowing. The
     *  fuzzy search itself lives in lib/search.ts; this component is
     *  only the input pill. */
    query: string;
  }

  let { query = $bindable() }: Props = $props();

  const active = $derived(query.trim().length > 0);
</script>

<div
  class="flex items-center gap-1 rounded-full border px-2 py-1 transition-colors {active
    ? 'border-base-content/50'
    : 'border-base-content/20'}"
>
  <MagnifyingGlassIcon
    size={14}
    weight="duotone"
    class="mx-0.5 {active ? 'opacity-80' : 'opacity-50'}"
    aria-label="Search"
  />
  <input
    type="text"
    bind:value={query}
    placeholder="Search…"
    aria-label="Search tasks"
    class="w-32 bg-transparent py-0.5 text-xs outline-none placeholder:opacity-50"
  />
  {#if active}
    <button
      type="button"
      class="cursor-pointer rounded-full p-0.5 opacity-60 hover:bg-base-content/10 hover:opacity-100"
      aria-label="Clear search"
      onclick={() => (query = "")}
    >
      <XIcon size={10} weight="bold" />
    </button>
  {/if}
</div>
