import type { Command } from "commander";
import { deleteTask, resolveTaskId } from "../../../shared/domain/tasks";
import { withProjectDb } from "../../context";

export function removeCommand(parent: Command): void {
  parent
    .command("remove <id>")
    .alias("rm")
    .description("Delete a task and its subtasks")
    .action((idInput: string) => {
      withProjectDb(
        ({ db }) => {
          const task = resolveTaskId(db, idInput);
          deleteTask(db, task.id);
          console.log(`Deleted ${task.id.slice(-6)}  ${task.title}`);
        },
        { notify: true },
      );
    });
}
