import type { SqliteDb } from "../db";

export class DependencyCycleError extends Error {
  override readonly name = "DependencyCycleError";
  constructor(
    readonly taskId: string,
    readonly dependsOnId: string,
  ) {
    super(
      `Adding dependency from ${taskId} to ${dependsOnId} would create a cycle in the depends-on graph.`,
    );
  }
}

export class SelfDependencyError extends Error {
  override readonly name = "SelfDependencyError";
  constructor(readonly taskId: string) {
    super(`A task cannot depend on itself (${taskId}).`);
  }
}

// Walks the depends-on graph forward from `startId` and returns true if
// `targetId` is reachable. Used to reject A→B when B already depends on A
// (transitively). Iterative BFS — no recursion to avoid stack issues on
// pathological chains.
function reaches(db: SqliteDb, startId: string, targetId: string): boolean {
  if (startId === targetId) return true;
  const stmt = db.prepare(`SELECT depends_on_id FROM task_dependencies WHERE task_id = ?`);
  const visited: Record<string, true> = { [startId]: true };
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const rows = stmt.all(current) as { depends_on_id: string }[];
    for (const row of rows) {
      if (row.depends_on_id === targetId) return true;
      if (!visited[row.depends_on_id]) {
        visited[row.depends_on_id] = true;
        queue.push(row.depends_on_id);
      }
    }
  }
  return false;
}

// Would adding `taskId → dependsOnId` create a cycle? True iff `dependsOnId`
// already (transitively) depends on `taskId`.
export function wouldCreateCycle(db: SqliteDb, taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true;
  return reaches(db, dependsOnId, taskId);
}

export function addDependency(db: SqliteDb, taskId: string, dependsOnId: string): void {
  if (taskId === dependsOnId) throw new SelfDependencyError(taskId);
  if (wouldCreateCycle(db, taskId, dependsOnId)) {
    throw new DependencyCycleError(taskId, dependsOnId);
  }
  db.prepare(`INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)`).run(
    taskId,
    dependsOnId,
  );
}

export function removeDependency(db: SqliteDb, taskId: string, dependsOnId: string): boolean {
  const res = db
    .prepare(`DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?`)
    .run(taskId, dependsOnId);
  return res.changes > 0;
}

// Replace the task's full set of dependencies. Each id in `dependsOnIds`
// must already exist as a task; the cycle check runs over the proposed set
// before any writes hit the DB.
export function setDependencies(db: SqliteDb, taskId: string, dependsOnIds: string[]): void {
  for (const id of dependsOnIds) {
    if (id === taskId) throw new SelfDependencyError(taskId);
  }

  // Validate against a virtual "post-update" graph: drop the task's existing
  // edges, then check each proposed edge in turn against the live graph minus
  // those edges. We do this in a transaction so a cycle in the middle of the
  // proposed set rolls back cleanly.
  db.transaction(() => {
    db.prepare(`DELETE FROM task_dependencies WHERE task_id = ?`).run(taskId);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)`,
    );
    for (const dependsOnId of dependsOnIds) {
      if (wouldCreateCycle(db, taskId, dependsOnId)) {
        throw new DependencyCycleError(taskId, dependsOnId);
      }
      insert.run(taskId, dependsOnId);
    }
  })();
}

export function listDependencyIds(db: SqliteDb, taskId: string): string[] {
  const rows = db
    .prepare(`SELECT depends_on_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_id`)
    .all(taskId) as { depends_on_id: string }[];
  return rows.map((r) => r.depends_on_id);
}

export function listDependentIds(db: SqliteDb, dependsOnId: string): string[] {
  const rows = db
    .prepare(`SELECT task_id FROM task_dependencies WHERE depends_on_id = ? ORDER BY task_id`)
    .all(dependsOnId) as { task_id: string }[];
  return rows.map((r) => r.task_id);
}

// Bulk lookup — taskId → list of depends_on ids. Used by listTasks to avoid
// N+1 queries when hydrating Task.dependsOn for every row.
export function listDependenciesByTaskIds(
  db: SqliteDb,
  taskIds: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (taskIds.length === 0) return result;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT task_id, depends_on_id FROM task_dependencies
       WHERE task_id IN (${placeholders})
       ORDER BY task_id, depends_on_id`,
    )
    .all(...taskIds) as { task_id: string; depends_on_id: string }[];
  for (const row of rows) {
    (result[row.task_id] ??= []).push(row.depends_on_id);
  }
  return result;
}
