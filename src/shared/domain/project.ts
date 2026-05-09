import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { ulid } from "ulid";
import { applyMigrations, openDatabase, type SqliteDb } from "../db";

export const WRIT_DIR = ".writ";
export const DB_FILE = "writ.db";

export const DEFAULT_COLUMNS = ["Backlog", "Todo", "Doing", "Done", "Archived"] as const;

export function findProjectRoot(cwd: string): string | null {
  let dir = cwd;
  // Walk up until we find .writ/writ.db or hit the filesystem root.
  while (true) {
    if (existsSync(join(dir, WRIT_DIR, DB_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function getDbPath(rootDir: string): string {
  return join(rootDir, WRIT_DIR, DB_FILE);
}

const PROJECT_ID_KEY = "project_id";
const DISPLAY_NAME_KEY = "display_name";

export function getProjectId(db: SqliteDb): string {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(PROJECT_ID_KEY) as
    | { value: string }
    | undefined;
  if (!row) {
    // Migration v4 guarantees this row exists for any DB that's gone through
    // applyMigrations. Hitting this branch means a caller skipped migrations.
    throw new Error("project_id missing — open the DB through applyMigrations()");
  }
  return row.value;
}

export function getDisplayName(db: SqliteDb): string | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(DISPLAY_NAME_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setDisplayName(db: SqliteDb, name: string | null): void {
  if (name === null) {
    db.prepare(`DELETE FROM meta WHERE key = ?`).run(DISPLAY_NAME_KEY);
    return;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Display name cannot be empty. Pass null to clear it.");
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(DISPLAY_NAME_KEY, trimmed);
}

export interface InitResult {
  dbPath: string;
  alreadyInitialized: boolean;
}

export function initProject(rootDir: string): InitResult {
  const writDir = join(rootDir, WRIT_DIR);
  const dbPath = getDbPath(rootDir);
  const alreadyInitialized = existsSync(dbPath);

  mkdirSync(writDir, { recursive: true });
  const db = openDatabase(dbPath);
  try {
    applyMigrations(db);
    if (!alreadyInitialized) {
      seedDefaultColumns(db);
    }
  } finally {
    db.close();
  }

  return { dbPath, alreadyInitialized };
}

function seedDefaultColumns(db: SqliteDb): void {
  const insert = db.prepare(`INSERT INTO columns (id, name, position) VALUES (?, ?, ?)`);
  db.transaction(() => {
    DEFAULT_COLUMNS.forEach((name, i) => {
      insert.run(ulid(), name, (i + 1) * 1000);
    });
  })();
}
