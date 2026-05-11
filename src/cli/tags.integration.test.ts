import { describe, expect, it } from "vitest";

import { init, runWrit, suffixFromCreated, withProject } from "./integration-helpers";

describe.concurrent("writ tags", () => {
  it("list and list --with-counts surface colors and usage", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "a", "--tag", "ui=red"]);
      await runWrit(dir, ["task", "add", "b", "--tag", "ui", "--tag", "core"]);

      const list = await runWrit(dir, ["tags", "list"]);
      expect(list.exitCode).toBe(0);
      expect(list.stdout).toMatch(/^core\s+—/m);
      expect(list.stdout).toMatch(/^ui\s+red/m);

      const withCounts = await runWrit(dir, ["tags", "ls", "--with-counts"]);
      expect(withCounts.stdout).toMatch(/^core\s+—\s+1$/m);
      expect(withCounts.stdout).toMatch(/^ui\s+red\s+2$/m);
    }));

  it("rm --yes deletes globally and detaches from every task", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "a", "--tag", "doomed"])).stdout,
      );

      const rm = await runWrit(dir, ["tags", "rm", "doomed", "--yes"]);
      expect(rm.exitCode).toBe(0);
      expect(rm.stdout).toMatch(/Deleted tag 'doomed'\./);

      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).not.toMatch(/doomed/);

      const list = await runWrit(dir, ["tags", "list"]);
      expect(list.stdout).not.toMatch(/doomed/);
    }));

  it("rm reports an error when the tag doesn't exist", () =>
    withProject(async (dir) => {
      await init(dir);
      const rm = await runWrit(dir, ["tags", "rm", "ghost", "--yes"]);
      expect(rm.exitCode).toBe(1);
      expect(rm.stderr).toMatch(/not found/);
    }));

  it("rm without --yes errors on non-TTY rather than hanging", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "a", "--tag", "ui"]);
      const rm = await runWrit(dir, ["tags", "rm", "ui"]);
      expect(rm.exitCode).toBe(1);
      expect(rm.stderr).toMatch(/--yes/);
    }));

  it("rename preserves color and updates task tag listings", () =>
    withProject(async (dir) => {
      await init(dir);
      const id = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "a", "--tag", "ui=red"])).stdout,
      );

      const rename = await runWrit(dir, ["tags", "rename", "ui", "frontend"]);
      expect(rename.exitCode).toBe(0);
      expect(rename.stdout).toMatch(/Renamed 'ui' to 'frontend'\./);

      const view = await runWrit(dir, ["task", "view", id]);
      expect(view.stdout).toMatch(/frontend/);
      expect(view.stdout).not.toMatch(/Tags\s+.*\bui\b/);

      const list = await runWrit(dir, ["tags", "list"]);
      expect(list.stdout).toMatch(/^frontend\s+red/m);
    }));

  it("rename rejects a collision and validates the new name", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "a", "--tag", "ui"]);
      await runWrit(dir, ["task", "add", "b", "--tag", "core"]);

      const conflict = await runWrit(dir, ["tags", "rename", "ui", "core"]);
      expect(conflict.exitCode).toBe(1);
      expect(conflict.stderr).toMatch(/already exists/);

      const bad = await runWrit(dir, ["tags", "rename", "ui", "not a name"]);
      expect(bad.exitCode).toBe(1);
      expect(bad.stderr).toMatch(/Invalid tag name/);
    }));

  it("color sets and --clear removes the override", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "a", "--tag", "ui"]);

      const set = await runWrit(dir, ["tags", "color", "ui", "#abcdef"]);
      expect(set.exitCode).toBe(0);
      expect((await runWrit(dir, ["tags", "list"])).stdout).toMatch(/^ui\s+#abcdef/m);

      const cleared = await runWrit(dir, ["tags", "color", "ui", "--clear"]);
      expect(cleared.exitCode).toBe(0);
      expect((await runWrit(dir, ["tags", "list"])).stdout).toMatch(/^ui\s+—/m);
    }));

  it("color rejects bad combinations of args", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "a", "--tag", "ui"]);

      const missing = await runWrit(dir, ["tags", "color", "ui"]);
      expect(missing.exitCode).toBe(1);

      const both = await runWrit(dir, ["tags", "color", "ui", "red", "--clear"]);
      expect(both.exitCode).toBe(1);
    }));

  it("prune --dry-run lists candidates without deleting", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "a", "--tag", "used"]);
      // Create an orphan by adding+removing the tag.
      const tmp = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "tmp", "--tag", "orphan"])).stdout,
      );
      await runWrit(dir, ["task", "rm", tmp]);

      const preview = await runWrit(dir, ["tags", "prune", "--dry-run"]);
      expect(preview.exitCode).toBe(0);
      expect(preview.stdout).toMatch(/Would prune 1 tag/);
      expect(preview.stdout).toMatch(/orphan/);

      // Nothing was actually deleted.
      const list = await runWrit(dir, ["tags", "list"]);
      expect(list.stdout).toMatch(/orphan/);
    }));

  it("prune --yes removes orphan tags and leaves used ones", () =>
    withProject(async (dir) => {
      await init(dir);
      await runWrit(dir, ["task", "add", "keep", "--tag", "used"]);
      const tmp = suffixFromCreated(
        (await runWrit(dir, ["task", "add", "tmp", "--tag", "orphan"])).stdout,
      );
      await runWrit(dir, ["task", "rm", tmp]);

      const prune = await runWrit(dir, ["tags", "prune", "--yes"]);
      expect(prune.exitCode).toBe(0);
      expect(prune.stdout).toMatch(/Pruned 1 tag/);

      const list = await runWrit(dir, ["tags", "list"]);
      expect(list.stdout).toMatch(/used/);
      expect(list.stdout).not.toMatch(/orphan/);
    }));

  it("prune reports cleanly when there's nothing to do", () =>
    withProject(async (dir) => {
      await init(dir);
      const r = await runWrit(dir, ["tags", "prune", "--yes"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/No orphan tags to prune\./);
    }));
});
