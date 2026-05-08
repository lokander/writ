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

1. **`writ` CLI** — small Node binary. Subcommands for tasks, init, register, and `writ mcp` (stdio MCP server). Fast startup; never boots Electron unless asked to.
2. **`writ` desktop app** — Electron + Svelte 5 + TypeScript. Aggregates registered projects, provides Kanban + List views, edits tasks via IPC into the same domain layer the CLI uses.
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
- A user-level registry at `~/.config/writ/registry.json` lists project paths the desktop app aggregates over. The CLI auto-registers a project on first successful write so the UI just sees it.
- WAL sidecars (`writ.db-wal`, `writ.db-shm`) are deleted by SQLite only when the **last** open connection closes. With CLI/MCP/app potentially holding the file concurrently, expect sidecars to linger during dev. This is normal. If we ever want a self-contained `.writ/writ.db` for export/commit, run `PRAGMA wal_checkpoint(TRUNCATE)` and close all our connections — third-party tools holding the file open will still keep the sidecars alive until they release.

Rationale: the user's mental model is TODO.md-per-repo. Files travel with the code; users decide per-repo whether to gitignore `.writ/` or commit it.

### Hybrid MCP: direct SQLite, with an optional liveness ping

`writ mcp` reads/writes the SQLite file directly. It does not proxy through the desktop app.

- Works without the desktop app running (CI, SSH, headless agents).
- SQLite WAL handles concurrent writes from multiple sessions safely; "the shared instance" is the file, not a server.
- Cwd is inherited from the spawning client, so project discovery is free.
- After every write, the CLI/MCP fires a best-effort notification at `~/.config/writ/app.sock` (Unix socket; named pipe on Windows). If the desktop app is listening, it refreshes immediately. If not, no-op.
- The desktop app also watches each registered DB with `fs.watch` as a fallback, so correctness never depends on the ping arriving.

