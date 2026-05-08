# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**writ is pre-implementation.** The current `src/` is the unmodified electron-vite + Svelte scaffold (Versions.svelte demo, `ping` IPC roundtrip, electron logo). Treat it as a deletion target, not a foundation.

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

npm run build            # typecheck then electron-vite build (out/)
npm run build:unpack     # build + electron-builder --dir (no installer)
npm run build:linux      # AppImage + snap + deb
npm run build:mac        # dmg
npm run build:win        # nsis installer
```

There is no test runner configured yet. When adding the data layer, pick one (vitest is the natural fit alongside Vite) and wire `npm test` before writing tests against `shared/domain/`.

## TypeScript project layout

Three TS projects, root `tsconfig.json` references both children. **Where you put a file determines which config type-checks it.**

- `tsconfig.node.json` — covers `src/main/**` and `src/preload/**`. Node/Electron runtime. Strict.
- `tsconfig.web.json` — covers `src/renderer/src/**` (including `.svelte`). Browser/DOM lib. **`strict: false`**, `verbatimModuleSyntax: true`. Treat the looser strictness as a pragmatic choice for UI code, not license to write sloppy types in shared logic.
- New top-level dirs from `design.md` (`src/shared/`, `src/cli/`, `src/mcp/`) are not yet covered by either config. Add them to `tsconfig.node.json`'s `include` (they all run under Node) when you create them.

The CLI and MCP server are Node entry points; do not import Electron APIs from them. The shared domain library must be importable from all three contexts (renderer, main, CLI/MCP) — keep it framework-free.

## Framework conventions

- **Svelte 5 with runes.** `package.json` pins `svelte ^5.45`. Use `$state`, `$derived`, `$effect`, `$props`. Don't reach for the Svelte 4 store/`export let` patterns even though some still compile.
- **`$state.snapshot()` before IPC.** Reactive `$state` values are Proxies and are not structured-cloneable, so `ipcRenderer.invoke` rejects them with `An object could not be cloned.` Spread (`{...obj}`) and `Array.from()` only flatten the top level — nested fields stay reactive and still throw. Always deep-clone with `$state.snapshot()` before sending state across IPC.
- **`untrack` reads in state-class methods called from `$effect`.** Reactive reads inside a method leak as dependencies of any `$effect` that calls the method. A `dismiss()` that reads `this.dialog` will be re-run by an unrelated write to `dialog`, which can synchronously cancel work that just started. Symptom: "the promise resolved before the user could click anything." Wrap such reads in `untrack(() => ...)`.
- **Renderer mounts via `mount()`** (not `new App({ target })`). See `src/renderer/src/main.ts`.
- **Preload uses `contextBridge`** with context isolation on, sandbox off. Renderer talks to main via the typed `window.api` surface declared in `src/preload/index.d.ts` — extend that type when adding IPC channels rather than reaching for `(window as any)`. Anything passed to `invoke`/`send` must be structured-cloneable: no class instances, functions, Proxies, or DOM nodes.
- **Electron 39, Node 22+.** `better-sqlite3` is a native module; the `postinstall` hook (`electron-builder install-app-deps`) rebuilds it against Electron's Node ABI. **Dual-ABI gotcha during dev:** the CLI runs under regular Node (via `tsx`), so a fresh `npm install` leaves better-sqlite3 in Electron-ABI mode and the CLI throws `NODE_MODULE_VERSION` on first use. Toggle as needed:
  - For CLI/MCP work: `npm run sqlite:build-for-cli` (rebuilds for current Node)
  - For Electron dev (`npm run dev`): `npm run sqlite:build-for-app` (rebuilds for Electron)

  At packaging time the CLI bundle and the Electron app each ship their own ABI-correct copy, so this friction is dev-only. If a native module errors at startup with `NODE_MODULE_VERSION` mismatch, the wrong-ABI build is almost always the cause — flip and retry before debugging anything deeper.

## Architectural rules from `design.md` worth restating

- **One writer.** All mutations to `.writ/writ.db` go through `src/shared/domain/`. The Electron main process, the CLI, and the MCP server are all thin shims over that module. Don't add a second code path that mutates the DB.
- **No app dependency for MCP/CLI.** `writ task add` and `writ mcp` must work when the Electron app is not running. The desktop app is a viewer/editor, not a server.
- **Project discovery walks up from cwd**, like git finds `.git`. The same `findProjectRoot(cwd)` helper is used by the CLI, the MCP server, and the "open project" flow in main.
- **Two binaries, one user-facing name.** `writ` is a fast Node CLI; it spawns the Electron binary only for `writ` with no subcommand. Never make a Node CLI subcommand pay Chromium boot cost.

## Memory and design.md

The user keeps durable architectural rationale in `~/.claude/projects/-home-lok-projects-writ/memory/` (loaded automatically). `design.md` is the in-repo, code-adjacent version. When they conflict, prefer `design.md` and update memory. When implementation diverges from both, ask before silently choosing.
