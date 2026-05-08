import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

import type { Column, NewTask, ProjectInfo, Task } from "../shared/types";

const api = {
  project: {
    current: (): Promise<ProjectInfo | null> => ipcRenderer.invoke("project:current"),
  },
  columns: {
    list: (): Promise<Column[]> => ipcRenderer.invoke("columns:list"),
  },
  tasks: {
    list: (): Promise<Task[]> => ipcRenderer.invoke("tasks:list"),
    create: (input: NewTask): Promise<Task> => ipcRenderer.invoke("tasks:create", input),
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
