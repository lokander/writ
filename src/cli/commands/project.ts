import { basename } from "path";
import { Command } from "commander";

import { getDisplayName, getProjectId, setDisplayName } from "../../shared/domain/project";
import { handleCliError, withProjectDb } from "../context";

interface RenameOptions {
  clear?: boolean;
}

export function projectCommand(): Command {
  const cmd = new Command("project").description("Inspect and configure the current project");

  cmd
    .command("show")
    .description("Print project id, display name, and paths")
    .action(() => {
      withProjectDb(({ db, root }) => {
        const id = getProjectId(db);
        const display = getDisplayName(db);
        const fallback = basename(root);
        const pad = (s: string): string => s.padEnd(10);
        console.log(`${pad("Id")} ${id}`);
        console.log(`${pad("Name")} ${display ?? `${fallback} (default)`}`);
        console.log(`${pad("Root")} ${root}`);
      });
    });

  cmd
    .command("rename [name]")
    .description("Set the project's display name. Pass --clear to remove an override.")
    .option("--clear", "Remove the current display name override")
    .action((name: string | undefined, opts: RenameOptions) => {
      if (opts.clear) {
        if (name !== undefined) {
          handleCliError(new Error("Pass either a name or --clear, not both."));
        }
        withProjectDb(({ db }) => {
          setDisplayName(db, null);
          console.log("Display name cleared.");
        });
        return;
      }
      if (name === undefined) {
        handleCliError(new Error("Pass a name (or --clear to remove the current override)."));
      }
      withProjectDb(({ db }) => {
        setDisplayName(db, name);
        console.log(`Display name set to '${getDisplayName(db)}'.`);
      });
    });

  return cmd;
}
