import { Command, InvalidArgumentError } from "commander";
import { getColumnByName, listColumns } from "../../shared/domain/columns";
import {
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  resolveTaskId,
} from "../../shared/domain/tasks";
import { PRIORITY_NAMES, type Priority, type Task } from "../../shared/types";
import type { Column } from "../../shared/types";
import { handleCliError, resolveProjectDb } from "../context";

const PRIORITY_INPUT: Record<string, Priority> = {
  u: 0,
  urgent: 0,
  "0": 0,
  h: 1,
  high: 1,
  "1": 1,
  n: 2,
  normal: 2,
  "2": 2,
  l: 3,
  low: 3,
  "3": 3,
};

function parsePriority(input: string): Priority {
  const p = PRIORITY_INPUT[input.toLowerCase()];
  if (p === undefined) {
    throw new InvalidArgumentError("Priority must be u(rgent), h(igh), n(ormal), l(ow), or 0-3");
  }
  return p;
}

interface AddOptions {
  priority?: Priority;
  col?: string;
  description?: string;
  parent?: string;
}

interface ListOptions {
  col?: string;
  tree?: boolean;
}

export function taskCommand(): Command {
  const cmd = new Command("task").description("Manage tasks");

  cmd
    .command("add <title>")
    .description("Add a new task to the first column (Backlog by default)")
    .option(
      "-p, --priority <level>",
      "Priority: u(rgent), h(igh), n(ormal), l(ow), or 0-3",
      parsePriority,
    )
    .option("-c, --col <name>", "Column to put it in (case-insensitive)")
    .option("-d, --description <text>", "Markdown description")
    .option("--parent <id>", "Make this a subtask of the given task (full ulid or unique suffix)")
    .action((title: string, opts: AddOptions) => {
      const { db } = resolveProjectDb();
      try {
        let columnId: string | undefined;
        if (opts.col) {
          const col = getColumnByName(db, opts.col);
          if (!col) {
            throw new Error(`Column '${opts.col}' not found. ${availableColumns(db)}`);
          }
          columnId = col.id;
        }

        let parentId: string | null | undefined;
        if (opts.parent) {
          parentId = resolveTaskId(db, opts.parent).id;
        }

        const task = createTask(db, {
          title,
          description: opts.description,
          columnId,
          parentId,
          priority: opts.priority,
        });
        console.log(`Created ${task.id.slice(-6)}  ${task.title}`);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("list")
    .description("List tasks grouped by column")
    .option("-c, --col <name>", "Only show tasks in the named column")
    .option("--tree", "Show subtasks indented under their parents (ignores column grouping)")
    .action((opts: ListOptions) => {
      const { db } = resolveProjectDb();
      try {
        const columns = listColumns(db);
        const allTasks = listTasks(db);

        if (allTasks.length === 0) {
          console.log('No tasks. Use `writ task add "title"` to create one.');
          return;
        }

        if (opts.tree) {
          renderTree(allTasks);
          return;
        }

        let filteredColumns = columns;
        if (opts.col) {
          const col = getColumnByName(db, opts.col);
          if (!col) {
            throw new Error(`Column '${opts.col}' not found. ${availableColumns(db)}`);
          }
          filteredColumns = [col];
        }

        // Default view: top-level only, grouped by column.
        const topLevel = allTasks.filter((t) => t.parentId === null);
        const childCount = countChildrenByParent(allTasks);
        for (const col of filteredColumns) {
          const inCol = topLevel.filter((t) => t.columnId === col.id);
          if (inCol.length === 0) continue;
          console.log(`\n${col.name}`);
          for (const t of inCol) {
            console.log(`  ${formatTaskLine(t, childCount.get(t.id) ?? 0)}`);
          }
        }
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("move <id> <column>")
    .description("Move a task to a different column (case-insensitive)")
    .action((idInput: string, columnName: string) => {
      const { db } = resolveProjectDb();
      try {
        const task = resolveTaskId(db, idInput);
        const col = getColumnByName(db, columnName);
        if (!col) {
          throw new Error(`Column '${columnName}' not found. ${availableColumns(db)}`);
        }
        moveTask(db, task.id, col.id);
        console.log(`Moved ${task.id.slice(-6)}  ${task.title}  →  ${col.name}`);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("rm <id>")
    .description("Delete a task and its subtasks")
    .action((idInput: string) => {
      const { db } = resolveProjectDb();
      try {
        const task = resolveTaskId(db, idInput);
        deleteTask(db, task.id);
        console.log(`Deleted ${task.id.slice(-6)}  ${task.title}`);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  return cmd;
}

function priorityChip(p: Priority): string {
  if (p === 2) return "";
  return `[${PRIORITY_NAMES[p][0]}] `;
}

function formatTaskLine(t: Task, childCount: number): string {
  const subs = childCount > 0 ? ` (${childCount} sub)` : "";
  return `${t.id.slice(-6)}  ${priorityChip(t.priority)}${t.title}${subs}`;
}

function countChildrenByParent(tasks: Task[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.parentId) counts.set(t.parentId, (counts.get(t.parentId) ?? 0) + 1);
  }
  return counts;
}

function renderTree(tasks: Task[]): void {
  const byParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId;
    const list = byParent.get(key) ?? [];
    list.push(t);
    byParent.set(key, list);
  }

  function walk(parentId: string | null, depth: number): void {
    const children = byParent.get(parentId) ?? [];
    for (const t of children) {
      const indent = "  ".repeat(depth);
      console.log(`${indent}${t.id.slice(-6)}  ${priorityChip(t.priority)}${t.title}`);
      walk(t.id, depth + 1);
    }
  }

  walk(null, 0);
}

function availableColumns(db: import("../../shared/db").SqliteDb): string {
  const names = listColumns(db)
    .map((c: Column) => c.name)
    .join(", ");
  return `Available: ${names}`;
}
