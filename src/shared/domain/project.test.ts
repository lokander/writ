import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, openDatabase } from "../db";

import {
  findProjectRoot,
  getDbPath,
  getDisplayName,
  getProjectId,
  initProject,
  setDisplayName,
  WRIT_DIR,
} from "./project";
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

describe("project meta helpers", () => {
  it("getProjectId returns the ulid written by migration v4", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(getProjectId(db)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    db.close();
  });

  it("getProjectId is stable across calls (same DB)", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(getProjectId(db)).toBe(getProjectId(db));
    db.close();
  });

  it("getProjectId across two fresh DBs returns different ids", () => {
    const a = openDatabase(":memory:");
    applyMigrations(a);
    const b = openDatabase(":memory:");
    applyMigrations(b);
    expect(getProjectId(a)).not.toBe(getProjectId(b));
    a.close();
    b.close();
  });

  it("getDisplayName returns null on a fresh DB", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(getDisplayName(db)).toBeNull();
    db.close();
  });

  it("setDisplayName then getDisplayName roundtrips", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    setDisplayName(db, "Pet Project");
    expect(getDisplayName(db)).toBe("Pet Project");
    db.close();
  });

  it("setDisplayName trims surrounding whitespace", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    setDisplayName(db, "  spaced out  ");
    expect(getDisplayName(db)).toBe("spaced out");
    db.close();
  });

  it("setDisplayName(null) clears a previously set name", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    setDisplayName(db, "temp");
    setDisplayName(db, null);
    expect(getDisplayName(db)).toBeNull();
    db.close();
  });

  it("setDisplayName rejects an empty / whitespace-only name", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db);
    expect(() => setDisplayName(db, "")).toThrow(/empty/i);
    expect(() => setDisplayName(db, "   ")).toThrow(/empty/i);
    db.close();
  });
});
