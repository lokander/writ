# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**writ is in active early development.** The CLI (`writ`, `bin/writ-dev`), the stdio MCP server (`writ mcp`), and the Electron renderer all sit on top of the shared domain layer in `src/shared/{types,db,domain}`. For what's currently shipped, in flight, or deferred — query writ itself via the `mcp__writ__*` tools (especially `list_tasks` per column). We're dogfooding, so writ is the source of truth for project state, not this file.

`.mcp.json` at the repo root registers writ's own MCP server (`./bin/writ-dev mcp`), so a Claude Code session opened in this repo gets `mcp__writ__*` tools alongside its in-session task tools. The user tracks ongoing work in writ via these tools — when proposing new tasks, add them to writ via `mcp__writ__create_task`, _not_ to the in-session task list, and don't start work on them until the user gives the go-ahead.

**When work on a task in `Doing` looks finished, actively ask whether to finalize it before moving on.** Don't assume the user will remember to close it out — they often won't, especially after ad-hoc scope changes mid-implementation. Surface what shipped vs. the original task description, flag any scope that drifted into separate follow-ups, and ask: mark it Done, or is there more? Then either move it via `mcp__writ__move_task` to `Done` (and split out leftovers as new backlog tasks) or keep it in `Doing` per the user's call.

**Commit before moving the task to `Done`, not after.** Keeps the git history aligned with the column transition — when you (or git blame) look back at the commit that closed the task, the diff matches what was finalized. Also forces a sanity check on the working tree: if there's nothing to commit when you go to finalize, slice 2 wasn't really done. Sequence: confirm finalization with the user → commit → `mcp__writ__move_task` to `Done`.

**`design.md` at the repo root is the architectural source of truth.** Read it before making non-trivial changes. It defines: per-project SQLite at `<repo>/.writ/writ.db`, two binaries (a fast Node `writ` CLI plus the Electron app it can launch), a stdio MCP server (`writ mcp`) that writes SQLite directly with a best-effort liveness ping to a running desktop app, a shared domain layer that the CLI, MCP server, and Electron main process all import, and a phased build plan starting with scaffold cleanup and the data layer.

If a change deviates from `design.md`, update `design.md` in the same change — don't let code and design drift.

## Commands

```bash
npm install              # also runs electron-builder install-app-deps via postinstall
npm run dev              # launch Electron with HMR (electron-vite dev)
npm run start            # preview built app (electron-vite preview)

npm run lint             # ESLint flat config, cached
npm run format           # Prettier with prettier-plugin-svelte across the repo
npm run typecheck        # runs typecheck:node AND svelte-check; both must pass
npm run typecheck:node   # tsc on main + preload (tsconfig.node.json)
npm run svelte-check     # svelte-check on the renderer

npm test                 # vitest run (one-shot)
npm run test:watch       # vitest in watch mode
npm run test:ui          # vitest browser UI

npm run cli -- <args>    # run the CLI from the project root (Electron-as-Node + tsx)
bin/writ-dev <args>      # same, runnable from any cwd (testing findProjectRoot)

npm run sqlite:rebuild   # force-rebuild better-sqlite3 for Electron's ABI (rarely needed)

npm run build            # typecheck then electron-vite build (out/)
npm run build:unpack     # build + electron-builder --dir (no installer)
npm run build:linux      # AppImage + snap + deb
npm run build:mac        # dmg
npm run build:win        # nsis installer
```

**Don't run lint/format/typecheck manually after edits.** Hooks in `.claude/settings.json` run prettier, eslint, `typecheck:node`, and `svelte-check` automatically after every Edit/Write to a matching file, scoped by path. **Prettier and eslint block** on failure (exit 2) so style and lint issues get fixed immediately. **Typecheck and svelte-check warn but don't block** — failures print to stderr and you'll see them inline, but they don't halt the next tool call. This keeps multi-file refactors viable; just make sure tsc is clean before committing. Use the scripts above when you want to run them across the whole tree.

Hook scope (which check fires for which path):

| Path                                 | prettier | eslint | tsc:node | svelte-check |
| ------------------------------------ | -------- | ------ | -------- | ------------ |
| `src/main/**`, `src/preload/**`      | ✓        | ✓      | ✓        |              |
| `src/shared/**`                      | ✓        | ✓      | ✓        | ✓            |
| `src/cli/**`, `src/mcp/**`           | ✓        | ✓      | ✓        |              |
| `src/renderer/**` (`.ts`, `.svelte`) | ✓        | ✓      |          | ✓            |
| `*.{md,json,yml,css,html,...}`       | ✓        |        |          |              |

