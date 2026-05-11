import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
import { ulid } from "ulid";
import { createTask, getTask, updateTask } from "../shared/domain/tasks";
import { makeTestDb } from "../shared/test-utils";

import { buildContext, presentSummary, registerTools, runMcpUpdate } from "./tools";

// Minimal McpServer stand-in: `registerTools` only ever calls `registerTool`,
// so we capture each (name, handler) pair and let the test invoke them
// directly. Avoids spinning up the real MCP SDK / stdio plumbing.
type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

interface ToolResultText {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function captureHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  // Cast to the McpServer shape registerTools expects — the runtime only
  // touches `registerTool`, so a partial mock is safe here.
  const stub = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler): void => {
      handlers.set(name, handler);
    },
  } as unknown as Parameters<typeof registerTools>[0];
  registerTools(stub);
  return handlers;
}

function parseResult<T>(result: ToolResultText): T {
  expect(result.isError, result.content[0]?.text ?? "no content").not.toBe(true);
  return JSON.parse(result.content[0]!.text) as T;
}

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

describe("list_tasks priority filter", () => {
  // The MCP handler resolves the project via findProjectRoot(process.cwd()),
  // so we need a real .writ/writ.db on disk in a tmpdir we chdir into. This
  // is heavier than the in-memory makeTestDb path used above, but it
  // exercises the registered tool handler end-to-end — which is the point of
  // a wiring-level integration test.
  let projectDir: string;
  let originalCwd: string;
  let handlers: Map<string, ToolHandler>;

  function seedColumns(seedDb: SqliteDb): void {
    const insert = seedDb.prepare(`INSERT INTO columns (id, name, position) VALUES (?, ?, ?)`);
    seedDb.transaction(() => {
      ["Backlog", "Todo", "Doing", "Done", "Archived"].forEach((name, i) =>
        insert.run(ulid(), name, (i + 1) * 1000),
      );
    })();
  }

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "writ-mcp-"));
    mkdirSync(join(projectDir, ".writ"));
    const setupDb = openDatabase(join(projectDir, ".writ", "writ.db"));
    applyMigrations(setupDb);
    seedColumns(setupDb);
    // Seed tasks at varied priorities so we can verify OR filtering across
    // the priority array.
    createTask(setupDb, { title: "urgent-task", priority: 0 });
    createTask(setupDb, { title: "high-task", priority: 1 });
    createTask(setupDb, { title: "normal-task", priority: 2 });
    createTask(setupDb, { title: "low-task", priority: 3 });
    setupDb.close();

    originalCwd = process.cwd();
    process.chdir(projectDir);
    handlers = captureHandlers();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("filters to a single priority by name", async () => {
    const result = await handlers.get("list_tasks")!({ priority: ["urgent"] });
    const parsed = parseResult<{ count: number; tasks: { title: string }[] }>(result);
    expect(parsed.tasks.map((t) => t.title)).toEqual(["urgent-task"]);
  });

  it("ORs across multiple priorities including the single-letter aliases", async () => {
    const result = await handlers.get("list_tasks")!({ priority: ["u", "h"] });
    const parsed = parseResult<{ tasks: { title: string }[] }>(result);
    expect(parsed.tasks.map((t) => t.title).sort()).toEqual(["high-task", "urgent-task"]);
  });

  it("empty / omitted priority is a no-op (returns everything in scope)", async () => {
    const omitted = parseResult<{ count: number }>(await handlers.get("list_tasks")!({}));
    const empty = parseResult<{ count: number }>(
      await handlers.get("list_tasks")!({ priority: [] }),
    );
    expect(empty.count).toBe(omitted.count);
    expect(omitted.count).toBe(4);
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
