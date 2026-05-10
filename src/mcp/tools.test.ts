import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SqliteDb } from "../shared/db";
import { createTask, getTask, updateTask } from "../shared/domain/tasks";
import { makeTestDb } from "../shared/test-utils";

import { buildContext, presentSummary, runMcpUpdate } from "./tools";

let db: SqliteDb;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  db.close();
});

describe("presentSummary", () => {
  it("includes a short_id equal to the last 6 chars of the full id", () => {
    const task = createTask(db, { title: "Buy milk" });
    const summary = presentSummary(task, buildContext(db));
    expect(summary.id).toBe(task.id);
    expect(summary.short_id).toBe(task.id.slice(-6));
    expect(summary.short_id).toHaveLength(6);
  });

  it("preserves both forms so callers can grep by either", () => {
    const task = createTask(db, { title: "Pick up bread" });
    const summary = presentSummary(task, buildContext(db));
    // Same field name as the CLI / UI display lets us round-trip ids between
    // chat and the kanban without anyone re-slicing.
    expect(task.id.endsWith(summary.short_id)).toBe(true);
  });
});

describe("runMcpUpdate", () => {
  it("succeeds when no concurrent writer interferes (unpinned)", () => {
    const task = createTask(db, { title: "v0" });
    const updated = runMcpUpdate(db, task.id, task.version, { title: "v1" }, undefined);
    expect(updated.title).toBe("v1");
    expect(updated.version).toBe(1);
  });

  it("retries once on a detected race when caller did not pin", () => {
    const task = createTask(db, { title: "v0" });
    const initialVersion = task.version;
    // Simulate a concurrent writer: bump the version *after* the MCP layer
    // captured `initialVersion`. The first updateTask call inside
    // runMcpUpdate will pin to the now-stale value, throw StaleReadError,
    // refetch, and try again with the fresh version.
    updateTask(db, task.id, { description: "concurrent change" });
    const updated = runMcpUpdate(db, task.id, initialVersion, { title: "from-mcp" }, undefined);
    expect(updated.title).toBe("from-mcp");
    // Concurrent write bumped to 1; our retry bumps to 2.
    expect(updated.version).toBe(2);
    // The concurrent write's description is preserved alongside the retry's
    // title — no field gets clobbered by the retry path.
    expect(updated.description).toBe("concurrent change");
  });

  it("surfaces a tool error (not a retry) when the caller pinned a stale version", () => {
    const task = createTask(db, { title: "v0" });
    updateTask(db, task.id, { title: "concurrent" });
    let caught: unknown;
    try {
      runMcpUpdate(db, task.id, task.version, { title: "from-mcp" }, /* callerPinned */ 0);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Stale read/);
    expect((caught as Error).message).toMatch(/get_task/);
    // Underlying task should still be at the concurrent state, not from-mcp.
    expect(getTask(db, task.id)?.title).toBe("concurrent");
  });
});
