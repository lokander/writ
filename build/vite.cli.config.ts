import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Read prod deps from package.json so the bundle externalizes them rather
// than inlining — they're resolved at runtime through the node_modules
// inside the packaged app (asar). Inlining commander/zod/etc. would
// duplicate code that's already in the asar's node_modules; externalizing
// keeps the CLI bundle small and shared.
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const NODE_BUILTINS = [
  "child_process",
  "fs",
  "fs/promises",
  "net",
  "os",
  "path",
  "process",
  "readline",
  "stream",
  "url",
  "util",
];
// Vite's lib mode defaults to browser-friendly behavior, so both bare
// ("fs") and prefixed ("node:fs") built-in imports need to be in the
// externals list — otherwise Rollup tries to bundle them and fails.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...NODE_BUILTINS,
  ...NODE_BUILTINS.map((m) => `node:${m}`),
];

export default defineConfig({
  build: {
    outDir: resolve(__dirname, "../out/cli"),
    emptyOutDir: true,
    target: "node22",
    minify: false,
    lib: {
      entry: resolve(__dirname, "../src/cli/index.ts"),
      formats: ["cjs"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external,
    },
    // Don't fail the build on circular deps in our shared/ tree — those
    // are existing patterns, not new ones introduced by bundling.
    chunkSizeWarningLimit: 2000,
  },
});
