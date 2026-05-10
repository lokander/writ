import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SqliteDb } from "../shared/db";
import { createTask } from "../shared/domain/tasks";
import { makeTestDb } from "../shared/test-utils";

import { buildContext, presentSummary } from "./tools";

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
