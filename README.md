# writ

A local-first desktop TODO app, built to replace the scattered `TODO.md` files most projects accumulate. Tasks live with the code they describe, in a per-project SQLite database at `<repo>/.writ/writ.db`. An MCP server (planned) lets Claude Code and other agents read and update tasks in the same store the desktop UI shows.

> **Status:** pre-1.0, active development. The CLI is usable; the desktop app is a placeholder; the MCP server is not yet implemented. See [`design.md`](./design.md) for the full architecture and [`CLAUDE.md`](./CLAUDE.md) for repo-specific guidance.

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
```

Short IDs accept the full ulid or any unique suffix. `task list` shows the last 6 chars, so `task move ABCDEF Done` works.

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

# col: existing column name (case-insensitive)
col: Backlog

# parent: ulid suffix of parent task, or null for top-level
parent: null
---

Two percent. From the corner store.
```

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
