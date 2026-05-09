<script lang="ts">
  import { X, Plus } from "phosphor-svelte";

  import type { Priority, Task } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import {
    parseTagSpec,
    validateTagName,
    TagValidationError,
  } from "../../../shared/domain/tag-format";
  import { writState } from "./state.svelte";
  import { indexTags, tagStyle } from "./tag-color";

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
  let pickedDependsOnId = $state("");

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

  const previewChip = $derived.by(() => {
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) return null;
    try {
      const validName = validateTagName(trimmed);
      const color = useCustomColor ? newTagColor : (colorByTag[validName] ?? null);
      const ts = tagStyle(validName, color);
      return { ...ts, name: validName };
    } catch {
      return null;
    }
  });

  function addTag(): void {
    const trimmed = newTagName.trim();
    if (trimmed.length === 0) return;
    let name: string;
    try {
      name = validateTagName(trimmed);
    } catch (e) {
      tagError = e instanceof TagValidationError ? e.message : String(e);
      return;
    }
    const spec = useCustomColor ? `${name}=${newTagColor}` : name;
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
    newTagName = "";
    useCustomColor = false;
    newTagColor = "#888888";
    tagError = null;
  }

  function removeTagAt(index: number): void {
    tagSpecs = tagSpecs.filter((_, i) => i !== index);
  }

  function addDependency(): void {
    if (!pickedDependsOnId) return;
    if (!dependsOnIds.includes(pickedDependsOnId)) {
      dependsOnIds = [...dependsOnIds, pickedDependsOnId];
    }
    pickedDependsOnId = "";
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

  function onTagNameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      addTag();
    }
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

      <label class="form-control w-full max-w-md">
        <span class="label label-text">Parent</span>
        <select class="select select-bordered" bind:value={parentId}>
          <option value={null}>(no parent)</option>
          {#each parentOptions as p (p.id)}
            <option value={p.id}>{p.title}</option>
          {/each}
        </select>
      </label>
    </div>

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
        <input
          type="text"
          class="input input-bordered input-sm flex-1 min-w-[10rem]"
          placeholder="Tag name"
          bind:value={newTagName}
          onkeydown={onTagNameKeydown}
        />
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
        {#if previewChip}
          <span
            class="badge badge-sm {previewChip.className}"
            style:background-color={previewChip.inlineBg}
            title="Preview"
          >
            {previewChip.name}
          </span>
        {/if}
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={addTag}
          disabled={newTagName.trim().length === 0}
        >
          <Plus size={14} weight="bold" />
          Add
        </button>
      </div>

      {#if tagError}
        <span class="label label-text text-error mt-1 text-xs">{tagError}</span>
      {/if}
    </div>

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

      <div class="flex flex-wrap items-center gap-2">
        <select
          class="select select-bordered select-sm flex-1 min-w-[10rem]"
          bind:value={pickedDependsOnId}
        >
          <option value="">(pick a task to depend on)</option>
          {#each dependencyOptions as opt (opt.id)}
            <option value={opt.id}>
              {opt.id.slice(-6)} — {opt.title}
            </option>
          {/each}
        </select>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={addDependency}
          disabled={!pickedDependsOnId}
        >
          <Plus size={14} weight="bold" />
          Add
        </button>
      </div>
    </div>

    <div class="modal-action mt-6 flex justify-end gap-2">
      <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={!canSave}>Create</button>
    </div>
  </form>
</div>
