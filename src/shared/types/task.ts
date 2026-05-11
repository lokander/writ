export type Priority = 0 | 1 | 2 | 3;

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: "urgent",
  1: "high",
  2: "normal",
  3: "low",
};

export interface Task {
  id: string;
  parentId: string | null;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  position: number;
  /** Optimistic-concurrency version. Bumped on every successful update
   *  (fields, tags, or deps). Starts at 0; pin via expectedVersion to
   *  detect stale reads. */
  version: number;
  /** Tag names (sorted). Always populated by getTask / listTasks. */
  tags: string[];
  /** Ids of all tasks this one depends on. Always populated. */
  dependsOn: string[];
  /** Subset of `dependsOn` that aren't yet in a Done column — what's still
   *  blocking this task. Always populated. */
  blockedBy: string[];
  /** True iff every entry in `dependsOn` is in a Done column (or there are
   *  no dependencies at all). Convenience for the `--ready` filter. */
  isReady: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NewTask {
  title: string;
  description?: string;
  columnId?: string;
  parentId?: string | null;
  priority?: Priority;
  /** Tag specs: `NAME` or `NAME=COLOR`. Tags are auto-created on first use. */
  tags?: string[];
  /** Ids (or unique suffixes — caller resolves) of tasks this depends on. */
  dependsOn?: string[];
}

// Card / row ordering modes. `position` is the manual fractional index the
// drag-and-drop and CLI workflows mutate; the others are presentational
// re-sorts applied AFTER filtering and BEFORE rendering. When a non-position
// mode is active in the desktop UI, drag-and-drop is disabled — reordering
// would write to `position` while the user is looking at a different sort.
export const SORT_MODES = ["position", "priority", "updated", "created"] as const;
export type SortMode = (typeof SORT_MODES)[number];

// Re-sort a task array by the requested mode. `position` is a no-op (callers
// already get position-ordered rows from listTasks). The non-position modes
// produce a NEW sorted array — we don't mutate the input so callers can keep
// their own reference around. JS's Array.prototype.sort is stable since
// ES2019, so equal keys preserve the input order (i.e. the existing
// column-then-position grouping) without an explicit secondary key.
//
// `priority`: ascending priority value (0 = urgent first).
// `updated` / `created`: descending timestamp (most recent first).
//
// Lives in types/ (not domain/) because the renderer can't import from
// shared/domain — that path pulls in better-sqlite3 / fs. This function is
// pure and operates only on the `Task` shape, so it's safe to share.
export function sortTasks(tasks: Task[], mode: SortMode): Task[] {
  if (mode === "position") return tasks;
  const copy = [...tasks];
  switch (mode) {
    case "priority":
      copy.sort((a, b) => a.priority - b.priority);
      break;
    case "updated":
      copy.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
    case "created":
      copy.sort((a, b) => b.createdAt - a.createdAt);
      break;
  }
  return copy;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  columnId?: string;
  parentId?: string | null;
  priority?: Priority;
  position?: number;
  /** When provided, replaces the task's tag set. Tag specs: `NAME` or `NAME=COLOR`. */
  tags?: string[];
  /** When provided, replaces the task's dependsOn set. `[]` clears all. */
  dependsOn?: string[];
  /** Optimistic-concurrency pin. If set and the task's stored `version`
   *  differs at write time, the domain layer throws `StaleReadError` with
   *  the now-current task and rolls back. Omit to keep last-write-wins. */
  expectedVersion?: number;
}
