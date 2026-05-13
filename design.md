# writ — design

A local-first desktop TODO app that replaces scattered `TODO.md` files. Inspired by Jira/Trello for the visual model, by `git` for project discovery, by `code` for the CLI/app relationship. Built so that humans (the desktop UI) and agents (Claude Code via MCP, scripts via CLI) are equal first-class consumers of the same data.

## Goals

- One nice place to track planned/in-progress/done work across many repos.
- Tasks live with the code they describe (per-repo SQLite file), not in a central cloud.
- Agents can read and write tasks programmatically, and their changes show up live in the UI when it's open.
- Works whether or not the desktop app is running (CI, SSH, headless).

## Non-goals (for now)

- Multi-user, sharing, sync, cloud. Personal, local, single-machine.
- Due dates and deadlines.
- Time tracking, sprint/velocity metrics, burndown charts.
- Plugin/extension API. Internal modules only.

## Architecture overview

Three things ship as one project:

1. **`writ` CLI** — small Node binary. Subcommands for `init`, `task`, `project`, `mcp` (the stdio MCP server, with `install` / `uninstall` helpers for `.mcp.json`), and `completion` (bash / zsh / fish). Bare `writ` (no subcommand) launches or focuses the desktop app. Fast startup; never boots Electron for the subcommand path.
2. **`writ` desktop app** — Electron + Svelte 5 + TypeScript. Edits tasks via IPC into the same domain layer the CLI uses. Today: a list view with column tabs and a kanban view with drag-and-drop between columns (toggle in the navbar), sharing a view-first edit modal. One project per window; switch via the file-dialog picker (which walks up from the chosen path to find a `.writ/`). An aggregated cross-project view was considered and rejected — see the decision log.
3. **Shared domain library** — schema, migrations, task CRUD, project resolution. Both the CLI and the Electron main process import it. There is no other place that mutates the database.

```
   ┌──────────────┐                  ┌────────────────────────────┐
   │  Claude Code │ ── stdio MCP ─▶ │  writ-mcp (CLI subcommand) │
   └──────────────┘                  └─────────────┬──────────────┘
                                                   │
   ┌──────────────┐    direct                      ▼
   │  shell user  │ ── invoke ───▶  writ task add/list/...  ┐
   └──────────────┘                                          │
                                                             ▼
                                              ┌──────────────────────┐
                                              │  shared/domain/*     │
                                              │  (the only writer)   │
                                              └──────────┬───────────┘
                                                         │ better-sqlite3
                                                         ▼
                                              <repo>/.writ/writ.db   ← WAL mode
                                                         ▲
                                              fs.watch + (opt) ping  │
                                                         │
                                              ┌──────────┴───────────┐
                                              │ Electron main proc.  │
                                              │  (also imports       │
                                              │   shared/domain)     │
                                              └──────────┬───────────┘
                                                         │ IPC
                                                         ▼
                                              ┌──────────────────────┐
                                              │ Svelte renderer (UI) │
                                              └──────────────────────┘
```

### Storage: per-project SQLite

- One database per project, at `<repo>/.writ/writ.db`.
- Discovered by walking up from cwd, like git finds `.git`. The CLI, the MCP server, and the Electron "open project" flow all use the same `findProjectRoot(cwd)` helper.
- SQLite is opened in WAL mode so multiple processes (CLI, MCP, Electron) can read and write concurrently without external coordination.
- **No global registry.** Each writ-aware process — CLI, MCP, desktop window — sees exactly one project, the one its cwd resolves to. The desktop app additionally accepts an explicit "open this folder" via a native file dialog, but that's a per-window choice driven by the user, not a persistent enumeration. See the [decision log](#no-cross-project-visibility--cwd-is-the-boundary).
- WAL sidecars (`writ.db-wal`, `writ.db-shm`) are deleted by SQLite only when the **last** open connection closes. With CLI/MCP/app potentially holding the file concurrently, expect sidecars to linger during dev. This is normal. If we ever want a self-contained `.writ/writ.db` for export/commit, run `PRAGMA wal_checkpoint(TRUNCATE)` and close all our connections — third-party tools holding the file open will still keep the sidecars alive until they release.

Rationale: the user's mental model is TODO.md-per-repo. Files travel with the code; users decide per-repo whether to gitignore `.writ/` or commit it.

### Hybrid MCP: direct SQLite, with an optional liveness ping

`writ mcp` reads/writes the SQLite file directly. It does not proxy through the desktop app.

