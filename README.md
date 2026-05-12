# writ

A local-first desktop TODO app that replaces the scattered `TODO.md` files most projects accumulate. Tasks live with the code they describe — one SQLite file per project, at `<repo>/.writ/writ.db` — and a stdio MCP server lets Claude Code (and any other MCP-aware agent) read and update the same store the desktop UI shows.

> **Status:** pre-1.0, active development. The CLI, the MCP server, and the desktop UI (kanban + list views, drag-and-drop, subtasks, tags, dependencies, filtering) are usable today. Arch / pacman is the only packaged install path so far; other formats are tracked in the writ project itself. Breaking changes possible.

<!-- TODO: add screenshot of the kanban view here once we have a public-friendly one to commit -->

## Why writ

- **Per-project SQLite, not a cloud service.** `.writ/writ.db` travels with your repo. Commit it or gitignore it — your call.
- **Agents are first-class.** The MCP server reads and writes the same DB the desktop UI does. Anything Claude Code does shows up in the kanban; anything you do in the kanban is visible to Claude.
- **Works without the desktop app running.** CLI and MCP write SQLite directly. Useful in CI, on remote shells, in headless containers.
- **One writer, one schema, three clients.** Fast Node CLI, stdio MCP server, Electron + Svelte 5 desktop UI — all importing the same `shared/domain` module. There's only one place tasks get mutated.
- **Plain-text-friendly.** Markdown descriptions, ulid task ids, YAML-frontmatter editing via `$EDITOR`. Nothing locks you in.

## Install

### Arch Linux (pacman)

```fish
git clone <repo> writ && cd writ
npm install
npm run build:linux                     # produces dist/writ-X.Y.Z.pacman
sudo pacman -U dist/writ-*.pacman       # installs to /opt/writ + /usr/bin/writ
```

`writ` is now on PATH. Bare `writ` opens the desktop app; subcommands stay on the fast Node path.

> Other Linux package formats (deb, AppImage, snap), the AUR submission, and macOS / Windows builds are tracked as follow-up tasks. Build from source meanwhile.

### From source (any platform)

```fish
git clone <repo> writ && cd writ
npm install                             # postinstall builds better-sqlite3 for Electron
```

Add the dev wrapper to your PATH:

```fish
# fish
alias writ='~/projects/writ/bin/writ-dev'

# bash / zsh (in ~/.bashrc or ~/.zshrc)
alias writ='~/projects/writ/bin/writ-dev'
```

## Quick start

```fish
cd ~/your-project
writ init                                       # creates .writ/, prints next steps
writ task add "Buy milk" -p high                # priority high
writ task add "Get eggs" --parent <id>          # subtask
writ task add "Ship feature" --tag UI=blue      # tag with explicit color
writ task add "Deploy" --depends-on <id>        # blocker
writ task list                                  # grouped by column (Done hidden)
writ task list --ready                          # only what's ready to start
writ task <id>                                  # show full details
writ task move <id> Doing                       # column transitions
writ                                            # launch the desktop app on this project
```

Task ids accept the full ulid or any unique suffix. The CLI and the desktop UI both display the last 6 chars — quote those when referring to a task.

## Using writ with Claude Code

`writ mcp install` is the one-shot setup:

```fish
cd ~/your-project
writ init                       # if not already
writ mcp install                # writes .mcp.json
```

This adds a `writ` entry to the project's `.mcp.json`. Claude Code picks it up the next session, and the MCP tools (`mcp__writ__list_tasks`, `mcp__writ__create_task`, …) operate on the project that lives at or above the spawning client's cwd. No global state, no cross-project visibility.

If `.mcp.json` already has a `writ` entry that differs from what install would write, the command prints the diff and exits with a non-zero status. `writ mcp install --yes` overwrites (preserving any user-added fields like `env`); `writ mcp uninstall` removes the entry.

### MCP tools

| Tool           | What it does                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `list_tasks`   | List tasks. `column` / `parent_id` / `tag` / `ready` / `blocked` / `query` filters.                  |
| `get_task`     | Single task with full markdown description and hydrated tags / dependencies.                         |
| `create_task`  | Create with title; optional description, column, priority, parent, tags, deps.                       |
| `update_task`  | Patch any field; omit fields to leave them unchanged. Optimistic concurrency via `expected_version`. |
| `move_task`    | Shortcut for changing only the column.                                                               |
| `delete_task`  | Delete a task; subtasks cascade.                                                                     |
| `list_columns` | Columns in display order.                                                                            |
| `list_tags`    | Tags in the project with their stored colors.                                                        |

Ids accept the full ulid or any unique suffix, same as the CLI.

## CLI reference

