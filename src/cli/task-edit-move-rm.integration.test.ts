import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { init, runWrit, suffixFromCreated, withProject } from "./integration-helpers";

describe.concurrent("writ task edit", () => {
  it("--tag replaces the tag set; --depends-on replaces the dependency set", () =>
    withProject(async (dir) => {
      await init(dir);

      const blocker = suffixFromCreated((await runWrit(dir, ["task", "add", "blocker"])).stdout);
      const id = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "target", "--tag", "old"])).stdout,
      );

      const edited = await runWrit(dir, [
        "task",
        "edit",
        id,
        "--tag",
        "new",
        "--depends-on",
        blocker,
      ]);
      expect(edited.exitCode).toBe(0);

      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).toMatch(/Tags\s+new$/m);
      expect(view.stdout).not.toMatch(/Tags\s+.*old/);
      expect(view.stdout).toMatch(new RegExp(`Blocked by \\(1\\)[\\s\\S]*${blocker}`));
    }));

  it("editor mode round-trips title + description through $WRIT_EDITOR", () =>
    withProject(async (dir) => {
      await init(dir);

      const id = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "before", "--description", "old desc"])).stdout,
      );

      const editorScript = join(dir, "test-editor.mjs");
      writeFileSync(
        editorScript,
        `import { writeFileSync } from "node:fs";
const file = process.argv[process.argv.length - 1];
writeFileSync(file, process.env.WRIT_TEST_CONTENT, "utf8");
`,
      );

      const newContent = [
        "---",
        "title: after",
        "priority: high",
        "col: Doing",
        "parent: null",
        "tags: [updated]",
        "depends_on: []",
        "---",
        "",
        "new desc",
        "",
      ].join("\n");

      const r = await runWrit(dir, ["task", "edit", id], {
        env: {
          WRIT_EDITOR: `node ${editorScript}`,
          WRIT_TEST_CONTENT: newContent,
        },
      });
      expect(r.exitCode).toBe(0);

      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).toMatch(/^Title\s+after$/m);
      expect(view.stdout).toMatch(/Priority\s+high/);
      expect(view.stdout).toMatch(/Column\s+Doing/);
      expect(view.stdout).toMatch(/Tags\s+updated/);
      expect(view.stdout).toMatch(/new desc/);
    }));

  it("editor mode surfaces a parse error and points at the salvaged temp file", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated((await runWrit(dir, ["task", "add", "a"])).stdout);

      const editorScript = join(dir, "test-editor.mjs");
      writeFileSync(
        editorScript,
        `import { writeFileSync } from "node:fs";
const file = process.argv[process.argv.length - 1];
writeFileSync(file, "this is not yaml frontmatter\\n", "utf8");
`,
      );

      const r = await runWrit(dir, ["task", "edit", id], {
        env: { WRIT_EDITOR: `node ${editorScript}` },
      });
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toLowerCase()).toMatch(/frontmatter|yaml|parse/);
    }));
});

describe.concurrent("writ task move", () => {
  it("moves a task to the named column and updates list output", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "movable", "--col", "Backlog"])).stdout,
      );
      const r = await runWrit(dir, ["task", "move", id, "Doing"]);
      expect(r.exitCode).toBe(0);
      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).toMatch(/Column\s+Doing/);
    }));

  it("rejects an unknown column name", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated((await runWrit(dir, ["task", "add", "x"])).stdout);
      const r = await runWrit(dir, ["task", "move", id, "Bogus"]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/Column 'Bogus' not found/);
    }));

  it("`mv` is an alias for `move`", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated((await runWrit(dir, ["task", "add", "via-mv"])).stdout);
      const r = await runWrit(dir, ["task", "mv", id, "Doing"]);
      expect(r.exitCode).toBe(0);
      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).toMatch(/Column\s+Doing/);
    }));
});

describe.concurrent("writ task remove", () => {
  it("deletes a task and cascades to its subtasks", () =>
    withProject(async (dir) => {
      await init(dir);
      const parent = suffixFromCreated((await runWrit(dir, ["task", "add", "parent-task"])).stdout);
      const child = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "child-task", "--parent", parent])).stdout,
      );

      const r = await runWrit(dir, ["task", "remove", parent, "--yes"]);
      expect(r.exitCode).toBe(0);

      const view = await runWrit(dir, ["task", "view", parent]);
      expect(view.exitCode).toBe(1);
      expect(view.stderr).toMatch(/No task matches/);

      const childView = await runWrit(dir, ["task", "view", child]);
      expect(childView.exitCode).toBe(1);
      expect(childView.stderr).toMatch(/No task matches/);
    }));

  it("`rm` is an alias for `remove`", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated((await runWrit(dir, ["task", "add", "via-rm"])).stdout);
      const r = await runWrit(dir, ["task", "rm", id, "--yes"]);
      expect(r.exitCode).toBe(0);
      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.exitCode).toBe(1);
    }));

  it("requires --yes on non-TTY (refuses to hang on a prompt no one can answer)", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated((await runWrit(dir, ["task", "add", "needs-prompt"])).stdout);
      const r = await runWrit(dir, ["task", "rm", id]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/--yes/);
    }));
});
