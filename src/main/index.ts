import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";

import { registerIpcHandlers } from "./ipc";
import { startPingServer, stopPingServer } from "./live";
import { bootProject, closeCurrentProject } from "./project";
import { createWindow } from "./window";

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

// Quit-time cleanup runs in `will-quit`, after all windows have actually
// closed. Moving it out of `before-quit` is critical: the renderer's
// close guard can cancel the close, and cleanup that ran in before-quit
// would have already torn down the ping server / DB handle for a session
// the user just chose to keep alive. See design.md "Window close:
// two-phase guard".
app.on("will-quit", () => {
  stopPingServer();
  closeCurrentProject();
});
