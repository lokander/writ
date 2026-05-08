import { ulid } from "ulid";
import type { SqliteDb } from "../db";
import type { NewTask, Priority, Task, TaskUpdate } from "../types";
import { getFirstColumn } from "./columns";
import { listTaskTagNames, listTaskTagsByTaskIds, setTaskTags } from "./tags";

interface TaskRow {
  id: string;
  parent_id: string | null;
  column_id: string;
  title: string;
  description: string;
  priority: number;
  position: number;
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
    tags: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  })();

  return getTask(db, id)!;
}

export function getTask(db: SqliteDb, id: string): Task | null {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
  if (!row) return null;
  const task = fromRow(row);
  task.tags = listTaskTagNames(db, id);
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

  // Bulk-load tags so the renderer/CLI can show them without N+1 queries.
  const tagsByTaskId = listTaskTagsByTaskIds(
    db,
    tasks.map((t) => t.id),
  );
  for (const task of tasks) {
    task.tags = tagsByTaskId[task.id] ?? [];
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

  if (!hasFieldUpdate && !hasTagUpdate) return existing;

  db.transaction(() => {
    if (hasFieldUpdate) {
      fields.push("updated_at = ?");
      params.push(Date.now());
      params.push(id);
      db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    }
    if (hasTagUpdate) {
      setTaskTags(db, id, update.tags!);
    }
  })();

  return getTask(db, id);
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
  // resolveTaskId callers don't use .tags off this — they call getTask if they
  // need the full hydrated task. Returning a tag-empty task is fine here.
  return fromRow(rows[0]);
}
