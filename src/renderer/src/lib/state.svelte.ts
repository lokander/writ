import type { Column, NewTask, ProjectInfo, Tag, Task, TaskUpdate } from "../../../shared/types";

export class WritState {
  project = $state<ProjectInfo | null>(null);
  columns = $state<Column[]>([]);
  tasks = $state<Task[]>([]);
  tags = $state<Tag[]>([]);
  loading = $state(true);
  error = $state<string | null>(null);

  async loadAll(): Promise<void> {
    this.loading = true;
    this.error = null;
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
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
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

  async createTask(input: NewTask): Promise<Task | null> {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) return null;
    try {
      const task = await window.api.tasks.create({ ...input, title: trimmed });
      this.tasks = [...this.tasks, task];
      if (input.tags && input.tags.length > 0) await this.refreshTags();
      return task;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  async updateTask(id: string, update: TaskUpdate): Promise<Task | null> {
    try {
      const updated = await window.api.tasks.update(id, $state.snapshot(update));
      if (!updated) return null;
      this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
      if (update.tags !== undefined) await this.refreshTags();
      return updated;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return null;
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
