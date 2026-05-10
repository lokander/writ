import { describe, expect, it } from "vitest";

import type { Task } from "../../../shared/types";

import {
  buildResolvedUpdate,
  buildTaskUpdate,
  type ConflictResolutions,
  diffTask,
  type EditedTaskFields,
  intersectFlags,
  taskToFields,
} from "./diff-task";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "01ABCDEFGHIJKLMNOPQRSTUVWX",
    parentId: null,
    columnId: "col-1",
    title: "Initial title",
    description: "Initial body",
    priority: 2,
    position: 1000,
    version: 0,
    tags: ["a", "b"],
    dependsOn: ["01DEP000000000000000000001"],
    blockedBy: [],
    isReady: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeEdited(task: Task, overrides: Partial<EditedTaskFields> = {}): EditedTaskFields {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    parentId: task.parentId,
    tagSpecs: [...task.tags],
    dependsOnIds: [...task.dependsOn],
    ...overrides,
  };
}

describe("diffTask", () => {
  it("reports nothing dirty when edited values match the task", () => {
    const task = makeTask();
    const flags = diffTask(task, makeEdited(task));
    expect(flags).toEqual({
      title: false,
      description: false,
      priority: false,
      parentId: false,
      tags: false,
      dependsOn: false,
      any: false,
    });
  });

  it("flips title dirty on edit and back when reverted", () => {
    const task = makeTask();
    const edited = makeEdited(task, { title: "Renamed" });
    expect(diffTask(task, edited).title).toBe(true);
    expect(diffTask(task, makeEdited(task, { title: task.title })).title).toBe(false);
  });

  it("flips description dirty independently of title", () => {
    const task = makeTask();
    const flags = diffTask(task, makeEdited(task, { description: "new body" }));
    expect(flags.description).toBe(true);
    expect(flags.title).toBe(false);
    expect(flags.any).toBe(true);
  });

  it("flips priority dirty when the numeric level changes", () => {
    const task = makeTask({ priority: 2 });
    expect(diffTask(task, makeEdited(task, { priority: 0 })).priority).toBe(true);
    expect(diffTask(task, makeEdited(task, { priority: 2 })).priority).toBe(false);
  });

  it("flips parentId dirty in either direction (null → id, id → null)", () => {
    const noParent = makeTask({ parentId: null });
    expect(
      diffTask(noParent, makeEdited(noParent, { parentId: "01PARENT0000000000000000AB" })).parentId,
    ).toBe(true);
    const withParent = makeTask({ parentId: "01PARENT0000000000000000AB" });
    expect(diffTask(withParent, makeEdited(withParent, { parentId: null })).parentId).toBe(true);
  });

  it("treats reordered tags as clean (unordered set equality)", () => {
    const task = makeTask({ tags: ["alpha", "beta", "gamma"] });
    const reordered = makeEdited(task, { tagSpecs: ["gamma", "alpha", "beta"] });
    expect(diffTask(task, reordered).tags).toBe(false);
  });

  it("marks tags dirty on add, remove, or =COLOR upsert", () => {
    const task = makeTask({ tags: ["alpha"] });
    expect(diffTask(task, makeEdited(task, { tagSpecs: ["alpha", "beta"] })).tags).toBe(true);
    expect(diffTask(task, makeEdited(task, { tagSpecs: [] })).tags).toBe(true);
    // Same name, but with a color suffix → still dirty so the color upsert
    // round-trips through updateTask.
    expect(diffTask(task, makeEdited(task, { tagSpecs: ["alpha=red"] })).tags).toBe(true);
  });

  it("marks dependsOn dirty on set change but not on reorder", () => {
    const task = makeTask({ dependsOn: ["01A", "01B"] });
    expect(diffTask(task, makeEdited(task, { dependsOnIds: ["01B", "01A"] })).dependsOn).toBe(
      false,
    );
    expect(diffTask(task, makeEdited(task, { dependsOnIds: ["01C"] })).dependsOn).toBe(true);
  });
});

describe("buildTaskUpdate", () => {
  it("omits every field when nothing changed", () => {
    const task = makeTask();
    expect(buildTaskUpdate(task, makeEdited(task))).toEqual({});
  });

  it("includes only the fields the user touched", () => {
    const task = makeTask();
    const update = buildTaskUpdate(task, makeEdited(task, { title: "Renamed" }));
    expect(update).toEqual({ title: "Renamed" });
    // Critically, description is absent — not `description: undefined` but
    // truly missing — so the IPC payload doesn't carry a stale snapshot.
    expect("description" in update).toBe(false);
    expect("priority" in update).toBe(false);
    expect("parentId" in update).toBe(false);
  });

  it("trims the title at the IPC boundary even when only whitespace differs", () => {
    const task = makeTask({ title: "Title" });
    const update = buildTaskUpdate(task, makeEdited(task, { title: "  Title  " }));
    // dirty (whitespace differs) → field appears, but trimmed back to the
    // original. domain dedupes a no-op write but the round trip is harmless.
    expect(update.title).toBe("Title");
  });

  it("passes the edited array through verbatim (preserves user's order)", () => {
    const task = makeTask({ tags: ["a"] });
    const update = buildTaskUpdate(task, makeEdited(task, { tagSpecs: ["b", "a"] }));
    expect(update.tags).toEqual(["b", "a"]);
  });

  it("supports a multi-field edit without leaking untouched fields", () => {
    const task = makeTask({ title: "T", priority: 2, tags: ["x"] });
    const update = buildTaskUpdate(task, makeEdited(task, { title: "T2", priority: 0 }));
    expect(update).toEqual({ title: "T2", priority: 0 });
    expect("description" in update).toBe(false);
    expect("tags" in update).toBe(false);
    expect("dependsOn" in update).toBe(false);
  });
});

