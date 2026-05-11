import { defineConfig } from "vitest/config";

// CLI integration tests shell out to `bin/writ-dev` (Electron-as-Node) per
// `runWrit` call. With vitest's default `threads` pool sizing the workers
// to one per CPU (32 on this dev box, plus the CI runners we care about
// have plenty), and each worker running up to `maxConcurrency` `it.concurrent`
// cases at once, full-suite runs can fan out to dozens of simultaneous
// electron spawns. Under that load individual subprocess startups blow
// past the per-test 5s budget at random, surfacing as the "task-list /
// task-edit / tags integration timed out" flakes documented in RANDHA.
//
// Cap the file-level pool to a small number so the integration suite
// doesn't pile up against itself. Unit tests are fast enough that 4 workers
// is still plenty for them — the total wall time is bounded by the
// integration tests either way. Bump the per-test timeout too, as a safety
// margin for the cases where a single subprocess still takes a bit longer
// under contention from in-file `it.concurrent` peers.
export default defineConfig({
  test: {
    testTimeout: 15000,
    maxWorkers: 4,
    minWorkers: 1,
  },
});
