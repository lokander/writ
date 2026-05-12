import { BrowserWindow, dialog, ipcMain } from "electron";

import { listColumns } from "../shared/domain/columns";
import { findProjectRoot, setDisplayName } from "../shared/domain/project";
import { listTags } from "../shared/domain/tags";
import {
  createTask,
  deleteTask,
  listTasks,
  StaleReadError,
  updateTask,
} from "../shared/domain/tasks";
import type { NewTask, OpenFolderResult, TaskUpdate, UpdateTaskResult } from "../shared/types";

import {
  broadcastProjectChanged,
  closeCurrentProject,
  getCurrentDb,
  getCurrentProject,
  noteSelfWrite,
  refreshCurrentProject,
  switchProject,
} from "./project";
import { approveCloseAndClose } from "./window";

export function registerIpcHandlers(): void {
  // Renderer's side of the two-phase close guard — sent when the dirty-edit
  // prompt resolves to "close anyway" (or there's nothing dirty in the
  // first place). One-way `send`, not invoke/handle: the renderer
  // doesn't care about a response, and we don't want to delay the
  // window.close() roundtrip on it.
  ipcMain.on("app:close-now", () => {
    approveCloseAndClose();
  });

  ipcMain.handle("project:current", () => {
    // Always rebuild so the renderer's first paint after a CLI-side
    // `writ project rename` reflects the new display name without restart.
    return refreshCurrentProject();
  });

  ipcMain.handle("project:setDisplayName", (_event, name: string | null) => {
    const db = getCurrentDb();
    if (!db || !getCurrentProject()) throw new Error("No project open");
    setDisplayName(db, name);
    const updated = refreshCurrentProject();
    noteSelfWrite();
    return updated;
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
    const after = getCurrentProject();
    if (!after) {
      // switchProject failed silently — surface a generic error rather than
      // pretending the open succeeded.
      return { error: "Failed to open the selected project." };
    }
    return { project: after };
  });

  ipcMain.handle("columns:list", () => {
    const db = getCurrentDb();
    return db ? listColumns(db) : [];
  });

  ipcMain.handle("tasks:list", () => {
    const db = getCurrentDb();
    return db ? listTasks(db) : [];
  });

  ipcMain.handle("tasks:create", (_event, input: NewTask) => {
    const db = getCurrentDb();
    if (!db) throw new Error("No project open");
    const task = createTask(db, input);
    noteSelfWrite();
    return task;
  });

  ipcMain.handle("tasks:update", (_event, id: string, update: TaskUpdate): UpdateTaskResult => {
    const db = getCurrentDb();
    if (!db) throw new Error("No project open");
    try {
      const task = updateTask(db, id, update);
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
    const db = getCurrentDb();
    if (!db) throw new Error("No project open");
    const ok = deleteTask(db, id);
    noteSelfWrite();
    return ok;
  });

  ipcMain.handle("tags:list", () => {
    const db = getCurrentDb();
    return db ? listTags(db) : [];
  });
}
