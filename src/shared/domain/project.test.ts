import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../db";

import { findProjectRoot, getDbPath, initProject, WRIT_DIR } from "./project";
import { listColumns } from "./columns";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "writ-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("findProjectRoot", () => {
  it("returns the directory containing .writ/writ.db", () => {
    initProject(workdir);
    expect(findProjectRoot(workdir)).toBe(workdir);
  });

  it("walks up from a nested cwd", () => {
    initProject(workdir);
    const nested = join(workdir, "src", "deep", "more");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(workdir);
  });

  it("returns null when no project exists at or above cwd", () => {
    // workdir is fresh; no .writ/ created
    expect(findProjectRoot(workdir)).toBeNull();
  });
});

describe("initProject", () => {
  it("creates .writ/writ.db with default columns", () => {
    const result = initProject(workdir);
    expect(result.alreadyInitialized).toBe(false);
    expect(result.dbPath).toBe(join(workdir, WRIT_DIR, "writ.db"));
    expect(existsSync(result.dbPath)).toBe(true);

    const db = openDatabase(getDbPath(workdir));
    try {
      const cols = listColumns(db).map((c) => c.name);
      expect(cols).toEqual(["Backlog", "Todo", "Doing", "Done", "Archived"]);
    } finally {
      db.close();
    }
  });

  it("is idempotent — re-init preserves existing data and reports alreadyInitialized", () => {
    initProject(workdir);
    const db1 = openDatabase(getDbPath(workdir));
    db1.prepare(`UPDATE columns SET name = 'Renamed' WHERE name = 'Backlog'`).run();
    db1.close();

    const result = initProject(workdir);
    expect(result.alreadyInitialized).toBe(true);

    const db2 = openDatabase(getDbPath(workdir));
    try {
      const cols = listColumns(db2).map((c) => c.name);
      expect(cols).toEqual(["Renamed", "Todo", "Doing", "Done", "Archived"]);
    } finally {
      db2.close();
    }
  });
});
