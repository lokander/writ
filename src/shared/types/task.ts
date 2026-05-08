export type Priority = 0 | 1 | 2 | 3;

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: "urgent",
  1: "high",
  2: "normal",
  3: "low",
};

export interface Task {
  id: string;
  parentId: string | null;
  columnId: string;
  title: string;
  description: string;
  priority: Priority;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewTask {
  title: string;
  description?: string;
  columnId?: string;
  parentId?: string | null;
  priority?: Priority;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  columnId?: string;
  parentId?: string | null;
  priority?: Priority;
  position?: number;
}
