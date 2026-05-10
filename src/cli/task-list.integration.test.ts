import { describe, expect, it } from "vitest";
import { init, runWrit, suffixFromCreated, withProject } from "./integration-helpers";

describe.concurrent("writ task list", () => {
  it("prints a friendly empty-state message on a fresh project", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["task", "list"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/No tasks/);
    }));

  it("groups by column and hides Done / Archived by default", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "todo-task", "--col", "Todo"]);
      await runWrit(dir, ["task", "add", "doing-task", "--col", "Doing"]);
      await runWrit(dir, ["task", "add", "done-task", "--col", "Done"]);

      const r = await runWrit(dir, ["task", "list"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("todo-task");
      expect(r.stdout).toContain("doing-task");
      expect(r.stdout).not.toContain("done-task");

      const withDone = await runWrit(dir, ["task", "list", "--show-done"]);
      expect(withDone.stdout).toContain("done-task");
    }));

  it("--col filters to a single column (case-insensitive) and unhides Done implicitly", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "doing-task", "--col", "Doing"]);
      await runWrit(dir, ["task", "add", "done-task", "--col", "Done"]);

      const onlyDone = await runWrit(dir, ["task", "list", "--col", "done"]);
      expect(onlyDone.stdout).toContain("done-task");
      expect(onlyDone.stdout).not.toContain("doing-task");
    }));

  it("--tag ANDs across selected tags; --any-tag ORs", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "alpha", "--tag", "x"]);
      await runWrit(dir, ["task", "add", "beta", "--tag", "y"]);
      await runWrit(dir, ["task", "add", "both", "--tag", "x", "--tag", "y"]);

      const andXY = await runWrit(dir, ["task", "list", "--tag", "x", "--tag", "y"]);
      expect(andXY.stdout).toContain("both");
      expect(andXY.stdout).not.toContain("alpha");
      expect(andXY.stdout).not.toContain("beta");

      const orXY = await runWrit(dir, ["task", "list", "--any-tag", "x", "--any-tag", "y"]);
      expect(orXY.stdout).toContain("alpha");
      expect(orXY.stdout).toContain("beta");
      expect(orXY.stdout).toContain("both");
    }));

  it("--priority narrows to one level; multiple --priority flags OR", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "urgent-task", "--priority", "urgent"]);
      await runWrit(dir, ["task", "add", "high-task", "--priority", "high"]);
      await runWrit(dir, ["task", "add", "normal-task"]);
      await runWrit(dir, ["task", "add", "low-task", "--priority", "low"]);

      const onlyUrgent = await runWrit(dir, ["task", "list", "--priority", "urgent"]);
      expect(onlyUrgent.exitCode).toBe(0);
      expect(onlyUrgent.stdout).toContain("urgent-task");
      expect(onlyUrgent.stdout).not.toContain("high-task");
      expect(onlyUrgent.stdout).not.toContain("normal-task");
      expect(onlyUrgent.stdout).not.toContain("low-task");

      const urgentOrHigh = await runWrit(dir, [
        "task",
        "list",
        "--priority",
        "urgent",
        "--priority",
        "high",
      ]);
      expect(urgentOrHigh.stdout).toContain("urgent-task");
      expect(urgentOrHigh.stdout).toContain("high-task");
      expect(urgentOrHigh.stdout).not.toContain("normal-task");
      expect(urgentOrHigh.stdout).not.toContain("low-task");
    }));

  it("--ready hides blocked tasks; --blocked hides ready ones", () =>
    withProject(async (dir) => {
      await init(dir);
      const blocker = suffixFromCreated((await runWrit(dir, ["task", "add", "blocker"])).stdout);
      await runWrit(dir, ["task", "add", "dependent", "--depends-on", blocker]);
      await runWrit(dir, ["task", "add", "freestanding"]);

      const ready = await runWrit(dir, ["task", "list", "--ready"]);
      expect(ready.stdout).toContain("freestanding");
      expect(ready.stdout).toContain("blocker");
      expect(ready.stdout).not.toContain("dependent");

      const blocked = await runWrit(dir, ["task", "list", "--blocked"]);
      expect(blocked.stdout).toContain("dependent");
      expect(blocked.stdout).not.toContain("freestanding");
    }));

  it("indents subtasks under their parent in the same column", () =>
    withProject(async (dir) => {
      await init(dir);
      const parent = suffixFromCreated((await runWrit(dir, ["task", "add", "parent-task"])).stdout);
      await runWrit(dir, ["task", "add", "child-task", "--parent", parent]);

      const r = await runWrit(dir, ["task", "list"]);
      const lines = r.stdout.split("\n");
      const parentLine = lines.findIndex((l) => l.includes("parent-task"));
      const childLine = lines.findIndex((l) => l.includes("child-task"));
      expect(parentLine).toBeGreaterThan(-1);
      expect(childLine).toBeGreaterThan(parentLine);
      expect(lines[childLine]).toMatch(/^\s{2,}/);
    }));
});
