import { ulid } from "ulid";
import type { SqliteDb } from "../db";
import type { NewTask, Priority, Task, TaskUpdate } from "../types";
import { getFirstColumn, listColumns } from "./columns";
import { listDependenciesByTaskIds, listDependencyIds, setDependencies } from "./dependencies";
import { listTaskTagNames, listTaskTagsByTaskIds, setTaskTags } from "./tags";

interface TaskRow {
  id: string;
  parent_id: string | null;
  column_id: string;
  title: string;
  description: string;
  priority: number;
  position: number;
  version: number;
  created_at: number;
  updated_at: number;
}

function fromRow(row: TaskRow): Task {
  return {
    id: row.id,
    parentId: row.parent_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description,
    priority: row.priority as Priority,
    position: row.position,
    version: row.version,
    tags: [],
    dependsOn: [],
    blockedBy: [],
    isReady: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Returns the set of task ids that are "resolved" — i.e. live in a column
// whose name is `Done` or `Archived` (case-insensitive). Used to compute
// `blockedBy` and `isReady` from the dependency graph. Archived counts so
// that archiving a blocker doesn't un-resolve dependents.
function loadDoneTaskIds(db: SqliteDb): Record<string, true> {
  const doneCols = listColumns(db).filter((c) => {
    const n = c.name.toLowerCase();
    return n === "done" || n === "archived";
  });
  if (doneCols.length === 0) return {};
  const placeholders = doneCols.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT id FROM tasks WHERE column_id IN (${placeholders})`)
    .all(...doneCols.map((c) => c.id)) as { id: string }[];
  const set: Record<string, true> = {};
  for (const r of rows) set[r.id] = true;
  return set;
}

function computeBlockedBy(dependsOn: string[], doneIds: Record<string, true>): string[] {
  return dependsOn.filter((id) => !doneIds[id]);
}

export function createTask(db: SqliteDb, input: NewTask): Task {
  const id = ulid();
  const columnId = input.columnId ?? getFirstColumn(db).id;
  const now = Date.now();

  // Append to the bottom of the target column using fractional indexing.
  const max = db
    .prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE column_id = ?`)
    .get(columnId) as { m: number };
  const position = max.m + 1000;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks
         (id, parent_id, column_id, title, description, priority, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.parentId ?? null,
      columnId,
      input.title,
      input.description ?? "",
      input.priority ?? 2,
      position,
      now,
      now,
    );

    if (input.tags && input.tags.length > 0) {
      setTaskTags(db, id, input.tags);
    }
    if (input.dependsOn && input.dependsOn.length > 0) {
      setDependencies(db, id, input.dependsOn);
    }
  })();

  return getTask(db, id)!;
}

export function getTask(db: SqliteDb, id: string): Task | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  if (!row) return null;
  const task = fromRow(row);
  task.tags = listTaskTagNames(db, id);
  task.dependsOn = listDependencyIds(db, id);
  const doneIds = loadDoneTaskIds(db);
  task.blockedBy = computeBlockedBy(task.dependsOn, doneIds);
  task.isReady = task.blockedBy.length === 0;
  return task;
}

export interface ListFilter {
  columnId?: string;
  // undefined = no filter; null = top-level only; string = children of that id.
  parentId?: string | null;
  // AND filter: returned tasks must have all of these tag names.
  tags?: string[];
  // OR filter: returned tasks must have at least one of these tag names.
  anyTags?: string[];
  // OR filter: returned tasks must have one of these priorities. Empty / undefined is a no-op.
  priorities?: Priority[];
  // Only tasks with no open blockers (or no dependencies at all).
  ready?: boolean;
  // Only tasks with at least one open blocker.
  blocked?: boolean;
}