This is the only architectural choice that took real debate; see [Decision log](#decision-log).

### Two binaries, one user-facing name

The `writ` command users type is a thin Node CLI script. It is _not_ the Electron binary.

- For task/init/register/mcp subcommands: handle in-process with fast Node startup.
- For `writ` with no subcommand: spawn the Electron app, detaching, and exit. If an instance is already running, send "focus on this project" via the same socket and exit.

The Electron binary is an implementation detail; users don't invoke it directly. (How `code` works.)

This costs us a small launcher script in distribution (electron-builder writes it on install) but it's the only way to keep `writ task add` from paying Chromium boot cost.

## Stack

- Runtime: Node 22+, Electron 39, Chromium via Electron.
- UI: Svelte 5 (runes mode), TypeScript, Vite via electron-vite.
- Data: SQLite via `better-sqlite3` (synchronous, fast, perfect for a desktop app's main process and a CLI).
- MCP: `@modelcontextprotocol/sdk` over stdio.
- CLI parser: TBD — likely `commander` for familiarity, but the surface is small enough that a hand-rolled router is also fine.
- Packaging: electron-builder (already configured) for the desktop app + launcher shim. The CLI is a separate `tsup`/`vite`/`esbuild` bundle into `dist/cli/index.js`.

## Repository layout (target)

```
src/
  shared/
    domain/           — task CRUD, project resolution, validation
    db/               — schema, migrations, connection mgmt
    types/            — Task, Project, Status, Priority, Tag, ...
    ipc-contract/     — typed channel names + payloads, used by main + preload
  main/               — Electron main: window mgmt, IPC handlers, fs.watch on registered DBs, socket listener
  preload/            — bridge that exposes a typed `window.writ` API
  renderer/           — Svelte 5 UI (Kanban, List, task detail)
  cli/
    index.ts          — argv router; entry point for the `writ` binary
    commands/
      task.ts         — add | list | rm | done | edit | move
      init.ts
      register.ts
      mcp.ts          — runs stdio MCP server
      open.ts         — `writ` with no subcommand: launch/focus the app
  mcp/
    server.ts         — exports runMcpServer(); imports shared/domain
    tools.ts          — tool definitions, all delegating to shared/domain
```

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
```

Notes:

- IDs are ulids (sortable, no central coordination, MCP/CLI/UI can all mint them).
- Fractional `position` lets us insert between cards without renumbering everything; rebalance on degenerate spreads.
- `parent_id` is the only subtask mechanism — kanban shows top-level cards; the card surfaces a `done/total` count for descendants; the detail view shows the full tree.
- Default columns on `init`: `Backlog`, `Todo`, `Doing`, `Done`. User-editable.

## CLI surface (sketch — not locked)

```
writ                       open app, focus current project (or last) if app is running
writ init                  create .writ/writ.db here, with default columns
writ register [path]       add path (default cwd) to ~/.config/writ/registry.json

writ task add "title"      [--priority p|h|n|l] [--tag foo] [--col Doing] [--parent <id>]
writ task list             [--status doing] [--tag foo] [--tree]
writ task done <id>
writ task rm <id>
writ task edit <id>        opens $EDITOR on the description (markdown)
writ task move <id> <col>  by name or id

writ mcp                   stdio MCP server, long-lived
```

Open question: collapse `writ task add` to `writ add`? Tasks are the only noun. Probably yes; revisit when there's a second noun (tags? columns?). For now, design for `writ task ...` namespace and add shortcuts later.

## MCP tools (initial)

Each tool is a thin wrapper around a function in `shared/domain`. No business logic in the MCP layer.

- `list_tasks(filter?)` → tasks in the current project, with optional status/tag/parent filters
- `get_task(id)`
- `create_task(title, description?, column?, priority?, tags?, parent?)`
- `update_task(id, fields)`
- `move_task(id, column, position?)`
- `delete_task(id)`
- `list_columns()`
- `list_projects()` → reads the registry, useful when an agent is asked to "look at all my todos"
- `set_project(path)` → for sessions where cwd doesn't match the intended project

## UI

- **Kanban view (default):** columns horizontally, cards within. Drag to reorder and to change column. Cards show title, priority chip, tag chips, subtask progress (e.g. `2/5`). Click → detail pane (markdown description editor).
- **List view:** flat or tree (toggle). Indented subtasks. Faster for keyboard-driven users.
- **Project switcher:** sidebar listing registered projects. "All projects" view (aggregated) is a stretch goal.

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

Simplest model. Recursive queries are well-supported in SQLite. The kanban view never recurses past the top level, so the recursion is bounded to the detail view and the `done/total` rollup.

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

## Phased implementation

1. **Scaffold** — strip electron-vite boilerplate (Versions.svelte, demo IPC). Add `src/shared/`, `src/cli/`, `src/mcp/` directories. Add `better-sqlite3` and rebuild for Electron.
2. **Domain + db** — schema, migrations, project resolution, task CRUD. Pure functions over a `Database` handle. Unit-tested without Electron.
3. **CLI v0** — `writ init`, `writ task add`, `writ task list`, `writ task done`. No app integration yet. Validates the domain layer end-to-end from a real entry point.
4. **Electron renderer + IPC** — list view first (simpler), wired through `shared/domain`. Open a project from the file picker; show its tasks; add/edit/done.
5. **Kanban view** — drag-drop, column reordering, position management.
6. **`writ mcp`** — stdio MCP server. Tools above. Same domain layer.
7. **Liveness ping** — Unix socket, app-side listener, `fs.watch` fallback.
8. **`writ` (no subcommand)** — launch/focus app, send "open project" over the socket.
9. **Polish** — tags UI, priority filters, subtask checklists on cards, registry-aware project switcher.
10. **Packaging** — electron-builder shim for `writ` on PATH on all three OSes.

## Open questions

- `writ task add` vs `writ add` — defer until a second noun shows up.
- Should `writ init` ask before creating, or just do it? (Probably just do it; it's a single hidden directory.)
- Default `.writ/` gitignored or committed? Recommendation: gitignore by default (since it's a SQLite binary), document `writ export` for committing a markdown snapshot if users want one.
- Stable project ID across renames: store one in `meta` so the registry can survive `mv repo-old repo-new`.
- Aggregated "All projects" view: nice-to-have or core? Treating as stretch unless you say otherwise.
