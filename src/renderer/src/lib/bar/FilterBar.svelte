<script lang="ts">
  import { FunnelIcon, XIcon } from "phosphor-svelte";

  import { type Priority, type Tag } from "../../../../shared/types";
  import { type StateFilter as StateFilterValue } from "../filter";
  import PriorityFilter from "./PriorityFilter.svelte";
  import SearchFilter from "./SearchFilter.svelte";
  import StateFilter from "./StateFilter.svelte";
  import TagFilter from "./TagFilter.svelte";

  interface Props {
    /** Selected tag names. Replaced wholesale on toggle (no mutation).
     *  ANDed in matchesFilters — the renderer doesn't surface OR mode
     *  (use the CLI's `--any-tag` if you need it). */
    tags: string[];
    /** Selected priorities (multi-select). */
    priorities: Priority[];
    /** State (ready/blocked/any) narrowing. */
    stateFilter: StateFilterValue;
    /** Free-text fuzzy query over title + description. */
    query: string;
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
    query = $bindable(),
    visibleTagChips,
    filtersActive,
  }: Props = $props();

  function clearAll(): void {
    tags = [];
    priorities = [];
    stateFilter = "any";
    query = "";
  }
</script>

<div
  class="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 transition-colors {filtersActive
    ? 'bg-primary/1'
    : 'bg-base-200'}"
>
  <FunnelIcon size={20} weight="duotone" class="ml-0.5 mr-1 opacity-60" aria-label="Filter" />

  <SearchFilter bind:query />
  <StateFilter bind:stateFilter />
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
