import { app, shell, BrowserWindow, ipcMain } from "electron";
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
import { createTask, deleteTask, listTasks, updateTask } from "../shared/domain/tasks";
import type { NewTask, ProjectInfo, TaskUpdate } from "../shared/types";

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

function openCurrentProject(): void {
  // Slice 1 of the renderer: resolve from cwd. The packaged `writ` shim will
  // launch with the user's cwd; a richer project picker (writ task 44ZCQS)
  // covers double-click and "no project here" paths later.
  const root = findProjectRoot(process.cwd());
  if (!root) return;
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
  let msg: { root?: unknown };
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (typeof msg.root !== "string") return;
  // Filter by project root so a ping for project A doesn't refresh a window
  // viewing project B. Once we support multiple open projects, this turns
  // into a per-window match.
  if (currentProject?.root !== msg.root) return;
  broadcastProjectChanged();
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
  ipcMain.handle("columns:list", () => (currentDb ? listColumns(currentDb) : []));
  ipcMain.handle("tasks:list", () => (currentDb ? listTasks(currentDb) : []));
  ipcMain.handle("tasks:create", (_event, input: NewTask) => {
    if (!currentDb) throw new Error("No project open");
    const task = createTask(currentDb, input);
    noteSelfWrite();
    return task;
  });
  ipcMain.handle("tasks:update", (_event, id: string, update: TaskUpdate) => {
    if (!currentDb) throw new Error("No project open");
    const updated = updateTask(currentDb, id, update);
    noteSelfWrite();
    return updated;
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

  openCurrentProject();
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
