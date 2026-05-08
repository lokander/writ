import { Command } from "commander";

import { runMcpServer } from "../../mcp/server";

export function mcpCommand(): Command {
  return new Command("mcp")
    .description("Run the writ MCP server over stdio (for Claude Code and other agents)")
    .action(async () => {
      // Long-lived: returns when the stdio client disconnects.
      await runMcpServer();
    });
}