- Works without the desktop app running (CI, SSH, headless agents).
- SQLite WAL handles concurrent writes from multiple sessions safely; "the shared instance" is the file, not a server.
- Cwd is inherited from the spawning client, so project discovery is free.
- After every successful write, the CLI/MCP fires a best-effort notification at `~/.config/writ/app.sock` (Unix socket; named pipe on Windows at `\\.\pipe\writ-app`). The wire format is line-delimited JSON with a discriminator: `{"type": "changed", "root": "<path>"}` for write-notifications, `{"type": "open", "root": "<path>" | null}` for the bare-`writ` launch flow (focus the existing window and switch projects if the cwd differs; null means "focus only, don't change the open project"). If the desktop app is listening, it dispatches accordingly — `changed` broadcasts `project:changed` to the renderer; `open` switches and broadcasts. If no listener, no-op. The socket is `unref`d in the writer process so a pending connect never delays CLI exit.
- The desktop app also watches each open DB's `.writ/` directory with `fs.watch` (filtered to `writ.db` / `writ.db-wal`, debounced ~150ms) so correctness never depends on the ping arriving — third-party writes and lost pings still surface in the UI. Renderer-initiated IPC writes set a ~250ms suppression window so the watcher event our own write trips doesn't trigger a redundant refetch on top of optimistic state.

