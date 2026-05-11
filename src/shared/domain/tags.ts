import { ulid } from "ulid";

import type { SqliteDb } from "../db";
import type { Tag } from "../types";
import { normalizeColor, parseTagSpec, validateTagName, type ParsedTagSpec } from "./tag-format";

export class TagNotFoundError extends Error {
  override readonly name = "TagNotFoundError";
  constructor(name: string) {
    super(`Tag '${name}' not found.`);
  }
}

export class TagConflictError extends Error {
  override readonly name = "TagConflictError";
  constructor(name: string) {
    super(`Tag '${name}' already exists.`);
  }
}

export interface TagWithCount extends Tag {
  /** Number of `task_tags` rows referencing this tag — i.e. how many tasks
   *  currently use it. Drives the `--with-counts` listing and the `prune`
   *  candidates. */
  usageCount: number;
}

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

// Same list shape as `listTags`, with a usageCount column joined in. Kept
// separate so the common-case Tag[] surface stays narrow and Tag stays a pure
// global-properties record.
export function listTagsWithCounts(db: SqliteDb): TagWithCount[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.color, COUNT(tt.task_id) AS cnt
       FROM tags t
       LEFT JOIN task_tags tt ON tt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`,
    )
    .all() as { id: string; name: string; color: string | null; cnt: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, usageCount: r.cnt }));
}

// Delete a tag globally. task_tags rows cascade via the schema's
// ON DELETE CASCADE, so we don't need to detach manually. Returns false when
// the tag doesn't exist so callers can distinguish "deleted" from "no such
// tag" without an extra round-trip.
export function deleteTag(db: SqliteDb, name: string): boolean {
  const res = db.prepare(`DELETE FROM tags WHERE name = ?`).run(name);
  return res.changes > 0;
}

// Rename in place. Preserves the tag's id and color (and therefore every
// task_tags association). Throws TagNotFoundError when the source doesn't
// exist; TagConflictError when the destination already does (we don't merge
// — the caller would need an explicit merge command for that).
export function renameTag(db: SqliteDb, oldName: string, newName: string): Tag {
  const validated = validateTagName(newName);
  const existing = db.prepare(`SELECT * FROM tags WHERE name = ?`).get(oldName) as
    | TagRow
    | undefined;
  if (!existing) throw new TagNotFoundError(oldName);
  if (validated === oldName) return fromRow(existing);
  const collision = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(validated);
  if (collision) throw new TagConflictError(validated);
  db.prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(validated, existing.id);
  return { id: existing.id, name: validated, color: existing.color };
}

// Set or clear a tag's color. `null` clears the override; a string is run
// through normalizeColor (lowercase hex / CSS named) so callers don't have
// to pre-validate. Throws TagNotFoundError when the tag doesn't exist.
export function setTagColor(db: SqliteDb, name: string, color: string | null): Tag {
  const normalized = color === null ? null : normalizeColor(color);
  const existing = db.prepare(`SELECT * FROM tags WHERE name = ?`).get(name) as TagRow | undefined;
  if (!existing) throw new TagNotFoundError(name);
  db.prepare(`UPDATE tags SET color = ? WHERE id = ?`).run(normalized, existing.id);
  return { id: existing.id, name: existing.name, color: normalized };
}

// Drop every tag with zero task_tags references. Returns the list of removed
// names in sorted order for the caller's report. Selection and deletion are
// wrapped in a single transaction so a concurrent setTaskTags can't sneak in
// between the SELECT and the DELETE and leave a now-used tag dangling.
export function pruneOrphanTags(db: SqliteDb): string[] {
  return db.transaction((): string[] => {
    const orphans = db
      .prepare(
        `SELECT t.name FROM tags t
         LEFT JOIN task_tags tt ON tt.tag_id = t.id
         WHERE tt.tag_id IS NULL
         ORDER BY t.name`,
      )
      .all() as { name: string }[];
    if (orphans.length === 0) return [];
    const names = orphans.map((o) => o.name);
    const placeholders = names.map(() => "?").join(", ");
    db.prepare(`DELETE FROM tags WHERE name IN (${placeholders})`).run(...names);
    return names;
  })();
}
