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
