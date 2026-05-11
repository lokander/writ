import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SqliteDb } from "../db";
import { makeTestDb } from "../test-utils";

import { TagValidationError } from "./tag-format";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "./tasks";
import {
  addTagToTask,
  deleteTag,
  getOrCreateTag,
  listTags,
  listTagsWithCounts,
  listTaskTagNames,
  listTaskTagsByTaskIds,
  pruneOrphanTags,
  removeTagFromTask,
  renameTag,
  setTagColor,
  setTaskTags,
  TagConflictError,
  TagNotFoundError,
} from "./tags";

let db: SqliteDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  db.close();
});

describe("getOrCreateTag", () => {
  it("creates a tag with NULL color when none is supplied", () => {
    const tag = getOrCreateTag(db, { name: "UI" });
    expect(tag.name).toBe("UI");
    expect(tag.color).toBeNull();
  });

  it("creates a tag with the provided color", () => {
    const tag = getOrCreateTag(db, { name: "Backend", color: "red" });
    expect(tag.color).toBe("red");
  });

  it("reuses an existing tag by name", () => {
    const a = getOrCreateTag(db, { name: "Core" });
    const b = getOrCreateTag(db, { name: "Core" });
    expect(b.id).toBe(a.id);
  });

  it("preserves the existing color when no new color is given", () => {
    getOrCreateTag(db, { name: "Backend", color: "red" });
    const again = getOrCreateTag(db, { name: "Backend" });
    expect(again.color).toBe("red");
  });

  it("overwrites the color when a different one is given", () => {
    getOrCreateTag(db, { name: "Backend", color: "red" });
    const updated = getOrCreateTag(db, { name: "Backend", color: "#0000ff" });
    expect(updated.color).toBe("#0000ff");
    // and persists
    const all = listTags(db);
    expect(all.find((t) => t.name === "Backend")?.color).toBe("#0000ff");
  });
});

describe("setTaskTags", () => {
  it("attaches tags to a task and auto-creates them", () => {
    const task = createTask(db, { title: "x" });
    setTaskTags(db, task.id, ["UI", "Core"]);
    expect(listTaskTagNames(db, task.id)).toEqual(["Core", "UI"]);
    expect(
      listTags(db)
        .map((t) => t.name)
        .sort(),
    ).toEqual(["Core", "UI"]);
  });

  it("replaces the full set on subsequent calls", () => {
    const task = createTask(db, { title: "x" });
    setTaskTags(db, task.id, ["UI", "Core"]);
    setTaskTags(db, task.id, ["UI", "Backend"]);
    expect(listTaskTagNames(db, task.id)).toEqual(["Backend", "UI"]);
  });

  it("accepts NAME=COLOR specs and stores the color on the tag", () => {
    const task = createTask(db, { title: "x" });
    setTaskTags(db, task.id, ["UI=red", "Backend=#00ff00"]);
    const tags = listTags(db);
    const ui = tags.find((t) => t.name === "UI")!;
    const be = tags.find((t) => t.name === "Backend")!;
    expect(ui.color).toBe("red");
    expect(be.color).toBe("#00ff00");
  });

  it("rejects malformed specs without partial assignment", () => {
    const task = createTask(db, { title: "x" });
    expect(() => setTaskTags(db, task.id, ["valid", "not a name"])).toThrow(TagValidationError);
    // The transactional wrapping in setTaskTags means nothing was attached.
    expect(listTaskTagNames(db, task.id)).toEqual([]);
  });
});

describe("addTagToTask / removeTagFromTask", () => {
  it("adds idempotently", () => {
    const task = createTask(db, { title: "x" });
    addTagToTask(db, task.id, "UI");
    addTagToTask(db, task.id, "UI");
    expect(listTaskTagNames(db, task.id)).toEqual(["UI"]);
  });

  it("removes by name and reports whether anything was removed", () => {
    const task = createTask(db, { title: "x" });
    addTagToTask(db, task.id, "UI");
    expect(removeTagFromTask(db, task.id, "UI")).toBe(true);
    expect(removeTagFromTask(db, task.id, "UI")).toBe(false);
    expect(listTaskTagNames(db, task.id)).toEqual([]);
  });

  it("removeTagFromTask leaves the global tag intact", () => {
    const task = createTask(db, { title: "x" });
    addTagToTask(db, task.id, "UI");
    removeTagFromTask(db, task.id, "UI");
    expect(listTags(db).some((t) => t.name === "UI")).toBe(true);
  });
});

