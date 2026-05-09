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
}
