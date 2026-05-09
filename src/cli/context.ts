import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
import { findProjectRoot, getDbPath } from "../shared/domain/project";
import { AmbiguousTaskError, TaskNotFoundError } from "../shared/domain/tasks";

export interface ResolvedProject {
  db: SqliteDb;
  root: string;
}

export function resolveProjectDb(cwd: string = process.cwd()): ResolvedProject {
  const root = findProjectRoot(cwd);
  if (!root) {
    process.stderr.write("No writ project found. Run `writ init` to create one.\n");
    process.exit(1);
  }
  const db = openDatabase(getDbPath(root));
  // Apply any pending migrations. Idempotent — no-op when the DB is already
  // at the latest schema version.
  applyMigrations(db);
  return { db, root };
}

export function handleCliError(error: unknown): never {
  if (error instanceof AmbiguousTaskError) {
    process.stderr.write(`${error.message}:\n`);
    for (const m of error.matches.slice(0, 5)) {
      process.stderr.write(`  ${m.id.slice(-10)}  ${m.title}\n`);
    }
    if (error.matches.length > 5) {
      process.stderr.write(`  ... (${error.matches.length} total)\n`);
    }
  } else if (error instanceof TaskNotFoundError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(`${String(error)}\n`);
  }
  process.exit(1);
}
