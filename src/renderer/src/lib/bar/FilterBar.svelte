<script lang="ts">
  import { FlagIcon, FunnelIcon, TagIcon, XIcon } from "phosphor-svelte";

  import { PRIORITY_NAMES, type Priority, type Tag } from "../../../../shared/types";
  import { PRIORITY_DOT_CLASS } from "../priority-color";
  import { STATE_FILTERS, type StateFilter } from "../filter";
  import TagChip from "../chip/TagChip.svelte";

  interface Props {
    /** Selected tag names. Replaced wholesale on toggle (no mutation). */
    tags: string[];
    /** Selected priorities (multi-select). */
    priorities: Priority[];
    /** How selected tag chips combine: "all" = AND, "any" = OR (parity with
     *  the CLI's `--any-tag`). */
    tagMode: "all" | "any";
    /** State (ready/blocked/any) narrowing. */
    state: StateFilter;
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
    tagMode = $bindable(),
    state = $bindable(),
    visibleTagChips,
    filtersActive,
  }: Props = $props();

  // Same priority-chip palette the bar always rendered. Lives here now
  // because nothing outside FilterBar references it.
  const PRIORITY_CHIPS: { value: Priority; label: string; dotClass: string }[] = [
    { value: 0, label: PRIORITY_NAMES[0], dotClass: PRIORITY_DOT_CLASS[0] },
    { value: 1, label: PRIORITY_NAMES[1], dotClass: PRIORITY_DOT_CLASS[1] },
    { value: 2, label: PRIORITY_NAMES[2], dotClass: PRIORITY_DOT_CLASS[2] },
    { value: 3, label: PRIORITY_NAMES[3], dotClass: PRIORITY_DOT_CLASS[3] },
  ];

  function toggleTag(name: string): void {
    tags = tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name];
  }

  function togglePriority(p: Priority): void {
    priorities = priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p];
  }

  function clearAll(): void {
    tags = [];
    priorities = [];
    tagMode = "all";
    state = "any";
  }
</script>

<div
  class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 transition-colors {filtersActive
    ? 'border-primary/40 bg-primary/5'
    : 'border-base-300 bg-base-200'}"
>
  <div class="flex items-center gap-2">
    <FunnelIcon size={20} class="ml-0.5 opacity-60" aria-label="Filter" />
    <div class="join">
      {#each STATE_FILTERS as opt (opt)}
        <button
          type="button"
          class="btn btn-primary btn-xs join-item"
          class:btn-soft={state !== opt}
          onclick={() => (state = opt)}
        >
          {opt === "any" ? "All" : opt[0].toUpperCase() + opt.slice(1)}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-1.5">
    <FlagIcon size={14} class="opacity-50" aria-label="Priority" />
    {#each PRIORITY_CHIPS as chip (chip.value)}
      {@const active = priorities.includes(chip.value)}
      <button
        type="button"
        class="flex items-center gap-1 rounded-full border border-base-content/20 px-2 py-0.5 text-xs transition-opacity"
        class:opacity-40={!active}
        aria-pressed={active}
        onclick={() => togglePriority(chip.value)}
      >
        <span class="inline-block h-2 w-2 rounded-full {chip.dotClass}"></span>
        <span class="capitalize">{chip.label}</span>
      </button>
    {/each}
  </div>

  {#if visibleTagChips.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <TagIcon size={14} class="opacity-50" aria-label="Tags" />
      <div class="join">
        {#each ["all", "any"] as const as mode (mode)}
          <button
            type="button"
            class="btn btn-primary btn-xs join-item"
            class:btn-soft={tagMode !== mode}
            title={mode === "all"
              ? "Match tasks tagged with every selected tag"
              : "Match tasks tagged with any of the selected tags"}
            onclick={() => (tagMode = mode)}
          >
            {mode[0].toUpperCase() + mode.slice(1)}
          </button>
        {/each}
      </div>
      <div class="flex flex-wrap items-center gap-1">
        {#each visibleTagChips as tag (tag.name)}
          {@const active = tags.includes(tag.name)}
          <button
            type="button"
            class="cursor-pointer transition-opacity"
            class:opacity-40={!active}
            aria-pressed={active}
            onclick={() => toggleTag(tag.name)}
          >
            <TagChip name={tag.name} color={tag.color} />
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if filtersActive}
    <button type="button" class="btn btn-ghost btn-xs ml-auto" onclick={clearAll}>
      <XIcon size={12} weight="bold" />
    </button>
  {/if}
</div>
