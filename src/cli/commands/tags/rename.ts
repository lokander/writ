import type { Command } from "commander";

import { renameTag } from "../../../shared/domain/tags";
import { withProjectDb } from "../../context";

export function renameCommand(parent: Command): void {
  parent
    .command("rename <old> <new>")
    .description("Rename a tag in place. Preserves its color and every task association.")
    .action((oldName: string, newName: string) => {
      withProjectDb(
        ({ db }) => {
          const updated = renameTag(db, oldName, newName);
          if (oldName === updated.name) {
            console.log(`Tag '${oldName}' already named '${newName}'. No change.`);
            return;
          }
          console.log(`Renamed '${oldName}' to '${updated.name}'.`);
        },
        { notify: true },
      );
    });
}
