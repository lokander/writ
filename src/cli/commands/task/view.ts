import type { Command } from "commander";
import { listColumns } from "../../../shared/domain/columns";
import { listTasks, resolveTaskId } from "../../../shared/domain/tasks";
import { withProjectDb } from "../../context";
import { renderTaskView } from "./render";

export function viewTask(idInput: string): void {
  withProjectDb(({ db }) => {
    const resolved = resolveTaskId(db, idInput);
    const columns = listColumns(db);
    const allTasks = listTasks(db);
    // resolveTaskId returns a tag-empty / dep-empty stub (it's a cheap suffix
    // resolver, not a full hydrator). Pull the fully populated row out of the
    // listTasks result so renderTaskView sees real tags / blockers / etc.
    const task = allTasks.find((t) => t.id === resolved.id) ?? resolved;
    process.stdout.write(renderTaskView(task, columns, allTasks) + "\n");
  });
}

export function viewCommand(parent: Command): void {
  parent
    .command("view <id>")
    .description("Show a task's full details (header + description + subtasks)")
    .action((idInput: string) => viewTask(idInput));
}
