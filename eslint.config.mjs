import { defineConfig } from "eslint/config";
import tseslint from "@electron-toolkit/eslint-config-ts";
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier";
import eslintPluginSvelte from "eslint-plugin-svelte";

export default defineConfig(
  { ignores: ["**/node_modules", "**/dist", "**/out"] },
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
