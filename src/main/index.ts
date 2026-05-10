import { app, shell, BrowserWindow, dialog, ipcMain } from "electron";
import * as fs from "node:fs";
import * as net from "node:net";
import { homedir } from "os";
import { dirname, join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";

import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
import { getDesktopSocketPath } from "../shared/desktop-ping";
import { listColumns } from "../shared/domain/columns";
import {
  findProjectRoot,
  getDbPath,
  getDisplayName,
  getProjectId,
  setDisplayName,
} from "../shared/domain/project";
import { listTags } from "../shared/domain/tags";
import {
  createTask,
  deleteTask,
  listTasks,
  StaleReadError,
  updateTask,
} from "../shared/domain/tasks";
import type {
  NewTask,
  OpenFolderResult,
  ProjectInfo,
  TaskUpdate,
  UpdateTaskResult,
} from "../shared/types";

let currentDb: SqliteDb | null = null;
let currentProject: ProjectInfo | null = null;
let pingServer: net.Server | null = null;
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

// Schemes we're willing to hand off to the OS via shell.openExternal. http(s)
// covers ordinary URLs; mailto for contact addresses pasted into descriptions.
// Everything else (file:, javascript:, custom protocols, garbage) is denied.
const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    // Malformed URL — refuse.
    return false;
  }
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

function openProjectAt(root: string): void {
  const dbPath = getDbPath(root);
  currentDb = openDatabase(dbPath);
  applyMigrations(currentDb);
  currentProject = buildProjectInfo(root, dbPath, currentDb);
  startDbWatch(root);
}

function closeCurrentProject(): void {
  stopDbWatch();
  currentDb?.close();
  currentDb = null;
  currentProject = null;
}

/** Boot path: resolve a project from cwd, if any. The CLI's bare-`writ`
 *  branch spawns Electron in the user's cwd, so this is the natural seed.
 *  When no project is found the renderer shows its empty state with the
 *  "Open project…" picker. */
function bootProject(): void {
  const root = findProjectRoot(process.cwd());
  if (root) openProjectAt(root);
}

/** Switch the open project (or close it if `newRoot` is null). No-op if the
 *  caller passes the root that's already open. Does NOT broadcast on its own
 *  — callers decide whether to fire `project:changed` so e.g. the openFolder
 *  error path can avoid a race where the renderer's silent refetch clears the
 *  error message we're about to surface. */
function switchProject(newRoot: string | null): void {
  if (currentProject?.root === newRoot) return;
  closeCurrentProject();
  if (newRoot) openProjectAt(newRoot);
}

function focusMainWindow(): void {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return;
  const win = wins[0]!;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function broadcastProjectChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("project:changed");
  }
}

function noteSelfWrite(): void {
  suppressWatchUntil = Date.now() + SELF_WRITE_SUPPRESS_MS;
}

function startPingServer(): void {
  const sockPath = getDesktopSocketPath();
  // Unix socket: ensure parent dir exists and remove any stale file from a
  // previous crashed instance. Windows named pipes have neither concern.
  if (process.platform !== "win32") {
    try {
      fs.mkdirSync(dirname(sockPath), { recursive: true });
    } catch (err) {
      console.error("[writ] failed to create socket dir", err);
    }
    try {
      fs.unlinkSync(sockPath);
    } catch {
      // ENOENT is the happy path; anything else surfaces on listen() below.
    }
  }
  pingServer = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handlePingLine(line);
    });
    sock.on("end", () => {
      if (buf.trim().length > 0) handlePingLine(buf);
    });
    sock.on("error", () => sock.destroy());
  });
  pingServer.on("error", (err) => {
    console.error("[writ] ping server error", err);
  });
  pingServer.listen(sockPath);
}

function handlePingLine(line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let msg: { type?: unknown; root?: unknown };
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  // Two message types share the socket; an absent `type` is treated as
  // "changed" so an in-flight CLI/MCP from an older build still works.
  const type = typeof msg.type === "string" ? msg.type : "changed";

  if (type === "changed") {
    if (typeof msg.root !== "string") return;
    // Filter by project root so a ping for project A doesn't refresh a window
    // viewing project B.
    if (currentProject?.root !== msg.root) return;
    broadcastProjectChanged();
    return;
  }

  if (type === "open") {
    // The CLI resolves `findProjectRoot(cwd)` before sending, so `root` is
    // either an actual project root or null (cwd had no .writ/). Trust it.
    const root = typeof msg.root === "string" ? msg.root : null;
    // Bare `writ` from a writ-less cwd: focus only, don't wipe the user's
    // current project. The file-dialog picker is the explicit-switch path.
    if (root !== null || currentProject === null) {
      switchProject(root);
      broadcastProjectChanged();
    }
    focusMainWindow();
    return;
  }
}