describe("intersectFlags", () => {
  const allFalse = {
    title: false,
    description: false,
    priority: false,
    parentId: false,
    tags: false,
    dependsOn: false,
    any: false,
  };

  it("returns all-false when neither side has any dirty fields", () => {
    expect(intersectFlags(allFalse, allFalse)).toEqual(allFalse);
  });

  it("returns the field set true on both sides only", () => {
    const a = { ...allFalse, title: true, description: true, any: true };
    const b = { ...allFalse, description: true, priority: true, any: true };
    const out = intersectFlags(a, b);
    expect(out.title).toBe(false);
    expect(out.description).toBe(true);
    expect(out.priority).toBe(false);
    expect(out.any).toBe(true);
  });

  it("derives any=false when sides are dirty in disjoint fields (auto-merge case)", () => {
    const a = { ...allFalse, title: true, any: true };
    const b = { ...allFalse, description: true, any: true };
    const out = intersectFlags(a, b);
    expect(out.any).toBe(false);
  });
});

describe("taskToFields", () => {
  it("projects a Task down to the modal's editable shape", () => {
    const task = makeTask();
    expect(taskToFields(task)).toEqual({
      title: task.title,
      description: task.description,
      priority: task.priority,
      parentId: task.parentId,
      tagSpecs: task.tags,
      dependsOnIds: task.dependsOn,
    });
  });

  it("copies arrays so the result can be mutated without touching the task", () => {
    const task = makeTask({ tags: ["a"] });
    const fields = taskToFields(task);
    fields.tagSpecs.push("b");
    expect(task.tags).toEqual(["a"]);
  });
});

const ALL_THEIRS: ConflictResolutions = {
  title: "theirs",
  description: "theirs",
  priority: "theirs",
  parentId: "theirs",
  tags: "theirs",
  dependsOn: "theirs",
};

const ALL_MINE: ConflictResolutions = {
  title: "mine",
  description: "mine",
  priority: "mine",
  parentId: "mine",
  tags: "mine",
  dependsOn: "mine",
};

describe("buildResolvedUpdate", () => {
  it("includes a dirty-only field even when resolutions point to theirs (no conflict on it)", () => {
    // Local user changed the title; remote didn't touch it. resolutions are
    // irrelevant here because this isn't a conflict — yours wins by default.
    const original = makeTask({ title: "T", description: "D" });
    const remote = makeTask({ title: "T", description: "D" });
    const edited = makeEdited(original, { title: "Renamed" });
    const update = buildResolvedUpdate(original, edited, remote, ALL_THEIRS);
    expect(update).toEqual({ title: "Renamed" });
  });

  it("omits a remote-only field even when resolutions say mine (no conflict on it)", () => {
    // Remote changed description; user didn't. resolutions don't apply
    // because there's no overlap; theirs in the DB stays untouched.
    const original = makeTask({ title: "T", description: "old" });
    const remote = makeTask({ title: "T", description: "new from CLI" });
    const edited = makeEdited(original);
    const update = buildResolvedUpdate(original, edited, remote, ALL_MINE);
    expect(update).toEqual({});
  });

  it("respects per-field resolution on a true conflict (both sides changed)", () => {
    const original = makeTask({ title: "T", description: "D" });
    const remote = makeTask({ title: "remote-rename", description: "remote-body" });
    const edited = makeEdited(original, { title: "local-rename", description: "local-body" });
    const keepMineTitle: ConflictResolutions = { ...ALL_THEIRS, title: "mine" };
    const update = buildResolvedUpdate(original, edited, remote, keepMineTitle);
    expect(update.title).toBe("local-rename");
    expect("description" in update).toBe(false); // theirs stays in DB
  });

  it("force-save mine: every dirty field flows through with yours", () => {
    const original = makeTask({ title: "T", description: "D" });
    const remote = makeTask({ title: "remote", description: "remote" });
    const edited = makeEdited(original, { title: "yours", description: "yours" });
    const update = buildResolvedUpdate(original, edited, remote, ALL_MINE);
    expect(update).toEqual({ title: "yours", description: "yours" });
  });

  it("accept all theirs: payload is empty when every dirty field also conflicts", () => {
    const original = makeTask({ title: "T", description: "D" });
    const remote = makeTask({ title: "remote", description: "remote" });
    const edited = makeEdited(original, { title: "yours", description: "yours" });
    const update = buildResolvedUpdate(original, edited, remote, ALL_THEIRS);
    expect(update).toEqual({});
  });

  it("auto-merge: dirty + remote on disjoint fields → both contributions land", () => {
    // User changed title; remote changed description. No conflict; payload
    // contains the user's title only — remote's description survives in the
    // DB because we don't include the description field at all.
    const original = makeTask({ title: "T", description: "D" });
    const remote = makeTask({ title: "T", description: "remote" });
    const edited = makeEdited(original, { title: "yours" });
    const update = buildResolvedUpdate(original, edited, remote, ALL_THEIRS);
    expect(update).toEqual({ title: "yours" });
  });

  it("trims the title at the IPC boundary regardless of resolution", () => {
    const original = makeTask({ title: "T" });
    const remote = makeTask({ title: "T" });
    const edited = makeEdited(original, { title: "  yours  " });
    const update = buildResolvedUpdate(original, edited, remote, ALL_MINE);
    expect(update.title).toBe("yours");
  });
});