export function listTasks(db: SqliteDb, filter: ListFilter = {}): Task[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.columnId) {
    conditions.push("column_id = ?");
    params.push(filter.columnId);
  }
  if (filter.parentId !== undefined) {
    if (filter.parentId === null) {
      conditions.push("parent_id IS NULL");
    } else {
      conditions.push("parent_id = ?");
      params.push(filter.parentId);
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY column_id, position`)
    .all(...params) as TaskRow[];
  let tasks = rows.map(fromRow);

  // Bulk-load tags + dependencies so the renderer/CLI can show them without
  // N+1 queries. The Done lookup is done once and reused for every task.
  const ids = tasks.map((t) => t.id);
  const tagsByTaskId = listTaskTagsByTaskIds(db, ids);
  const depsByTaskId = listDependenciesByTaskIds(db, ids);
  const doneIds = loadDoneTaskIds(db);
  for (const task of tasks) {
    task.tags = tagsByTaskId[task.id] ?? [];
    task.dependsOn = depsByTaskId[task.id] ?? [];
    task.blockedBy = computeBlockedBy(task.dependsOn, doneIds);
    task.isReady = task.blockedBy.length === 0;
  }

  // Tag filtering happens in JS — clearer than threading another join into
  // the dynamic SQL above and fast enough at task-tracker scales.
  if (filter.tags && filter.tags.length > 0) {
    const required = filter.tags;
    tasks = tasks.filter((t) => required.every((name) => t.tags.includes(name)));
  }
  if (filter.anyTags && filter.anyTags.length > 0) {
    const allowed = filter.anyTags;
    tasks = tasks.filter((t) => allowed.some((name) => t.tags.includes(name)));
  }
  if (filter.priorities && filter.priorities.length > 0) {
    const allowed = new Set(filter.priorities);
    tasks = tasks.filter((t) => allowed.has(t.priority));
  }
  if (filter.ready === true) {
    tasks = tasks.filter((t) => t.isReady);
  }
  if (filter.blocked === true) {
    tasks = tasks.filter((t) => !t.isReady);
  }

  return tasks;
}

export function updateTask(db: SqliteDb, id: string, update: TaskUpdate): Task | null {
  const existing = getTask(db, id);
  if (!existing) return null;

  const fields: string[] = [];
  const params: unknown[] = [];

  if (update.title !== undefined) {
    fields.push("title = ?");
    params.push(update.title);
  }
  if (update.description !== undefined) {
    fields.push("description = ?");
    params.push(update.description);
  }
  if (update.columnId !== undefined) {
    fields.push("column_id = ?");
    params.push(update.columnId);
  }
  if (update.parentId !== undefined) {
    fields.push("parent_id = ?");
    params.push(update.parentId);
  }
  if (update.priority !== undefined) {
    fields.push("priority = ?");
    params.push(update.priority);
  }
  if (update.position !== undefined) {
    fields.push("position = ?");
    params.push(update.position);
  }

  const hasFieldUpdate = fields.length > 0;
  const hasTagUpdate = update.tags !== undefined;
  const hasDependencyUpdate = update.dependsOn !== undefined;

  if (!hasFieldUpdate && !hasTagUpdate && !hasDependencyUpdate) {
    // No-op. Still surface staleness if the caller pinned an obsolete
    // version — they asked to be told.
    if (update.expectedVersion !== undefined && existing.version !== update.expectedVersion) {
      throw new StaleReadError(existing);
    }
    return existing;
  }

  // BEGIN IMMEDIATE so the OCC version check + the UPDATE see a single,
  // writer-locked snapshot. With deferred (the default), another process
  // could commit between our SELECT and our UPDATE inside the txn.
  let result: Task | null = null;
  db.transaction(() => {
    if (update.expectedVersion !== undefined) {
      const row = db.prepare(`SELECT version FROM tasks WHERE id = ?`).get(id) as
        | { version: number }
        | undefined;
      if (!row) {
        // Disappeared between the getTask above and our write lock. Treat
        // as not-found (the outer null contract) by aborting the txn.
        throw new TaskNotFoundError(id);
      }
      if (row.version !== update.expectedVersion) {
        // Re-hydrate inside the same writer-locked snapshot so the error
        // carries the freshest current state. Throwing rolls the txn back.
        throw new StaleReadError(getTask(db, id)!);
      }
    }

    if (hasFieldUpdate) {
      fields.push("updated_at = ?");
      params.push(Date.now());
      fields.push("version = version + 1");
      params.push(id);
      db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    }
    if (hasTagUpdate) {
      setTaskTags(db, id, update.tags!);
    }
    if (hasDependencyUpdate) {
      setDependencies(db, id, update.dependsOn!);
    }
    // Tag/dep-only updates still bump version + updated_at: version so a
    // stale modal that overwrites tags is caught by OCC, updated_at because
    // a tag change IS a real user edit (parity with how a position-only
    // drag already bumps updated_at via the field path).
    if (!hasFieldUpdate && (hasTagUpdate || hasDependencyUpdate)) {
      db.prepare(`UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ?`).run(
        Date.now(),
        id,
      );
    }
    result = getTask(db, id);
  }).immediate();

  if (result === null) {
    // Txn body completed but couldn't re-fetch — the row was deleted by a
    // concurrent writer between our UPDATE and the re-read. Surface as the
    // existing not-found contract.
    return null;
  }
  return result;
}

export function deleteTask(db: SqliteDb, id: string): boolean {
  const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function moveTask(db: SqliteDb, id: string, columnId: string): Task | null {
  // Append to the bottom of the new column.
  const max = db
    .prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE column_id = ?`)
    .get(columnId) as { m: number };
  return updateTask(db, id, { columnId, position: max.m + 1000 });
}

export class AmbiguousTaskError extends Error {
  override readonly name = "AmbiguousTaskError";
  constructor(
    readonly input: string,
    readonly matches: Task[],
  ) {
    super(`'${input}' matches ${matches.length} tasks`);
  }
}

export class TaskNotFoundError extends Error {
  override readonly name = "TaskNotFoundError";
  constructor(readonly input: string) {
    super(`No task matches '${input}'`);
  }
}

/** Thrown by `updateTask` when the caller pinned `expectedVersion` and the
 *  task's stored version no longer matches. `currentTask` carries the
 *  hydrated row at the moment the conflict was detected so callers can
 *  diff against the user's local edit (modal conflict UI) or re-render
 *  for the user to retry (CLI editor mode). */
export class StaleReadError extends Error {
  override readonly name = "StaleReadError";
  constructor(readonly currentTask: Task) {
    super(`Stale read: task ${currentTask.id} is now at version ${currentTask.version}`);
  }
}

// Resolve a user-supplied task identifier — full ulid or any unique suffix.
// Suffix matching aligns with what `task list` displays (last 6 chars).
export function resolveTaskId(db: SqliteDb, input: string): Task {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new TaskNotFoundError(input);
  }

  // Escape SQLite LIKE metacharacters. ulids never contain these, but a typo
  // with %, _, or \ shouldn't trigger fuzzy matching.
  const upper = trimmed.toUpperCase();
  const escaped = upper.replace(/[\\%_]/g, "\\$&");

  const rows = db
    .prepare(`SELECT * FROM tasks WHERE id LIKE ? ESCAPE '\\'`)
    .all(`%${escaped}`) as TaskRow[];

  if (rows.length === 0) throw new TaskNotFoundError(input);
  if (rows.length > 1) throw new AmbiguousTaskError(input, rows.map(fromRow));
  // resolveTaskId callers don't use the hydrated fields off this — they call
  // getTask if they need a fully populated record.
  return fromRow(rows[0]);
}
