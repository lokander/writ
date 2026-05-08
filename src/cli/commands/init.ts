import { Command } from "commander";
import { initProject } from "../../shared/domain/project";

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize a writ project in the current directory")
    .action(() => {
      const { dbPath, alreadyInitialized } = initProject(process.cwd());
      if (alreadyInitialized) {
        console.log(`writ project already initialized at ${dbPath}`);
      } else {
        console.log(`Initialized writ project at ${dbPath}`);
      }
    });
}
