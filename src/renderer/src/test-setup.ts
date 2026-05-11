// Vitest setup loaded for every test file (see vitest.config.ts → setupFiles).
//
// Two jobs:
//   1. Register @testing-library/jest-dom's matchers (`toBeInTheDocument`,
//      `toHaveTextContent`, `toBeDisabled`, …) so renderer tests can use
//      them via vitest's `expect`.
//   2. Run @testing-library/svelte's cleanup after each test so component
//      DOM doesn't leak between cases.
//
// Both libraries no-op when imported in a node environment (the matchers
// register but stay unused; cleanup needs a DOM but happy-dom-environment
// tests opt in via `// @vitest-environment happy-dom`). The bare imports
// are safe in non-renderer suites for that reason.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Lazily import cleanup so node-env tests don't drag the testing-library
// module graph in for nothing. The dynamic import only resolves when an
// afterEach hook actually runs in a DOM-equipped environment.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/svelte");
  cleanup();
});
