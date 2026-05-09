<script lang="ts">
  import { untrack } from "svelte";
  import { XIcon, TrashIcon, PlusIcon, PencilSimpleIcon, LockSimpleIcon } from "phosphor-svelte";

  import type { Priority, Task } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import { writState } from "./state.svelte";
  import { indexTags } from "./tag-color";
  import { renderMarkdown } from "./markdown";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import DependsOnPicker from "./DependsOnPicker.svelte";
  import ParentPicker from "./ParentPicker.svelte";
  import TagChip from "./TagChip.svelte";
  import TagPicker from "./TagPicker.svelte";
  import TaskIdChip from "./TaskIdChip.svelte";
  import TaskRefRow from "./TaskRefRow.svelte";

  interface Props {
    task: Task;
    /** Mode the modal opens in. The context-menu "Edit task…" entry passes
     *  `"edit"` so the user lands directly in the form; clicking a card
     *  defaults to `"view"`. Captured-on-mount via untrack — the parent keys
     *  the modal on task.id, so a switch remounts and re-reads this. */
    initialMode?: "view" | "edit";
    onClose: () => void;
    onSwitch: (id: string) => void;
  }

  const { task, initialMode = "view", onClose, onSwitch }: Props = $props();

  let mode = $state<"view" | "edit">(untrack(() => initialMode));

  // The modal is keyed by `task.id` in the parent (App.svelte), so a switch
  // to a different task remounts the component and these initializers re-run.
  // `untrack` tells svelte-check that capturing only the initial value is
  // intentional, not a missed reactivity bug.
  let title = $state(untrack(() => task.title));
  let description = $state(untrack(() => task.description));
  let priority = $state<Priority>(untrack(() => task.priority));
  let parentId = $state<string | null>(untrack(() => task.parentId));
  let tagSpecs = $state<string[]>(untrack(() => [...task.tags]));
  let dependsOnIds = $state<string[]>(untrack(() => [...task.dependsOn]));

  let saving = $state(false);
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

  // Self + all descendants — passed to the parent picker as excludeIds so the
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

  const parentTask = $derived(
    task.parentId === null ? null : (writState.tasks.find((t) => t.id === task.parentId) ?? null),
  );

  const dependents = $derived(writState.tasks.filter((t) => t.dependsOn.includes(task.id)));
  const children = $derived(writState.tasks.filter((t) => t.parentId === task.id));

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  const colorByTag = $derived(indexTags(writState.tags));

  function enterEdit(): void {
    title = task.title;
    description = task.description;
    priority = task.priority;
    parentId = task.parentId;
    tagSpecs = [...task.tags];
    dependsOnIds = [...task.dependsOn];
    mode = "edit";
  }

  function cancelEdit(): void {
    mode = "view";
  }

  // Discard-confirmation gate. When the user tries to do something that
  // would silently throw away unsaved edits (close the modal, hit Cancel,
  // press Esc, click a subtask), `tryDiscardingAction` captures what they
  // were trying to do. A `<ConfirmDialog>` opens; on confirm it runs the
  // captured action, on cancel it just clears. Last attempt wins so a
  // second click on a different discard path replaces the captured action
  // — the dialog always reflects the user's most recent intent.
  let pendingDiscardAction = $state<(() => void) | null>(null);
  let confirmingDelete = $state(false);

  function tryDiscardingAction(action: () => void): void {
    if (mode === "edit" && dirty) {
      pendingDiscardAction = action;
    } else {
      action();
    }
  }

  function confirmDiscard(): void {
    pendingDiscardAction?.();
    pendingDiscardAction = null;
  }

  function cancelDiscard(): void {
    pendingDiscardAction = null;
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

  async function performDelete(): Promise<void> {
    confirmingDelete = false;
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
    // Esc unwinds layered state: discard prompt → subtask form → edit mode
    // → close modal. The discard prompt takes precedence so Esc backs out
    // of it without also tearing down the underlying edit state.
    if (pendingDiscardAction) {
      cancelDiscard();
      event.stopPropagation();
    } else if (addingSubtask) {
      cancelAddSubtask();
      event.stopPropagation();
    } else if (mode === "edit") {
      tryDiscardingAction(cancelEdit);
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
  <button
    type="button"
    class="modal-backdrop"
    aria-label="Close"
    onclick={() => tryDiscardingAction(onClose)}
  ></button>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    {#if mode === "view"}
      <div class="mb-4 flex items-start justify-between gap-3">
        <h2 id="task-modal-title" class="select-text text-2xl font-semibold leading-tight">
          {task.title}
        </h2>
        <div class="flex shrink-0 items-baseline gap-2">
          <TaskIdChip id={task.id} />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Close"
            onclick={() => tryDiscardingAction(onClose)}
          >
            <XIcon size={16} weight="bold" />
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
              <TagChip name={tag} color={colorByTag[tag] ?? null} />
            {/each}
          </span>
        {/if}
      </div>

      {#if task.dependsOn.length > 0}
        <div class="mb-4">
          <div class="label label-text mb-1 flex items-center gap-2 opacity-60">
            <LockSimpleIcon
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
                <TaskRefRow
                  task={blocker}
                  columnName={columnNameById[blocker.columnId] ?? "?"}
                  onClick={() => onSwitch(blocker.id)}
                  muted={!task.blockedBy.includes(blockerId)}
                />
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
              <TaskRefRow
                task={dep}
                columnName={columnNameById[dep.columnId] ?? "?"}
                onClick={() => onSwitch(dep.id)}
              />
            {/each}
          </div>
        </div>
      {/if}

      <div class="mb-6">
        <div class="label label-text mb-1 opacity-60">Description</div>
        {#if task.description.trim().length > 0}
          <!-- markdown.ts strips raw HTML at parse time (html: false), so
               {@html} here is safe — no script/iframe/etc. tags can ride
               through. eslint can't see that, so the rule is suppressed. -->
          <div class="prose prose-sm max-w-none select-text rounded-lg bg-base-200 px-4 py-3">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(task.description)}
          </div>
        {:else}
          <p class="text-sm italic opacity-40">No description.</p>
        {/if}
      </div>
    {:else}
      <div class="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="task-modal-title" class="text-lg font-semibold">Edit task</h2>
        <div class="flex shrink-0 items-baseline gap-2">
          <TaskIdChip id={task.id} />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Close"
            onclick={() => tryDiscardingAction(onClose)}
          >
            <XIcon size={16} weight="bold" />
          </button>
        </div>
      </div>

      <label class="form-control mb-3 w-full">
        <span class="label label-text">Title</span>
        <!-- svelte-ignore a11y_autofocus -->
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

        <ParentPicker bind:parentId excludeIds={descendantIds} />
      </div>

      <TagPicker bind:tagSpecs />

      <DependsOnPicker bind:dependsOnIds taskIdForCycleCheck={task.id} />
    {/if}

    <div class="mb-4">
      <div class="mb-2 flex items-center justify-between">
        <span class="label-text font-medium">Subtasks ({children.length})</span>
        {#if !addingSubtask}
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (addingSubtask = true)}>
            <PlusIcon size={14} weight="bold" />
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
              onclick={() => tryDiscardingAction(() => onSwitch(child.id))}
            >
              <TaskIdChip id={child.id} />
              <span class="flex-1">{child.title}</span>
              {#each child.tags as tag (tag)}
                <TagChip name={tag} color={colorByTag[tag] ?? null} />
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
          <!-- svelte-ignore a11y_autofocus -->
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
      <button
        type="button"
        class="btn btn-error btn-outline"
        onclick={() => (confirmingDelete = true)}
      >
        <TrashIcon size={16} weight="bold" />
        Delete
      </button>
      <div class="flex gap-2">
        {#if mode === "view"}
          <button type="button" class="btn btn-primary" onclick={enterEdit}>
            <PencilSimpleIcon size={16} weight="bold" />
            Edit
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => tryDiscardingAction(cancelEdit)}>Cancel</button
          >
          <button type="submit" class="btn btn-primary" disabled={!canSave}>Save</button>
        {/if}
      </div>
    </div>
  </form>
</div>

{#if pendingDiscardAction}
  <ConfirmDialog
    title="Discard your edits?"
    message="Your unsaved changes will be lost."
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    variant="danger"
    onConfirm={confirmDiscard}
    onCancel={cancelDiscard}
  />
{/if}

{#if confirmingDelete}
  <ConfirmDialog
    title="Delete this task?"
    message={children.length > 0
      ? `This will also delete ${children.length} subtask${children.length === 1 ? "" : "s"}. Can't be undone.`
      : "Can't be undone."}
    confirmLabel="Delete"
    cancelLabel="Cancel"
    variant="danger"
    onConfirm={performDelete}
    onCancel={() => (confirmingDelete = false)}
  />
{/if}