```
writ                            Open the desktop app on the cwd-resolved project
                                (or focus an existing window, switching projects
                                if the cwd is a different one)

writ init                       Create .writ/writ.db here

writ task add <title>           Add a task
  -p, --priority <l>            urgent | high | normal | low (or u/h/n/l, 0–3)
  -c, --col <name>              Column (case-insensitive). Default: first column.
  -d, --description <text>      Markdown body
  --parent <id>                 Make this a subtask
  --tag <spec>                  Add a tag. Spec: NAME or NAME=COLOR. Repeatable.
  --depends-on <id>             Block on another task. Repeatable.

writ task list                  List tasks; default hides Done / Archived  (alias: ls)
  -c, --col <name>              Only this column
  --tag <name>                  Tasks tagged with this name. Repeatable; ANDs.
  --any-tag <name>              Tasks tagged with any of these. Repeatable; ORs.
  --priority <l>                Filter by priority. Repeatable; ORs.
  --grep <pattern>              Filter to titles containing this substring
  --ready                       Only tasks whose blockers are all Done
  --blocked                     Only tasks with at least one open blocker
  --show-done                   Include the Done column
  --show-archived               Include the Archived column

writ task view <id>             Full details (header + description + subtasks)
writ task <id>                  Shortcut for view
writ task move <id> <col>       Move to a different column   (alias: mv)
writ task edit <id>             Open in $EDITOR (frontmatter + markdown body)
  --tag <spec>                  Replace the tag set without opening the editor
  --depends-on <id>             Replace the dependency set without opening the editor
writ task remove <id>           Delete; subtasks cascade     (alias: rm)

writ project show               Project id, name, paths
writ project rename <name>      Set the display name (or --clear to revert)

writ mcp                        Run the stdio MCP server (for agents)
writ mcp install                Add writ to ./.mcp.json
writ mcp uninstall              Remove the writ entry from ./.mcp.json

writ completion <shell>         Print a shell completion script (bash | zsh | fish)
```

The default `task list` rendering is hierarchical — subtasks indent under their parent, with a `[Col]` badge if the child lives in a different column. Narrowing filters (`--tag`, `--any-tag`, `--priority`, `--grep`, `--ready`, `--blocked`) switch to flat-per-column so child matches still surface when their parent doesn't match.

### Shell completion

```fish
# fish (auto-loaded from this dir)
writ completion fish > ~/.config/fish/completions/writ.fish

# bash (eval inline, or pipe to /etc/bash_completion.d/writ)
eval "$(writ completion bash)"

# zsh (drop into a dir on $fpath, then compinit)
writ completion zsh > "${fpath[1]}/_writ"
```

Subcommand names and the most-used flags are completed. Task ids, tag names, and column names aren't yet — separate follow-up.

## Editing tasks

`writ task edit <id>` opens the task in your editor. Resolution order: `$WRIT_EDITOR` → `$VISUAL` → `$EDITOR`. If none are set, the command errors (no fallback to `vi`, no peek at `git config core.editor`).

For VS Code, **the `--wait` flag is critical** — without it, `code` returns immediately and writ thinks you're done before you've typed anything. Same gotcha git has.

```fish
# fish
set -x EDITOR 'code --wait'

# bash / zsh
export EDITOR='code --wait'
```

The edit file is markdown with a YAML frontmatter block:

```markdown
---
title: Buy milk
priority: high
col: Backlog
parent: null
---

<!-- writ-hint: everything below is the description (markdown allowed) -->

Two percent. From the corner store.
```

Removing a frontmatter line means _keep the current value_, not "clear it". Setting `parent: null` explicitly clears the parent. If parsing fails, the temp file path is printed so your edits aren't lost.

For tags and dependencies, prefer the direct flags (`writ task edit <id> --tag …` or `--depends-on …`) — they replace the set in one shot without opening the editor.

## Where data lives

- **`<repo>/.writ/writ.db`** — your tasks. One file per project. **Commit it** if you want the team to share the task list (the default — see the note `writ init` prints). Gitignore `.writ/` to keep it local.
- **`<repo>/.writ/writ.db-wal`, `.writ/writ.db-shm`** — SQLite WAL sidecars. Always gitignore (they're transient locks/journals).

A `.gitignore` line for the safe-by-default case:

```
.writ/writ.db-wal
.writ/writ.db-shm
```

Or to keep tasks out of git entirely: `.writ/`.

## Architecture

```
src/
  shared/
    types/        Pure data types — importable everywhere
    db/           SQLite connection + versioned migrations
    domain/       Task CRUD; the only thing that mutates the DB
  cli/            Node CLI — uses shared/domain
  mcp/            stdio MCP server — same shared/domain as the CLI
  main/           Electron main process: window mgmt, IPC handlers
  preload/        Electron preload bridge (typed window.api)
  renderer/       Svelte 5 UI (Tailwind + DaisyUI, Phosphor icons)
```

The CLI, the MCP server, and the Electron main process all import the same `shared/domain` module — there's only ever one writer of `.writ/writ.db`. See [`design.md`](./design.md) for the full architecture and the decision log behind it.

## Development

```fish
npm run dev               # launch Electron with HMR
npm test                  # vitest run (one-shot)
npm run test:watch        # vitest in watch mode
npm run typecheck         # tsc + svelte-check
npm run lint              # eslint
npm run format            # prettier across the repo
npm run build:linux       # pacman package
```

Tests live next to source as `*.test.ts`. They run under Electron-as-Node (same as the CLI and MCP), so they share the app's `better-sqlite3` ABI — no per-context rebuilds. Run `npm test` once or `npm run test:watch` in a side terminal.

For working in this repo with Claude Code, see [`CLAUDE.md`](./CLAUDE.md) — conventions, hook setup, and project-specific gotchas.

## License

MIT. See [`LICENSE`](./LICENSE).
