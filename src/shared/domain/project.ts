import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { ulid } from "ulid";
import { applyMigrations, openDatabase, type SqliteDb } from "../db";

export const WRIT_DIR = ".writ";
export const DB_FILE = "writ.db";

export const DEFAULT_COLUMNS = ["Backlog", "Todo", "Doing", "Done"] as const;

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
