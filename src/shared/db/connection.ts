import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

export type SqliteDb = Db;

export function openDatabase(path: string): SqliteDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Wait up to 5s for a conflicting writer's lock instead of failing
  // immediately with SQLITE_BUSY. With three potential writers (desktop +
  // CLI + MCP) all going through BEGIN IMMEDIATE for OCC, brief contention
  // is a normal-day occurrence; this lets SQLite serialize them without
  // bubbling errors up to the caller.
  db.pragma("busy_timeout = 5000");
  return db;
}
