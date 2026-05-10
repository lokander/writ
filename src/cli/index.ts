#!/usr/bin/env node
import { Command } from "commander";
import { completionCommand } from "./commands/completion";
import { initCommand } from "./commands/init";
import { mcpCommand } from "./commands/mcp";
import { projectCommand } from "./commands/project";
import { taskCommand } from "./commands/task";
import { launchDesktop } from "./launch";

async function main(): Promise<void> {
  // Bare `writ` (no subcommand) launches or focuses the desktop app, like
  // `code .`. Dispatch BEFORE commander parses so it never prints --help in
  // the no-args path. Subcommands (`writ task ...`, `writ mcp`, ...) and
  // global flags (`--version`, `--help`) still go through commander below.
  if (process.argv.length <= 2) {
    await launchDesktop();
    return;
  }

  const program = new Command()
    .name("writ")
    .description("A glorified TODO app — CLI")
    .version("0.0.1");

  program.addCommand(initCommand());
  program.addCommand(taskCommand());
  program.addCommand(projectCommand());
  program.addCommand(mcpCommand());
  program.addCommand(completionCommand());

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
