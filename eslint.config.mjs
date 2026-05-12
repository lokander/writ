import { defineConfig } from "eslint/config";
import tseslint from "@electron-toolkit/eslint-config-ts";
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier";
import eslintPluginSvelte from "eslint-plugin-svelte";

export default defineConfig(
  { ignores: ["**/node_modules", "**/dist", "**/out"] },
  {
    // Build-time constants substituted by Vite's `define` in
    // electron.vite.config.ts. Declared as globals in env.d.ts so
    // TypeScript / svelte-check are happy; ESLint needs the same hint
    // separately so `no-undef` doesn't fire on them.
    languageOptions: {
      globals: {
        __APP_COMMIT__: "readonly",
        __APP_VERSION__: "readonly",
      },
    },
  },
  tseslint.configs.recommended,
  eslintPluginSvelte.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    // Svelte 5 module-reactive files (.svelte.ts / .svelte.js). The Svelte
    // plugin's recommended config doesn't pick these up automatically; tell
    // eslint to parse them with the TS parser so imports and runes parse.
    files: ["**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    files: ["**/*.{tsx,svelte}"],
    rules: {
      "svelte/no-unused-svelte-ignore": "off",
    },
  },
  eslintConfigPrettier,
);
