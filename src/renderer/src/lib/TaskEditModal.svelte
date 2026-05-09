<script lang="ts">
  import { X, Trash, Plus, PencilSimple, LockSimple } from "phosphor-svelte";

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

  let dependsOnIds = $state<string[]>([...task.dependsOn]);

  let addingSubtask = $state(false);
  let newSubtaskTitle = $state("");

  const tagsDirty = $derived.by(() => {
    if (tagSpecs.length !== task.tags.length) return true;
    const a = [...tagSpecs].sort();
    const b = [...task.tags].sort();
    return a.some((v, i) => v !== b[i]);
  });

  const dependsOnDirty = $derived.by(() => {
    if (dependsOnIds.length !== task.dependsOn.length) return true;
    const a = [...dependsOnIds].sort();
    const b = [...task.dependsOn].sort();
    return a.some((v, i) => v !== b[i]);
  });

  const dirty = $derived(
    title !== task.title ||
      description !== task.description ||
      priority !== task.priority ||
      parentId !== task.parentId ||
      tagsDirty ||
      dependsOnDirty,
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

  // BFS through depends-on edges from `candidateId` to see whether it would
  // (transitively) reach the current task. If so, attaching the candidate as
  // a blocker would create a cycle. Mirrors the cycle check in the domain
  // layer (which the user gets at save time anyway, but doing it client-side
  // lets us hide invalid candidates from the picker).
  function wouldCycle(candidateId: string): boolean {
    if (candidateId === task.id) return true;
    const visited: Record<string, true> = {};
    const queue: string[] = [candidateId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === task.id) return true;
      if (visited[cur]) continue;
      visited[cur] = true;
      const row = writState.tasks.find((t) => t.id === cur);
      if (!row) continue;
      for (const depId of row.dependsOn) queue.push(depId);
    }
    return false;
  }

  const dependencyOptions = $derived(
    writState.tasks
      .filter((t) => t.id !== task.id)
      .filter((t) => !dependsOnIds.includes(t.id))
      .filter((t) => !wouldCycle(t.id))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const dependents = $derived(writState.tasks.filter((t) => t.dependsOn.includes(task.id)));

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
    dependsOnIds = [...task.dependsOn];
    mode = "edit";
  }

  function cancelEdit(): void {
    mode = "view";
  }

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
    // Existing tag picked: custom color toggle doesn't apply (color management
    // for existing tags is a separate flow). Reset for a clean next pick.
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

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const updated = await writState.updateTask(task.id, {
      title: title.trim(),
      description,
      priority,
      parentId,
      tags: tagsDirty ? tagSpecs : undefined,
      dependsOn: dependsOnDirty ? dependsOnIds : undefined,
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

      {#if task.dependsOn.length > 0}
        <div class="mb-4">
          <div class="label label-text mb-1 flex items-center gap-2 opacity-60">
            <LockSimple
              size={14}
              weight="fill"
              class={task.isReady ? "opacity-40" : "text-warning"}
            />
            Blocked by ({task.blockedBy.length}/{task.dependsOn.length} open)
          </div>
          <div class="flex flex-col gap-1">
            {#each task.dependsOn as blockerId (blockerId)}
              {@const blocker = writState.tasks.find((t) => t.id === blockerId)}
              {#if blocker}
                {@const stillBlocking = task.blockedBy.includes(blockerId)}
                <button
                  type="button"
                  class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
                  class:opacity-50={!stillBlocking}
                  onclick={() => onSwitch(blocker.id)}
                >
                  <span class="font-mono text-xs opacity-50">{blocker.id.slice(-6)}</span>
                  <span class="flex-1">
                    {#if !stillBlocking}<span class="line-through">{blocker.title}</span
                      >{:else}{blocker.title}{/if}
                  </span>
                  <span class="badge badge-outline badge-sm">
                    {columnNameById[blocker.columnId] ?? "?"}
                  </span>
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      {#if dependents.length > 0}
        <div class="mb-4">
          <div class="label label-text mb-1 opacity-60">
            Blocks ({dependents.length})
          </div>
          <div class="flex flex-col gap-1">
            {#each dependents as dep (dep.id)}
              <button
                type="button"
                class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
                onclick={() => onSwitch(dep.id)}
              >
                <span class="font-mono text-xs opacity-50">{dep.id.slice(-6)}</span>
                <span class="flex-1">{dep.title}</span>
                <span class="badge badge-outline badge-sm">
                  {columnNameById[dep.columnId] ?? "?"}
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

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
          <!-- query is unused here but the snippet API requires it -->
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
