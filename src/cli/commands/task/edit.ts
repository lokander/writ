import type { Command } from "commander";
import { getColumnByName, listColumns } from "../../../shared/domain/columns";
import { getTask, resolveTaskId, StaleReadError, updateTask } from "../../../shared/domain/tasks";
import {
  parseTaskFile,
  serializeTaskFile,
  TaskFileParseError,
} from "../../../shared/domain/task-format";
import type { Priority, Task } from "../../../shared/types";
import { withProjectDb } from "../../context";
import { cleanupTempFile, editInExternalEditor } from "../../editor";
import { collectString } from "./options";
import { availableColumns } from "./render";

interface EditOptions {
  tag?: string[];
  dependsOn?: string[];
}

// Compares "incoming spec list" (which may include =COLOR suffixes) against
// the task's current plain tag names. We only short-circuit when the name set
// is identical AND no spec carries a color override. A name-only re-list of
// the same tags is a no-op; passing `--tag UI=red` after `UI` triggers an
// update so the color side-effect goes through.
function sameTagSet(incoming: string[], current: string[]): boolean {
  if (incoming.some((s) => s.includes("="))) return false;
  if (incoming.length !== current.length) return false;
  const a = [...incoming].sort();
  const b = [...current].sort();
  return a.every((v, i) => v === b[i]);
}

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  return aa.every((v, i) => v === bb[i]);
}

function editTaskViaEditor(db: import("../../../shared/db").SqliteDb, task: Task): void {
  const columns = listColumns(db);
  const colName = columns.find((c) => c.id === task.columnId)?.name ?? "";
  const parentSuffix = task.parentId ? task.parentId.slice(-6) : undefined;

  const initial = serializeTaskFile({
    task,
    columnName: colName,
    columnNames: columns.map((c) => c.name),
    parentSuffix,
    dependsOnSuffixes: task.dependsOn.map((id) => id.slice(-6)),
  });
  const filename = `task-${task.id.slice(-6)}.md`;
  const edited = editInExternalEditor(initial, filename);
  let tempPath: string | undefined = edited.tempPath;

  try {
    if (edited.content === initial) {
      console.log("No changes.");
      cleanupTempFile(tempPath);
      tempPath = undefined;
      return;
    }

    const parsed = parseTaskFile(edited.content);
    const update: {
      title?: string;
      description?: string;
      priority?: Priority;
      columnId?: string;
      parentId?: string | null;
      tags?: string[];
      dependsOn?: string[];
    } = {};

    if (parsed.title !== undefined && parsed.title !== task.title) {
      update.title = parsed.title;
    }
    if (parsed.description !== task.description) {
      update.description = parsed.description;
    }
    if (parsed.priority !== undefined && parsed.priority !== task.priority) {
      update.priority = parsed.priority;
    }
    if (parsed.colName !== undefined) {
      const col = getColumnByName(db, parsed.colName);
      if (!col) {
        throw new TaskFileParseError(`col: '${parsed.colName}' not found. ${availableColumns(db)}`);
      }
      if (col.id !== task.columnId) update.columnId = col.id;
    }
    if (parsed.parentInput !== undefined) {
      if (parsed.parentInput === null) {
        if (task.parentId !== null) update.parentId = null;
      } else {
        const parent = resolveTaskId(db, parsed.parentInput);
        if (parent.id === task.id) {
          throw new TaskFileParseError("parent: a task cannot be its own parent");
        }
        if (parent.id !== task.parentId) update.parentId = parent.id;
      }
    }
    if (parsed.tags !== undefined && !sameTagSet(parsed.tags, task.tags)) {
      update.tags = parsed.tags;
    }
    if (parsed.dependsOnInputs !== undefined) {
      const resolved = parsed.dependsOnInputs.map((ref) => resolveTaskId(db, ref).id);
      if (!sameIdSet(resolved, task.dependsOn)) {
        update.dependsOn = resolved;
      }
    }

    if (Object.keys(update).length === 0) {
      console.log("No changes.");
    } else {
      // Pin the version observed at editor-open. If a concurrent writer
      // bumped the row while the user was in their editor, the write is
      // refused: we surface the now-current task as YAML so the user can
      // re-run with the new state instead of silently overwriting.
      updateTask(db, task.id, { ...update, expectedVersion: task.version });
      const summary = Object.keys(update).join(", ");
      console.log(`Updated ${task.id.slice(-6)}  (${summary})`);
    }

    cleanupTempFile(tempPath);
    tempPath = undefined;
  } catch (e) {
    if (e instanceof TaskFileParseError && tempPath) {
      process.stderr.write(`${e.message}\n`);
      process.stderr.write(`Your edits are preserved at: ${tempPath}\n`);
      process.exit(1);
    }
    if (e instanceof StaleReadError) {
      const current = e.currentTask;
      const cols = listColumns(db);
      const colName = cols.find((c) => c.id === current.columnId)?.name ?? "";
      const parentSuffix = current.parentId ? current.parentId.slice(-6) : undefined;
      const yaml = serializeTaskFile({
        task: current,
        columnName: colName,
        columnNames: cols.map((c) => c.name),
        parentSuffix,
        dependsOnSuffixes: current.dependsOn.map((id) => id.slice(-6)),
      });
      process.stderr.write(
        `Conflict: task ${current.id.slice(-6)} was edited by someone else (now at version ${current.version}).\n`,
      );
      if (tempPath) {
        process.stderr.write(`Your edits are preserved at: ${tempPath}\n`);
      }
      process.stderr.write(`Current state:\n\n`);
      process.stdout.write(yaml);
      process.exit(1);
    }
    throw e;
  }
}

export function editCommand(parent: Command): void {
  parent
    .command("edit <id>")
    .description("Open a task in $EDITOR (frontmatter + markdown body)")
    .option(
      "--tag <spec>",
      "Replace the task's tag set (NAME or NAME=COLOR). Repeatable. Skips the editor. Last-writer-wins (no version pin).",
      collectString,
    )
    .option(
      "--depends-on <id>",
      "Replace the task's dependency set (full ulid or unique suffix). Repeatable. Skips the editor. Last-writer-wins (no version pin).",
      collectString,
    )
    .action((idInput: string, opts: EditOptions) => {
      withProjectDb(
        ({ db }) => {
          const task = resolveTaskId(db, idInput);

          // Direct flag mode: `--tag X --tag Y` (or `--depends-on …`) replaces
          // the set without opening the editor. Combines if both flags are
          // passed together. We deliberately don't pin a version here — there
          // was no read-edit-save loop where the user could have based their
          // input on stale state, so OCC would just be friction.
          const directUpdates: { tags?: string[]; dependsOn?: string[] } = {};
          if (opts.tag !== undefined) directUpdates.tags = opts.tag;
          if (opts.dependsOn !== undefined) {
            directUpdates.dependsOn = opts.dependsOn.map((ref) => resolveTaskId(db, ref).id);
          }
          if (Object.keys(directUpdates).length > 0) {
            updateTask(db, task.id, directUpdates);
            const summary = Object.keys(directUpdates).join(", ");
            console.log(`Updated ${task.id.slice(-6)}  (${summary})`);
            return;
          }

          // Hydrate before opening the editor so the YAML reflects current
          // tags / depends_on (resolveTaskId returns a stub).
          const hydrated = getTask(db, task.id) ?? task;
          editTaskViaEditor(db, hydrated);
        },
        { notify: true },
      );
    });
}
