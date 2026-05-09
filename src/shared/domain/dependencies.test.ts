import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SqliteDb } from "../db";
import { makeTestDb } from "../test-utils";

import { getColumnByName } from "./columns";
import {
  addDependency,
  DependencyCycleError,
  listDependenciesByTaskIds,
  listDependencyIds,
  listDependentIds,
  removeDependency,
  SelfDependencyError,
  setDependencies,
  wouldCreateCycle,
} from "./dependencies";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "./tasks";

let db: SqliteDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  db.close();
});

describe("addDependency", () => {
  it("creates an edge", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    addDependency(db, a.id, b.id);
    expect(listDependencyIds(db, a.id)).toEqual([b.id]);
    expect(listDependentIds(db, b.id)).toEqual([a.id]);
  });

  it("is idempotent", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    addDependency(db, a.id, b.id);
    addDependency(db, a.id, b.id);
    expect(listDependencyIds(db, a.id)).toEqual([b.id]);
  });

  it("rejects self-dependency", () => {
    const a = createTask(db, { title: "a" });
    expect(() => addDependency(db, a.id, a.id)).toThrow(SelfDependencyError);
  });

  it("rejects direct cycles (A→B then B→A)", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    addDependency(db, a.id, b.id);
    expect(() => addDependency(db, b.id, a.id)).toThrow(DependencyCycleError);
  });

  it("rejects transitive cycles (A→B→C, then C→A)", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    addDependency(db, a.id, b.id);
    addDependency(db, b.id, c.id);
    expect(() => addDependency(db, c.id, a.id)).toThrow(DependencyCycleError);
  });
});

describe("wouldCreateCycle", () => {
  it("returns true for self", () => {
    const a = createTask(db, { title: "a" });
    expect(wouldCreateCycle(db, a.id, a.id)).toBe(true);
  });

  it("returns true through transitive chains", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    addDependency(db, a.id, b.id);
    addDependency(db, b.id, c.id);
    expect(wouldCreateCycle(db, c.id, a.id)).toBe(true);
  });

  it("returns false for unrelated tasks", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    expect(wouldCreateCycle(db, a.id, b.id)).toBe(false);
  });
});

describe("removeDependency", () => {
  it("removes the edge and reports whether it existed", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    addDependency(db, a.id, b.id);
    expect(removeDependency(db, a.id, b.id)).toBe(true);
    expect(removeDependency(db, a.id, b.id)).toBe(false);
    expect(listDependencyIds(db, a.id)).toEqual([]);
  });
});

describe("setDependencies", () => {
  it("replaces the full set", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    setDependencies(db, a.id, [b.id, c.id]);
    setDependencies(db, a.id, [c.id]);
    expect(listDependencyIds(db, a.id)).toEqual([c.id]);
  });

  it("clears all deps when given an empty array", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    addDependency(db, a.id, b.id);
    setDependencies(db, a.id, []);
    expect(listDependencyIds(db, a.id)).toEqual([]);
  });

  it("rolls back when a cycle would be introduced mid-set", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    addDependency(db, b.id, a.id); // b depends on a, so a→b would cycle
    expect(() => setDependencies(db, a.id, [c.id, b.id])).toThrow(DependencyCycleError);
    // Pre-existing edge still in place; no partial state
    expect(listDependencyIds(db, a.id)).toEqual([]);
    expect(listDependentIds(db, a.id)).toEqual([b.id]);
  });
});

describe("listDependenciesByTaskIds (bulk)", () => {
  it("returns a per-task map", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    addDependency(db, a.id, b.id);
    addDependency(db, a.id, c.id);
    addDependency(db, b.id, c.id);
    const map = listDependenciesByTaskIds(db, [a.id, b.id, c.id]);
    expect(map[a.id]?.sort()).toEqual([b.id, c.id].sort());
    expect(map[b.id]).toEqual([c.id]);
    expect(map[c.id]).toBeUndefined();
  });

  it("returns an empty object for an empty input", () => {
    expect(listDependenciesByTaskIds(db, [])).toEqual({});
  });
});

