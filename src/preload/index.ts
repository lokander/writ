import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

import type {
  Column,
  NewTask,
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
