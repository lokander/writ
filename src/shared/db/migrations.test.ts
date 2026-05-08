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
    expect(tables.map((t) => t.name)).toEqual(["columns", "meta", "tags", "task_tags", "tasks"]);

    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(version?.value).toBe("1");
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();

    const version = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
      | { value: string }
      | undefined;
    expect(version?.value).toBe("1");
  });
});
