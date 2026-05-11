import type { Command } from "commander";
import { deleteTask, getTask, resolveTaskId } from "../../../shared/domain/tasks";
import { confirmYesNo } from "../../confirm";
import { withProjectDb } from "../../context";

interface RemoveOptions {
  yes?: boolean;
}

export function removeCommand(parent: Command): void {
  parent
    .command("remove <id>")
    .alias("rm")
    .description("Delete a task and its subtasks")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (idInput: string, opts: RemoveOptions) => {
      // Resolve + count subtasks before the prompt so the message can warn
      // about cascade impact. Keeps the prompt-and-then-delete logic in two
      // separate withProjectDb scopes; the second pins to the same id so a
      // concurrent delete simply makes the second call a no-op.
      const target = withProjectDb(({ db }) => {
        const stub = resolveTaskId(db, idInput);
        const hydrated = getTask(db, stub.id);
        const subtaskCount = hydrated ? listSubtaskCount(db, hydrated.id) : 0;
        return { id: stub.id, title: stub.title, subtaskCount };
      });

      if (!opts.yes) {
        const suffix =
          target.subtaskCount > 0
            ? ` (and ${target.subtaskCount} subtask${target.subtaskCount === 1 ? "" : "s"})`
            : "";
        const ok = await confirmYesNo(`Delete ${target.id.slice(-6)} '${target.title}'${suffix}?`);
        if (!ok) {
          console.log("Aborted.");
          return;
        }
      }

      withProjectDb(
        ({ db }) => {
          deleteTask(db, target.id);
          console.log(`Deleted ${target.id.slice(-6)}  ${target.title}`);
        },
        { notify: true },
      );
    });
}

function listSubtaskCount(db: Parameters<typeof getTask>[0], parentId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?`).get(parentId) as {
    n: number;
  };
  return row.n;
}
