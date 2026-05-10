import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BrowserWindow } from "electron";

import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
import { findProjectRoot, getDbPath, getDisplayName, getProjectId } from "../shared/domain/project";
import type { ProjectInfo } from "../shared/types";

// Single-open: one project, one db handle, one file watcher. Module-level
// state so IPC handlers and the ping socket can both reach it without an
// explicit context object.
let currentDb: SqliteDb | null = null;
let currentProject: ProjectInfo | null = null;
let dbWatcher: fs.FSWatcher | null = null;
let watchDebounce: NodeJS.Timeout | null = null;
// Bumped to "now + grace" each time the renderer's IPC handlers commit a
// write, so the fs.watch event our own write trips doesn't re-broadcast and
// cause the renderer to refetch on top of its own optimistic update. Pings
// from CLI / MCP processes are unaffected — those come over the socket, not
// the watcher.
let suppressWatchUntil = 0;
const SELF_WRITE_SUPPRESS_MS = 250;
const WATCH_DEBOUNCE_MS = 150;

export function getCurrentDb(): SqliteDb | null {
  return currentDb;
}

export function getCurrentProject(): ProjectInfo | null {
  return currentProject;
}

/** Replace a leading $HOME with `~` for nicer display. Falls back to the
 *  raw path when home isn't available or the path lives elsewhere. */
function prettifyRoot(root: string): string {
  const home = homedir();
  if (!home) return root;
  if (root === home) return "~";
  if (root.startsWith(home + "/") || root.startsWith(home + "\\")) {
    return "~" + root.slice(home.length);
  }
  return root;
}

function buildProjectInfo(root: string, dbPath: string, db: SqliteDb): ProjectInfo {
  return {
    root,
    prettyRoot: prettifyRoot(root),
    dbPath,
    projectId: getProjectId(db),
    displayName: getDisplayName(db),
  };
}

/** Rebuild the cached ProjectInfo from the live db and store it. Used after
 *  writes that may have changed display name, and by the `project:current`
 *  handler so a CLI-side `writ project rename` is visible without restart. */
export function refreshCurrentProject(): ProjectInfo | null {
  if (!currentDb || !currentProject) return null;
  currentProject = buildProjectInfo(currentProject.root, currentProject.dbPath, currentDb);
  return currentProject;
}

export function openProjectAt(root: string): void {
  const dbPath = getDbPath(root);
  currentDb = openDatabase(dbPath);
  applyMigrations(currentDb);
  currentProject = buildProjectInfo(root, dbPath, currentDb);
  startDbWatch(root);
}

export function closeCurrentProject(): void {
  stopDbWatch();
  currentDb?.close();
  currentDb = null;
  currentProject = null;
}

/** Boot path: resolve a project from cwd, if any. The CLI's bare-`writ`
 *  branch spawns Electron in the user's cwd, so this is the natural seed.
 *  When no project is found the renderer shows its empty state with the
 *  "Open project…" picker. */
export function bootProject(): void {
  const root = findProjectRoot(process.cwd());
  if (root) openProjectAt(root);
}

/** Switch the open project (or close it if `newRoot` is null). No-op if the
 *  caller passes the root that's already open. Does NOT broadcast on its own
 *  — callers decide whether to fire `project:changed` so e.g. the openFolder
 *  error path can avoid a race where the renderer's silent refetch clears
 *  the error message we're about to surface. */
export function switchProject(newRoot: string | null): void {
  if (currentProject?.root === newRoot) return;
  closeCurrentProject();
  if (newRoot) openProjectAt(newRoot);
}

export function noteSelfWrite(): void {
  suppressWatchUntil = Date.now() + SELF_WRITE_SUPPRESS_MS;
}

export function broadcastProjectChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("project:changed");
  }
}

function startDbWatch(root: string): void {
  const writDir = join(root, ".writ");
  try {
    dbWatcher = fs.watch(writDir, (_event, filename) => {
      if (!filename) return;
      // SQLite in WAL mode commits land in writ.db-wal; full checkpoints touch
      // writ.db. writ.db-shm is shared-memory metadata that flutters with
      // every transaction — ignore it to avoid spurious refreshes.
      if (filename !== "writ.db" && filename !== "writ.db-wal") return;
      if (Date.now() < suppressWatchUntil) return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        watchDebounce = null;
        broadcastProjectChanged();
      }, WATCH_DEBOUNCE_MS);
    });
    dbWatcher.on("error", (err) => {
      console.error("[writ] db watcher error", err);
    });
  } catch (err) {
    console.error("[writ] failed to start db watcher", err);
  }
}

function stopDbWatch(): void {
  dbWatcher?.close();
  dbWatcher = null;
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
}
