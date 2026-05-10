<script lang="ts">
  import { untrack } from "svelte";

  import type { Priority, Task, TaskUpdate } from "../../../../shared/types";
  import { writState } from "../state.svelte";
  import {
    buildResolvedUpdate,
    buildTaskUpdate,
    type ConflictResolutions,
    diffTask,
    intersectFlags,
    taskToFields,
  } from "./diff-task";
  import { indexTags } from "../tag-color";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ConflictDialog from "./ConflictDialog.svelte";
  import Modal from "./Modal.svelte";
  import SubtasksPanel from "./SubtasksPanel.svelte";
  import TaskEditPanel from "./TaskEditPanel.svelte";
  import TaskGoneBanner from "./TaskGoneBanner.svelte";
  import TaskModalActions from "./TaskModalActions.svelte";
  import TaskViewPanel from "./TaskViewPanel.svelte";

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
    /** True when this modal sits at the top of the stack and should react
     *  to keyboard / backdrop events. Lower modals stay mounted (so their
     *  form state is preserved when the user pops back) but are hidden
     *  via `display: none` and ignore Esc / clicks. */
    isTop: boolean;
    /** Position in the modal stack (0 = bottom). Drives the inline z-index
     *  so a higher entry paints over lower ones, leaving headroom under
     *  ConfirmDialog (z-1100) and ToastStack (z-1200). */
    stackIndex: number;
    onClose: () => void;
    onSwitch: (id: string) => void;
  }

  const { taskId, initialMode = "view", isTop, stackIndex, onClose, onSwitch }: Props = $props();

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
    // Every stacked modal binds its own svelte:window keydown — only the
    // topmost should react, else Esc on a stack of 3 would tear down all
    // three at once.
    if (!isTop) return;
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
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Stack semantics: lower entries stay mounted AND visible — the topmost
     modal's backdrop covers them, and Modal's `inert={!isTop}` blocks any
     tab / click / screen-reader input from sneaking through. z-index
     900 + (10 × stackIndex) keeps each stacked instance above the one
     below it while staying clear of ConfirmDialog (1100) and ToastStack
     (1200). The isTop gate on onKeydown above silences window-bound Esc
     handlers from lower modals (which inert doesn't reach). -->
<Modal
  {isTop}
  zIndex={900 + stackIndex * 10}
  ariaLabelledBy="task-modal-title"
  onBackdropClick={() => tryDiscardingAction(onClose)}
>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    {#if taskGone}
      <TaskGoneBanner {mode} {dirty} />
    {/if}

    {#if mode === "view"}
      <TaskViewPanel
        {task}
        {parentTask}
        {dependents}
        {columnNameById}
        {colorByTag}
        {onSwitch}
        {onClose}
      />
    {:else}
      <TaskEditPanel
        {task}
        bind:title
        bind:description
        bind:priority
        bind:parentId
        bind:tagSpecs
        bind:dependsOnIds
        {descendantIds}
        onClose={() => tryDiscardingAction(onClose)}
      />
    {/if}

    <SubtasksPanel
      {task}
      {children}
      {colorByTag}
      {columnNameById}
      {taskGone}
      bind:isAdding={addingSubtask}
      bind:newTitle={newSubtaskTitle}
      {onSwitch}
      onAdd={addSubtask}
    />

    <TaskModalActions
      {mode}
      {taskGone}
      {canSave}
      onEnterEdit={enterEdit}
      onCancelEdit={() => tryDiscardingAction(cancelEdit)}
      onRequestDelete={() => (confirmingDelete = true)}
    />
  </form>
</Modal>

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
