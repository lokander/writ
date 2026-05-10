<script lang="ts">
  import {
    parseTagSpec,
    validateTagName,
    TagValidationError,
  } from "../../../../shared/domain/tag-format";
  import type { Tag } from "../../../../shared/types";
  import { writState } from "../state.svelte";
  import { indexTags } from "../tag-color";
  import Combobox from "./Combobox.svelte";
  import TagChip from "../chip/TagChip.svelte";

  interface Props {
    /** Tag specs (`NAME` or `NAME=COLOR`). Bindable so callers can patch this
     *  straight into their save payload. */
    tagSpecs: string[];
  }

  let { tagSpecs = $bindable() }: Props = $props();

  let newTagName = $state("");
  let useCustomColor = $state(false);
  let newTagColor = $state("#888888");
  let tagError = $state<string | null>(null);

  const colorByTag = $derived(indexTags(writState.tags));

  // Names of tags currently attached to the in-progress edit. Used to filter
  // the combobox so the user doesn't see tags they've already added. Plain
  // object instead of Set to dodge svelte/prefer-svelte-reactivity (the value
  // is recomputed on every tagSpecs change anyway, no internal mutation).
  const attachedTagNames = $derived.by(() => {
    const names: Record<string, true> = {};
    for (const spec of tagSpecs) {
      try {
        names[parseTagSpec(spec).name] = true;
      } catch {
        // ignore — invalid specs can't have been added through the UI
      }
    }
    return names;
  });

  const availableTags = $derived(writState.tags.filter((t) => !attachedTagNames[t.name]));

  // The current input, validated to a tag name. null when empty or invalid.
  const validatedTagName = $derived.by(() => {
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) return null;
    try {
      return validateTagName(trimmed);
    } catch {
      return null;
    }
  });

  // Show "Create new tag X" only when input is valid AND no existing tag has
  // exactly that name. Existing tags surface in the dropdown items instead.
  const canCreateNewTag = $derived(
    validatedTagName !== null && !writState.tags.some((t) => t.name === validatedTagName),
  );

  // Reflect tag-name validation as an inline error.
  $effect(() => {
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) {
      tagError = null;
      return;
    }
    try {
      validateTagName(trimmed);
      tagError = null;
    } catch (e) {
      tagError = e instanceof TagValidationError ? e.message : String(e);
    }
  });

  function specToNameColor(spec: string): { name: string; color: string | null } {
    try {
      const parsed = parseTagSpec(spec);
      return { name: parsed.name, color: parsed.color ?? colorByTag[parsed.name] ?? null };
    } catch {
      return { name: spec, color: null };
    }
  }

  function dedupTagSpec(spec: string, name: string): void {
    // Replace any existing entry resolving to the same name so picking again
    // (e.g. with a color override) overwrites the older spec rather than
    // double-adding.
    const existingIndex = tagSpecs.findIndex((s) => {
      try {
        return parseTagSpec(s).name === name;
      } catch {
        return false;
      }
    });
    if (existingIndex >= 0) {
      tagSpecs = [...tagSpecs.slice(0, existingIndex), spec, ...tagSpecs.slice(existingIndex + 1)];
    } else {
      tagSpecs = [...tagSpecs, spec];
    }
  }

  function onPickExistingTag(t: Tag): void {
    dedupTagSpec(t.name, t.name);
    // Custom color toggle only applies to new tags; reset for a clean next pick.
    useCustomColor = false;
    newTagColor = "#888888";
  }

  function onCreateNewTag(name: string): void {
    // canCreateNewTag was true to enable this code path, so name validates.
    const spec = useCustomColor ? `${name}=${newTagColor}` : name;
    dedupTagSpec(spec, name);
    useCustomColor = false;
    newTagColor = "#888888";
  }

  function removeTagAt(index: number): void {
    tagSpecs = tagSpecs.filter((_, i) => i !== index);
  }
</script>

<div class="form-control mb-4 w-full">
  <span class="label label-text">Tags</span>

  {#if tagSpecs.length > 0}
    <div class="mb-2 flex flex-wrap gap-1">
      {#each tagSpecs as spec, i (spec + i)}
        {@const nc = specToNameColor(spec)}
        <TagChip name={nc.name} color={nc.color} onRemove={() => removeTagAt(i)} />
      {/each}
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <div class="min-w-40 flex-1">
      <Combobox
        items={availableTags}
        itemText={(t) => t.name}
        itemKey={(t) => t.name}
        onSelect={onPickExistingTag}
        item={tagRow}
        extra={canCreateNewTag ? createTagRow : undefined}
        onExtraSelect={canCreateNewTag ? onCreateNewTag : undefined}
        bind:value={newTagName}
        placeholder="Tag name"
      />
    </div>
    <label class="label cursor-pointer gap-2 px-2">
      <input type="checkbox" class="checkbox checkbox-sm" bind:checked={useCustomColor} />
      <span class="label-text text-sm">Custom color</span>
    </label>
    {#if useCustomColor}
      <input
        type="color"
        class="h-8 w-12 cursor-pointer rounded border border-base-300 bg-base-200"
        bind:value={newTagColor}
      />
    {/if}
  </div>

  {#if tagError}
    <span class="label label-text text-error mt-1 text-xs">{tagError}</span>
  {/if}
</div>

{#snippet tagRow({ item: t }: { item: Tag; active: boolean })}
  <TagChip name={t.name} color={t.color ?? null} />
{/snippet}

{#snippet createTagRow({ query }: { query: string; active: boolean })}
  {#if validatedTagName !== null}
    {@const previewColor = useCustomColor ? newTagColor : (colorByTag[validatedTagName] ?? null)}
    <span class="opacity-70">Create new tag</span>
    <span class="ml-2"><TagChip name={validatedTagName} color={previewColor} /></span>
  {:else}
    <span class="italic opacity-60">Type a tag name…</span>
    <span class="hidden">{query}</span>
  {/if}
{/snippet}
