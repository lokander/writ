import { ulid } from "ulid";

import { applyMigrations, openDatabase, type SqliteDb } from "./db";

/**
 * Build an in-memory SQLite database with migrations applied and the given
 * columns seeded. Intended only for tests; production code goes through
 * initProject() against a real file path.
 */
export function makeTestDb(
  columns: string[] = ["Backlog", "Todo", "Doing", "Done", "Archived"],
): SqliteDb {
  const db = openDatabase(":memory:");
  applyMigrations(db);
  const insert = db.prepare(`INSERT INTO columns (id, name, position) VALUES (?, ?, ?)`);
  db.transaction(() => {
    columns.forEach((name, i) => insert.run(ulid(), name, (i + 1) * 1000));
  })();
  return db;
}
