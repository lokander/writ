import { ulid } from "ulid";

import type { SqliteDb } from "../db";
import type { Tag } from "../types";
import { parseTagSpec, type ParsedTagSpec } from "./tag-format";

interface TagRow {
  id: string;
  name: string;
  color: string | null;
}

function fromRow(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color };
}

// Find an existing tag by name, or create one. When `spec.color` is provided
// and differs from the stored color (or the tag is new), overwrite. When
// `spec.color` is undefined, the existing color is preserved (NULL on a
// freshly created tag).
export function getOrCreateTag(db: SqliteDb, spec: ParsedTagSpec): Tag {
  const existing = db.prepare(`SELECT * FROM tags WHERE name = ?`).get(spec.name) as
    | TagRow
    | undefined;

  if (existing) {
    if (spec.color !== undefined && spec.color !== existing.color) {
      db.prepare(`UPDATE tags SET color = ? WHERE id = ?`).run(spec.color, existing.id);
      return { id: existing.id, name: existing.name, color: spec.color };
    }
    return fromRow(existing);
  }

  const id = ulid();
  const color = spec.color ?? null;
  db.prepare(`INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`).run(id, spec.name, color);
  return { id, name: spec.name, color };
}

// Replace the tag set for a task. Each spec is `NAME` or `NAME=COLOR` —
// see parseTagSpec. Tags are auto-created on first reference.
export function setTaskTags(db: SqliteDb, taskId: string, specs: string[]): void {
  const tagIds: string[] = [];
  for (const spec of specs) {
    const parsed = parseTagSpec(spec);
    tagIds.push(getOrCreateTag(db, parsed).id);
  }

  db.transaction(() => {
    db.prepare(`DELETE FROM task_tags WHERE task_id = ?`).run(taskId);
    const insert = db.prepare(`INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)`);
    for (const tagId of tagIds) insert.run(taskId, tagId);
  })();
}

export function addTagToTask(db: SqliteDb, taskId: string, spec: string): void {
  const parsed = parseTagSpec(spec);
  const tag = getOrCreateTag(db, parsed);
  db.prepare(`INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)`).run(taskId, tag.id);
}

export function removeTagFromTask(db: SqliteDb, taskId: string, name: string): boolean {
  const tag = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name) as
    | { id: string }
    | undefined;
  if (!tag) return false;
  const res = db
    .prepare(`DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?`)
    .run(taskId, tag.id);
  return res.changes > 0;
}

export function listTaskTagNames(db: SqliteDb, taskId: string): string[] {
  const rows = db
    .prepare(
      `SELECT t.name FROM tags t
       JOIN task_tags tt ON tt.tag_id = t.id
       WHERE tt.task_id = ?
       ORDER BY t.name`,
    )
    .all(taskId) as { name: string }[];
  return rows.map((r) => r.name);
}

// Bulk lookup — returns map of taskId → sorted tag names. Used by listTasks
// to avoid an N+1 query when surfacing tags on every card.
export function listTaskTagsByTaskIds(db: SqliteDb, taskIds: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (taskIds.length === 0) return result;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT tt.task_id, t.name FROM task_tags tt
       JOIN tags t ON t.id = tt.tag_id
       WHERE tt.task_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .all(...taskIds) as { task_id: string; name: string }[];
  for (const row of rows) {
    (result[row.task_id] ??= []).push(row.name);
  }
  return result;
}

export function listTags(db: SqliteDb): Tag[] {
  const rows = db.prepare(`SELECT * FROM tags ORDER BY name`).all() as TagRow[];
  return rows.map(fromRow);
}
