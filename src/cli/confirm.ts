import { createInterface } from "node:readline/promises";

// Y/N prompt for destructive CLI commands. Always asks at the terminal;
// callers bypass via `--yes`. Bails (exit 1) when stdin isn't a TTY so a
// scripted invocation without `--yes` fails fast instead of hanging on a
// prompt no human can answer.
export async function confirmYesNo(prompt: string): Promise<boolean> {
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
