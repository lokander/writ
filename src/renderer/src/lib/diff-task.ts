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
