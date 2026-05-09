# writ

A local-first desktop TODO app that replaces the scattered `TODO.md` files most projects accumulate. Tasks live with the code they describe — one SQLite file per project, at `<repo>/.writ/writ.db` — and an MCP server lets Claude Code (and any other MCP-aware agent) read and update the same store the desktop UI shows.

> **Status:** pre-1.0, active development. The CLI and the MCP server are usable today; the desktop UI ships with a tabbed list view, a view-first edit modal, subtasks, tags, and dependencies. Kanban + drag-drop and packaged binaries are still in progress. See [`design.md`](./design.md) for the full architecture.

## Features

- **Per-project SQLite.** Tasks live in `<repo>/.writ/writ.db`. Discovered like git — `writ` walks up from cwd looking for `.writ/`.
- **Three first-class clients sharing one domain layer.** A fast Node CLI (`writ`), a stdio MCP server (`writ mcp`) for agents, and an Electron + Svelte 5 desktop UI. Whatever you do in one shows up in the others.
- **Subtasks.** Self-referential `parent_id`. The UI indents children under their parent and lets you switch between them; the CLI shows the same hierarchy.
- **Tags with colors.** Hex (`#3b82f6`) or any of the 147 CSS named colors. Tags are global per project and auto-created on first use.
- **Dependencies (depends-on graph).** Strict DAG — cycles are rejected. Tasks expose `isReady` (all blockers Done) and `blockedBy` (open blockers only) so you can filter to "ready to start" work.
- **Markdown descriptions.** `writ task edit` opens your `$EDITOR` with a YAML-frontmatter file; the body is the description.
- **Works without the desktop app running.** CLI + MCP write SQLite directly. Useful in CI, on remote shells, in headless containers.

## Install

writ isn't packaged yet. For now you clone the repo and use the in-tree dev wrapper:

```bash
git clone <repo> && cd writ
npm install   # postinstall builds better-sqlite3 for Electron's ABI
```

Then alias `bin/writ-dev` so you can call it `writ`:

```fish
# fish (~/.config/fish/config.fish)
alias writ='~/projects/writ/bin/writ-dev'
```

```bash
# bash/zsh (~/.bashrc, ~/.zshrc)
alias writ='~/projects/writ/bin/writ-dev'
```

(Packaged binaries — `writ` on `$PATH` plus the desktop app installer — are planned.)

## Quick start

```bash
cd ~/your-project
writ init                                    # creates .writ/writ.db
writ task add "Buy milk" -p high             # priority high
writ task add "Get eggs" --parent <id>       # subtask
writ task add "Ship feature" --tag UI=blue   # tag with explicit color
writ task add "Deploy" --depends-on <id>     # blocker
writ task list                               # grouped by column (Done hidden)
writ task list --ready                       # only what's ready to start
writ task <id>                               # show full details
writ task move <id> Doing                    # column transitions
```

Short IDs accept the full ulid or any unique suffix. `task list` shows the last 6 chars, so `writ task move ABCDEF Done` always works.

## CLI

```
writ init                       Create .writ/writ.db here

writ task add <title>           Add a task
  -p, --priority <l>            urgent | high | normal | low (or u/h/n/l, 0–3)
  -c, --col <name>              Column (case-insensitive). Default: first column.
  -d, --description <text>      Markdown body
  --parent <id>                 Make this a subtask
  --tag <spec>                  Add a tag. Spec: NAME or NAME=COLOR. Repeatable.
  --depends-on <id>             Block on another task. Repeatable.

writ task list                  List tasks; default hides Done
  -c, --col <name>              Only this column
  --tag <name>                  Tasks tagged with this name. Repeatable; ANDs.
  --any-tag <name>              Tasks tagged with any of these. Repeatable; ORs.
  --ready                       Only tasks whose blockers are all Done
  --blocked                     Only tasks with at least one open blocker
  --show-done                   Include the Done column

writ task view <id>             Full details (header + description + subtasks)
writ task <id>                  Shortcut for view
writ task move <id> <col>       Move to a different column
writ task edit <id>             Open in $EDITOR (frontmatter + markdown body)
  --tag <spec>                  Replace the tag set without opening the editor
  --depends-on <id>             Replace the dependency set without opening the editor
writ task rm <id>               Delete; subtasks cascade

writ mcp                        Run the stdio MCP server (for agents)
```

The default `task list` rendering is hierarchical — subtasks indent under their parent, with a `[Col]` badge if the child lives in a different column. Narrowing filters (`--tag`, `--any-tag`, `--ready`, `--blocked`) switch to flat-per-column so child matches still surface when their parent doesn't match.

## Using writ with Claude Code (and other MCP clients)

