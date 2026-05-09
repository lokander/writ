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

1. **`writ` CLI** — small Node binary. Subcommands for `init`, `task`, and `writ mcp` (stdio MCP server) today; `register` and bare-`writ` desktop launch are planned (see writ Backlog). Fast startup; never boots Electron unless asked to.
2. **`writ` desktop app** — Electron + Svelte 5 + TypeScript. Edits tasks via IPC into the same domain layer the CLI uses. Today: a list view with column tabs and a kanban view with drag-and-drop between columns (toggle in the navbar), sharing a view-first edit modal. Aggregating across registered projects is planned.
3. **Shared domain library** — schema, migrations, task CRUD, project resolution. Both the CLI and the Electron main process import it. There is no other place that mutates the database.

```
   ┌──────────────┐                 ┌────────────────────────────┐
   │  Claude Code │ ── stdio MCP ─▶ │ writ-mcp (CLI subcommand)  │
   └──────────────┘                 └─────────────┬──────────────┘
                                                  │
   ┌──────────────┐    direct                     ▼
   │  shell user  │ ── invoke ───▶  writ task add/list/...   ┐
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
- **Planned:** a user-level registry at `~/.config/writ/registry.json` will list project paths the desktop app aggregates over, and the CLI will auto-register a project on first successful write so the UI just sees it. Until then, the desktop app opens whatever project lives at the cwd it was launched from.
- WAL sidecars (`writ.db-wal`, `writ.db-shm`) are deleted by SQLite only when the **last** open connection closes. With CLI/MCP/app potentially holding the file concurrently, expect sidecars to linger during dev. This is normal. If we ever want a self-contained `.writ/writ.db` for export/commit, run `PRAGMA wal_checkpoint(TRUNCATE)` and close all our connections — third-party tools holding the file open will still keep the sidecars alive until they release.

Rationale: the user's mental model is TODO.md-per-repo. Files travel with the code; users decide per-repo whether to gitignore `.writ/` or commit it.

### Hybrid MCP: direct SQLite, with an optional liveness ping

`writ mcp` reads/writes the SQLite file directly. It does not proxy through the desktop app.

- Works without the desktop app running (CI, SSH, headless agents).
- SQLite WAL handles concurrent writes from multiple sessions safely; "the shared instance" is the file, not a server.
- Cwd is inherited from the spawning client, so project discovery is free.
- **Planned:** after every write, the CLI/MCP will fire a best-effort notification at `~/.config/writ/app.sock` (Unix socket; named pipe on Windows). If the desktop app is listening, it refreshes immediately. If not, no-op.
- **Planned:** the desktop app will also watch each registered DB with `fs.watch` as a fallback, so correctness never depends on the ping arriving. Today the renderer doesn't pick up external writes until it's reopened; an interim "live-reload on focus" tweak is in the backlog ahead of the full ping/watch story.

This is the only architectural choice that took real debate; see [Decision log](#decision-log).

### Two binaries, one user-facing name

The `writ` command users type is a thin Node CLI script. It is _not_ the Electron binary.

- For `init`/`task`/`mcp` subcommands: handle in-process with fast Node startup. Today via `bin/writ-dev`, which runs under Electron-as-Node.
- **Planned:** for `writ` with no subcommand: spawn the Electron app, detaching, and exit. If an instance is already running, send "focus on this project" via the same socket and exit.

The Electron binary is an implementation detail; users don't invoke it directly. (How `code` works.)

This costs us a small launcher script in distribution (electron-builder writes it on install) but it's the only way to keep `writ task add` from paying Chromium boot cost.

## Stack

- Runtime: Node 22+, Electron 39, Chromium via Electron.
- UI: Svelte 5 (runes mode), TypeScript, Vite via electron-vite.
- Data: SQLite via `better-sqlite3` (synchronous, fast, perfect for a desktop app's main process and a CLI).
- MCP: `@modelcontextprotocol/sdk` over stdio.
- CLI parser: `commander`.
- Packaging: electron-builder (already configured) for the desktop app. **Planned:** ship the CLI as a separate `tsup`/`vite`/`esbuild` bundle into `dist/cli/index.js` plus a launcher shim on `$PATH`. Today the CLI runs from source via `bin/writ-dev` under Electron-as-Node.

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

### Two binaries, one user name

Chromium boots in 1–2s; unacceptable per `writ task add`. The CLI must be a fast Node script that delegates to the Electron binary only for `writ` (no subcommand). Cost: a launcher shim in the installer; one extra build target.

### Subtasks via self-referential `parent_id`, not a separate table

Simplest model. Recursive queries are well-supported in SQLite. Recursion is bounded to the list view's hierarchical render and the detail view's subtree; the kanban view renders flat per column, with a parent-title breadcrumb on subtasks for context.

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