describe("Task hydration (dependsOn / blockedBy / isReady)", () => {
  it("createTask attaches dependsOn from NewTask", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b", dependsOn: [a.id] });
    expect(b.dependsOn).toEqual([a.id]);
    expect(b.blockedBy).toEqual([a.id]);
    expect(b.isReady).toBe(false);
  });

  it("isReady is true when all blockers are in Done", () => {
    const done = getColumnByName(db, "Done")!;
    const a = createTask(db, { title: "a", columnId: done.id });
    const b = createTask(db, { title: "b", dependsOn: [a.id] });
    expect(b.isReady).toBe(true);
    expect(b.blockedBy).toEqual([]);
  });

  it("isReady is false when any blocker is not in Done", () => {
    const done = getColumnByName(db, "Done")!;
    const doing = getColumnByName(db, "Doing")!;
    const a = createTask(db, { title: "a", columnId: done.id });
    const b = createTask(db, { title: "b", columnId: doing.id });
    const c = createTask(db, { title: "c", dependsOn: [a.id, b.id] });
    expect(c.dependsOn.sort()).toEqual([a.id, b.id].sort());
    expect(c.blockedBy).toEqual([b.id]);
    expect(c.isReady).toBe(false);
  });

  it("isReady is true for tasks with no dependencies", () => {
    const a = createTask(db, { title: "a" });
    expect(a.isReady).toBe(true);
  });

  it("listTasks populates dependsOn / blockedBy / isReady on every row", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b", dependsOn: [a.id] });
    const tasks = listTasks(db);
    const aRow = tasks.find((t) => t.id === a.id)!;
    const bRow = tasks.find((t) => t.id === b.id)!;
    expect(aRow.dependsOn).toEqual([]);
    expect(aRow.isReady).toBe(true);
    expect(bRow.dependsOn).toEqual([a.id]);
    expect(bRow.isReady).toBe(false);
  });
});

describe("listTasks ready/blocked filters", () => {
  it("ready: returns tasks whose blockers are all in Done (or who have none)", () => {
    const done = getColumnByName(db, "Done")!;
    const blocker = createTask(db, { title: "blocker", columnId: done.id });
    createTask(db, { title: "ready", dependsOn: [blocker.id] });
    const standalone = createTask(db, { title: "standalone" });
    createTask(db, { title: "blocked", dependsOn: [standalone.id] });
    const result = listTasks(db, { ready: true });
    const titles = result.map((t) => t.title).sort();
    expect(titles).toContain("ready");
    expect(titles).toContain("standalone");
    // `blocker` is in Done; it's ready (no deps of its own).
    expect(titles).toContain("blocker");
    // `blocked` waits on `standalone` which isn't Done.
    expect(titles).not.toContain("blocked");
  });

  it("blocked: returns only tasks with at least one open blocker", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b", dependsOn: [a.id] });
    const result = listTasks(db, { blocked: true });
    expect(result.map((t) => t.id)).toEqual([b.id]);
  });
});

describe("updateTask + dependsOn", () => {
  it("replaces the dep set when dependsOn is provided", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c", dependsOn: [a.id] });
    const updated = updateTask(db, c.id, { dependsOn: [b.id] });
    expect(updated?.dependsOn).toEqual([b.id]);
  });

  it("clears all when dependsOn is []", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b", dependsOn: [a.id] });
    const updated = updateTask(db, b.id, { dependsOn: [] });
    expect(updated?.dependsOn).toEqual([]);
  });

  it("leaves deps alone when dependsOn is undefined", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b", dependsOn: [a.id] });
    const updated = updateTask(db, b.id, { title: "renamed" });
    expect(updated?.dependsOn).toEqual([a.id]);
    expect(updated?.title).toBe("renamed");
  });
});

describe("cascade on task delete", () => {
  it("removes incoming and outgoing edges", () => {
    const a = createTask(db, { title: "a" });
    const b = createTask(db, { title: "b" });
    const c = createTask(db, { title: "c" });
    addDependency(db, a.id, b.id);
    addDependency(db, c.id, b.id);
    deleteTask(db, b.id);
    expect(getTask(db, b.id)).toBeNull();
    expect(listDependencyIds(db, a.id)).toEqual([]);
    expect(listDependencyIds(db, c.id)).toEqual([]);
  });
});
