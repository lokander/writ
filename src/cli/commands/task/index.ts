import { Command } from "commander";
import { addCommand } from "./add";
import { editCommand } from "./edit";
import { listCommand } from "./list";
import { moveCommand } from "./move";
import { removeCommand } from "./remove";
import { viewCommand, viewTask } from "./view";

export function taskCommand(): Command {
  const cmd = new Command("task").description("Manage tasks");

  // Bare-arg shortcut: `writ task <id>` runs the same logic as `writ task view <id>`.
  // If the arg is missing or matches a subcommand name, commander routes accordingly.
  cmd.argument("[id]", "Task id (shortcut for `task view <id>`)").action((idArg?: string) => {
    if (idArg) viewTask(idArg);
    else cmd.help();
  });

  addCommand(cmd);
  listCommand(cmd);
  moveCommand(cmd);
  removeCommand(cmd);
  viewCommand(cmd);
  editCommand(cmd);

  return cmd;
}
