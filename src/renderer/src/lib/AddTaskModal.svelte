<script lang="ts">
  import { X } from "phosphor-svelte";

  import type { Priority, Tag, Task } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import {
    parseTagSpec,
    validateTagName,
    TagValidationError,
  } from "../../../shared/domain/tag-format";
  import { writState } from "./state.svelte";
  import { indexTags, tagStyle } from "./tag-color";
  import Combobox from "./Combobox.svelte";

  interface Props {
    onClose: () => void;
    onCreated: (task: Task) => void;
  }

  const { onClose, onCreated }: Props = $props();

  let title = $state("");
  let description = $state("");
  let priority = $state<Priority>(2);
  let parentId = $state<string | null>(null);
  let tagSpecs = $state<string[]>([]);
  let newTagName = $state("");
  let useCustomColor = $state(false);
  let newTagColor = $state("#888888");
  let tagError = $state<string | null>(null);
  let saving = $state(false);

  let dependsOnIds = $state<string[]>([]);

  const canSave = $derived(title.trim().length > 0 && !saving);

  // The new task isn't in the graph yet, so any existing task is a valid
  // parent and any is a valid blocker — no descendant or cycle filtering
  // needed (cf. TaskEditModal which has both).
  const parentOptions = $derived(
    writState.tasks.slice().sort((a, b) => a.title.localeCompare(b.title)),
  );

  const dependencyOptions = $derived(
    writState.tasks
      .filter((t) => !dependsOnIds.includes(t.id))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const parentTask = $derived(
    parentId === null ? null : (writState.tasks.find((t) => t.id === parentId) ?? null),
  );

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  const colorByTag = $derived(indexTags(writState.tags));

  function chipStyle(spec: string): { className: string; inlineBg: string | null; name: string } {
    try {
      const parsed = parseTagSpec(spec);
      const color = parsed.color ?? colorByTag[parsed.name] ?? null;
      const ts = tagStyle(parsed.name, color);
      return { ...ts, name: parsed.name };
    } catch {
      return { className: "", inlineBg: null, name: spec };
    }
  }

  // Plain object instead of Set to dodge svelte/prefer-svelte-reactivity (the
  // value is recomputed on every tagSpecs change anyway, no internal mutation).
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

  const validatedTagName = $derived.by(() => {
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) return null;
    try {
      return validateTagName(trimmed);
    } catch {
      return null;
    }
  });

  const canCreateNewTag = $derived(
    validatedTagName !== null && !writState.tags.some((t) => t.name === validatedTagName),
  );

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

  function dedupTagSpec(spec: string, name: string): void {
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
    useCustomColor = false;
    newTagColor = "#888888";
  }

  function onCreateNewTag(name: string): void {
    const spec = useCustomColor ? `${name}=${newTagColor}` : name;
    dedupTagSpec(spec, name);
    useCustomColor = false;
    newTagColor = "#888888";
  }

  function removeTagAt(index: number): void {
    tagSpecs = tagSpecs.filter((_, i) => i !== index);
  }

  function depItemText(t: Task): string {
    return `${t.id.slice(-6)} ${t.title}`;
  }

  function onPickDependency(t: Task): void {
    if (!dependsOnIds.includes(t.id)) {
      dependsOnIds = [...dependsOnIds, t.id];
    }
  }

  function removeDependencyAt(index: number): void {
    dependsOnIds = dependsOnIds.filter((_, i) => i !== index);
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const created = await writState.createTask({
      title: title.trim(),
      description,
      priority,
      parentId,
      tags: tagSpecs.length > 0 ? tagSpecs : undefined,
      dependsOn: dependsOnIds.length > 0 ? dependsOnIds : undefined,
    });
    saving = false;
    if (created) onCreated(created);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    save();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  aria-labelledby="add-task-modal-title"
  tabindex="-1"
>
  <button type="button" class="modal-backdrop" aria-label="Close" onclick={onClose}></button>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 id="add-task-modal-title" class="text-lg font-semibold">New task</h2>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
        <X size={16} weight="bold" />
      </button>
    </div>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Title</span>
      <input type="text" class="input input-bordered w-full" bind:value={title} autofocus />
    </label>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Description</span>
      <textarea class="textarea textarea-bordered w-full" rows="10" bind:value={description}
      ></textarea>
    </label>

    <div class="mb-4 flex flex-wrap gap-4">
      <label class="form-control w-full max-w-xs">
        <span class="label label-text">Priority</span>
        <select class="select select-bordered" bind:value={priority}>
          {#each [0, 1, 2, 3] as p (p)}
            <option value={p}>{PRIORITY_NAMES[p as Priority]}</option>
          {/each}
        </select>
      </label>

      <div class="form-control w-full max-w-md">
        <span class="label label-text">Parent</span>
        <div class="flex flex-col gap-2">
          {#if parentTask}
            <div class="flex items-center gap-2">
              <span class="badge badge-outline">{parentTask.title}</span>
              <button
                type="button"
                class="opacity-70 hover:opacity-100"
                aria-label="Clear parent"
                onclick={() => (parentId = null)}
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          {:else}
            <span class="text-xs italic opacity-50">(no parent)</span>
          {/if}
          <Combobox
            items={parentOptions}
            itemText={(t) => t.title}
            itemKey={(t) => t.id}
            onSelect={(t) => (parentId = t.id)}
            placeholder="Search tasks…"
            item={parentRow}
          />
        </div>
      </div>
    </div>

    {#snippet parentRow({ item: t }: { item: Task; active: boolean })}
      <span class="font-mono text-xs opacity-50">{t.id.slice(-6)}</span>
      <span class="ml-2">{t.title}</span>
      <span class="badge badge-outline badge-sm ml-2">
        {columnNameById[t.columnId] ?? "?"}
      </span>
    {/snippet}

    <div class="form-control mb-4 w-full">
      <span class="label label-text">Tags</span>

      {#if tagSpecs.length > 0}
        <div class="mb-2 flex flex-wrap gap-1">
          {#each tagSpecs as spec, i (spec + i)}
            {@const cs = chipStyle(spec)}
            <span class="badge badge-sm {cs.className}" style:background-color={cs.inlineBg}>
              {cs.name}
              <button
                type="button"
                class="ml-1 opacity-70 hover:opacity-100"
                aria-label="Remove tag"
                onclick={() => removeTagAt(i)}
              >
                <X size={10} weight="bold" />
              </button>
            </span>
          {/each}
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        <div class="min-w-[10rem] flex-1">
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
      {@const ts = tagStyle(t.name, t.color ?? null)}
      <span class="badge badge-sm {ts.className}" style:background-color={ts.inlineBg}>
        {t.name}
      </span>
    {/snippet}

    {#snippet createTagRow({ query }: { query: string; active: boolean })}
      {#if validatedTagName !== null}
        {@const previewColor = useCustomColor
          ? newTagColor
          : (colorByTag[validatedTagName] ?? null)}
        {@const ts = tagStyle(validatedTagName, previewColor)}
        <span class="opacity-70">Create new tag</span>
        <span class="badge badge-sm ml-2 {ts.className}" style:background-color={ts.inlineBg}>
          {validatedTagName}
        </span>
      {:else}
        <span class="italic opacity-60">Type a tag name…</span>
        <span class="hidden">{query}</span>
      {/if}
    {/snippet}

    <div class="form-control mb-4 w-full">
      <span class="label label-text">Blocked by</span>

      {#if dependsOnIds.length > 0}
        <div class="mb-2 flex flex-col gap-1">
          {#each dependsOnIds as depId, i (depId)}
            {@const dep = writState.tasks.find((t) => t.id === depId)}
            <div class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-sm">
              <span class="font-mono text-xs opacity-50">{depId.slice(-6)}</span>
              <span class="flex-1">{dep?.title ?? "(unknown)"}</span>
              {#if dep}
                <span class="badge badge-outline badge-sm">
                  {columnNameById[dep.columnId] ?? "?"}
                </span>
              {/if}
              <button
                type="button"
                class="opacity-70 hover:opacity-100"
                aria-label="Remove blocker"
                onclick={() => removeDependencyAt(i)}
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <Combobox
        items={dependencyOptions}
        itemText={depItemText}
        itemKey={(t) => t.id}
        onSelect={onPickDependency}
        item={dependencyRow}
        placeholder="Search tasks…"
      />
    </div>

    {#snippet dependencyRow({ item: t }: { item: Task; active: boolean })}
      <span class="font-mono text-xs opacity-50">{t.id.slice(-6)}</span>
      <span class="ml-2">{t.title}</span>
      <span class="badge badge-outline badge-sm ml-2">
        {columnNameById[t.columnId] ?? "?"}
      </span>
    {/snippet}

    <div class="modal-action mt-6 flex justify-end gap-2">
      <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={!canSave}>Create</button>
    </div>
  </form>
</div>
