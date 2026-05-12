import type { Task } from "./task";

export interface ProjectInfo {
  root: string;
  /** Home-relative form of `root` for display (e.g. `~/projects/writ`).
   *  Computed in main where homedir() is available; the renderer just
   *  renders it. Equal to `root` when the path isn't under $HOME. */
  prettyRoot: string;
  dbPath: string;
  /** Stable ulid written to meta on first open (migration v4). Survives
   *  folder renames so the future per-user registry can key by id. */
  projectId: string;
  /** User-set display name override, or null to fall back to the cwd
   *  basename. The renderer is responsible for rendering the fallback. */
  displayName: string | null;
}

/** Result envelope for `tasks:update`. Throwing across IPC loses class
 *  identity, so the stale-read case rides on the same shape with a populated
 *  `conflict` field — the renderer branches on it to drive the conflict
 *  modal (slice 3) without leaking the failure to the catch-all error toast.
 *
 *  Invariants: when `conflict` is present, the write didn't land and `task`
 *  is null. When `conflict` is absent, `task` is the post-write row (or null
 *  if the row was already gone). Renderers that don't care about OCC can
 *  ignore `conflict` and treat the envelope as `Task | null`. */
export interface UpdateTaskResult {
  task: Task | null;
  conflict?: { error: "stale-read"; current: Task };
}

/** Result envelope for project-open IPC handlers (`project:openFolder` and
 *  `project:init`). The renderer branches on the discriminator:
 *  `canceled` → user dismissed the dialog (no-op), `error` → operation
 *  failed (show the message inline), `project` → switched and the new
 *  ProjectInfo is attached so the renderer can refresh state. */
export type OpenFolderResult = { canceled: true } | { error: string } | { project: ProjectInfo };
