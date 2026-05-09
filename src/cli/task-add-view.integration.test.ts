import { describe, expect, it } from "vitest";
import { init, runWrit, suffixFromCreated, withProject } from "./integration-helpers";

describe.concurrent("writ task add", () => {
  it("creates a task with bare title, in Backlog by default, with normal priority", () =>
    withProject(async (dir) => {
      await init(dir);

      const r = await runWrit(dir, ["task", "add", "buy milk"]);
      expect(r.exitCode).toBe(0);
      const id = suffixFromCreated(r.stdout);
      expect(r.stdout).toMatch(new RegExp(`Created ${id}  buy milk`));

      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).toMatch(/Column\s+Backlog/);
      expect(view.stdout).toMatch(/Priority\s+normal/);
    }));

  it("honors --col, --priority, --description, --tag, --depends-on, --parent", () =>
    withProject(async (dir) => {
      await init(dir);

      const blocker = suffixFromCreated((await runWrit(dir, ["task", "add", "blocker"])).stdout);
      const parent = suffixFromCreated((await runWrit(dir, ["task", "add", "parent"])).stdout);

      const created = await runWrit(dir, [
        "task",
        "add",
        "child",
        "--col",
        "Doing",
        "--priority",
        "high",
        "--description",
        "do the thing",
        "--tag",
        "urgent=red",
        "--tag",
        "work",
        "--depends-on",
        blocker,
        "--parent",
        parent,
      ]);
      expect(created.exitCode).toBe(0);
      const child = suffixFromCreated(created.stdout);

      const view = await runWrit(dir, ["task", "view", child]);
      expect(view.stdout).toMatch(/Column\s+Doing/);
      expect(view.stdout).toMatch(/Priority\s+high/);
      expect(view.stdout).toMatch(/Tags\s+urgent, work/);
      expect(view.stdout).toMatch(new RegExp(`Parent\\s+${parent}`));
      expect(view.stdout).toMatch(/do the thing/);
      expect(view.stdout).toMatch(new RegExp(`Blocked by \\(1\\)[\\s\\S]*${blocker}`));
    }));

  it("rejects an unknown column name with a helpful error", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["task", "add", "x", "--col", "nope"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/Column 'nope' not found/);
      expect(r.stderr).toMatch(/Available: Backlog, Todo, Doing, Done, Archived/);
    }));

  it("rejects an invalid priority", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["task", "add", "x", "--priority", "bogus"]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/[Pp]riority/);
    }));

  it("rejects a malformed tag spec", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["task", "add", "x", "--tag", "bad name with spaces"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toLowerCase()).toMatch(/tag/);
    }));

  it("rejects --depends-on that creates a cycle", () =>
    withProject(async (dir) => {
      await init(dir);
      const a = suffixFromCreated((await runWrit(dir, ["task", "add", "a"])).stdout);
      const b = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "b", "--depends-on", a])).stdout,
      );
      // Now try to make a depend on b → cycle a → b → a.
      const r = await runWrit(dir, ["task", "edit", a, "--depends-on", b]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toLowerCase()).toMatch(/cycle/);
    }));
});

describe.concurrent("writ task view", () => {
  it("shows full details by ulid suffix", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated((await runWrit(dir, ["task", "add", "viewable"])).stdout);
      const r = await runWrit(dir, ["task", "view", id]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/^ID\s+[0-9A-HJKMNP-TV-Z]{26}$/m);
      expect(r.stdout).toMatch(/^Title\s+viewable$/m);
    }));

  it("not-found prints the unresolved input and exits 1", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["task", "view", "ZZZZZZ"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/No task matches 'ZZZZZZ'/);
    }));

  it("ambiguous suffix lists candidates", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "alpha"]);
      await runWrit(dir, ["task", "add", "beta"]);
      await runWrit(dir, ["task", "add", "gamma"]);
      // A 1-char suffix is almost certain to match multiple ulids.
      const r = await runWrit(dir, ["task", "view", "0"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/matches \d+ tasks|No task matches/);
    }));
});
