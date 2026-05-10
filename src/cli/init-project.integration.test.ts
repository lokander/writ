import { describe, expect, it } from "vitest";
import { init, runWrit, withProject } from "./integration-helpers";

describe.concurrent("writ init", () => {
  it("creates .writ/writ.db on a fresh directory", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["init"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Initialized writ project at .*\.writ\/writ\.db/);
    }));

  it("prints next-steps and gitignore guidance on fresh init", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["init"]);
      expect(r.exitCode).toBe(0);
      // Quickstart commands cover the user's three likely next moves.
      expect(r.stdout).toMatch(/writ task add/);
      expect(r.stdout).toMatch(/writ task list/);
      expect(r.stdout).toMatch(/writ mcp install/);
      // Gitignore note flags the non-obvious "commit the DB" default so
      // users don't end up gitignoring `.writ/` by reflex.
      expect(r.stdout).toMatch(/\.gitignore/);
    }));

  it("is idempotent — re-init reports already-initialized and skips next-steps", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["init"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/already initialized/);
      // The next-steps block is fresh-init-only; re-init stays terse.
      expect(r.stdout).not.toMatch(/Next steps/);
    }));

  it("task commands fail outside a writ project with a clear message", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["task", "list"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/No writ project found/);
    }));
});

describe.concurrent("writ project", () => {
  it("show prints id, default name, and root", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["project", "show"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/^Id\s+[0-9A-HJKMNP-TV-Z]{26}$/m);
      expect(r.stdout).toMatch(/Name\s+.*\(default\)/);
      expect(r.stdout).toMatch(new RegExp(`Root\\s+${dir.replace(/[/\\]/g, "\\$&")}`));
    }));

  it("rename then show reflects the new name; --clear restores the default", () =>
    withProject(async (dir) => {
      await init(dir);

      const renamed = await runWrit(dir, ["project", "rename", "Pet Project"]);
      expect(renamed.exitCode).toBe(0);
      expect(renamed.stdout).toMatch(/Display name set to 'Pet Project'/);

      const after = await runWrit(dir, ["project", "show"]);
      expect(after.stdout).toMatch(/Name\s+Pet Project$/m);
      expect(after.stdout).not.toMatch(/\(default\)/);

      const cleared = await runWrit(dir, ["project", "rename", "--clear"]);
      expect(cleared.exitCode).toBe(0);
      expect(cleared.stdout).toMatch(/Display name cleared/);

      const final = await runWrit(dir, ["project", "show"]);
      expect(final.stdout).toMatch(/Name\s+.*\(default\)/);
    }));

  it("rename without args or with both name and --clear is a clean error", () =>
    withProject(async (dir) => {
      await init(dir);

      const bare = await runWrit(dir, ["project", "rename"]);
      expect(bare.exitCode).toBe(1);
      expect(bare.stderr).toMatch(/Pass a name/);
      expect(bare.stderr).not.toMatch(/at /); // no stack trace

      const both = await runWrit(dir, ["project", "rename", "x", "--clear"]);
      expect(both.exitCode).toBe(1);
      expect(both.stderr).toMatch(/Pass either a name or --clear, not both/);

      const empty = await runWrit(dir, ["project", "rename", ""]);
      expect(empty.exitCode).toBe(1);
      expect(empty.stderr).toMatch(/cannot be empty/);
    }));
});
