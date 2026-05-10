import { Command } from "commander";
import { initProject } from "../../shared/domain/project";

export function initCommand(): Command {
  return new Command("init")
    .description("Initialize a writ project in the current directory")
    .action(() => {
      const { dbPath, alreadyInitialized } = initProject(process.cwd());
      if (alreadyInitialized) {
        // Keep the no-op terse — the user already knows the project exists,
        // they just want confirmation that init didn't blow it away.
        console.log(`writ project already initialized at ${dbPath}`);
        return;
      }
      console.log(`Initialized writ project at ${dbPath}\n`);
      console.log(renderNextSteps());
    });
}

function renderNextSteps(): string {
  // Column-aligned for readability. Width chosen so the longest command
  // (`writ task add "..."`) leaves a comfortable gap before the description.
  const rows: [string, string][] = [
    [`writ task add "..."`, "Add a task"],
    ["writ task list", "List tasks"],
    ["writ", "Open the desktop app"],
    ["writ mcp install", "Register writ as an MCP server for Claude Code"],
  ];
  const width = Math.max(...rows.map(([cmd]) => cmd.length));
  const lines = rows.map(([cmd, desc]) => `  ${cmd.padEnd(width + 2)}${desc}`);
  return [
    "Next steps:",
    ...lines,
    "",
    // .writ/ being committed is a deliberate design choice (the DB is the
    // project's source of truth, travels with the code). The note exists
    // because we know that's not the default mental model from .vscode/,
    // .idea/, etc.
    "writ commits .writ/ to your repo by default — the DB is your",
    "project's source of truth. Add `.writ/` to .gitignore to keep it local.",
  ].join("\n");
}
