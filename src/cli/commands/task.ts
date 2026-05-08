import { Command } from "commander";
import { listColumns } from "../../shared/domain/columns";
import { createTask, listTasks } from "../../shared/domain/tasks";
import { PRIORITY_NAMES } from "../../shared/types";
import { resolveProjectDb } from "../context";

export function taskCommand(): Command {
  const cmd = new Command("task").description("Manage tasks");

  cmd
    .command("add <title>")
    .description("Add a new task to the first column (Backlog by default)")
    .action((title: string) => {
      const { db } = resolveProjectDb();
      try {
        const task = createTask(db, { title });
        console.log(`Created ${task.id}  ${task.title}`);
      } finally {
        db.close();
      }
    });

  cmd
    .command("list")
    .description("List all tasks grouped by column")
    .action(() => {
      const { db } = resolveProjectDb();
      try {
        const columns = listColumns(db);
        const tasks = listTasks(db);

        if (tasks.length === 0) {
          console.log('No tasks. Use `writ task add "title"` to create one.');
          return;
        }

        for (const col of columns) {
          const inCol = tasks.filter((t) => t.columnId === col.id);
          if (inCol.length === 0) continue;
          console.log(`\n${col.name}`);
          for (const t of inCol) {
            const tag = t.priority !== 2 ? `[${PRIORITY_NAMES[t.priority]}] ` : "";
            console.log(`  ${t.id.slice(-6)}  ${tag}${t.title}`);
          }
        }
      } finally {
        db.close();
      }
    });

  return cmd;
}
