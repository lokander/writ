import type { SqliteDb } from "../db";
import type { Column } from "../types";

interface ColumnRow {
  id: string;
  name: string;
  position: number;
}

export function listColumns(db: SqliteDb): Column[] {
  return db
    .prepare(`SELECT id, name, position FROM columns ORDER BY position`)
    .all() as ColumnRow[];
}

export function getColumnByName(db: SqliteDb, name: string): Column | null {
  const row = db
    .prepare(`SELECT id, name, position FROM columns WHERE name = ? COLLATE NOCASE`)
    .get(name) as ColumnRow | undefined;
  return row ?? null;
}

export function getFirstColumn(db: SqliteDb): Column {
  const row = db
    .prepare(`SELECT id, name, position FROM columns ORDER BY position LIMIT 1`)
    .get() as ColumnRow | undefined;
  if (!row) {
    throw new Error("No columns found; project may not be initialized.");
  }
  return row;
}
