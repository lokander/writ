import { createInterface } from "node:readline/promises";

// Y/N prompt for destructive CLI commands. Bails (exit 1) when stdin isn't a
// TTY — piping into `writ tags rm foo` without `--yes` would otherwise hang
// the test runner / shell pipeline forever waiting on a response that can't
// arrive. Callers gate on `--yes` first; this is the interactive fallback.
export async function confirmOrExit(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    process.stderr.write("Refusing to prompt: stdin is not a TTY. Re-run with --yes.\n");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${prompt} [y/N]: `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
