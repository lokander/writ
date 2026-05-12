<script lang="ts">
  import { FunnelIcon, XIcon } from "phosphor-svelte";

  import { type Priority, type Tag } from "../../../../shared/types";
  import { STATE_FILTERS, type StateFilter } from "../filter";
  import PriorityFilter from "./PriorityFilter.svelte";
  import TagFilter from "./TagFilter.svelte";

  interface Props {
    /** Selected tag names. Replaced wholesale on toggle (no mutation).
     *  ANDed in matchesFilters — the renderer doesn't surface OR mode
     *  (use the CLI's `--any-tag` if you need it). */
    tags: string[];
    /** Selected priorities (multi-select). */
    priorities: Priority[];
    /** State (ready/blocked/any) narrowing. */
    stateFilter: StateFilter;
    /** Tag chips to render — owner-derived from the tasks currently visible
     *  so the legend doesn't list tags the user can't see anyway. */
    visibleTagChips: Tag[];
    /** Drives the highlighted border/background on the bar when any filter
     *  is active. Derived upstream because the same flag drives the
     *  visibleTasks pipeline. */
    filtersActive: boolean;
  }

  let {
    tags = $bindable(),
    priorities = $bindable(),
    stateFilter = $bindable(),
    visibleTagChips,
    filtersActive,
  }: Props = $props();

  function clearAll(): void {
    tags = [];
    priorities = [];
    stateFilter = "any";
  }
</script>

<div
  class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 transition-colors {filtersActive
    ? 'bg-primary/1'
    : 'bg-base-200'}"
>
  <div class="flex items-center gap-2">
    <FunnelIcon size={20} class="ml-0.5 opacity-60" aria-label="Filter" />
    <div class="join">
      {#each STATE_FILTERS as opt (opt)}
        <button
          type="button"
          class="btn btn-primary btn-xs join-item"
          class:btn-soft={stateFilter !== opt}
          onclick={() => (stateFilter = opt)}
        >
          {opt === "any" ? "All" : opt[0].toUpperCase() + opt.slice(1)}
        </button>
      {/each}
    </div>
  </div>

  <PriorityFilter bind:priorities />

  {#if visibleTagChips.length > 0}
    <TagFilter bind:tags {visibleTagChips} />
  {/if}

  {#if filtersActive}
    <button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={clearAll}>
      <XIcon size={12} weight="bold" />
    </button>
  {/if}
</div>