describe("listTaskTagsByTaskIds", () => {
  it("returns a per-task map of sorted names", () => {
    const a = createTask(db, { title: "a", tags: ["UI", "Core"] });
    const b = createTask(db, { title: "b", tags: ["UI", "Backend"] });
    const map = listTaskTagsByTaskIds(db, [a.id, b.id]);
    expect(map[a.id]).toEqual(["Core", "UI"]);
    expect(map[b.id]).toEqual(["Backend", "UI"]);
  });

  it("returns an empty object when given no ids", () => {
    expect(listTaskTagsByTaskIds(db, [])).toEqual({});
  });
});

describe("createTask + tags", () => {
  it("attaches tags from NewTask.tags", () => {
    const task = createTask(db, { title: "x", tags: ["UI", "Backend=#ff0000"] });
    expect(task.tags).toEqual(["Backend", "UI"]);
    expect(listTags(db).find((t) => t.name === "Backend")?.color).toBe("#ff0000");
  });
});

describe("updateTask + tags", () => {
  it("replaces tags when update.tags is provided", () => {
    const task = createTask(db, { title: "x", tags: ["UI"] });
    const updated = updateTask(db, task.id, { tags: ["Core"] });
    expect(updated?.tags).toEqual(["Core"]);
  });

  it("clears tags when update.tags = []", () => {
    const task = createTask(db, { title: "x", tags: ["UI"] });
    const updated = updateTask(db, task.id, { tags: [] });
    expect(updated?.tags).toEqual([]);
  });

  it("leaves tags alone when update.tags is undefined", () => {
    const task = createTask(db, { title: "x", tags: ["UI"] });
    const updated = updateTask(db, task.id, { title: "renamed" });
    expect(updated?.tags).toEqual(["UI"]);
    expect(updated?.title).toBe("renamed");
  });
});

describe("listTasks tag filters", () => {
  it("AND filter returns tasks that have all of the given tags", () => {
    createTask(db, { title: "a", tags: ["UI"] });
    createTask(db, { title: "b", tags: ["UI", "Core"] });
    createTask(db, { title: "c", tags: ["Core"] });
    const result = listTasks(db, { tags: ["UI", "Core"] });
    expect(result.map((t) => t.title)).toEqual(["b"]);
  });

  it("OR filter returns tasks that have any of the given tags", () => {
    createTask(db, { title: "a", tags: ["UI"] });
    createTask(db, { title: "b", tags: ["Core"] });
    createTask(db, { title: "c", tags: ["Backend"] });
    const result = listTasks(db, { anyTags: ["UI", "Core"] });
    expect(result.map((t) => t.title).sort()).toEqual(["a", "b"]);
  });

  it("populates tags on returned tasks even without a filter", () => {
    createTask(db, { title: "a", tags: ["UI", "Core"] });
    const [a] = listTasks(db);
    expect(a!.tags).toEqual(["Core", "UI"]);
  });
});

describe("listTagsWithCounts", () => {
  it("reports zero usages for orphaned tags and joins counts otherwise", () => {
    getOrCreateTag(db, { name: "Lonely" });
    const a = createTask(db, { title: "a", tags: ["UI"] });
    createTask(db, { title: "b", tags: ["UI", "Core"] });
    void a;
    const withCounts = listTagsWithCounts(db);
    const byName = Object.fromEntries(withCounts.map((t) => [t.name, t.usageCount]));
    expect(byName).toEqual({ Lonely: 0, UI: 2, Core: 1 });
  });
});

describe("deleteTag", () => {
  it("removes the tag globally and cascades task_tags rows", () => {
    const t = createTask(db, { title: "x", tags: ["UI"] });
    expect(deleteTag(db, "UI")).toBe(true);
    expect(listTags(db).some((tag) => tag.name === "UI")).toBe(false);
    // task_tags is cascaded by the FK
    const refreshed = getTask(db, t.id);
    expect(refreshed?.tags).toEqual([]);
  });

  it("returns false for an unknown tag", () => {
    expect(deleteTag(db, "Nope")).toBe(false);
  });
});

