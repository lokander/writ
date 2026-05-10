import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
import { pingDesktopApp } from "../shared/desktop-ping";
import { findProjectRoot, getDbPath } from "../shared/domain/project";
import { AmbiguousTaskError, TaskNotFoundError } from "../shared/domain/tasks";

export interface ResolvedProject {
  db: SqliteDb;
  root: string;
}

export interface WithProjectDbOptions {
  /** Fire a best-effort ping at the desktop app socket after `fn` returns
   *  successfully. Mutating commands (`task add/move/edit/rm`, `project rename`)
   *  set this so an open UI refreshes immediately. Read-only commands leave
   *  it off — there's nothing to refresh. */
  notify?: boolean;
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

/** Resolves the project DB, runs `fn`, and always closes the DB. Any thrown
 *  error is fed to `handleCliError` (which exits the process), so callers can
 *  write a single happy-path block instead of repeating the open/try/finally
 *  dance per command. */
export function withProjectDb<T>(
  fn: (project: ResolvedProject) => T,
  options: WithProjectDbOptions = {},
): T {
  const project = resolveProjectDb();
  try {
    const result = fn(project);
    if (options.notify) {
      // Detached: don't block command exit on the socket round-trip. The
      // event loop drains naturally; the ping has its own ~250ms timeout.
      // Fire before db.close() — the write is already committed by then,
      // but we want the ping to leave even if close() slows down.
      void pingDesktopApp({ root: project.root });
    }
    return result;
  } catch (e) {
    handleCliError(e);
  } finally {
    project.db.close();
  }
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
