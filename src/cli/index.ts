#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init";
import { mcpCommand } from "./commands/mcp";
import { projectCommand } from "./commands/project";
import { taskCommand } from "./commands/task";

const program = new Command()
  .name("writ")
  .description("A glorified TODO app — CLI")
  .version("0.0.1");

program.addCommand(initCommand());
program.addCommand(taskCommand());
program.addCommand(projectCommand());
program.addCommand(mcpCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
