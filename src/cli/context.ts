import { openDatabase, type SqliteDb } from "../shared/db";
import { findProjectRoot, getDbPath } from "../shared/domain/project";

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
  return { db, root };
}
