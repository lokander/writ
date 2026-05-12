<script lang="ts">
  import { FunnelIcon, XIcon } from "phosphor-svelte";

  import { type Tag } from "../../../../shared/types";
  import { filters } from "../filters.svelte";
  import PriorityFilter from "./PriorityFilter.svelte";
  import SearchFilter from "./SearchFilter.svelte";
  import StateFilter from "./StateFilter.svelte";
  import TagFilter from "./TagFilter.svelte";

  interface Props {
    /** Tag chips to render — owner-derived from the tasks currently visible
     *  so the legend doesn't list tags the user can't see anyway. Lives in
     *  App.svelte because it depends on `view` and `activeColumnId`, which
     *  the filter module doesn't know about. */
    visibleTagChips: Tag[];
  }

  let { visibleTagChips }: Props = $props();
</script>

<div
  class="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2 transition-colors {filters.active
    ? 'bg-primary/1'
    : 'bg-base-200'}"
>
  <FunnelIcon size={20} weight="duotone" class="ml-0.5 mr-1 opacity-60" aria-label="Filter" />

  <SearchFilter bind:query={filters.query} />
  <StateFilter bind:stateFilter={filters.state} />
  <PriorityFilter bind:priorities={filters.priorities} />

  {#if visibleTagChips.length > 0}
    <TagFilter bind:tags={filters.tags} {visibleTagChips} />
  {/if}

  {#if filters.active}
    <button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={() => filters.clear()}>
      <XIcon size={12} weight="bold" />
    </button>
  {/if}
</div>
