import { Command, InvalidArgumentError } from "commander";

import { BASH_COMPLETION } from "../completions/bash";
import { FISH_COMPLETION } from "../completions/fish";
import { ZSH_COMPLETION } from "../completions/zsh";

const SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SHELLS)[number];

const SCRIPTS: Record<Shell, string> = {
  bash: BASH_COMPLETION,
  zsh: ZSH_COMPLETION,
  fish: FISH_COMPLETION,
};

function parseShell(input: string): Shell {
  if ((SHELLS as readonly string[]).includes(input)) {
    return input as Shell;
  }
  throw new InvalidArgumentError(`Unknown shell '${input}'. Supported: ${SHELLS.join(", ")}.`);
}

export function completionCommand(): Command {
  return new Command("completion")
    .description("Print a shell completion script for writ (bash | zsh | fish)")
    .argument("<shell>", "Target shell: bash, zsh, or fish", parseShell)
    .addHelpText(
      "after",
      `\nExamples:
  # bash: eval inline (every new shell) or write to a system dir
  eval "$(writ completion bash)"
  writ completion bash | sudo tee /etc/bash_completion.d/writ

  # zsh: drop into a directory on $fpath, then \`compinit\`
  writ completion zsh > "\${fpath[1]}/_writ"

  # fish: drop into the completions dir (fish auto-loads)
  writ completion fish > ~/.config/fish/completions/writ.fish

Completions are static (subcommand + flag names). Task ids, tags, and
column names aren't completed yet — separate follow-up.`,
    )
    .action((shell: Shell) => {
      process.stdout.write(SCRIPTS[shell]);
    });
}
