import { describe, expect, it } from "vitest";

import { applyMigrations } from "./migrations";
import { openDatabase } from "./connection";

describe("applyMigrations", () => {
  it("creates tables and sets schema_version on a fresh DB", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual([
      "columns",
      "meta",
      "tags",
      "task_dependencies",
      "task_tags",
      "tasks",
    ]);

    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(version?.value).toBe("3");
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();

    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(version?.value).toBe("3");
  });

  it("v3 adds an Archived column to a v2 project that doesn't have one", () => {
    const db = openDatabase(":memory:");
    // Stand up a v2 DB with the canonical four default columns and a task.
    db.exec(`
      CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
      CREATE TABLE columns ( id TEXT PRIMARY KEY, name TEXT NOT NULL, position REAL NOT NULL );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, parent_id TEXT, column_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 2, position REAL NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE tags ( id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT );
      CREATE TABLE task_tags (
        task_id TEXT, tag_id TEXT, PRIMARY KEY (task_id, tag_id)
      );
      CREATE TABLE task_dependencies (
        task_id TEXT, depends_on_id TEXT,
        PRIMARY KEY (task_id, depends_on_id)
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '2');
      INSERT INTO columns (id, name, position) VALUES
        ('c1', 'Backlog', 1000), ('c2', 'Todo', 2000),
        ('c3', 'Doing', 3000), ('c4', 'Done', 4000);
    `);

    applyMigrations(db);

    const cols = db.prepare(`SELECT name, position FROM columns ORDER BY position`).all() as {
      name: string;
      position: number;
    }[];
    expect(cols.map((c) => c.name)).toEqual(["Backlog", "Todo", "Doing", "Done", "Archived"]);
    // Archived lands after the existing max (4000) at +1000.
    expect(cols[4]!.position).toBe(5000);
  });

  it("v3 is a no-op on a project that already has Archived", () => {
    const db = openDatabase(":memory:");
    db.exec(`
      CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
      CREATE TABLE columns ( id TEXT PRIMARY KEY, name TEXT NOT NULL, position REAL NOT NULL );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, parent_id TEXT, column_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 2, position REAL NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE tags ( id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT );
      CREATE TABLE task_tags ( task_id TEXT, tag_id TEXT, PRIMARY KEY (task_id, tag_id) );
      CREATE TABLE task_dependencies (
        task_id TEXT, depends_on_id TEXT, PRIMARY KEY (task_id, depends_on_id)
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '2');
      -- pre-existing Archived (case-insensitive name match)
      INSERT INTO columns (id, name, position) VALUES ('c0', 'archived', 500);
    `);

    applyMigrations(db);

    const archivedRows = db
      .prepare(`SELECT name FROM columns WHERE LOWER(name) = 'archived'`)
      .all() as { name: string }[];
    expect(archivedRows).toHaveLength(1);
  });

  it("upgrades a v1 database to v2 without losing v1 data", () => {
    const db = openDatabase(":memory:");
    // Apply only v1 by running the first migration directly (simulate an older
    // DB that hasn't seen v2 yet).
    db.exec(`
      CREATE TABLE meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
      CREATE TABLE columns ( id TEXT PRIMARY KEY, name TEXT NOT NULL, position REAL NOT NULL );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, parent_id TEXT, column_id TEXT NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 2, position REAL NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE tags ( id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT );
      CREATE TABLE task_tags (
        task_id TEXT, tag_id TEXT, PRIMARY KEY (task_id, tag_id)
      );
      INSERT INTO meta (key, value) VALUES ('schema_version', '1');
      INSERT INTO columns (id, name, position) VALUES ('col1', 'Backlog', 1000);
      INSERT INTO tasks (id, column_id, title, position, created_at, updated_at)
        VALUES ('task1', 'col1', 'Existing task', 1000, 1000, 1000);
    `);

    applyMigrations(db);

    // v2 table now exists
    const dependenciesTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='task_dependencies'`)
      .get();
    expect(dependenciesTable).toBeDefined();

    // v1 data survived
    const task = db.prepare(`SELECT title FROM tasks WHERE id = 'task1'`).get() as
      | { title: string }
      | undefined;
    expect(task?.title).toBe("Existing task");

    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(version?.value).toBe("3");
  });
});
