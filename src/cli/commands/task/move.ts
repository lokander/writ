import type { Command } from "commander";
import { getColumnByName } from "../../../shared/domain/columns";
import { moveTask, resolveTaskId } from "../../../shared/domain/tasks";
import { withProjectDb } from "../../context";
import { availableColumns } from "./render";

export function moveCommand(parent: Command): void {
  parent
    .command("move <id> <column>")
    .alias("mv")
    .description("Move a task to a different column (case-insensitive)")
    .action((idInput: string, columnName: string) => {
      withProjectDb(
        ({ db }) => {
          const task = resolveTaskId(db, idInput);
          const col = getColumnByName(db, columnName);
          if (!col) {
            throw new Error(`Column '${columnName}' not found. ${availableColumns(db)}`);
          }
          moveTask(db, task.id, col.id);
          console.log(`Moved ${task.id.slice(-6)}  ${task.title}  →  ${col.name}`);
        },
        { notify: true },
      );
    });
}
