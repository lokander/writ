import type { Command } from "commander";

import { setTagColor } from "../../../shared/domain/tags";
import { handleCliError, withProjectDb } from "../../context";

interface ColorOptions {
  clear?: boolean;
}

export function colorCommand(parent: Command): void {
  parent
    .command("color <name> [color]")
    .description("Set or clear a tag's color (hex `#rgb`/`#rrggbb` or a CSS named color)")
    .option("--clear", "Remove the color override (renderer will hash the name for a palette slot)")
    .action((name: string, colorArg: string | undefined, opts: ColorOptions) => {
      if (opts.clear && colorArg !== undefined) {
        handleCliError(new Error("Pass either a color or --clear, not both."));
      }
      if (!opts.clear && colorArg === undefined) {
        handleCliError(new Error("Pass a color value (or --clear to remove the override)."));
      }
      withProjectDb(
        ({ db }) => {
          const updated = setTagColor(db, name, opts.clear ? null : (colorArg ?? null));
          if (updated.color === null) {
            console.log(`Cleared color on '${name}'.`);
          } else {
            console.log(`Set '${name}' color to '${updated.color}'.`);
          }
        },
        { notify: true },
      );
    });
}
