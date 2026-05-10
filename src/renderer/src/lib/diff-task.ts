import type { Priority, Task, TaskUpdate } from "../../../shared/types";

/** The user-editable fields the modal binds to. Plain values, not $state
 *  proxies — callers pass `$state.snapshot(...)` at the boundary. */
export interface EditedTaskFields {
  title: string;
  description: string;
  priority: Priority;
  parentId: string | null;
  tagSpecs: string[];
  dependsOnIds: string[];
}

/** Per-field dirty flags. `any` is true iff at least one is dirty. */
export interface TaskDirtyFlags {
  title: boolean;
  description: boolean;
  priority: boolean;
  parentId: boolean;
  tags: boolean;
  dependsOn: boolean;
  any: boolean;
}

/** Compare the user's edited values to the live task. Tags and depends-on
 *  use unordered set equality — re-ordering tags shouldn't count as a
 *  change. */
export function diffTask(current: Task, edited: EditedTaskFields): TaskDirtyFlags {
  const title = edited.title !== current.title;
  const description = edited.description !== current.description;
  const priority = edited.priority !== current.priority;
  const parentId = edited.parentId !== current.parentId;
  const tags = !sameSet(edited.tagSpecs, current.tags);
  const dependsOn = !sameSet(edited.dependsOnIds, current.dependsOn);
  return {
    title,
    description,
    priority,
    parentId,
    tags,
    dependsOn,
    any: title || description || priority || parentId || tags || dependsOn,
  };
}

/** Build the `TaskUpdate` IPC payload for `tasks:update`, narrowed to only
 *  the fields the user actually changed. Untouched fields are omitted (not
 *  set to undefined explicitly — that wouldn't matter for IPC, but it does
 *  matter for OCC: each present field becomes a "yes, write this exact
 *  value" instruction, so untouched fields shouldn't carry stale snapshots
 *  that could clobber a concurrent writer's edit). */
export function buildTaskUpdate(current: Task, edited: EditedTaskFields): TaskUpdate {
  const flags = diffTask(current, edited);
  const update: TaskUpdate = {};
  if (flags.title) update.title = edited.title.trim();
  if (flags.description) update.description = edited.description;
  if (flags.priority) update.priority = edited.priority;
  if (flags.parentId) update.parentId = edited.parentId;
  if (flags.tags) update.tags = edited.tagSpecs;
  if (flags.dependsOn) update.dependsOn = edited.dependsOnIds;
  return update;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  return aa.every((v, i) => v === bb[i]);
}

/** Per-field user choice when both sides changed the same field. */
export type Resolution = "mine" | "theirs";

export interface ConflictResolutions {
  title: Resolution;
  description: Resolution;
  priority: Resolution;
  parentId: Resolution;
  tags: Resolution;
  dependsOn: Resolution;
}

/** Fields dirty on BOTH sides — i.e. true conflicts that need a user
 *  decision. Returned with `any` so the modal can branch on "is there
 *  anything to ask the user about?". */
export function intersectFlags(a: TaskDirtyFlags, b: TaskDirtyFlags): TaskDirtyFlags {
  const title = a.title && b.title;
  const description = a.description && b.description;
  const priority = a.priority && b.priority;
  const parentId = a.parentId && b.parentId;
  const tags = a.tags && b.tags;
  const dependsOn = a.dependsOn && b.dependsOn;
  return {
    title,
    description,
    priority,
    parentId,
    tags,
    dependsOn,
    any: title || description || priority || parentId || tags || dependsOn,
  };
}

/** Project a `Task` down to the fields the modal binds to. Used to compare
 *  two Task snapshots (original vs server-current) through the same
 *  `diffTask` machinery the modal already uses. */
export function taskToFields(task: Task): EditedTaskFields {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    parentId: task.parentId,
    tagSpecs: [...task.tags],
    dependsOnIds: [...task.dependsOn],
  };
}

/** Build the final IPC payload after a conflict has been resolved.
 *
 *  For each field, four cases drive whether it lands in the payload:
 *  - !dirty, !remoteChanged: nobody touched it, skip.
 *  - dirty, !remoteChanged: my edit, no conflict — include yours.
 *  - !dirty, remoteChanged: their edit, no conflict — skip so theirs stays.
 *  - dirty AND remoteChanged: conflict — `resolutions[field]` decides.
 *    `mine` includes yours; `theirs` skips (so their value stays in the DB).
 *
 *  The returned payload should be sent paired with `expectedVersion`
 *  re-pinned to the conflict's `current.version` — that's the contract
 *  the OCC retry expects. */
export function buildResolvedUpdate(
  originalTask: Task,
  edited: EditedTaskFields,
  remoteTask: Task,
  resolutions: ConflictResolutions,
): TaskUpdate {
  const dirty = diffTask(originalTask, edited);
  const remote = diffTask(originalTask, taskToFields(remoteTask));
  const update: TaskUpdate = {};

  function include(field: keyof ConflictResolutions): boolean {
    if (!dirty[field]) return false;
    if (!remote[field]) return true; // dirty-only → mine
    return resolutions[field] === "mine"; // conflict → user's pick
  }

  if (include("title")) update.title = edited.title.trim();
  if (include("description")) update.description = edited.description;
  if (include("priority")) update.priority = edited.priority;
  if (include("parentId")) update.parentId = edited.parentId;
  if (include("tags")) update.tags = edited.tagSpecs;
  if (include("dependsOn")) update.dependsOn = edited.dependsOnIds;
  return update;
}
