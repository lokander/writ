# writ

A local-first desktop TODO app, built to replace the scattered `TODO.md` files most projects accumulate. Tasks live with the code they describe, in a per-project SQLite database at `<repo>/.writ/writ.db`. An MCP server lets Claude Code and other agents read and update tasks in the same store the desktop UI shows.

> **Status:** pre-1.0, active development. The CLI and the MCP server are usable; the desktop app is a placeholder. See [`design.md`](./design.md) for the full architecture and [`CLAUDE.md`](./CLAUDE.md) for repo-specific guidance.

## Quick start

```bash
git clone <repo> && cd writ
npm install
npm run sqlite:build-for-cli   # see "Native modules" below
```

Then, from any directory you want to track tasks in:

```bash
~/path/to/writ/bin/writ-dev init                              # creates .writ/writ.db
~/path/to/writ/bin/writ-dev task add "Buy milk" -p high       # priority high
~/path/to/writ/bin/writ-dev task add "Get eggs" --parent <id> # subtask
~/path/to/writ/bin/writ-dev task list
```

`bin/writ-dev` is the in-tree dev wrapper that runs the CLI with `tsx`. The packaged `writ` binary is forthcoming.

## CLI

```
writ init                       Create .writ/writ.db here
writ task add <title> [flags]   Add a task: -p, -c, -d, --parent
writ task list [flags]          List tasks: -c <col>, --tree
writ task move <id> <col>       Move to a different column (case-insensitive)
writ task edit <id>             Open the task in $EDITOR
writ task rm <id>               Delete a task; subtasks cascade
writ mcp                        Run the stdio MCP server (for agents)
```

Short IDs accept the full ulid or any unique suffix. `task list` shows the last 6 chars, so `task move ABCDEF Done` works.

## MCP server

`writ mcp` is a stdio-based [Model Context Protocol](https://modelcontextprotocol.io) server. Spawn it from any MCP-aware client (Claude Code, Cline, Zed, etc.) and the client can read and update tasks in whatever writ project the spawning process's `cwd` resolves to.

### Tools

| Tool           | What it does                                                             |
| -------------- | ------------------------------------------------------------------------ |
| `list_tasks`   | List tasks. `column`/`parent_id` filters. Body omitted (use `get_task`). |
| `get_task`     | Single task with the full markdown description.                          |
| `create_task`  | Create with title; optional description, column, priority, parent.       |
| `update_task`  | Patch any field; omit fields to leave them unchanged.                    |
| `move_task`    | Shortcut for changing only the column.                                   |
| `delete_task`  | Delete a task; subtasks cascade.                                         |
| `list_columns` | Columns in display order.                                                |

IDs accept the full ulid or any unique suffix, same as the CLI.

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

The MCP server inherits Claude Code's `cwd`, so it operates on whichever writ project lives at or above where you started Claude. If no `.writ/` is found, every tool returns a "no project" error pointing you at `writ init`.

### Why stdio (and not HTTP)

The desktop app is a _viewer/editor_, not a server. The MCP server writes SQLite directly so it works without the desktop app running — useful in CI, on remote shells, and in headless containers. When the desktop app is open, it'll pick up changes via `fs.watch` (and eventually a best-effort socket ping for instant refresh). See [`design.md`](./design.md) for the full reasoning.

## Editor

`writ task edit` resolves the editor in this order:

1. `$WRIT_EDITOR`
2. `$VISUAL`
3. `$EDITOR`

If none are set, the command errors. There is no fallback to `vi` and no peek at `git config core.editor` — set the env var explicitly so behavior is predictable.

For VS Code, **the `--wait` flag is critical** — without it, `code` returns immediately and writ thinks you're done before you've typed anything. Same gotcha git has.

```fish
# fish (~/.config/fish/config.fish)
set -x EDITOR 'code --wait'
```

```bash
# bash/zsh (~/.bashrc, ~/.zshrc)
export EDITOR='code --wait'
```

The edit file is markdown with a YAML frontmatter block:

```markdown
---
# title: short summary (required)
title: Buy milk

# priority: urgent | high | normal | low  (also accepts u/h/n/l, 0-3)
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

## Native modules

writ uses `better-sqlite3`, a native module rebuilt against a specific Node ABI. The CLI runs under regular Node; the (forthcoming) Electron app runs under Electron's Node fork. The two ABIs are incompatible, so flip the build for whichever you're working on:

```bash
npm run sqlite:build-for-cli   # for CLI/MCP work
npm run sqlite:build-for-app   # for Electron dev
```

If a native module errors with `NODE_MODULE_VERSION` mismatch on startup, the build is for the wrong runtime — flip it before debugging anything else.

## Project layout

```
src/
  shared/
    types/        Pure data types — importable everywhere
    db/           SQLite connection + versioned migrations
    domain/       Task CRUD; the only thing that mutates the DB
  cli/            Node CLI (writ init, task ...) — uses shared/domain
  main/           Electron main process (placeholder for now)
  preload/        Electron preload bridge
  renderer/       Svelte 5 UI (placeholder for now)
  mcp/            MCP server — not yet implemented
```

The CLI, the (forthcoming) MCP server, and the Electron main process all import the same `shared/domain` module — there's only ever one writer of `.writ/writ.db`. See [`design.md`](./design.md) for the rationale.

## Development

```bash
npm run dev               # launch Electron with HMR (after sqlite:build-for-app)
npm run typecheck         # tsc + svelte-check
npm run lint              # eslint
npm run format            # prettier across the repo
npm run build:linux       # AppImage + snap + deb
npm run build:mac         # dmg
npm run build:win         # nsis installer
```

A test runner is not yet wired up.