This is the only architectural choice that took real debate; see [Decision log](#decision-log).

### Two binaries, one user-facing name

The `writ` command users type is a thin shell launcher. It is _not_ the Electron binary directly — it's a script that decides whether to invoke Electron as Node or as a GUI.

- For `init` / `task` / `project` / `mcp` / `completion` subcommands: the launcher invokes `ELECTRON_RUN_AS_NODE=1 <electron-bin> <cli-bundle.js> "$@"`. The bundled CLI (`out/cli/index.js`, built by `build/vite.cli.config.ts`) handles dispatch via commander. Fast Node startup; no Chromium boot.
- For bare `writ` (no subcommand): the same path through the bundled CLI, which then calls `launchDesktop()`. That helper first tries to send `{"type": "open", "root": <cwd>}` over the desktop socket — if a window is open, it focuses and (if cwd differs) switches projects. On socket failure, it spawns the Electron binary detached (no `ELECTRON_RUN_AS_NODE`) so the parent CLI can exit immediately.

In the pacman-packaged build: the launcher is `/opt/writ/bin/writ` (a shell script shipped via electron-builder's `extraFiles`); the install hook symlinks `/usr/bin/writ → /opt/writ/bin/writ`. In the AppImage build: a custom AppRun (injected by `build/afterPack.cjs`) delegates to the same `bin/writ` launcher inside the mounted squashfs at `$APPDIR/bin/writ`; users put it on PATH by renaming or symlinking the `.AppImage` as `writ` somewhere in PATH. In dev: `bin/writ-dev` is the equivalent, running the CLI from source via tsx. All three paths end up at the same dispatch.

One AppImage-specific wrinkle: bare `writ` would normally spawn Electron detached and exit, but inside an AppImage that race tears down the fuse mount before Electron finishes booting. `spawnDesktopApp` (`src/cli/launch.ts`) detects `$APPIMAGE` and instead re-execs the `.AppImage` itself, detached, with `WRIT_APPIMAGE_DESKTOP=1`; the new instance's AppRun sees that env, skips the CLI bundle, and `exec`s Electron directly — its mount is held open by the GUI process itself.

The Electron binary is an implementation detail; users don't invoke it directly. (How `code` works.)

## Stack

- Runtime: Node 22+, Electron 39, Chromium via Electron.
- UI: Svelte 5 (runes mode), TypeScript, Vite via electron-vite.
- Data: SQLite via `better-sqlite3` (synchronous, fast, perfect for a desktop app's main process and a CLI).
- MCP: `@modelcontextprotocol/sdk` over stdio.
- CLI parser: `commander`.
- Packaging: electron-builder + fpm. Shipped targets: `pacman` (CLI on PATH via post-install symlink to `/usr/bin/writ`) and `AppImage` (CLI on PATH by renaming/symlinking the `.AppImage` as `writ`; a custom AppRun from `build/afterPack.cjs` routes invocations through the same launcher). AUR submission and the remaining Linux formats (snap / deb) plus macOS / Windows targets are tracked as follow-up tasks. The CLI is bundled into `out/cli/index.js` via a sibling Vite config (`build/vite.cli.config.ts`) and shipped inside the asar; the launcher shell script (`build/writ-launcher.sh`) lands at `<install-dir>/bin/writ` via electron-builder's `extraFiles`.
- Releases: tag-driven via `.github/workflows/release.yml`. Pushing a `v*` tag runs the matrix (`ubuntu-latest` → AppImage + pacman, `macos-latest` → dmg, `windows-latest` → nsis), uploads each runner's artifacts, then creates a **draft** GitHub Release with auto-generated notes; you publish manually after smoke-testing. The committed `version` in `package.json` is a placeholder (`0.0.0-dev`); CI stamps the tag value via `npm version --no-git-tag-version --allow-same-version` before building, so artifact names and the renderer's AboutDialog always reflect the release tag. Unsigned everywhere for now — macOS notarization and Windows code-signing are deferred.

The current CLI and MCP surfaces are the live source of truth — see the [README](./README.md), `writ --help`, and the registered `mcp__writ__*` tools rather than restating them here. Active work is tracked in writ itself (`mcp__writ__list_tasks`).

## Data model

Each `.writ/writ.db` is itself one project; there is no `projects` table inside it.

```sql
-- meta: schema version, project name override, stable project id
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- user-customizable kanban columns; status on a task is the column's id
CREATE TABLE columns (
  id         TEXT PRIMARY KEY,           -- ulid
  name       TEXT NOT NULL,
  position   REAL NOT NULL               -- fractional indexing for cheap reorders
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  column_id    TEXT NOT NULL REFERENCES columns(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',  -- markdown
  priority     INTEGER NOT NULL DEFAULT 2,-- 0=urgent, 1=high, 2=normal, 3=low
  position     REAL NOT NULL,             -- order within the column
  version      INTEGER NOT NULL DEFAULT 0,-- OCC; bumped on every successful updateTask (v5)
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX tasks_column_pos ON tasks (column_id, position);
CREATE INDEX tasks_parent     ON tasks (parent_id);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);
CREATE TABLE task_tags (
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- depends-on graph (added in migration v2)
CREATE TABLE task_dependencies (
  task_id        TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id  TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id != depends_on_id)
);
CREATE INDEX task_deps_depends_on ON task_dependencies (depends_on_id);
```

Notes:

- IDs are ulids (sortable, no central coordination, MCP/CLI/UI can all mint them).
- `position` is a REAL ordered ascending. New cards (and cards moved between columns) get `MAX(position in target column) + 1000`. Fractional inserts at midpoints would let us reorder without renumbering, but that's not implemented — within-column manual reorder was deliberately cut in favor of `Q095` (alternative card sort orders), so there's nothing to rebalance.
- `parent_id` is the only subtask mechanism — the list view indents children under their parent within a column; the kanban view renders flat per column with a `↳ parent.title` breadcrumb so subtasks keep context without consuming horizontal space. Both views surface a child-count badge on the parent. The detail view shows the full subtree. (A `done/total` split is a possible later refinement.)
- `task_dependencies` is a strict DAG — a forward-BFS cycle check rejects writes that would create a cycle. Tasks expose derived `dependsOn` / `blockedBy` (the subset of blockers not yet in a column whose name is `Done`, case-insensitive) and `isReady` (true iff every blocker is Done). These are populated by `getTask` / `listTasks` with bulk loaders to avoid N+1.
- Default columns on `init`: `Backlog`, `Todo`, `Doing`, `Done`. User-editable.

## Decision log

### MCP transport: stdio with direct SQLite + optional liveness ping (Hybrid B)

Considered:

- **Pure HTTP/SSE in the desktop app.** Simple "shared instance" story, but couples MCP availability to "is the Electron app running." Breaks SSH/CI. Forces clients to send cwd in protocol (no MCP client does this by default), or an explicit `project_path` arg on every tool call.
- **Pure stdio with no app coupling.** Works everywhere. Live UI updates rely solely on `fs.watch`, which is fine but slightly laggy under some filesystems.
- **Stdio binary that proxies through HTTP to the app.** Worst-of-both: requires app running _and_ maintains two protocols. Rejected.
- **Hybrid B (chosen):** stdio writes SQLite directly; emits a best-effort ping to the running app via Unix socket. Correctness lives in SQLite; the socket is a UX optimization for live updates that the app falls back from to `fs.watch`.

### Per-project DB rather than global workspace

A global SQLite at `~/.config/writ/writ.db` was simpler to implement (one connection, one schema, no aggregation) but lost the "lives with the code" property the user wanted. Reversed.

### No cross-project visibility — cwd is the boundary

Considered: a per-user registry at `~/.config/writ/registry.json` listing every project the user has touched, populated automatically on first write. The desktop UI would show recents and an aggregated "all projects" view; MCP would expose `set_project` / `list_projects` tools so an agent could enumerate or switch projects mid-session.

Rejected. An agent running inside project A should not be able to read or enumerate tasks from project B without explicit consent — the cwd that spawned the MCP server is that consent. A registry-backed `set_project` weakens the boundary in a way `fs.watch`-style filesystem access can't equally reach (the registry is a curated index of "interesting" projects, easier to crawl than `find ~ -name .writ`).

Cost paid: opening a different project from inside the running desktop app goes through a native folder picker (a one-time per-project click) rather than a recents list. A desktop-only recents file (kept in `app.getPath('userData')`, never read by CLI / MCP) can close that UX gap without exposing cross-project state to agents; tracked as a low-priority follow-up.

### Two binaries, one user name

Chromium boots in 1–2s; unacceptable per `writ task add`. The CLI must be a fast Node script that delegates to the Electron binary only for `writ` (no subcommand). Cost: a launcher shim in the installer; one extra build target.

### Subtasks via self-referential `parent_id`, not a separate table

Simplest model. Recursive queries are well-supported in SQLite. Recursion is bounded to the list view's hierarchical render and the detail view's subtree; the kanban view renders flat per column, with a parent-title breadcrumb on subtasks for context.

### Optimistic concurrency via per-task `version`

Three writers (CLI, MCP, desktop) share a single SQLite. To keep "user opened a modal three minutes ago" from silently overwriting an MCP edit that landed two seconds ago, every successful `updateTask` bumps `tasks.version`. Callers may pin `expectedVersion` on the way in; on mismatch the domain layer throws `StaleReadError(currentTask)` and rolls the txn back via `BEGIN IMMEDIATE` (locks before the version check, so no other writer can interleave between read and write).

Layer-specific contracts:

- **IPC** (`tasks:update`): returns `{ task, conflict? }`. The renderer pipes `conflict.current` into a per-field conflict dialog; non-overlapping local-dirty / remote-changed sets auto-merge silently (re-pin and retry once).
- **MCP** (`update_task`, `move_task`): exposes `expected_version`. When the agent pins, a stale read becomes a tool error. When the agent doesn't pin, the server still pins internally and retries once with the refreshed version — without the internal pin, an unpinned write would silently overwrite a concurrent change.
- **CLI** (`writ task edit`): the editor mode pins to the version observed at editor-open and prints the now-current task as YAML on conflict so the user can re-run with the new state. Direct-flag mode (`--tag`, `--depends-on`) stays last-writer-wins — no read-edit-save gap to protect.

The renderer's modal computes "dirty" against a snapshot captured at edit-start, not against the live row, so a remote edit to an untouched field doesn't get reflected as a local edit and clobbered on save. The diff/merge logic lives in pure helpers (`src/renderer/src/lib/diff-task.ts`) so the field-by-field decisions are unit-testable independently of the Svelte component.

## Implementation patterns

Patterns we'll need across phases. Not yet implemented; documented here so we get them right the first time.

### Window state persistence

Persist size, position, and maximized to `<userData>/window-state.json`.

- **Debounce** writes (~500 ms) on `resize`/`move`/`maximize`; those events fire continuously.
- On `close`, **synchronously flush a cached snapshot** maintained from the resize/move handlers. `win.getBounds()` on a window already tearing down returns garbage, so reading it inside the close handler is wrong.
- On launch, **discard saved bounds that don't intersect any current display** (`screen.getAllDisplays()`) — handles a disconnected external monitor.
- **Don't persist position on Wayland** (`process.env.XDG_SESSION_TYPE === 'wayland'`). Wayland compositors don't expose a window's own absolute position to the client; we'd just store `(0, 0)` every launch. Size and maximized state still persist fine. (Relevant: writ targets Linux desktops first.)

### Window close: two-phase guard

For unsaved-edit prompts (e.g. an open task description), don't put the guard in main's `before-quit`. The renderer owns the modal stack and the dirty state; main shouldn't try to model it.

1. Main blocks the window's `close` event with `event.preventDefault()` and sends `app:request-close` to the renderer.
2. Renderer runs its guard (modal, "save / discard / cancel"). On approval it calls `app:close-now`. On cancel it stays silent — the close stays prevented.
3. Main's `app:close-now` handler sets a one-shot "really close" flag and re-issues `window.close()`.

Hook all quit-time work in the renderer here, not in `before-quit`.

_Active work and the running backlog live in writ itself; query via `mcp__writ__list_tasks` or `writ task list` from the project root._
