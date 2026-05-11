import type { Command } from "commander";

import { listTags, listTagsWithCounts } from "../../../shared/domain/tags";
import { withProjectDb } from "../../context";

interface ListOptions {
  withCounts?: boolean;
}

export function listCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
    .description("List every tag with its color, sorted by name")
    .option("--with-counts", "Include the number of tasks currently using each tag")
    .action((opts: ListOptions) => {
      withProjectDb(({ db }) => {
        if (opts.withCounts) {
          const tags = listTagsWithCounts(db);
          if (tags.length === 0) {
            console.log("No tags.");
            return;
          }
          const nameWidth = Math.max(...tags.map((t) => t.name.length));
          const colorWidth = Math.max(...tags.map((t) => (t.color ?? "—").length), 5);
          for (const t of tags) {
            console.log(
              `${t.name.padEnd(nameWidth)}  ${(t.color ?? "—").padEnd(colorWidth)}  ${t.usageCount}`,
            );
          }
          return;
        }
        const tags = listTags(db);
        if (tags.length === 0) {
          console.log("No tags.");
          return;
        }
        const nameWidth = Math.max(...tags.map((t) => t.name.length));
        for (const t of tags) {
          console.log(`${t.name.padEnd(nameWidth)}  ${t.color ?? "—"}`);
        }
      });
    });
}
