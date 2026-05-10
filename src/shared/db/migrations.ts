import { ulid } from "ulid";

import type { SqliteDb } from "./connection";

const MIGRATIONS: ((db: SqliteDb) => void)[] = [
  // v1: initial schema
  (db) => {
    db.exec(`
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE columns (
        id       TEXT PRIMARY KEY,
        name     TEXT NOT NULL,
        position REAL NOT NULL
      );

      CREATE TABLE tasks (
        id          TEXT PRIMARY KEY,
        parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        column_id   TEXT NOT NULL REFERENCES columns(id),
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority    INTEGER NOT NULL DEFAULT 2,
        position    REAL NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX tasks_column_pos ON tasks (column_id, position);
      CREATE INDEX tasks_parent     ON tasks (parent_id);

      CREATE TABLE tags (
        id    TEXT PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color TEXT
      );
      CREATE TABLE task_tags (
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id  TEXT REFERENCES tags(id)  ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );
    `);
  },

  // v2: task dependencies (depends-on graph)
  (db) => {
    db.exec(`
      CREATE TABLE task_dependencies (
        task_id        TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_id  TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, depends_on_id),
        CHECK (task_id != depends_on_id)
      );
      CREATE INDEX task_deps_depends_on ON task_dependencies (depends_on_id);
    `);
  },

  // v3: ensure existing projects have the new "Archived" default column.
  // For brand-new DBs (columns table is empty), skip — `init.ts`'s
  // `seedDefaultColumns` will insert it along with the rest at the right
  // position. For projects that already have columns, append Archived after
  // whatever's there.
  (db) => {
    const colCount = db.prepare(`SELECT COUNT(*) AS c FROM columns`).get() as { c: number };
    if (colCount.c === 0) return;

    const exists = db.prepare(`SELECT 1 FROM columns WHERE LOWER(name) = 'archived' LIMIT 1`).get();
    if (exists) return;

    const max = db.prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM columns`).get() as {
      m: number;
    };
    db.prepare(`INSERT INTO columns (id, name, position) VALUES (?, ?, ?)`).run(
      ulid(),
      "Archived",
      max.m + 1000,
    );
  },

  // v4: stable project_id ulid in meta. Survives folder renames so the
  // per-user registry can key by id rather than path. Backfilled here for
  // existing projects; fresh DBs go through this same migration on init.
  (db) => {
    const exists = db.prepare(`SELECT 1 FROM meta WHERE key = 'project_id'`).get();
    if (exists) return;
    db.prepare(`INSERT INTO meta (key, value) VALUES ('project_id', ?)`).run(ulid());
  },

  // v5: per-task optimistic-concurrency version. Bumped on every successful
  // updateTask write (fields, tags, or deps). Existing rows start at 0, so
  // a stale read that pinned no version still wins last-write-wins until the
  // first update lands.
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 0`);
  },
];

function metaTableExists(db: SqliteDb): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
    .get();
  return row !== undefined;
}

function getCurrentVersion(db: SqliteDb): number {
  if (!metaTableExists(db)) return 0;
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

function setVersion(db: SqliteDb, version: number): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(version));
}

export function applyMigrations(db: SqliteDb): void {
  const current = getCurrentVersion(db);
  for (let v = current; v < MIGRATIONS.length; v++) {
    const migrate = MIGRATIONS[v];
    db.transaction(() => {
      migrate(db);
      setVersion(db, v + 1);
    })();
  }
}
