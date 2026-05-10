import { describe, expect, it } from "vitest";

import { runWrit, withProject } from "./integration-helpers";

describe.concurrent("writ completion", () => {
  // `completion` doesn't touch the DB, so any cwd works — keep withProject
  // anyway for the tempdir lifecycle.
  it("prints a fish completion script", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["completion", "fish"]);
      expect(r.exitCode).toBe(0);
      // Anchor on a few syntactic markers so we'd catch shape regressions.
      expect(r.stdout).toMatch(/# writ fish completion/);
      expect(r.stdout).toMatch(/complete -c writ/);
      expect(r.stdout).toMatch(/Manage tasks/);
    }));

  it("prints a bash completion script", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["completion", "bash"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/_writ_completions/);
      expect(r.stdout).toMatch(/complete -F _writ_completions writ/);
    }));

  it("prints a zsh completion script", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["completion", "zsh"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/^#compdef writ/);
      expect(r.stdout).toMatch(/_writ\b/);
    }));

  it("rejects unknown shells with a clear error", () =>
    withProject(async (dir) => {
      const r = await runWrit(dir, ["completion", "powershell"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/Unknown shell/);
      expect(r.stderr).toMatch(/bash, zsh, fish/);
    }));
});
