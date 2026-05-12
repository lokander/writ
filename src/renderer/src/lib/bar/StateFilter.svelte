<script lang="ts">
  import { NotepadIcon } from "phosphor-svelte";

  import { STATE_FILTERS, type StateFilter } from "../filter";

  interface Props {
    /** Current state-filter mode. Bindable: the buttons are radio-style
     *  (exactly one selected at a time) and click sets the new mode. */
    stateFilter: StateFilter;
  }

  let { stateFilter = $bindable() }: Props = $props();
</script>

<div
  class="flex items-center gap-0.5 rounded-full border p-1 transition-colors {stateFilter !== 'any'
    ? 'border-base-content/50'
    : 'border-base-content/20'}"
>
  <NotepadIcon
    size={14}
    weight="duotone"
    class="mx-1 {stateFilter !== 'any' ? 'opacity-80' : 'opacity-50'}"
    aria-label="State"
  />
  {#each STATE_FILTERS as opt (opt)}
    {@const active = stateFilter === opt}
    <button
      type="button"
      class="cursor-pointer rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-base-content/10 {active
        ? 'bg-base-content/10'
        : 'opacity-60'}"
      aria-pressed={active}
      onclick={() => (stateFilter = opt)}
    >
      {opt === "any" ? "All" : opt[0].toUpperCase() + opt.slice(1)}
    </button>
  {/each}
</div>
