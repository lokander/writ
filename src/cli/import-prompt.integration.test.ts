import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runWrit, withProject } from "./integration-helpers";

describe.concurrent("writ import-prompt", () => {
  it("prints the prompt to stdout without --file (no project required)", async () => {
    // Note: no `init` — `import-prompt` is meant to be runnable before the
    // project even exists, since the user might want to see the prompt
    // before deciding to commit to writ.
    await withProject(async (dir) => {
      const r = await runWrit(dir, ["import-prompt"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/mcp__writ__create_task/);
      expect(r.stdout).toMatch(/mcp__writ__list_columns/);
      // Without --file, the agent is told to read the file from disk.
      expect(r.stdout).toMatch(/Ask the user which file/);
      // The inline-file marker should NOT appear when no --file passed.
      expect(r.stdout).not.toMatch(/Source file:/);
    });
  });

  it("--file inlines the source contents into the prompt", () =>
    withProject(async (dir) => {
      const todoPath = join(dir, "TODO.md");
      writeFileSync(
        todoPath,
        "# Project TODO\n\n## In Progress\n- Fix login bug\n\n## Backlog\n- [ ] OAuth\n",
        "utf8",
      );

      const r = await runWrit(dir, ["import-prompt", "--file", "TODO.md"]);
      expect(r.exitCode).toBe(0);
      // Header line + content both present.
      expect(r.stdout).toContain("Source file:");
      expect(r.stdout).toContain("Fix login bug");
      expect(r.stdout).toContain("- [ ] OAuth");
    }));

  it("--file with a missing path errors cleanly", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["import-prompt", "--file", "missing.md"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/ENOENT|no such file/i);
    }));
});
