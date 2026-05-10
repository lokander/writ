import type { Column, NewTask, ProjectInfo, Tag, Task, TaskUpdate } from "../../../shared/types";

/** Outcome of a `tasks:update` round-trip. The modal needs to distinguish
 *  "task vanished" from "your edit was based on stale state" so it can drive
 *  the conflict dialog (slice 4). Other callers (drag-drop, context-menu
 *  quick-edits) ignore the conflict path because they don't pin an
 *  `expectedVersion` — the conflict case is unreachable for them. */
export type UpdateOutcome =
  | { kind: "ok"; task: Task }
  | { kind: "missing" }
  | { kind: "conflict"; current: Task };

export class WritState {
  project = $state<ProjectInfo | null>(null);
  columns = $state<Column[]>([]);
  tasks = $state<Task[]>([]);
  tags = $state<Tag[]>([]);
  loading = $state(true);
  error = $state<string | null>(null);

  /** Refetch everything from main and assign. With keyed `{#each}` blocks
   *  diffing by id, unchanged rows keep their component instances and DOM —
   *  no scroll / hover / context-menu loss.
   *
   *  `silent: true` (used by the project:changed push handler) skips the
   *  `loading` flip so the UI doesn't unmount its main view to show the
   *  "Loading…" placeholder, and on IPC failure keeps existing arrays in
   *  place rather than wiping to `error`. The initial onMount call leaves
   *  silent off so the first paint still shows the spinner. */
  async loadAll(options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent ?? false;
    if (!silent) {
      this.loading = true;
      this.error = null;
    }
    try {
      const [project, columns, tasks, tags] = await Promise.all([
        window.api.project.current(),
        window.api.columns.list(),
        window.api.tasks.list(),
        window.api.tags.list(),
      ]);
      this.project = project;
      this.columns = columns;
      this.tasks = tasks;
      this.tags = tags;
      // A successful silent reload also clears any prior error: fresh data
      // means whatever caused the last failure is over.
      if (silent && this.error !== null) this.error = null;
    } catch (e) {
      if (silent) {
        // Don't wipe the UI on a transient IPC hiccup — existing arrays
        // stay in place; the next push or manual reload re-tries.
        console.warn("[writ] silent loadAll failed; keeping stale data", e);
      } else {
        this.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      if (!silent) this.loading = false;
    }
  }

  // Re-fetch tags after a write that may have created/recolored them. Keeps
  // tag chip colors in sync without making every mutation refetch all tags.
  async refreshTags(): Promise<void> {
    try {
      this.tags = await window.api.tags.list();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Set or clear the project's display name. Pass null to clear the
   *  override and fall back to the cwd basename. */
  async setDisplayName(name: string | null): Promise<void> {
    try {
      this.project = await window.api.project.setDisplayName(name);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  async createTask(input: NewTask): Promise<Task | null> {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) return null;
    try {
      const task = await window.api.tasks.create($state.snapshot({ ...input, title: trimmed }));
      this.tasks = [...this.tasks, task];
      if (input.tags && input.tags.length > 0) await this.refreshTags();
      return task;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async updateTask(id: string, update: TaskUpdate): Promise<UpdateOutcome> {
    try {
      const result = await window.api.tasks.update(id, $state.snapshot(update));
      if (result.conflict) {
        // Stale-read: a concurrent writer beat us. Refresh the local copy of
        // that task with the now-current state so the UI reflects the truth
        // either way (the conflict dialog will let the user decide what to
        // do); we don't set `error` because the failure isn't a system bug
        // and the modal owns the retry flow.
        const current = result.conflict.current;
        this.tasks = this.tasks.map((t) => (t.id === id ? current : t));
        return { kind: "conflict", current };
      }
      const updated = result.task;
      if (!updated) return { kind: "missing" };
      this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
      if (update.tags !== undefined) await this.refreshTags();
      return { kind: "ok", task: updated };
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return { kind: "missing" };
    }
  }

  async deleteTask(id: string): Promise<boolean> {
    try {
      const ok = await window.api.tasks.delete(id);
      if (ok) this.tasks = this.tasks.filter((t) => t.id !== id);
      return ok;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  }
}

export const writState = new WritState();
