import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";

import { handleCliError } from "../context";

interface ImportPromptOptions {
  file?: string;
}

// We deliberately don't read writState here (writ might not be init'd yet —
// the user is migrating INTO writ) and we don't call MCP tools — the whole
// command is templated text routed to stdout so it composes with pipes /
// clipboard tools (`writ import-prompt | wl-copy`, etc.). The agent the
// user pastes this to is what actually drives the migration.
export function importPromptCommand(): Command {
  return new Command("import-prompt")
    .description("Print an agent prompt for migrating an existing TODO file into this writ project")
    .option(
      "--file <path>",
      "Inline the file's contents into the prompt so the agent doesn't have to read it from disk. Useful with `--file TODO.md | wl-copy` to paste straight into a chat.",
    )
    .action((opts: ImportPromptOptions) => {
      let inlineBlock = "";
      if (opts.file !== undefined) {
        const absPath = resolve(process.cwd(), opts.file);
        let contents: string;
        try {
          contents = readFileSync(absPath, "utf8");
        } catch (e) {
          handleCliError(e instanceof Error ? e : new Error(String(e)));
        }
        inlineBlock =
          `\n## Source file: ${absPath}\n\n` +
          "Read the contents below — don't fetch from disk, this is the canonical copy for this migration.\n\n" +
          "```\n" +
          contents +
          (contents.endsWith("\n") ? "" : "\n") +
          "```\n";
      } else {
        inlineBlock =
          "\n## Source\n\n" +
          "Ask the user which file (or files) to migrate. Read them via your filesystem tools.\n" +
          "If they instead pasted the contents directly, work from that copy.\n";
      }

      process.stdout.write(renderPrompt(inlineBlock));
    });
}

function renderPrompt(inlineBlock: string): string {
  return `You are migrating a TODO file into a writ project via the \`mcp__writ__*\` tools.

The source is some structured representation of tasks — could be a bullet list, table, numbered sections, prose under headings, whatever. Figure out its shape first, then propose how that maps onto writ before you create anything.

## Two axes the source probably collapses

- **Subtask** (\`parent_id\`) — hierarchical containment. Use when one task clearly belongs inside another.
- **Dependency** (\`depends_on\`) — blocker relationship. Use only when the source explicitly says "blocked by X" / "after X" / similar.

## Workflow

1. Read the source and call \`mcp__writ__list_columns\` + \`mcp__writ__list_tags\` so you know what's already in use.
2. **Ask the user whether to cross-reference each task against the current codebase.** If yes, while building the mapping you'll also:
   - Pull in concrete file/symbol references to write richer descriptions.
   - Flag tasks that look already implemented (fully → candidate for \`Done\`/\`Archived\`; partially → ask whether to split out remaining work as subtasks).
   If no, work from the source text alone.
3. **Propose a mapping before creating anything.** Show the user:
   - What you take the source's structure to be.
   - How its categories / status markers / sections map to writ columns and tags.
   - How you'll handle hierarchy and dependencies, if any.
   - Per-task notes from the codebase pass, if step 2 was on.
   - Anything you're unsure about per task — ask, don't guess. Surfacing five short questions is cheaper than landing fifty wrong tasks.
4. After the user confirms, create one task at a time via \`mcp__writ__create_task\`. For nested cases, create the parent first and feed its \`id\` to children.

## Guardrails

- Don't invent columns. Map to one that already exists (from \`list_columns\`); ask if nothing fits.
- **Do** invent tags as needed — they auto-create on first use. Pick logical ones from the task content (theme, area, kind of work). Reuse any tag already returned by \`list_tags\` rather than coining a near-duplicate (\`ui\` vs \`UI\` vs \`frontend\`).
- Don't batch-create without showing the mapping first.
- Don't migrate clearly-stale "done" items as live tasks — drop them or land in \`Archived\` per the user's call.
- Default priority is \`normal\`. Only bump when the source is explicit.
- Call \`mcp__writ__list_tasks\` if you suspect overlap with existing tasks; ask before creating likely duplicates.
- Descriptions are markdown — prettify, don't copy-paste. Short paragraph for context, bullets for sub-points, code spans for symbols / paths. Backtick-wrap a task's \`short_id\` (last 6 chars of its ulid, e.g. \`ABCDEF\`) to auto-link it in the desktop renderer — handy when one task references another you just created.
${inlineBlock}`;
}
