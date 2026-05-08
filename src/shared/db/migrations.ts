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