describe("renameTag", () => {
  it("renames in place, preserves id and color, and updates task_tags lookups", () => {
    const t = createTask(db, { title: "x", tags: ["UI=red"] });
    const before = listTags(db).find((tag) => tag.name === "UI")!;
    const renamed = renameTag(db, "UI", "Frontend");
    expect(renamed.id).toBe(before.id);
    expect(renamed.color).toBe("red");
    // The task surfaces the new name on the next read.
    expect(getTask(db, t.id)?.tags).toEqual(["Frontend"]);
  });

  it("no-op when old === new", () => {
    getOrCreateTag(db, { name: "UI" });
    const r = renameTag(db, "UI", "UI");
    expect(r.name).toBe("UI");
  });

  it("throws TagNotFoundError when the source doesn't exist", () => {
    expect(() => renameTag(db, "ghost", "renamed")).toThrow(TagNotFoundError);
  });

  it("throws TagConflictError when the destination already exists", () => {
    getOrCreateTag(db, { name: "A" });
    getOrCreateTag(db, { name: "B" });
    expect(() => renameTag(db, "A", "B")).toThrow(TagConflictError);
  });

  it("rejects invalid new names", () => {
    getOrCreateTag(db, { name: "A" });
    expect(() => renameTag(db, "A", "not valid")).toThrow(TagValidationError);
  });
});

describe("setTagColor", () => {
  it("sets a color on an existing tag", () => {
    getOrCreateTag(db, { name: "UI" });
    setTagColor(db, "UI", "red");
    expect(listTags(db).find((t) => t.name === "UI")?.color).toBe("red");
  });

  it("clears the color when passed null", () => {
    getOrCreateTag(db, { name: "UI", color: "red" });
    setTagColor(db, "UI", null);
    expect(listTags(db).find((t) => t.name === "UI")?.color).toBeNull();
  });

  it("throws on a bad color value", () => {
    getOrCreateTag(db, { name: "UI" });
    expect(() => setTagColor(db, "UI", "not-a-color")).toThrow(TagValidationError);
  });

  it("throws TagNotFoundError when the tag doesn't exist", () => {
    expect(() => setTagColor(db, "ghost", "red")).toThrow(TagNotFoundError);
  });
});

describe("pruneOrphanTags", () => {
  it("removes tags with zero references and returns their names sorted", () => {
    getOrCreateTag(db, { name: "Lonely" });
    getOrCreateTag(db, { name: "AlsoLonely" });
    createTask(db, { title: "x", tags: ["Used"] });
    const removed = pruneOrphanTags(db);
    expect(removed).toEqual(["AlsoLonely", "Lonely"]);
    expect(listTags(db).map((t) => t.name)).toEqual(["Used"]);
  });

  it("is a no-op when there are no orphans", () => {
    createTask(db, { title: "x", tags: ["Used"] });
    expect(pruneOrphanTags(db)).toEqual([]);
    expect(listTags(db).map((t) => t.name)).toEqual(["Used"]);
  });

  it("removes a tag left behind after the only task that used it is deleted", () => {
    const t = createTask(db, { title: "x", tags: ["TempTag"] });
    deleteTask(db, t.id);
    // Tag itself sticks around (existing behavior — see "task delete cascade"
    // below); prune is the explicit cleanup.
    expect(listTags(db).map((t) => t.name)).toContain("TempTag");
    expect(pruneOrphanTags(db)).toEqual(["TempTag"]);
    expect(listTags(db).map((t) => t.name)).not.toContain("TempTag");
  });
});

describe("task delete cascade", () => {
  it("removes task_tags rows when the task is deleted", () => {
    const task = createTask(db, { title: "x", tags: ["UI"] });
    deleteTask(db, task.id);
    expect(getTask(db, task.id)).toBeNull();
    // Tag itself sticks around (intentional — orphan tags are harmless).
    expect(listTags(db).some((t) => t.name === "UI")).toBe(true);
    // task_tags row should be gone
    expect(listTaskTagsByTaskIds(db, [task.id])).toEqual({});
  });
});