function stopPingServer(): void {
  pingServer?.close();
  pingServer = null;
  if (process.platform !== "win32") {
    try {
      fs.unlinkSync(getDesktopSocketPath());
    } catch {
      // socket may already be gone (clean shutdown closed it)
    }
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

function registerIpcHandlers(): void {
  ipcMain.handle("project:current", () => {
    if (!currentDb || !currentProject) return null;
    // Refresh displayName each call so the renderer's first paint after a
    // CLI-side `writ project rename` reflects the new value without
    // requiring an app restart.
    return buildProjectInfo(currentProject.root, currentProject.dbPath, currentDb);
  });
  ipcMain.handle("project:setDisplayName", (_event, name: string | null) => {
    if (!currentDb || !currentProject) throw new Error("No project open");
    setDisplayName(currentDb, name);
    currentProject = buildProjectInfo(currentProject.root, currentProject.dbPath, currentDb);
    noteSelfWrite();
    return currentProject;
  });
  ipcMain.handle("project:openFolder", async (event): Promise<OpenFolderResult> => {
    // Tie the dialog to the requesting window so it's modal on platforms
    // that support it (macOS sheet, Windows owner). Falls back to standalone
    // if the call somehow comes in without a sender window.
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Open writ project",
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({
          title: "Open writ project",
          properties: ["openDirectory"],
        });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    const chosen = result.filePaths[0]!;
    // Walk up from the chosen path so picking a subdir of a project still
    // works (matches what the CLI does for `writ task add` from a subdir).
    const root = findProjectRoot(chosen);
    if (!root) {
      // Explicit user pick that wasn't a writ project. Drop the current
      // project so the renderer's empty state surfaces the error as the
      // explanation for the switch — gives the user a clean place to either
      // pick a different folder or (future task) init this one. Skip the
      // broadcast: the caller pairs the IPC return with its own silent
      // loadAll + error set, so the message survives without a parallel
      // refetch racing to clear it.
      closeCurrentProject();
      return {
        error: `No writ project found at ${chosen}. Run \`writ init\` there first.`,
      };
    }
    switchProject(root);
    broadcastProjectChanged();
    if (!currentProject) {
      // switchProject failed silently — surface a generic error rather than
      // pretending the open succeeded.
      return { error: "Failed to open the selected project." };
    }
    return { project: currentProject };
  });
  ipcMain.handle("columns:list", () => (currentDb ? listColumns(currentDb) : []));
  ipcMain.handle("tasks:list", () => (currentDb ? listTasks(currentDb) : []));
  ipcMain.handle("tasks:create", (_event, input: NewTask) => {
    if (!currentDb) throw new Error("No project open");
    const task = createTask(currentDb, input);
    noteSelfWrite();
    return task;
  });
  ipcMain.handle("tasks:update", (_event, id: string, update: TaskUpdate): UpdateTaskResult => {
    if (!currentDb) throw new Error("No project open");
    try {
      const task = updateTask(currentDb, id, update);
      noteSelfWrite();
      return { task };
    } catch (e) {
      if (e instanceof StaleReadError) {
        // Don't note a self-write — nothing landed. The renderer's modal
        // gets a structured envelope it can diff against; other writers
        // bumped the row, so an fs.watch refresh will follow naturally.
        return { task: null, conflict: { error: "stale-read", current: e.currentTask } };
      }
      throw e;
    }
  });
  ipcMain.handle("tasks:delete", (_event, id: string) => {
    if (!currentDb) throw new Error("No project open");
    const ok = deleteTask(currentDb, id);
    noteSelfWrite();
    return ok;
  });
  ipcMain.handle("tags:list", () => (currentDb ? listTags(currentDb) : []));
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  // External-link handling. markdown-it's link_open override (lib/markdown.ts)
  // adds target="_blank" rel=noopener to every rendered <a>, so clicks fire
  // window.open semantics and land here. We hand off to the OS browser and
  // deny the in-renderer new window.
  //
  // will-navigate is the belt-and-suspenders for anything that somehow
  // bypasses target=_blank (a future bug, an injected link, etc.) — it
  // catches plain navigation attempts that wouldn't trigger the open-handler.
  //
  // Both gates limit themselves to a small allow-list of schemes. javascript:
  // and data: are already filtered by markdown-it's default validateLink, but
  // any other source of links should still be safe.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    // The renderer never navigates internally (single-page app), so any
    // navigation attempt is an external link click. Block it and route to
    // the OS browser if the scheme is allowed.
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.writ.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  bootProject();
  registerIpcHandlers();
  startPingServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopPingServer();
  closeCurrentProject();
});
