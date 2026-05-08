import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

export type SqliteDb = Db;

export function openDatabase(path: string): SqliteDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
