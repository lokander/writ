<script lang="ts">
  import { untrack } from "svelte";
  import {
    XIcon,
    TrashIcon,
    PlusIcon,
    PencilSimpleIcon,
    LockSimpleIcon,
    WarningIcon,
  } from "phosphor-svelte";

  import type { Priority, Task, TaskUpdate } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import { writState } from "./state.svelte";
  import {
    buildResolvedUpdate,
    buildTaskUpdate,
    type ConflictResolutions,
    diffTask,
    intersectFlags,
    taskToFields,
  } from "./diff-task";
  import { indexTags } from "./tag-color";
  import { renderMarkdown } from "./markdown";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ConflictDialog from "./ConflictDialog.svelte";
  import DependsOnPicker from "./DependsOnPicker.svelte";
  import ParentPicker from "./ParentPicker.svelte";
  import TagChip from "./TagChip.svelte";
  import TagPicker from "./TagPicker.svelte";
  import TaskIdChip from "./TaskIdChip.svelte";
  import TaskRefRow from "./TaskRefRow.svelte";

  interface Props {
    /** The task this modal is editing. Looked up live from `writState.tasks`
     *  so external pushes (silent refresh) flow in. The parent only opens
     *  the modal for tasks that exist at click time; if the row is missing
     *  at mount we treat that as a parent bug and bail via onClose. */
    taskId: string;
    /** Mode the modal opens in. The context-menu "Edit task…" entry passes
     *  `"edit"` so the user lands directly in the form; clicking a card
     *  defaults to `"view"`. Captured-on-mount via untrack — the parent keys
     *  the modal on taskId, so a switch remounts and re-reads this. */
    initialMode?: "view" | "edit";
    onClose: () => void;
    onSwitch: (id: string) => void;
  }

  const { taskId, initialMode = "view", onClose, onSwitch }: Props = $props();

  let mode = $state<"view" | "edit">(untrack(() => initialMode));

  // Live row from writState. Goes null when the underlying task is deleted
  // by another writer (CLI / MCP / sqlite cli) — the silent-refresh push
  // surfaces that here as a transition to null.
  const liveTask = $derived(writState.tasks.find((t) => t.id === taskId) ?? null);

  // Snapshot for stale rendering: tracks the latest seen task data so the
  // modal can keep displaying the chrome (title bar, badges, blocked-by row)
  // even after the live row disappears. Freezes when liveTask becomes null.
  // Initialized from the live row at mount; the parent guarantees it exists
  // there, so the assert holds in practice.
  let snapshotTask = $state<Task>(
    untrack(() => {
      const t = writState.tasks.find((tt) => tt.id === taskId);
      if (!t) throw new Error(`TaskEditModal mounted for unknown task ${taskId}`);
      return t;
    }),
  );

  $effect(() => {
    if (liveTask !== null) snapshotTask = liveTask;
  });

  const task = $derived<Task>(liveTask ?? snapshotTask);
  const taskGone = $derived(liveTask === null);

  // The modal is keyed by `taskId` in the parent (App.svelte), so a switch
  // to a different task remounts the component and these initializers re-run.
  // `untrack` tells svelte-check that capturing only the initial value is
  // intentional, not a missed reactivity bug.
  let title = $state(untrack(() => task.title));
  let description = $state(untrack(() => task.description));
  let priority = $state<Priority>(untrack(() => task.priority));
  let parentId = $state<string | null>(untrack(() => task.parentId));
  let tagSpecs = $state<string[]>(untrack(() => [...task.tags]));
  let dependsOnIds = $state<string[]>(untrack(() => [...task.dependsOn]));

  // Snapshot of the task at the moment the user enters edit mode. Used as
  // the diff baseline so "dirty" means "the user typed something different
  // from what was there at edit-start", *not* "the form differs from the
  // current live row". The distinction matters when a remote writer changes
  // a field while the user is editing: without this snapshot, the modal
  // would re-flag the externally-changed field as dirty and clobber it on
  // save. We also pin `expectedVersion` to this snapshot's version so the
  // OCC layer detects any race that landed between mount and save.
  let originalTask = $state<Task>(untrack(() => $state.snapshot(task)));

  let saving = $state(false);
  let addingSubtask = $state(false);
  let newSubtaskTitle = $state("");

  // Per-field dirty flags. The IPC payload at save() narrows to only fields
  // that are dirty so an external writer's concurrent edit to (say) the
  // description isn't clobbered by our stale snapshot when the user only
  // touched the title. The flag-by-field shape is also what makes the
  // OCC auto-merge feasible: when local-dirty and remote-changed sets don't
  // intersect, the conflict resolves silently. Logic lives in `diff-task.ts`
  // (unit-tested) — the component just wraps it in a $derived for reactivity.
  const dirtyFlags = $derived(
    diffTask(originalTask, {
      title,
      description,
      priority,
      parentId,
      tagSpecs,
      dependsOnIds,
    }),
  );

  const dirty = $derived(dirtyFlags.any);

  const canSave = $derived(dirty && title.trim().length > 0 && !saving && !taskGone);

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
    // Capture a fresh original AT edit-start. Re-entering edit after a
    // remote update should treat the current state as the new baseline —
    // otherwise dirty-tracking would compare against a stale snapshot from
    // the previous edit session.
    originalTask = $state.snapshot(task);
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

  // Conflict state. When `tasks:update` returns `{ kind: "conflict" }`,
  // we either auto-merge (no overlap between dirty and remote-changed) or
  // store the remote view in `pendingConflict` to render the dialog. The
  // dialog's per-field picks come back through `applyResolutions`.
  let pendingConflict = $state<Task | null>(null);

  // Edited fields snapshot — what the user has typed. Wrapped in $derived
  // so the conflict dialog reads coherent values, not reactively-rebuilt
  // ones mid-render. Order has to match `EditedTaskFields`.
  const editedFields = $derived({
    title,
    description,
    priority,
    parentId,
    tagSpecs,
    dependsOnIds,
  });

  // Conflict overlap = which fields are dirty AND changed remotely. Drives
  // the auto-merge fast path (any === false → no dialog) and the dialog's
  // per-field rows.
  const conflictFlags = $derived(
    pendingConflict
      ? intersectFlags(dirtyFlags, diffTask(originalTask, taskToFields(pendingConflict)))
      : null,
  );

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const update = buildTaskUpdate(originalTask, editedFields);
    await trySave(update, originalTask.version, /* allowAutoMerge */ true);
  }

  /** Single attempt against the IPC. Handles three outcomes:
   *   - ok: exit edit mode, done.
   *   - missing: task vanished — leave the modal as-is so the user notices
   *     (the "Deleted by another writer" banner takes over via taskGone).
   *   - conflict: branch on overlap. If `allowAutoMerge` is true and there's
   *     no overlap, retry once with the same payload pinned to the new
   *     version. Otherwise open the dialog.
   *
   *  Recursion is bounded: auto-merge retries once with `allowAutoMerge =
   *  false`, after which a second conflict opens the dialog regardless. */
  async function trySave(
    update: TaskUpdate,
    expectedVersion: number,
    allowAutoMerge: boolean,
  ): Promise<void> {
    const outcome = await writState.updateTask(task.id, { ...update, expectedVersion });
    if (outcome.kind === "ok") {
      saving = false;
      mode = "view";
      return;
    }
    if (outcome.kind === "missing") {
      saving = false;
      return;
    }
    // conflict
    const remote = diffTask(originalTask, taskToFields(outcome.current));
    const overlap = intersectFlags(dirtyFlags, remote);
    if (allowAutoMerge && !overlap.any) {
      // Re-pin to the new version and retry. The payload is the same set
      // of dirty-only fields; theirs in the DB stays for non-overlapping
      // fields because we never include them.
      await trySave(update, outcome.current.version, false);
      return;
    }
    saving = false;
    pendingConflict = outcome.current;
  }

  function applyResolutions(resolutions: ConflictResolutions): void {
    const remote = pendingConflict;
    if (!remote) return;
    pendingConflict = null;
    saving = true;
    const update = buildResolvedUpdate(originalTask, editedFields, remote, resolutions);
    if (Object.keys(update).length === 0) {
      // User accepted theirs on every conflicting field and had no
      // non-conflicting dirty edits to send. Nothing to write — just exit
      // edit mode; the local copy of the task is already the remote view
      // (writState updated it when we hit the conflict).
      saving = false;
      mode = "view";
      return;
    }
    void trySave(update, remote.version, false);
  }

  function cancelConflict(): void {
    pendingConflict = null;
    saving = false;
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
    {#if taskGone}
      <div class="alert alert-warning mb-4">
        <WarningIcon size={18} weight="fill" />
        <div>
          <div class="font-semibold">Deleted by another writer</div>
          <div class="text-sm opacity-80">
            {#if mode === "edit" && dirty}
              Your unsaved edits are still here — copy them out before closing.
            {:else}
              This task no longer exists. Close when ready.
            {/if}
          </div>
        </div>
      </div>
    {/if}

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
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => (addingSubtask = true)}
            disabled={taskGone}
          >
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
        disabled={taskGone}
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
    task={{ title: task.title, id: task.id }}
    confirmLabel="Delete"
    cancelLabel="Cancel"
    variant="danger"
    onConfirm={performDelete}
    onCancel={() => (confirmingDelete = false)}
  />
{/if}

{#if pendingConflict && conflictFlags}
  <ConflictDialog
    {originalTask}
    edited={editedFields}
    remoteTask={pendingConflict}
    {conflictFlags}
    onResolve={applyResolutions}
    onCancel={cancelConflict}
  />
{/if}
