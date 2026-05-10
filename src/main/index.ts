import { app, shell, BrowserWindow, ipcMain } from "electron";
import { homedir } from "os";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";

import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
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
}

function closeCurrentProject(): void {
  currentDb?.close();
  currentDb = null;
  currentProject = null;
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
    return currentProject;
  });
  ipcMain.handle("columns:list", () => (currentDb ? listColumns(currentDb) : []));
  ipcMain.handle("tasks:list", () => (currentDb ? listTasks(currentDb) : []));
  ipcMain.handle("tasks:create", (_event, input: NewTask) => {
    if (!currentDb) throw new Error("No project open");
    return createTask(currentDb, input);
  });
  ipcMain.handle("tasks:update", (_event, id: string, update: TaskUpdate) => {
    if (!currentDb) throw new Error("No project open");
    return updateTask(currentDb, id, update);
  });
  ipcMain.handle("tasks:delete", (_event, id: string) => {
    if (!currentDb) throw new Error("No project open");
    return deleteTask(currentDb, id);
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

app.on("before-quit", closeCurrentProject);
