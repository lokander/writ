import { execSync } from "node:child_process";
import { defineConfig } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

import pkg from "./package.json" with { type: "json" };

/** Short git SHA of the current HEAD, captured at config-load (build) time
 *  and frozen into the bundle via Vite's `define`. The renderer reads it
 *  as `__APP_COMMIT__` so the About dialog can show "writ 1.0.0 (abc1234)".
 *
 *  We literal-substitute `"dev"` in `electron-vite dev` runs — the file on
 *  disk may be ahead of (or behind) the running renderer, so showing
 *  HEAD's hash in dev would be misleading. The cue "this is a dev build"
 *  is what the About dialog needs to communicate.
 *
 *  Falls back to `"unknown"` when git isn't available (e.g. tarball install
 *  in CI without the .git dir) so the bundle still builds. */
function resolveCommitHash(isDev: boolean): string {
  if (isDev) return "dev";
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const commit = resolveCommitHash(isDev);
  const defines = {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_VERSION__: JSON.stringify(pkg.version),
  };
  return {
    main: { define: defines },
    preload: { define: defines },
    renderer: {
      define: defines,
      plugins: [tailwindcss(), svelte()],
    },
  };
});
