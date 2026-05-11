<script lang="ts">
  import { FunnelIcon, TagIcon, XIcon } from "phosphor-svelte";

  import { type Priority, type Tag } from "../../../../shared/types";
  import { STATE_FILTERS, type StateFilter } from "../filter";
  import TagChip from "../chip/TagChip.svelte";
  import Combobox from "../picker/Combobox.svelte";
  import PriorityFilter from "./PriorityFilter.svelte";

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

  let tagQuery = $state("");

  function toggleTag(name: string): void {
    tags = tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name];
  }

  // Tags in scope but not currently selected — the typeahead's "what you
  // can still add" set. Selected tags live as chips above the input, where
  // each chip's X removes it. (Mirroring TagPicker's split: existing chips
  // for active selection, combobox for the remaining pool.)
  const availableTags = $derived(visibleTagChips.filter((t) => !tags.includes(t.name)));

  // Pair each selected name with its color from the in-scope tag set so
  // the chips render with the same palette as the dropdown rows. App.svelte
  // always keeps filtered tags in `tagsInView`, so the lookup hits.
  const selectedTags = $derived(
    tags
      .map((name): Tag | null => visibleTagChips.find((t) => t.name === name) ?? null)
      .filter((t): t is Tag => t !== null),
  );

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
    <div class="flex flex-wrap items-center gap-2">
      <TagIcon size={14} class="opacity-50" aria-label="Tags" />
      <div class="w-40">
        <Combobox
          items={availableTags}
          itemText={(t) => t.name}
          itemKey={(t) => t.name}
          onSelect={(t) => toggleTag(t.name)}
          item={tagOptionRow}
          bind:value={tagQuery}
          placeholder={selectedTags.length === 0 ? "Filter by tag…" : "Add tag…"}
        />
      </div>
      {#if selectedTags.length > 0}
        <div class="flex flex-wrap items-center gap-1">
          {#each selectedTags as tag (tag.name)}
            <button
              type="button"
              class="cursor-pointer"
              aria-label="Remove tag {tag.name}"
              onclick={() => toggleTag(tag.name)}
            >
              <TagChip name={tag.name} color={tag.color} />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if filtersActive}
    <button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={clearAll}>
      <XIcon size={12} weight="bold" />
    </button>
  {/if}
</div>

{#snippet tagOptionRow({ item: t }: { item: Tag; active: boolean })}
  <TagChip name={t.name} color={t.color} />
{/snippet}
