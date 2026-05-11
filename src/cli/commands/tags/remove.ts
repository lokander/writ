import type { Command } from "commander";

import { deleteTag } from "../../../shared/domain/tags";
import { confirmYesNo } from "../../confirm";
import { handleCliError, withProjectDb } from "../../context";

interface RemoveOptions {
  yes?: boolean;
}

export function removeCommand(parent: Command): void {
  parent
    .command("remove <name>")
    .alias("rm")
    .description("Delete a tag globally. Detaches it from every task that uses it.")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (name: string, opts: RemoveOptions) => {
      if (!opts.yes) {
        const ok = await confirmYesNo(`Delete tag '${name}'?`);
        if (!ok) {
          console.log("Aborted.");
          return;
        }
      }
      withProjectDb(
        ({ db }) => {
          if (!deleteTag(db, name)) {
            handleCliError(new Error(`Tag '${name}' not found.`));
          }
          console.log(`Deleted tag '${name}'.`);
        },
        { notify: true },
      );
    });
}
