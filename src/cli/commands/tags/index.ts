import { Command } from "commander";

import { colorCommand } from "./color";
import { listCommand } from "./list";
import { pruneCommand } from "./prune";
import { removeCommand } from "./remove";
import { renameCommand } from "./rename";

export function tagsCommand(): Command {
  const cmd = new Command("tags").description("List, rename, recolor, and prune project tags");
  listCommand(cmd);
  removeCommand(cmd);
  renameCommand(cmd);
  colorCommand(cmd);
  pruneCommand(cmd);
  return cmd;
}
