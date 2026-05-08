# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**writ is in active early development.** Shipped: the shared domain layer (`src/shared/{types,db,domain}`), the CLI (`writ init`, `writ task add | list | view | move | edit | rm`, plus bare `writ task <id>` as a `view` shortcut), and the stdio MCP server (`writ mcp`, `src/mcp/`) with seven task tools. The Electron renderer is still a placeholder; `src/main` and `src/renderer` carry only the minimum needed to keep `npm run dev` building.

`.mcp.json` at the repo root registers writ's own MCP server (`./bin/writ-dev mcp`), so a Claude Code session opened in this repo gets `mcp__writ__*` tools alongside its in-session task tools. The user tracks ongoing work in writ via these tools — when proposing new tasks, add them to writ via `mcp__writ__create_task`, _not_ to the in-session task list, and don't start work on them until the user gives the go-ahead.

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

Tests use vitest. Test files live next to source as `*.test.ts` and are auto-discovered. The in-memory DB helper is `src/shared/test-utils.ts` (`makeTestDb()`) — wraps `openDatabase(":memory:")` with migrations and default columns seeded; use it instead of touching the filesystem. Tests run under Node, so they need the CLI ABI of `better-sqlite3` (`npm run sqlite:build-for-cli`) — same as the CLI/MCP. There is no save-on-test hook; run `npm test` (or keep `npm run test:watch` running in a terminal) yourself.

## TypeScript project layout

Three TS projects, root `tsconfig.json` references both children. **Where you put a file determines which config type-checks it.**

- `tsconfig.node.json` — covers `src/main/**`, `src/preload/**`, `src/shared/**`, `src/cli/**`, and `src/mcp/**`. Node/Electron runtime. Strict.
- `tsconfig.web.json` — covers `src/renderer/src/**` (including `.svelte`) and `src/shared/types/**` so the renderer can import data types. Browser/DOM lib. **`strict: false`**, `verbatimModuleSyntax: true`. Never include `src/shared/db` or `src/shared/domain` here — they pull in `better-sqlite3`/`fs`. Treat the looser strictness as a pragmatic choice for UI code, not license to write sloppy types in shared logic.

The CLI and MCP server are Node entry points; do not import Electron APIs from them. The shared domain library must be importable from all three contexts (renderer, main, CLI/MCP) — keep it framework-free.

## Framework conventions

- **Svelte 5 with runes.** `package.json` pins `svelte ^5.45`. Use `$state`, `$derived`, `$effect`, `$props`. Don't reach for the Svelte 4 store/`export let` patterns even though some still compile.
- **`$state.snapshot()` before IPC.** Reactive `$state` values are Proxies and are not structured-cloneable, so `ipcRenderer.invoke` rejects them with `An object could not be cloned.` Spread (`{...obj}`) and `Array.from()` only flatten the top level — nested fields stay reactive and still throw. Always deep-clone with `$state.snapshot()` before sending state across IPC.
- **`untrack` reads in state-class methods called from `$effect`.** Reactive reads inside a method leak as dependencies of any `$effect` that calls the method. A `dismiss()` that reads `this.dialog` will be re-run by an unrelated write to `dialog`, which can synchronously cancel work that just started. Symptom: "the promise resolved before the user could click anything." Wrap such reads in `untrack(() => ...)`.
- **Renderer mounts via `mount()`** (not `new App({ target })`). See `src/renderer/src/main.ts`.
- **Preload uses `contextBridge`** with context isolation on, sandbox off. Renderer talks to main via the typed `window.api` surface declared in `src/preload/index.d.ts` — extend that type when adding IPC channels rather than reaching for `(window as any)`. Anything passed to `invoke`/`send` must be structured-cloneable: no class instances, functions, Proxies, or DOM nodes.
- **Electron 39, single ABI everywhere via Electron-as-Node.** `better-sqlite3` is a native module; the `postinstall` hook (`electron-builder install-app-deps`) rebuilds it for Electron's Node ABI, and that's the only ABI that ever matters because the CLI, MCP server, and tests **all run under `ELECTRON_RUN_AS_NODE=1 electron …`** — sharing Electron's bundled Node and its ABI. `bin/writ-dev`, `npm run cli`, `npm test`, and `npm run dev` are all Electron-as-Node entry points. There's no flip-flop and no per-context rebuild. If `NODE_MODULE_VERSION` mismatch ever does fire (e.g. after a botched install), `npm run sqlite:rebuild` forces a clean rebuild.

- **`task edit` editor resolution.** `$WRIT_EDITOR` → `$VISUAL` → `$EDITOR`; no fallback to `vi`, no peek at `git config core.editor`. For VS Code the `--wait` flag is critical — without it `code` returns immediately and the command thinks the user is done.

## Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/). Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `build`. Scope is optional but useful — sensible scopes here are `cli`, `domain`, `db`, `mcp`, `renderer`, `main`, `build`. Imperative-mood subject under ~70 chars; explain _why_ in the body when the diff doesn't make it obvious.

## Architectural rules from `design.md` worth restating

- **One writer.** All mutations to `.writ/writ.db` go through `src/shared/domain/`. The Electron main process, the CLI, and the MCP server are all thin shims over that module. Don't add a second code path that mutates the DB.
- **No app dependency for MCP/CLI.** `writ task add` and `writ mcp` must work when the Electron app is not running. The desktop app is a viewer/editor, not a server.
- **Project discovery walks up from cwd**, like git finds `.git`. The same `findProjectRoot(cwd)` helper is used by the CLI, the MCP server, and the "open project" flow in main.
- **Two binaries, one user-facing name.** `writ` is a fast Node CLI; it spawns the Electron binary only for `writ` with no subcommand. Never make a Node CLI subcommand pay Chromium boot cost.

## Memory and design.md

The user keeps durable architectural rationale in `~/.claude/projects/-home-lok-projects-writ/memory/` (loaded automatically). `design.md` is the in-repo, code-adjacent version. When they conflict, prefer `design.md` and update memory. When implementation diverges from both, ask before silently choosing.
