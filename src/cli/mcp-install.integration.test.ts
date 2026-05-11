import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { init, runWrit, withProject } from "./integration-helpers";

interface McpFile {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  [key: string]: unknown;
}

function readMcp(dir: string): McpFile {
  return JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")) as McpFile;
}

describe.concurrent("writ mcp install / uninstall", () => {
  // The PATH warning fires when `writ` (or the override command) isn't on
  // PATH in the test runner's env. Set a sentinel command we know isn't
  // installed so we can assert exact warning behavior; otherwise tests would
  // depend on whether the dev's machine has `writ` symlinked.
  const ORPHAN_CMD = "definitely-not-on-path-writ-12345";

  it("creates .mcp.json from scratch when none exists", () =>
    withProject(async (dir) => {
      await init(dir);

      const r = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Created \.mcp\.json with writ MCP server/);
      expect(r.stderr).toMatch(/not on your PATH/);

      const cfg = readMcp(dir);
      expect(cfg.mcpServers?.writ).toEqual({
        command: ORPHAN_CMD,
        args: ["mcp"],
      });
    }));

  it("merges into an existing .mcp.json without touching other servers", () =>
    withProject(async (dir) => {
      await init(dir);
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const r = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Added writ to \.mcp\.json/);

      const cfg = readMcp(dir);
      expect(cfg.mcpServers?.context7).toEqual({
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
      });
      expect(cfg.mcpServers?.writ).toEqual({
        command: ORPHAN_CMD,
        args: ["mcp"],
      });
    }));

  it("is a no-op when the writ entry already matches", () =>
    withProject(async (dir) => {
      await init(dir);
      const first = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD]);
      expect(first.exitCode).toBe(0);

      const before = readFileSync(join(dir, ".mcp.json"), "utf8");
      const second = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD]);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toMatch(/already configured/);

      const after = readFileSync(join(dir, ".mcp.json"), "utf8");
      expect(after).toBe(before);
    }));

  it("refuses to overwrite a differing 'writ' entry on non-TTY without --yes", () =>
    withProject(async (dir) => {
      await init(dir);
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              writ: { command: "./bin/writ-dev", args: ["mcp"] },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      // No --yes, non-TTY (subprocess pipe) — the prompt path bails with
      // a helpful error instead of hanging on stdin.
      const r = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD]);
      expect(r.exitCode).toBe(1);
      // The "already has a 'writ' entry" preamble lands on stdout before
      // the prompt; the TTY-refusal lands on stderr.
      expect(r.stdout).toMatch(/already has a 'writ' entry/);
      expect(r.stderr).toMatch(/--yes/);

      // Original entry should be untouched.
      const cfg = readMcp(dir);
      expect(cfg.mcpServers?.writ?.command).toBe("./bin/writ-dev");
    }));

  it("--dry-run prints the would-be config without writing", () =>
    withProject(async (dir) => {
      await init(dir);
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              writ: { command: "./bin/writ-dev", args: ["mcp"], env: { DEBUG: "1" } },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const r = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD, "--dry-run"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Would write to/);
      // The preview shows the merged entry: new command, original env.
      expect(r.stdout).toContain(ORPHAN_CMD);
      expect(r.stdout).toContain('"DEBUG"');

      // File should be unchanged.
      const cfg = readMcp(dir);
      expect(cfg.mcpServers?.writ?.command).toBe("./bin/writ-dev");
    }));

  it("--yes overwrites command/args while preserving other fields like env", () =>
    withProject(async (dir) => {
      await init(dir);
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              writ: {
                command: "./bin/writ-dev",
                args: ["mcp"],
                env: { DEBUG: "1" },
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const r = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD, "--yes"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Replaced existing 'writ' entry/);

      const cfg = readMcp(dir);
      expect(cfg.mcpServers?.writ).toEqual({
        command: ORPHAN_CMD,
        args: ["mcp"],
        env: { DEBUG: "1" },
      });
    }));

  it("rejects malformed .mcp.json instead of silently overwriting", () =>
    withProject(async (dir) => {
      await init(dir);
      writeFileSync(join(dir, ".mcp.json"), "{ not valid json", "utf8");

      const r = await runWrit(dir, ["mcp", "install", "--command", ORPHAN_CMD]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/not valid JSON/);

      // File should be untouched.
      expect(readFileSync(join(dir, ".mcp.json"), "utf8")).toBe("{ not valid json");
    }));

  it("uninstall removes the writ entry and leaves the rest", () =>
    withProject(async (dir) => {
      await init(dir);
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
              writ: { command: "writ", args: ["mcp"] },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const r = await runWrit(dir, ["mcp", "uninstall"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Removed 'writ'/);

      const cfg = readMcp(dir);
      expect(cfg.mcpServers?.writ).toBeUndefined();
      expect(cfg.mcpServers?.context7).toBeDefined();
    }));

  it("uninstall is a clean no-op when writ isn't configured", () =>
    withProject(async (dir) => {
      await init(dir);

      const noFile = await runWrit(dir, ["mcp", "uninstall"]);
      expect(noFile.exitCode).toBe(0);
      expect(noFile.stdout).toMatch(/No \.mcp\.json found/);
      expect(existsSync(join(dir, ".mcp.json"))).toBe(false);

      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { foo: { command: "x" } } }, null, 2),
        "utf8",
      );
      const noEntry = await runWrit(dir, ["mcp", "uninstall"]);
      expect(noEntry.exitCode).toBe(0);
      expect(noEntry.stdout).toMatch(/isn't configured/);
    }));

  it("install errors clearly when run outside a writ project", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["mcp", "install"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/No writ project found/);
    }));
});
