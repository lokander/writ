import type { Column, ProjectInfo, Task } from "../../../shared/types";

export class WritState {
  project = $state<ProjectInfo | null>(null);
  columns = $state<Column[]>([]);
  tasks = $state<Task[]>([]);
  loading = $state(true);
  error = $state<string | null>(null);

  async loadAll(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [project, columns, tasks] = await Promise.all([
        window.api.project.current(),
        window.api.columns.list(),
        window.api.tasks.list(),
      ]);
      this.project = project;
      this.columns = columns;
      this.tasks = tasks;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  async addTask(title: string): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    try {
      const task = await window.api.tasks.create({ title: trimmed });
      this.tasks = [...this.tasks, task];
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}

export const writState = new WritState();
