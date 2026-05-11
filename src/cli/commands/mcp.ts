import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";

import { runMcpServer } from "../../mcp/server";
import { findProjectRoot } from "../../shared/domain/project";
import { confirmYesNo } from "../confirm";
import { handleCliError } from "../context";

const MCP_CONFIG_FILE = ".mcp.json";
const SERVER_NAME = "writ";
const SERVER_ARGS = ["mcp"];
const DEFAULT_COMMAND = "writ";

interface McpServerEntry {
  command: string;
  args?: string[];
  // Other fields (env, type, cwd, …) are preserved as-is on update so user
  // tweaks aren't clobbered.
  [key: string]: unknown;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  // Pass through other top-level keys some Claude Code variants use.
  [key: string]: unknown;
}

interface InstallOptions {
  command?: string;
  yes?: boolean;
  dryRun?: boolean;
}

export function mcpCommand(): Command {
  const cmd = new Command("mcp")
    .description("Run the writ MCP server over stdio (for Claude Code and other agents)")
    .action(async () => {
      // Long-lived: returns when the stdio client disconnects.
      await runMcpServer();
    });

  cmd
    .command("install")
    .description("Add writ to the project's .mcp.json so Claude Code (and similar) can talk to it")
    .option(
      "--command <path>",
      `Command for the MCP entry (default: '${DEFAULT_COMMAND}', expecting it on PATH)`,
    )
    .option("-y, --yes", "Skip the confirmation prompt when overwriting an existing entry")
    .option("--dry-run", "Print what would be written to .mcp.json without modifying it")
    .action(async (opts: InstallOptions) => {
      const root = resolveRoot();
      await runInstall(root, opts);
    });

  cmd
    .command("uninstall")
    .description("Remove the 'writ' entry from the project's .mcp.json")
    .action(() => {
      const root = resolveRoot();
      runUninstall(root);
    });

  return cmd;
}

function resolveRoot(): string {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    handleCliError(new Error("No writ project found. Run `writ init` first."));
  }
  return root;
}

async function runInstall(root: string, opts: InstallOptions): Promise<void> {
  const command = (opts.command ?? DEFAULT_COMMAND).trim();
  if (command.length === 0) {
    handleCliError(new Error("--command cannot be empty"));
  }
  const path = join(root, MCP_CONFIG_FILE);

  const { config, fileExisted } = loadOrInitConfig(path);
  const existing = config.mcpServers![SERVER_NAME];

  if (existing && entryUpToDate(existing, command)) {
    console.log(`writ MCP server already configured in ${MCP_CONFIG_FILE}.`);
    maybeWarnPath(command);
    return;
  }

  // Build the merged entry up-front so both the dry-run preview and the
  // confirm prompt show exactly what would land. Other fields (env, type,
  // user-added cwd …) flow through unchanged on update.
  const nextEntry: McpServerEntry = {
    ...(existing ?? {}),
    command,
    args: [...SERVER_ARGS],
  };

  if (opts.dryRun) {
    console.log(`Would write to ${path}:`);
    console.log("");
    console.log(
      JSON.stringify(
        { ...config, mcpServers: { ...config.mcpServers, [SERVER_NAME]: nextEntry } },
        null,
        2,
      ),
    );
    return;
  }

  if (existing && !opts.yes) {
    process.stdout.write(
      `${MCP_CONFIG_FILE} already has a 'writ' entry with different fields.\n\n`,
    );
    process.stdout.write(`  Current command: ${existing.command}\n`);
    process.stdout.write(`  Current args:    ${JSON.stringify(existing.args ?? [])}\n\n`);
    process.stdout.write(`  New command:     ${command}\n`);
    process.stdout.write(`  New args:        ${JSON.stringify(SERVER_ARGS)}\n\n`);
    const ok = await confirmYesNo("Overwrite? (other fields like env are preserved)");
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  config.mcpServers![SERVER_NAME] = nextEntry;
  writeJson(path, config);

  if (existing) {
    console.log(`Replaced existing 'writ' entry in ${MCP_CONFIG_FILE}.`);
  } else if (fileExisted) {
    console.log(`Added writ to ${MCP_CONFIG_FILE}.`);
  } else {
    console.log(`Created ${MCP_CONFIG_FILE} with writ MCP server.`);
  }
  maybeWarnPath(command);
}

function runUninstall(root: string): void {
  const path = join(root, MCP_CONFIG_FILE);
  if (!existsSync(path)) {
    console.log(`No ${MCP_CONFIG_FILE} found — writ MCP server isn't configured.`);
    return;
  }
  const config = parseConfigFile(path);
  if (
    !config.mcpServers ||
    typeof config.mcpServers !== "object" ||
    Array.isArray(config.mcpServers) ||
    !config.mcpServers[SERVER_NAME]
  ) {
    console.log(`writ MCP server isn't configured in ${MCP_CONFIG_FILE}.`);
    return;
  }
  delete config.mcpServers[SERVER_NAME];
  writeJson(path, config);
  console.log(`Removed 'writ' from ${MCP_CONFIG_FILE}.`);
}

function loadOrInitConfig(path: string): { config: McpConfig; fileExisted: boolean } {
  if (!existsSync(path)) {
    return { config: { mcpServers: {} }, fileExisted: false };
  }
  const config = parseConfigFile(path);
  if (
    config.mcpServers &&
    (typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))
  ) {
    handleCliError(
      new Error(`${MCP_CONFIG_FILE}.mcpServers is not an object — refusing to overwrite.`),
    );
  }
  config.mcpServers = config.mcpServers ?? {};
  return { config, fileExisted: true };
}

function parseConfigFile(path: string): McpConfig {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    if (e instanceof SyntaxError) {
      handleCliError(new Error(`${MCP_CONFIG_FILE} is not valid JSON: ${e.message}`));
    }
    throw e;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    handleCliError(new Error(`${MCP_CONFIG_FILE} is not a JSON object — refusing to modify.`));
  }
  return parsed as McpConfig;
}

/** True iff the entry's command + args already match what `install` would
 *  write. Other fields (env, type) don't affect the answer — install
 *  preserves them on update. */
function entryUpToDate(entry: McpServerEntry, command: string): boolean {
  if (entry.command !== command) return false;
  const args = Array.isArray(entry.args) ? entry.args : [];
  if (args.length !== SERVER_ARGS.length) return false;
  return args.every((a, i) => a === SERVER_ARGS[i]);
}

function writeJson(path: string, value: unknown): void {
  // 2-space indent + trailing newline matches existing project conventions
  // and keeps diffs minimal across hand-edits.
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function maybeWarnPath(command: string): void {
  if (isOnPath(command)) return;
  process.stderr.write(
    `Warning: '${command}' is not on your PATH. ` +
      `Claude Code won't be able to start the writ MCP server until it is.\n`,
  );
}

function isOnPath(name: string): boolean {
  // Absolute / relative path with separator → check directly.
  if (name.includes("/") || name.includes("\\")) {
    return existsSync(name);
  }
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs = (process.env.PATH ?? "").split(sep).filter((d) => d.length > 0);
  for (const d of dirs) {
    for (const e of exts) {
      if (existsSync(join(d, name + e))) return true;
    }
  }
  return false;
}
