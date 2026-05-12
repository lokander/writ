<script lang="ts">
  import { TagIcon } from "phosphor-svelte";

  import type { Tag } from "../../../../shared/types";
  import TagChip from "../chip/TagChip.svelte";
  import Combobox from "../picker/Combobox.svelte";

  interface Props {
    /** Selected tag names. Bindable so the parent can persist them.
     *  ANDed in matchesFilters — the renderer doesn't surface OR mode. */
    tags: string[];
    /** Tag chips currently in scope — owner-derived from the tasks the
     *  user can see, so the typeahead doesn't surface tags they couldn't
     *  filter to anyway. */
    visibleTagChips: Tag[];
  }

  let { tags = $bindable(), visibleTagChips }: Props = $props();

  let tagQuery = $state("");

  function toggleTag(name: string): void {
    tags = tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name];
  }

  // Backspace-on-empty-input removes the last selected chip. Mirrors the
  // common pattern in tagged-input UIs (Slack, Linear, GitHub labels). The
  // target check makes sure we only act when the input itself is focused —
  // pressing Backspace on a focused chip button shouldn't drop a *different*
  // chip out from under the user.
  function onPillKeydown(event: KeyboardEvent): void {
    if (event.key !== "Backspace") return;
    if (!(event.target instanceof HTMLInputElement)) return;
    if (tagQuery !== "" || tags.length === 0) return;
    event.preventDefault();
    tags = tags.slice(0, -1);
  }

  // Available pool for the typeahead — visible tags minus what's already
  // selected (selected ones live as chips after the input, where the chip
  // itself is the remove affordance).
  const availableTags = $derived(visibleTagChips.filter((t) => !tags.includes(t.name)));

  // Pair each selected name with its color from the in-scope tag set so
  // chips render with the same palette as the dropdown rows. App.svelte
  // always keeps filtered tags in `tagsInView`, so the lookup hits.
  const selectedTags = $derived(
    tags
      .map((name): Tag | null => visibleTagChips.find((t) => t.name === name) ?? null)
      .filter((t): t is Tag => t !== null),
  );
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="flex items-center gap-1 rounded-full border p-1 transition-colors {tags.length > 0
    ? 'border-base-content/50'
    : 'border-base-content/20'}"
  onkeydown={onPillKeydown}
  role="group"
>
  <TagIcon
    size={14}
    weight="duotone"
    class="mx-1 {tags.length > 0 ? 'opacity-80' : 'opacity-50'}"
    aria-label="Tags"
  />
  {#if selectedTags.length > 0}
    <div class="flex flex-wrap items-center gap-1">
      {#each selectedTags as tag (tag.name)}
        <button
          type="button"
          class="flex cursor-pointer items-center"
          aria-label="Remove tag {tag.name}"
          onclick={() => toggleTag(tag.name)}
        >
          <TagChip name={tag.name} color={tag.color} />
        </button>
      {/each}
    </div>
  {/if}
  <div class="w-28">
    <Combobox
      items={availableTags}
      itemText={(t) => t.name}
      itemKey={(t) => t.name}
      onSelect={(t) => toggleTag(t.name)}
      item={tagOptionRow}
      bind:value={tagQuery}
      placeholder={selectedTags.length === 0 ? "Filter by tag…" : "Add tag…"}
      flat
      dropdownMinWidth="10rem"
      dropdownOffsetX={-32}
    />
  </div>
</div>

{#snippet tagOptionRow({ item: t }: { item: Tag; active: boolean })}
  <TagChip name={t.name} color={t.color} />
{/snippet}
