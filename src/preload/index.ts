import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

import type {
  Column,
  NewTask,
  OpenFolderResult,
  ProjectInfo,
  Tag,
  Task,
  TaskUpdate,
  UpdateTaskResult,
} from "../shared/types";

const api = {
  project: {
    current: (): Promise<ProjectInfo | null> => ipcRenderer.invoke("project:current"),
    setDisplayName: (name: string | null): Promise<ProjectInfo> =>
      ipcRenderer.invoke("project:setDisplayName", name),
    openFolder: (): Promise<OpenFolderResult> => ipcRenderer.invoke("project:openFolder"),
    initRoot: (): Promise<string> => ipcRenderer.invoke("project:initRoot"),
    init: (): Promise<OpenFolderResult> => ipcRenderer.invoke("project:init"),
  },
  columns: {
    list: (): Promise<Column[]> => ipcRenderer.invoke("columns:list"),
  },
  tasks: {
    list: (): Promise<Task[]> => ipcRenderer.invoke("tasks:list"),
    create: (input: NewTask): Promise<Task> => ipcRenderer.invoke("tasks:create", input),
    update: (id: string, update: TaskUpdate): Promise<UpdateTaskResult> =>
      ipcRenderer.invoke("tasks:update", id, update),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke("tasks:delete", id),
  },
  tags: {
    list: (): Promise<Tag[]> => ipcRenderer.invoke("tags:list"),
  },
  events: {
    /** Subscribe to "DB changed under us" notifications. Fires when:
     *  - the desktop liveness socket receives a ping from a CLI / MCP write
     *    targeting the open project, OR
     *  - fs.watch on `.writ/` sees writ.db / writ.db-wal change (covers
     *    third-party writes and lost pings).
     *
     *  Returns an unsubscribe fn — call it on component teardown so handlers
     *  don't accumulate across remounts. */
    onProjectChanged: (handler: () => void): (() => void) => {
      const wrapped = (): void => handler();
      ipcRenderer.on("project:changed", wrapped);
      return () => {
        ipcRenderer.removeListener("project:changed", wrapped);
      };
    },
  },
  app: {
    /** Approve a pending window close. Main blocks the natural close and
     *  sends `app:request-close`; the renderer's guard checks for dirty
     *  edits and calls this to let the close through. One-way; no
     *  response is meaningful (the next thing that happens is the window
     *  disappearing). */
    closeNow: (): void => {
      ipcRenderer.send("app:close-now");
    },
    /** Subscribe to main's "user is trying to close the window" message.
     *  The handler should run the renderer's dirty-edit guard and either
     *  approve via `closeNow()` or do nothing (the close stays blocked).
     *  Returns an unsubscribe fn. */
    onRequestClose: (handler: () => void): (() => void) => {
      const wrapped = (): void => handler();
      ipcRenderer.on("app:request-close", wrapped);
      return () => {
        ipcRenderer.removeListener("app:request-close", wrapped);
      };
    },
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}

export type Api = typeof api;
