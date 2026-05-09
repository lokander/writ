/**
 * Shared helpers for the CLI integration tests. Splitting the suite across
 * multiple `*.integration.test.ts` files lets vitest's worker pool run them
 * in parallel, and `runWrit` is async so `it.concurrent` / `describe.concurrent`
 * can actually overlap subprocess spawns within a single file.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const WRIT_DEV = join(REPO_ROOT, "bin", "writ-dev");

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOpts {
  env?: Record<string, string>;
}

/** Run `fn` against a fresh tempdir; clean up regardless of outcome.
 *  Safe under `it.concurrent` because each call mints its own dir and
 *  the cleanup runs in a try/finally — no shared lifecycle hook. */
export async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "writ-it-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Spawn `bin/writ-dev` and resolve once it exits. */
export function runWrit(cwd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolveResult) => {
    const child = spawn(WRIT_DEV, args, {
      cwd,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      resolveResult({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on("error", (err) => {
      resolveResult({ stdout, stderr: stderr + String(err), exitCode: -1 });
    });
  });
}

/** Convenience: `writ init` and throw if it fails. Most tests need a
 *  project before they can do anything else. */
export async function init(cwd: string): Promise<void> {
  const r = await runWrit(cwd, ["init"]);
  if (r.exitCode !== 0) {
    throw new Error(`init failed (exit ${r.exitCode}): ${r.stderr || r.stdout}`);
  }
}

/** Extract the 6-char ulid suffix from a `Created XXXXXX  title` line. */
export function suffixFromCreated(stdout: string): string {
  const m = stdout.match(/^Created ([A-Z0-9]{6}) /m);
  if (!m) {
    throw new Error(`No 'Created <id>' line in stdout:\n${stdout}`);
  }
  return m[1]!;
}
