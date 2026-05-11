import type { Command } from "commander";

import { listTagsWithCounts, pruneOrphanTags } from "../../../shared/domain/tags";
import { confirmOrExit } from "../../confirm";
import { withProjectDb } from "../../context";

interface PruneOptions {
  yes?: boolean;
  dryRun?: boolean;
}

export function pruneCommand(parent: Command): void {
  parent
    .command("prune")
    .description("Remove every tag with zero task references")
    .option("-y, --yes", "Skip the confirmation prompt")
    .option("--dry-run", "Print the candidates without deleting anything")
    .action(async (opts: PruneOptions) => {
      // We split the dry-run path from the actual delete so the user can see
      // exactly which tags would go before saying yes. The delete reuses the
      // same orphan-list as the preview via pruneOrphanTags' transaction.
      const candidates = withProjectDb(({ db }) =>
        listTagsWithCounts(db)
          .filter((t) => t.usageCount === 0)
          .map((t) => t.name),
      );

      if (candidates.length === 0) {
        console.log("No orphan tags to prune.");
        return;
      }

      if (opts.dryRun) {
        console.log(`Would prune ${candidates.length} tag${candidates.length === 1 ? "" : "s"}:`);
        for (const name of candidates) console.log(`  ${name}`);
        return;
      }

      console.log(
        `Will prune ${candidates.length} tag${candidates.length === 1 ? "" : "s"}: ${candidates.join(", ")}`,
      );
      if (!opts.yes) {
        const ok = await confirmOrExit("Proceed?");
        if (!ok) {
          console.log("Aborted.");
          return;
        }
      }

      const removed = withProjectDb(({ db }) => pruneOrphanTags(db), { notify: true });
      if (removed.length === 0) {
        // Race: someone reattached one of the candidates between our preview
        // and the delete. Surface the discrepancy rather than silently
        // claiming success on zero rows.
        console.log("Nothing pruned (candidates were re-used by a concurrent write).");
        return;
      }
      console.log(`Pruned ${removed.length} tag${removed.length === 1 ? "" : "s"}.`);
    });
}