Tests use vitest. Test files live next to source as `*.test.ts` and are auto-discovered. The in-memory DB helper is `src/shared/test-utils.ts` (`makeTestDb()`) — wraps `openDatabase(":memory:")` with migrations and default columns seeded; use it instead of touching the filesystem. Tests run under Electron-as-Node (same as the CLI and MCP), so they share the app's better-sqlite3 ABI; no flip needed. There is no save-on-test hook; run `npm test` (or keep `npm run test:watch` running in a terminal) yourself.

## TypeScript project layout

Three TS projects, root `tsconfig.json` references both children. **Where you put a file determines which config type-checks it.**

- `tsconfig.node.json` — covers `src/main/**`, `src/preload/**`, `src/shared/**`, `src/cli/**`, and `src/mcp/**`. Node/Electron runtime. Strict.
- `tsconfig.web.json` — covers `src/renderer/src/**` (including `.svelte`) and `src/shared/types/**` so the renderer can import data types. Browser/DOM lib. **`strict: false`**, `verbatimModuleSyntax: true`. Never include `src/shared/db` or `src/shared/domain` here — they pull in `better-sqlite3`/`fs`. Treat the looser strictness as a pragmatic choice for UI code, not license to write sloppy types in shared logic.

Do **NOT** add `composite: true` to `tsconfig.web.json` to "satisfy" the project-references warning. The renderer config includes `src/preload/*.d.ts` (the hand-written `window.api` augmentation), and a composite project wants to emit `index.d.ts` from `src/preload/index.ts` — collision. Instead, `npm run svelte-check` already targets `tsconfig.web.json` directly, sidestepping the references-must-be-composite check entirely.

The CLI and MCP server are Node entry points; do not import Electron APIs from them. The shared domain library must be importable from all three contexts (renderer, main, CLI/MCP) — keep it framework-free.

## Framework conventions

- **Svelte 5 with runes.** `package.json` pins `svelte ^5.45`. Use `$state`, `$derived`, `$effect`, `$props`. Don't reach for the Svelte 4 store/`export let` patterns even though some still compile.
- **`$state.snapshot()` before IPC.** Reactive `$state` values are Proxies and are not structured-cloneable, so `ipcRenderer.invoke` rejects them with `An object could not be cloned.` Spread (`{...obj}`) and `Array.from()` only flatten the top level — nested fields stay reactive and still throw. Always deep-clone with `$state.snapshot()` before sending state across IPC.
- **`untrack` reads that should NOT be tracked.** Two cases come up:
  - **In state-class methods called from `$effect`.** Reactive reads inside a method leak as dependencies of any `$effect` that calls the method. A `dismiss()` that reads `this.dialog` will be re-run by an unrelated write to `dialog`, which can synchronously cancel work that just started. Symptom: "the promise resolved before the user could click anything." Wrap such reads in `untrack(() => ...)`.
  - **In `$state` initializers that read props.** `let title = $state(task.title)` triggers `state_referenced_locally` because Svelte can't tell whether you wanted a one-shot capture or a missed reactivity. When the parent re-mounts via `{#key}` (so capture-on-mount IS what you want), wrap the initializer: `let title = $state(untrack(() => task.title))`.
- **Renderer mounts via `mount()`** (not `new App({ target })`). See `src/renderer/src/main.ts`.
- **Preload uses `contextBridge`** with context isolation on, sandbox off. Renderer talks to main via the typed `window.api` surface declared in `src/preload/index.d.ts` — extend that type when adding IPC channels rather than reaching for `(window as any)`. Anything passed to `invoke`/`send` must be structured-cloneable: no class instances, functions, Proxies, or DOM nodes.
- **Electron 39, single ABI everywhere via Electron-as-Node.** `better-sqlite3` is a native module; the `postinstall` hook (`electron-builder install-app-deps`) rebuilds it for Electron's Node ABI, and that's the only ABI that ever matters because the CLI, MCP server, and tests **all run under `ELECTRON_RUN_AS_NODE=1 electron …`** — sharing Electron's bundled Node and its ABI. `bin/writ-dev`, `npm run cli`, `npm test`, and `npm run dev` are all Electron-as-Node entry points. There's no flip-flop and no per-context rebuild. If `NODE_MODULE_VERSION` mismatch ever does fire (e.g. after a botched install), `npm run sqlite:rebuild` forces a clean rebuild.

