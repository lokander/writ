import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./tools";

export async function runMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: "writ", version: "0.0.1" },
    {
      instructions:
        "writ task tracker. Tools operate on the writ project found by walking up from the current working directory until a .writ/ directory is found. If no project is found the tools error and the user must run `writ init` first.",
    },
  );

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
