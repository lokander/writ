import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// CLI integration tests shell out to `bin/writ-dev` (Electron-as-Node) per
// `runWrit` call. With unbounded concurrency the suite fans out to dozens
// of simultaneous Electron spawns, which under external load (a parallel
// build, IDE indexing) blow past the per-test timeout at random — the
// "task-list / task-edit / tags integration timed out" flakes tracked in
// 2T2GFR.
//
// Two knobs together keep fan-out bounded:
//   - `maxWorkers: 4`        — file-level parallelism cap
//   - `maxConcurrency: 2`    — per-file `it.concurrent` cap
// So the worst case is 4 × 2 = 8 simultaneous CLI tests, each running
// ~3-5 sequential subprocesses. `testTimeout: 30000` is the safety margin
// for the cases where a single Electron-as-Node startup still spikes
// under contention; `runWrit` itself has a 20s per-subprocess cap that
// produces clearer error messages than vitest's "test timed out".
//
// `svelte()` plugin compiles .svelte SFCs that renderer tests import. Tests
// pick the DOM emulator via a per-file `// @vitest-environment happy-dom`
// pragma — keeping the default at "node" means the existing CLI / domain /
// MCP suites don't pay the happy-dom startup cost, only renderer files do.
// The setup file pulls in jest-dom's matchers (`toBeInTheDocument`, etc.)
// for the renderer tests; node-env tests don't load it.
export default defineConfig({
  plugins: [svelte({ hot: false })],
  // Resolve the svelte package's "browser" export condition (its client
  // runtime) — otherwise vitest picks up "node" and mount() lands on the
  // server build, which throws lifecycle_function_unavailable when a
  // component tries to mount in a happy-dom test.
  resolve: { conditions: ["browser"] },
  test: {
    testTimeout: 30000,
    maxWorkers: 4,
    minWorkers: 1,
    maxConcurrency: 2,
    setupFiles: ["./src/renderer/src/test-setup.ts"],
  },
});
