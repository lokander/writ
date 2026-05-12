/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Short git SHA of the build's HEAD, or `"dev"` in dev runs, or
 *  `"unknown"` if git wasn't available at build time. Injected by
 *  electron.vite.config.ts via Vite's `define`. */
declare const __APP_COMMIT__: string;

/** package.json `version` field, frozen into the bundle at build time. */
declare const __APP_VERSION__: string;
