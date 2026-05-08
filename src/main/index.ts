import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";

import { openDatabase, type SqliteDb } from "../shared/db";
import { listColumns } from "../shared/domain/columns";
import { findProjectRoot, getDbPath } from "../shared/domain/project";
import { createTask, listTasks } from "../shared/domain/tasks";
import type { NewTask, ProjectInfo } from "../shared/types";

let currentDb: SqliteDb | null = null;
let currentProject: ProjectInfo | null = null;

function openCurrentProject(): void {
  // Slice 1 of the renderer: resolve from cwd. The packaged `writ` shim will
  // launch with the user's cwd; a richer project picker (writ task 44ZCQS)
  // covers double-click and "no project here" paths later.
  const root = findProjectRoot(process.cwd());
  if (!root) return;
  const dbPath = getDbPath(root);
  currentDb = openDatabase(dbPath);
  currentProject = { root, dbPath };
}

function closeCurrentProject(): void {
  currentDb?.close();
  currentDb = null;
  currentProject = null;
}

function registerIpcHandlers(): void {
  ipcMain.handle("project:current", () => currentProject);
  ipcMain.handle("columns:list", () => (currentDb ? listColumns(currentDb) : []));
  ipcMain.handle("tasks:list", () => (currentDb ? listTasks(currentDb) : []));
  ipcMain.handle("tasks:create", (_event, input: NewTask) => {
    if (!currentDb) throw new Error("No project open");
    return createTask(currentDb, input);
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
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
