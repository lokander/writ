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
    expect(version?.value).toBe("2");
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();

    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(version?.value).toBe("2");
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
    expect(version?.value).toBe("2");
  });
});