`writ mcp` is a stdio-based [Model Context Protocol](https://modelcontextprotocol.io) server. Spawn it from any MCP-aware client (Claude Code, Cline, Zed, …) and the client can read and update tasks in whatever writ project the spawning process's `cwd` resolves to.

### Configure in Claude Code

```jsonc
// ~/.claude.json (user) or .mcp.json (per-project)
{
  "mcpServers": {
    "writ": {
      "command": "/absolute/path/to/writ/bin/writ-dev",
      "args": ["mcp"],
    },
  },
}
```

The MCP server inherits the client's `cwd`, so it operates on whichever writ project lives at or above where you started Claude. If no `.writ/` is found, every tool returns a "no project" error pointing you at `writ init`.

### Tools

| Tool           | What it does                                                                   |
| -------------- | ------------------------------------------------------------------------------ |
| `list_tasks`   | List tasks. `column` / `parent_id` / `tag` / `ready` / `blocked` filters.      |
| `get_task`     | Single task with full markdown description and hydrated tags/dependencies.     |
| `create_task`  | Create with title; optional description, column, priority, parent, tags, deps. |
| `update_task`  | Patch any field; omit fields to leave them unchanged.                          |
| `move_task`    | Shortcut for changing only the column.                                         |
| `delete_task`  | Delete a task; subtasks cascade.                                               |
| `list_columns` | Columns in display order.                                                      |
| `list_tags`    | Tags in the project with their stored colors.                                  |

IDs accept the full ulid or any unique suffix, same as the CLI.

### Why stdio (and not HTTP)

The desktop app is a _viewer/editor_, not a server. The MCP server writes SQLite directly so it works without the desktop app running — useful in CI, on remote shells, and in headless containers. When the desktop app is open, it'll pick up changes via `fs.watch` (planned) and a best-effort socket ping for instant refresh (planned). See [`design.md`](./design.md) for the full reasoning.

## Editing tasks

`writ task edit <id>` opens the task in your editor. The resolution order:

1. `$WRIT_EDITOR`
2. `$VISUAL`
3. `$EDITOR`

If none are set, the command errors. There is no fallback to `vi` and no peek at `git config core.editor` — set the env var explicitly so behavior is predictable.

For VS Code, **the `--wait` flag is critical** — without it, `code` returns immediately and writ thinks you're done before you've typed anything. Same gotcha git has.

```fish
# fish
set -x EDITOR 'code --wait'
```

```bash
# bash/zsh
export EDITOR='code --wait'
```

The edit file is markdown with a YAML frontmatter block:

```markdown
---
# title: short summary (required)
title: Buy milk

# priority: urgent | high | normal | low  (also accepts u/h/n/l, 0–3)
priority: high

# col: Backlog | Todo | Doing | Done  (case-insensitive)
col: Backlog

# parent: ulid suffix of parent task, or null for top-level
parent: null
---

<!-- writ-hint: everything below is the description (markdown allowed) -->

Two percent. From the corner store.
```

The `col:` hint lists your project's actual columns. The `<!-- writ-hint: ... -->` line is stripped on save so it never round-trips into your description.

Removing a frontmatter line means _keep the current value_, not "clear it". Setting `parent: null` explicitly clears the parent. If parsing fails, the temp file path is printed so your edits aren't lost.

For tags and dependencies, prefer the direct flags (`writ task edit <id> --tag …` or `--depends-on …`) — they replace the set in one shot without opening the editor.

## Where data lives

- **`<repo>/.writ/writ.db`** — your tasks. One file per project; commit it or gitignore it depending on whether the team wants to share the task list.
- **`<repo>/.writ/writ.db-wal`, `.writ/writ.db-shm`** — SQLite WAL sidecars. Always gitignore these (they're transient locks/journals). They linger while any process holds the DB open; this is normal.

A single `.gitignore` line covers the safe-by-default case:

```
.writ/writ.db-wal
.writ/writ.db-shm
```

Or to keep tasks out of git entirely: `.writ/`.

---

## Architecture

```
src/
  shared/
    types/        Pure data types — importable everywhere
    db/           SQLite connection + versioned migrations
    domain/       Task CRUD; the only thing that mutates the DB
  cli/            Node CLI (writ init, task ...) — uses shared/domain
  main/           Electron main process: window mgmt, IPC handlers
  preload/        Electron preload bridge (typed window.api)
  renderer/       Svelte 5 UI (Tailwind + DaisyUI, Phosphor icons)
  mcp/            stdio MCP server — same shared/domain as the CLI
```

The CLI, the MCP server, and the Electron main process all import the same `shared/domain` module — there's only ever one writer of `.writ/writ.db`. See [`design.md`](./design.md) for the full architecture and the decision log behind it.

## Development

```bash
npm run dev               # launch Electron with HMR
npm test                  # vitest run (one-shot)
npm run test:watch        # vitest in watch mode
npm run typecheck         # tsc + svelte-check
npm run lint              # eslint
npm run format            # prettier across the repo
npm run build:linux       # AppImage + snap + deb
npm run build:mac         # dmg
npm run build:win         # nsis installer
```

Tests live next to source as `*.test.ts`. They run under Electron-as-Node (same as the CLI and MCP), so they share the app's `better-sqlite3` ABI — no per-context rebuilds. Run `npm test` once or `npm run test:watch` in a side terminal.

### Native modules

writ uses `better-sqlite3`, a native module built for Electron's bundled Node ABI. The CLI, the MCP server, and the test suite all run under **Electron-as-Node** (`ELECTRON_RUN_AS_NODE=1 electron …`) so they share that ABI with the desktop app — one build covers everything; there are no per-context rebuild flips.

`npm install` builds it via the postinstall hook. If you ever see `NODE_MODULE_VERSION` mismatch (rare; usually after a corrupted install), `npm run sqlite:rebuild` forces a clean rebuild.

### Repo-specific guidance

For working in this repo (especially with Claude Code), see [`CLAUDE.md`](./CLAUDE.md) for the conventions, hook setup, and project-specific gotchas.