- **`task edit` editor resolution.** `$WRIT_EDITOR` → `$VISUAL` → `$EDITOR`; no fallback to `vi`, no peek at `git config core.editor`. For VS Code the `--wait` flag is critical — without it `code` returns immediately and the command thinks the user is done.

- **phosphor-svelte icons use the `Icon` suffix.** Always import the suffixed names (`PlusIcon`, `XIcon`, `LockSimpleIcon`), not the bare ones (`Plus`, `X`, `LockSimple`). The un-suffixed exports still work but are deprecated and will warn in editor tooling. The package README also recommends per-icon imports (`import PlusIcon from "phosphor-svelte/lib/PlusIcon"`) for faster compilation, but we use named imports from the package root for now — fine until compile time becomes a real pain point.

- **Drag-and-drop goes through `lib/dnd.ts`, not pragmatic-drag-and-drop directly.** The wrappers turn Pragmatic's imperative API into idiomatic Svelte actions (`use:draggable={…}`, `use:dropTarget={…}`), with a `current`-closure ref so action params can change after mount without going stale. Extend the wrappers when adding new dnd behavior (closest-edge hints, custom previews, etc.) — don't call Pragmatic directly from components.

## Domain conventions

- **Tag specs** are `NAME` or `NAME=COLOR`. Names match `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`. Colors accept `#rgb`/`#rrggbb` hex or one of the 147 CSS named colors; both are normalized lowercase. NULL color means "let the renderer hash the name to a DaisyUI palette slot." Color is a tag-level property — once set, it applies wherever the tag appears.
- **Dependencies form a strict DAG.** `setDependencies` / `addDependency` reject cycles via a forward BFS through `task_dependencies`. "Done" detection (for `isReady` / `blockedBy`) matches columns whose name is `Done` (case-insensitive), the same convention `task list --show-done` uses.
- **`Task` hydration.** `tags`, `dependsOn`, `blockedBy`, `isReady` are populated by `getTask` / `listTasks` (with bulk loaders to avoid N+1). `resolveTaskId` is a cheap suffix-resolver that returns an unhydrated stub — call `getTask(db, resolved.id)` if you need the full record.
- **Migrations auto-apply on every project open.** `resolveProjectDb` (CLI), `withDb` (MCP), and `openCurrentProject` (main) all run `applyMigrations`. New schema versions land for existing projects without re-init.
- **`task list` rendering.** Default is hierarchical-by-column (subtasks indented under their parent, regardless of the child's column — `[Col]` badge if it differs). Narrowing filters (`--tag`, `--any-tag`, `--ready`, `--blocked`) switch to flat-per-column so child matches whose parent doesn't match still surface.

## Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `build`. Scope is optional but useful — sensible scopes here are `cli`, `domain`, `db`, `mcp`, `renderer`, `main`, `build`. Imperative-mood subject under ~70 chars; explain _why_ in the body when the diff doesn't make it obvious.

## Architectural rules from `design.md` worth restating

- **One writer.** All mutations to `.writ/writ.db` go through `src/shared/domain/`. The Electron main process, the CLI, and the MCP server are all thin shims over that module. Don't add a second code path that mutates the DB.
- **No app dependency for MCP/CLI.** `writ task add` and `writ mcp` must work when the Electron app is not running. The desktop app is a viewer/editor, not a server.
- **Project discovery walks up from cwd**, like git finds `.git`. The same `findProjectRoot(cwd)` helper is used by the CLI, the MCP server, and the "open project" flow in main.
- **Two binaries, one user-facing name.** `writ` is a fast Node CLI; it spawns the Electron binary only for `writ` with no subcommand. Never make a Node CLI subcommand pay Chromium boot cost.

## Memory and design.md

The user keeps durable architectural rationale in `~/.claude/projects/-home-lok-projects-writ/memory/` (loaded automatically). `design.md` is the in-repo, code-adjacent version. When they conflict, prefer `design.md` and update memory. When implementation diverges from both, ask before silently choosing.

**When referring to a writ task, use the last 6 chars of the ulid** (e.g. `KENMJM`, not `MJM`). Matches what `task list` and the renderer cards show, so the user can copy-paste between conversation and the UI.
