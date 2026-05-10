import type { Command } from "commander";
import { getColumnByName } from "../../../shared/domain/columns";
import { createTask, resolveTaskId } from "../../../shared/domain/tasks";
import type { Priority } from "../../../shared/types";
import { withProjectDb } from "../../context";
import { collectString, parsePriority } from "./options";
import { availableColumns } from "./render";

interface AddOptions {
  priority?: Priority;
  col?: string;
  description?: string;
  parent?: string;
  tag?: string[];
  dependsOn?: string[];
}

export function addCommand(parent: Command): void {
  parent
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
    .option(
      "--tag <spec>",
      "Tag spec: NAME or NAME=COLOR. Repeatable. Auto-creates tags on first use.",
      collectString,
    )
    .option(
      "--depends-on <id>",
      "Make this task depend on another (full ulid or unique suffix). Repeatable.",
      collectString,
    )
    .action((title: string, opts: AddOptions) => {
      withProjectDb(
        ({ db }) => {
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

          const dependsOn = opts.dependsOn?.map((ref) => resolveTaskId(db, ref).id);

          const task = createTask(db, {
            title,
            description: opts.description,
            columnId,
            parentId,
            priority: opts.priority,
            tags: opts.tag,
            dependsOn,
          });
          console.log(`Created ${task.id.slice(-6)}  ${task.title}`);
        },
        { notify: true },
      );
    });
}
