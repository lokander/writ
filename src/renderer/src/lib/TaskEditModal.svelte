<script lang="ts">
  import { X, Trash, Plus, PencilSimple } from "phosphor-svelte";

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
    task: Task;
    onClose: () => void;
    onSwitch: (id: string) => void;
  }

  const { task, onClose, onSwitch }: Props = $props();

  let mode = $state<"view" | "edit">("view");

  let title = $state(task.title);
  let description = $state(task.description);
  let priority = $state<Priority>(task.priority);
  let parentId = $state<string | null>(task.parentId);
  // Each entry is a tag spec — `NAME` or `NAME=COLOR`. We display the parsed
  // name in chips, and pass the raw spec list straight to setTaskTags on save
  // so any `=COLOR` upserts go through.
  let tagSpecs = $state<string[]>([...task.tags]);
  let newTagName = $state("");
  let useCustomColor = $state(false);
  let newTagColor = $state("#888888");
  let tagError = $state<string | null>(null);
  let saving = $state(false);

  let addingSubtask = $state(false);
  let newSubtaskTitle = $state("");

  const tagsDirty = $derived.by(() => {
    if (tagSpecs.length !== task.tags.length) return true;
    const a = [...tagSpecs].sort();
    const b = [...task.tags].sort();
    return a.some((v, i) => v !== b[i]);
  });

  const dirty = $derived(
    title !== task.title ||
      description !== task.description ||
      priority !== task.priority ||
      parentId !== task.parentId ||
      tagsDirty,
  );

  const canSave = $derived(dirty && title.trim().length > 0 && !saving);

  // Self + all descendants — must be excluded from the parent picker so the
  // user can't make a cycle.
  const descendantIds = $derived.by(() => {
    const set: Record<string, true> = { [task.id]: true };
    let added = true;
    while (added) {
      added = false;
      for (const t of writState.tasks) {
        if (t.parentId !== null && set[t.parentId] && !set[t.id]) {
          set[t.id] = true;
          added = true;
        }
      }
    }
    return set;
  });

  const parentOptions = $derived(
    writState.tasks
      .filter((t) => !descendantIds[t.id])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const parentTask = $derived(
    task.parentId === null ? null : (writState.tasks.find((t) => t.id === task.parentId) ?? null),
  );

  const children = $derived(writState.tasks.filter((t) => t.parentId === task.id));

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  const colorByTag = $derived(indexTags(writState.tags));

  // Resolves the display color for a chip. Inline `=COLOR` overrides; else
  // fall back to whatever's stored on the global tag (NULL → hash slot).
  function chipStyle(spec: string): { className: string; inlineBg: string | null; name: string } {
    try {
      const parsed = parseTagSpec(spec);
      const color = parsed.color ?? colorByTag[parsed.name] ?? null;
      const ts = tagStyle(parsed.name, color);
      return { ...ts, name: parsed.name };
    } catch {
      // Shouldn't happen — addTagFromInput validates before pushing.
      return { className: "", inlineBg: null, name: spec };
    }
  }

  // Live preview of what the chip would look like with the current
  // name+color inputs, so the user sees the auto-color (or their picked
  // color) before pressing Add.
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

  function enterEdit(): void {
    title = task.title;
    description = task.description;
    priority = task.priority;
    parentId = task.parentId;
    tagSpecs = [...task.tags];
    newTagName = "";
    useCustomColor = false;
    newTagColor = "#888888";
    tagError = null;
    mode = "edit";
  }

  function cancelEdit(): void {
    mode = "view";
  }

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
    // Replace any existing entry that resolves to the same name so a
    // follow-up Add with a color overwrites the older spec.
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

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const updated = await writState.updateTask(task.id, {
      title: title.trim(),
      description,
      priority,
      parentId,
      tags: tagsDirty ? tagSpecs : undefined,
    });
    saving = false;
    if (updated) mode = "view";
  }

  async function remove(): Promise<void> {
    const ok = await writState.deleteTask(task.id);
    if (ok) onClose();
  }

  async function addSubtask(): Promise<void> {
    const trimmed = newSubtaskTitle.trim();
    if (trimmed.length === 0) return;
    const created = await writState.createTask({
      title: trimmed,
      parentId: task.id,
      columnId: task.columnId,
    });
    if (created) {
      newSubtaskTitle = "";
      addingSubtask = false;
    }
  }

  function cancelAddSubtask(): void {
    newSubtaskTitle = "";
    addingSubtask = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc unwinds layered state: subtask form → edit mode → close modal.
    if (addingSubtask) {
      cancelAddSubtask();
      event.stopPropagation();
    } else if (mode === "edit") {
      cancelEdit();
      event.stopPropagation();
    } else {
      onClose();
    }
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    save();
  }

  function onSubtaskFormSubmit(event: SubmitEvent): void {
    event.preventDefault();
    addSubtask();
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
  aria-labelledby="task-modal-title"
  tabindex="-1"
>
  <button type="button" class="modal-backdrop" aria-label="Close" onclick={onClose}></button>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    {#if mode === "view"}
      <div class="mb-4 flex items-start justify-between gap-3">
        <h2 id="task-modal-title" class="text-2xl font-semibold leading-tight">{task.title}</h2>
        <div class="flex shrink-0 items-baseline gap-2">
          <span class="font-mono text-xs opacity-50">{task.id.slice(-6)}</span>
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
            <X size={16} weight="bold" />
          </button>
        </div>
      </div>

      <div class="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span class="badge badge-outline">
          {columnNameById[task.columnId] ?? "?"}
        </span>
        <span><span class="opacity-60">Priority:</span> {PRIORITY_NAMES[task.priority]}</span>
        <span class="flex items-center gap-2">
          <span class="opacity-60">Parent:</span>
          {#if parentTask}
            <button type="button" class="link link-hover" onclick={() => onSwitch(parentTask.id)}>
              {parentTask.title}
            </button>
          {:else}
            <span class="opacity-50 italic">(none)</span>
          {/if}
        </span>
        {#if task.tags.length > 0}
          <span class="flex flex-wrap items-center gap-1">
            <span class="opacity-60">Tags:</span>
            {#each task.tags as tag (tag)}
              {@const ts = tagStyle(tag, colorByTag[tag] ?? null)}
              <span class="badge badge-sm {ts.className}" style:background-color={ts.inlineBg}>
                {tag}
              </span>
            {/each}
          </span>
        {/if}
      </div>

      <div class="mb-6">
        <div class="label label-text mb-1 opacity-60">Description</div>
        {#if task.description.trim().length > 0}
          <div class="rounded-lg bg-base-200 px-4 py-3 text-sm whitespace-pre-wrap">
            {task.description}
          </div>
        {:else}
          <p class="text-sm italic opacity-40">No description.</p>
        {/if}
      </div>
    {:else}
      <div class="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="task-modal-title" class="text-lg font-semibold">Edit task</h2>
        <div class="flex shrink-0 items-baseline gap-2">
          <span class="font-mono text-xs opacity-50">{task.id.slice(-6)}</span>
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
            <X size={16} weight="bold" />
          </button>
        </div>
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
    {/if}

    <div class="mb-4">
      <div class="mb-2 flex items-center justify-between">
        <span class="label-text font-medium">Subtasks ({children.length})</span>
        {#if !addingSubtask}
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (addingSubtask = true)}>
            <Plus size={14} weight="bold" />
            Subtask
          </button>
        {/if}
      </div>

      {#if children.length > 0}
        <div class="flex flex-col gap-1">
          {#each children as child (child.id)}
            {@const showBadge = child.columnId !== task.columnId}
            <button
              type="button"
              class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
              onclick={() => onSwitch(child.id)}
            >
              <span class="font-mono text-xs opacity-50">{child.id.slice(-6)}</span>
              <span class="flex-1">{child.title}</span>
              {#each child.tags as tag (tag)}
                {@const ts = tagStyle(tag, colorByTag[tag] ?? null)}
                <span class="badge badge-sm {ts.className}" style:background-color={ts.inlineBg}>
                  {tag}
                </span>
              {/each}
              {#if showBadge}
                <span class="badge badge-outline badge-sm">
                  {columnNameById[child.columnId] ?? "?"}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {:else if !addingSubtask}
        <p class="text-xs italic opacity-40">No subtasks.</p>
      {/if}

      {#if addingSubtask}
        <!-- A nested <form> would be invalid HTML inside the outer form, so this
             is a div with explicit submit-on-Enter handling instead. -->
        <div class="mt-2 flex gap-2">
          <input
            type="text"
            class="input input-bordered input-sm flex-1"
            placeholder="Subtask title"
            bind:value={newSubtaskTitle}
            onkeydown={(e) => {
              if (e.key === "Enter") onSubtaskFormSubmit(e as unknown as SubmitEvent);
            }}
            autofocus
          />
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onclick={addSubtask}
            disabled={newSubtaskTitle.trim().length === 0}
          >
            Add
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={cancelAddSubtask}>
            Cancel
          </button>
        </div>
      {/if}
    </div>

    <div class="modal-action mt-6 flex items-center justify-between">
      <button type="button" class="btn btn-error btn-outline" onclick={remove}>
        <Trash size={16} weight="bold" />
        Delete
      </button>
      <div class="flex gap-2">
        {#if mode === "view"}
          <button type="button" class="btn btn-primary" onclick={enterEdit}>
            <PencilSimple size={16} weight="bold" />
            Edit
          </button>
        {:else}
          <button type="button" class="btn btn-ghost" onclick={cancelEdit}>Cancel</button>
          <button type="submit" class="btn btn-primary" disabled={!canSave}>Save</button>
        {/if}
      </div>
    </div>
  </form>
</div>
