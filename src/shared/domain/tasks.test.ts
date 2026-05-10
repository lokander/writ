import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SqliteDb } from "../db";
import { makeTestDb } from "../test-utils";

import { getColumnByName, listColumns } from "./columns";
import {
  AmbiguousTaskError,
  StaleReadError,
  TaskNotFoundError,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  resolveTaskId,
  updateTask,
} from "./tasks";

let db: SqliteDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  db.close();
});

describe("createTask", () => {
  it("defaults to the first column at normal priority", () => {
    const task = createTask(db, { title: "Test" });
    const backlog = getColumnByName(db, "Backlog")!;
    expect(task.title).toBe("Test");
    expect(task.columnId).toBe(backlog.id);
    expect(task.priority).toBe(2);
    expect(task.parentId).toBeNull();
    expect(task.description).toBe("");
  });

  it("places successive tasks at the bottom of the column", () => {
    const a = createTask(db, { title: "A" });
    const b = createTask(db, { title: "B" });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it("can target a specific column and priority", () => {
    const doing = getColumnByName(db, "Doing")!;
    const task = createTask(db, { title: "Active", columnId: doing.id, priority: 0 });
    expect(task.columnId).toBe(doing.id);
    expect(task.priority).toBe(0);
  });
});

describe("listTasks", () => {
  it("returns all tasks when no filter", () => {
    createTask(db, { title: "A" });
    createTask(db, { title: "B" });
    expect(listTasks(db)).toHaveLength(2);
  });

  it("filters by column", () => {
    const todo = getColumnByName(db, "Todo")!;
    createTask(db, { title: "Backlog item" });
    createTask(db, { title: "Todo item", columnId: todo.id });
    const result = listTasks(db, { columnId: todo.id });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Todo item");
  });

  it("filters to top-level tasks when parentId is null", () => {
    const parent = createTask(db, { title: "Parent" });
    createTask(db, { title: "Child", parentId: parent.id });
    const tops = listTasks(db, { parentId: null });
    expect(tops).toHaveLength(1);
    expect(tops[0]!.title).toBe("Parent");
  });

  it("filters to children of a specific parent", () => {
    const parent = createTask(db, { title: "Parent" });
    createTask(db, { title: "Child A", parentId: parent.id });
    createTask(db, { title: "Child B", parentId: parent.id });
    const children = listTasks(db, { parentId: parent.id });
    expect(children).toHaveLength(2);
  });
});

describe("updateTask", () => {
  it("applies only provided fields, leaves others intact", () => {
    const task = createTask(db, { title: "Original", description: "body", priority: 2 });
    const updated = updateTask(db, task.id, { title: "Renamed" });
    expect(updated?.title).toBe("Renamed");
    expect(updated?.description).toBe("body");
    expect(updated?.priority).toBe(2);
  });

  it("returns null for an unknown id", () => {
    expect(updateTask(db, "01ABCDEFGHIJKLMNOPQRSTUVWX", { title: "X" })).toBeNull();
  });
});

describe("task version", () => {
  it("starts at 0 on createTask", () => {
    const task = createTask(db, { title: "v0" });
    expect(task.version).toBe(0);
  });

  it("increments on a field update", () => {
    const task = createTask(db, { title: "before" });
    const updated = updateTask(db, task.id, { title: "after" });
    expect(updated?.version).toBe(1);
  });

  it("increments on a tag-only update", () => {
    const task = createTask(db, { title: "tagged" });
    const updated = updateTask(db, task.id, { tags: ["alpha"] });
    expect(updated?.version).toBe(1);
  });

  it("increments on a dependency-only update", () => {
    const blocker = createTask(db, { title: "blocker" });
    const task = createTask(db, { title: "blocked" });
    const updated = updateTask(db, task.id, { dependsOn: [blocker.id] });
    expect(updated?.version).toBe(1);
  });

  it("increments on moveTask", () => {
    const doing = getColumnByName(db, "Doing")!;
    const task = createTask(db, { title: "moving" });
    const moved = moveTask(db, task.id, doing.id);
    expect(moved?.version).toBe(1);
  });

  it("does not increment on a no-op update (no fields/tags/deps provided)", () => {
    const task = createTask(db, { title: "untouched" });
    const updated = updateTask(db, task.id, {});
    expect(updated?.version).toBe(0);
    expect(updated?.updatedAt).toBe(task.updatedAt);
  });

  it("bumps updatedAt on a tag-only update", async () => {
    const task = createTask(db, { title: "tagged" });
    await new Promise((r) => setTimeout(r, 2));
    const updated = updateTask(db, task.id, { tags: ["alpha"] });
    expect(updated!.updatedAt).toBeGreaterThan(task.updatedAt);
  });

  it("bumps updatedAt on a dependency-only update", async () => {
    const blocker = createTask(db, { title: "blocker" });
    const task = createTask(db, { title: "blocked" });
    await new Promise((r) => setTimeout(r, 2));
    const updated = updateTask(db, task.id, { dependsOn: [blocker.id] });
    expect(updated!.updatedAt).toBeGreaterThan(task.updatedAt);
  });

  it("bumps once per call even when fields, tags, and deps all change", () => {
    const blocker = createTask(db, { title: "blocker" });
    const task = createTask(db, { title: "combo" });
    const updated = updateTask(db, task.id, {
      title: "renamed",
      tags: ["x"],
      dependsOn: [blocker.id],
    });
    expect(updated?.version).toBe(1);
  });
});

describe("updateTask + expectedVersion", () => {
  it("succeeds when expectedVersion matches the current version", () => {
    const task = createTask(db, { title: "v0" });
    const updated = updateTask(db, task.id, { title: "v1", expectedVersion: 0 });
    expect(updated?.title).toBe("v1");
    expect(updated?.version).toBe(1);
  });

  it("throws StaleReadError when expectedVersion is behind", () => {
    const task = createTask(db, { title: "v0" });
    updateTask(db, task.id, { title: "v1" });
    let caught: unknown;
    try {
      updateTask(db, task.id, { title: "v2-stale", expectedVersion: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StaleReadError);
    const current = (caught as StaleReadError).currentTask;
    expect(current.title).toBe("v1");
    expect(current.version).toBe(1);
  });

  it("rolls the txn back on stale read — no partial writes land", () => {
    const blocker = createTask(db, { title: "blocker" });
    const task = createTask(db, { title: "before" });
    updateTask(db, task.id, { title: "concurrent" });
    expect(() =>
      updateTask(db, task.id, {
        title: "after",
        tags: ["never"],
        dependsOn: [blocker.id],
        expectedVersion: 0,
      }),
    ).toThrow(StaleReadError);
    const fresh = getTask(db, task.id)!;
    expect(fresh.title).toBe("concurrent");
    expect(fresh.tags).toEqual([]);
    expect(fresh.dependsOn).toEqual([]);
    // Only the one concurrent write bumped the version, not the failed one.
    expect(fresh.version).toBe(1);
  });

  it("does not throw when expectedVersion is omitted (last-writer-wins)", () => {
    const task = createTask(db, { title: "v0" });
    updateTask(db, task.id, { title: "v1" });
    const overwritten = updateTask(db, task.id, { title: "v2" });
    expect(overwritten?.title).toBe("v2");
    expect(overwritten?.version).toBe(2);
  });

  it("surfaces staleness on a no-op update when caller pinned a stale version", () => {
    const task = createTask(db, { title: "v0" });
    updateTask(db, task.id, { title: "v1" });
    expect(() => updateTask(db, task.id, { expectedVersion: 0 })).toThrow(StaleReadError);
  });

  it("treats matching expectedVersion on a no-op as a successful no-op", () => {
    const task = createTask(db, { title: "v0" });
    const result = updateTask(db, task.id, { expectedVersion: 0 });
    expect(result?.version).toBe(0);
    expect(result?.title).toBe("v0");
  });
});

describe("moveTask", () => {
  it("changes column and appends to bottom of target column", () => {
    const doing = getColumnByName(db, "Doing")!;
    const existing = createTask(db, { title: "Existing in doing", columnId: doing.id });
    const task = createTask(db, { title: "From backlog" });
    const moved = moveTask(db, task.id, doing.id);
    expect(moved?.columnId).toBe(doing.id);
    expect(moved!.position).toBeGreaterThan(existing.position);
  });
});

describe("deleteTask", () => {
  it("cascades to subtasks via FK", () => {
    const parent = createTask(db, { title: "Parent" });
    const child = createTask(db, { title: "Child", parentId: parent.id });
    deleteTask(db, parent.id);
    expect(getTask(db, parent.id)).toBeNull();
    expect(getTask(db, child.id)).toBeNull();
  });

  it("returns false when the id doesn't exist", () => {
    expect(deleteTask(db, "01ABCDEFGHIJKLMNOPQRSTUVWX")).toBe(false);
  });
});

describe("resolveTaskId", () => {
  it("matches the full ulid", () => {
    const task = createTask(db, { title: "Find me" });
    expect(resolveTaskId(db, task.id).id).toBe(task.id);
  });

  it("matches a unique suffix (case-insensitive)", () => {
    const task = createTask(db, { title: "Find me" });
    const suffix = task.id.slice(-6);
    expect(resolveTaskId(db, suffix).id).toBe(task.id);
    expect(resolveTaskId(db, suffix.toLowerCase()).id).toBe(task.id);
  });

  it("throws TaskNotFoundError when nothing matches", () => {
    createTask(db, { title: "Sole task" });
    expect(() => resolveTaskId(db, "ZZZZZZ")).toThrow(TaskNotFoundError);
  });

  it("throws AmbiguousTaskError when multiple ids share the suffix", () => {
    // Force two tasks with the same suffix by inserting raw rows.
    const cols = listColumns(db);
    const colId = cols[0]!.id;
    const a = `01TESTPREFIXAAAAAAAAAYYZZZZ`;
    const b = `01TESTPREFIXBBBBBBBBBYYZZZZ`;
    const insert = db.prepare(
      `INSERT INTO tasks (id, parent_id, column_id, title, description, priority, position, created_at, updated_at)
       VALUES (?, NULL, ?, ?, '', 2, ?, ?, ?)`,
    );
    const now = Date.now();
    insert.run(a, colId, "A", 1000, now, now);
    insert.run(b, colId, "B", 2000, now, now);

    let caught: unknown;
    try {
      resolveTaskId(db, "YYZZZZ");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AmbiguousTaskError);
    expect((caught as AmbiguousTaskError).matches).toHaveLength(2);
  });

  it("rejects empty input as not found rather than matching everything", () => {
    createTask(db, { title: "X" });
    expect(() => resolveTaskId(db, "")).toThrow(TaskNotFoundError);
  });
});
