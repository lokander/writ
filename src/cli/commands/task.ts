import { Command, InvalidArgumentError } from "commander";
import { getColumnByName, listColumns } from "../../shared/domain/columns";
import {
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  resolveTaskId,
  updateTask,
} from "../../shared/domain/tasks";
import {
  parseTaskFile,
  serializeTaskFile,
  TaskFileParseError,
} from "../../shared/domain/task-format";
import { PRIORITY_NAMES, type Priority, type Task } from "../../shared/types";
import type { Column } from "../../shared/types";
import { handleCliError, resolveProjectDb } from "../context";
import { cleanupTempFile, editInExternalEditor } from "../editor";

const PRIORITY_INPUT: Record<string, Priority> = {
  u: 0,
  urgent: 0,
  "0": 0,
  h: 1,
  high: 1,
  "1": 1,
  n: 2,
  normal: 2,
  "2": 2,
  l: 3,
  low: 3,
  "3": 3,
};

function parsePriority(input: string): Priority {
  const p = PRIORITY_INPUT[input.toLowerCase()];
  if (p === undefined) {
    throw new InvalidArgumentError("Priority must be u(rgent), h(igh), n(ormal), l(ow), or 0-3");
  }
  return p;
}

// commander repeatable-option collector. Default is `undefined` so callers can
// distinguish "user passed no --tag" from "user passed --tag ''" (which we
// reject anyway via tag-format validation).
function collectString(value: string, prev: string[] | undefined): string[] {
  return prev ? [...prev, value] : [value];
}

interface AddOptions {
  priority?: Priority;
  col?: string;
  description?: string;
  parent?: string;
  tag?: string[];
}

interface ListOptions {
  col?: string;
  tag?: string[];
  anyTag?: string[];
  showDone?: boolean;
}

interface EditOptions {
  tag?: string[];
}

function viewTask(idInput: string): void {
  const { db } = resolveProjectDb();
  try {
    const task = resolveTaskId(db, idInput);
    const columns = listColumns(db);
    const allTasks = listTasks(db);
    process.stdout.write(renderTaskView(task, columns, allTasks) + "\n");
  } catch (e) {
    handleCliError(e);
  } finally {
    db.close();
  }
}

export function taskCommand(): Command {
  const cmd = new Command("task").description("Manage tasks");

  // Bare-arg shortcut: `writ task <id>` runs the same logic as `writ task view <id>`.
  // If the arg is missing or matches a subcommand name, commander routes accordingly.
  cmd.argument("[id]", "Task id (shortcut for `task view <id>`)").action((idArg?: string) => {
    if (idArg) viewTask(idArg);
    else cmd.help();
  });

  cmd
    .command("add <title>")
    .description("Add a new task to the first column (Backlog by default)")
    .option(
      "-p, --priority <level>",
      "Priority: u(rgent), h(igh), n(ormal), l(ow), or 0-3",
      parsePriority,
    )
    .option("-c, --col <name>", "Column to put it in (case-insensitive)")
    .option("-d, --description <text>", "Markdown description")
    .option("--parent <id>", "Make this a subtask of the given task (full ulid or unique suffix)")
    .option(
      "--tag <spec>",
      "Tag spec: NAME or NAME=COLOR. Repeatable. Auto-creates tags on first use.",
      collectString,
    )
    .action((title: string, opts: AddOptions) => {
      const { db } = resolveProjectDb();
      try {
        let columnId: string | undefined;
        if (opts.col) {
          const col = getColumnByName(db, opts.col);
          if (!col) {
            throw new Error(`Column '${opts.col}' not found. ${availableColumns(db)}`);
          }
          columnId = col.id;
        }

        let parentId: string | null | undefined;
        if (opts.parent) {
          parentId = resolveTaskId(db, opts.parent).id;
        }

        const task = createTask(db, {
          title,
          description: opts.description,
          columnId,
          parentId,
          priority: opts.priority,
          tags: opts.tag,
        });
        console.log(`Created ${task.id.slice(-6)}  ${task.title}`);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("list")
    .description("List tasks grouped by column")
    .option("-c, --col <name>", "Only show tasks in the named column")
    .option(
      "--tag <name>",
      "Filter to tasks tagged with this name. Repeatable; multiple --tag flags AND together.",
      collectString,
    )
    .option(
      "--any-tag <name>",
      "Filter to tasks tagged with any of these names. Repeatable; OR semantics.",
      collectString,
    )
    .option("--show-done", "Include the Done column (hidden by default)")
    .action((opts: ListOptions) => {
      const { db } = resolveProjectDb();
      try {
        const columns = listColumns(db);
        const allTasks = listTasks(db, {
          tags: opts.tag,
          anyTags: opts.anyTag,
        });

        if (allTasks.length === 0) {
          console.log('No tasks. Use `writ task add "title"` to create one.');
          return;
        }

        // An explicit --col Done overrides the default hide. If the user asked
        // for Done specifically, --show-done is implied.
        const explicitlyAskingForDone = opts.col?.toLowerCase() === "done";
        const includeDone = opts.showDone || explicitlyAskingForDone;
        const doneColumnIds = new Set(
          columns.filter((c) => c.name.toLowerCase() === "done").map((c) => c.id),
        );
        const visibleTasks = includeDone
          ? allTasks
          : allTasks.filter((t) => !doneColumnIds.has(t.columnId));

        let filteredColumns = columns;
        if (opts.col) {
          const col = getColumnByName(db, opts.col);
          if (!col) {
            throw new Error(`Column '${opts.col}' not found. ${availableColumns(db)}`);
          }
          filteredColumns = [col];
        } else if (!includeDone) {
          filteredColumns = columns.filter((c) => !doneColumnIds.has(c.id));
        }

        // Group tasks per column with subtasks indented under their parents.
        // Subtasks follow the parent regardless of the child's own column;
        // a `[Col]` badge on the line flags any column mismatch. Mirrors the
        // renderer's tree behavior so the two views stay legible together.
        const childrenByParent = buildChildrenByParent(visibleTasks);
        const columnNameById = new Map(columns.map((c) => [c.id, c.name]));

        for (const col of filteredColumns) {
          const topInCol = visibleTasks.filter((t) => t.parentId === null && t.columnId === col.id);
          if (topInCol.length === 0) continue;
          console.log(`\n${col.name}`);
          for (const t of topInCol) {
            renderTaskNode(t, null, 1, childrenByParent, columnNameById);
          }
        }
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("move <id> <column>")
    .description("Move a task to a different column (case-insensitive)")
    .action((idInput: string, columnName: string) => {
      const { db } = resolveProjectDb();
      try {
        const task = resolveTaskId(db, idInput);
        const col = getColumnByName(db, columnName);
        if (!col) {
          throw new Error(`Column '${columnName}' not found. ${availableColumns(db)}`);
        }
        moveTask(db, task.id, col.id);
        console.log(`Moved ${task.id.slice(-6)}  ${task.title}  →  ${col.name}`);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("rm <id>")
    .description("Delete a task and its subtasks")
    .action((idInput: string) => {
      const { db } = resolveProjectDb();
      try {
        const task = resolveTaskId(db, idInput);
        deleteTask(db, task.id);
        console.log(`Deleted ${task.id.slice(-6)}  ${task.title}`);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  cmd
    .command("view <id>")
    .description("Show a task's full details (header + description + subtasks)")
    .action((idInput: string) => viewTask(idInput));

  cmd
    .command("edit <id>")
    .description("Open a task in $EDITOR (frontmatter + markdown body)")
    .option(
      "--tag <spec>",
      "Replace the task's tag set (NAME or NAME=COLOR). Repeatable. Skips the editor.",
      collectString,
    )
    .action((idInput: string, opts: EditOptions) => {
      const { db } = resolveProjectDb();
      try {
        const task = resolveTaskId(db, idInput);

        // Direct flag mode: `--tag X --tag Y` replaces the set without opening
        // the editor. Plays the role of a one-shot tag-set command without
        // proliferating top-level subcommands.
        if (opts.tag !== undefined) {
          updateTask(db, task.id, { tags: opts.tag });
          console.log(`Updated ${task.id.slice(-6)}  (tags)`);
          return;
        }

        editTaskViaEditor(db, task);
      } catch (e) {
        handleCliError(e);
      } finally {
        db.close();
      }
    });

  return cmd;
}

function editTaskViaEditor(db: import("../../shared/db").SqliteDb, task: Task): void {
  const columns = listColumns(db);
  const colName = columns.find((c) => c.id === task.columnId)?.name ?? "";
  const parentSuffix = task.parentId ? task.parentId.slice(-6) : undefined;

  const initial = serializeTaskFile({
    task,
    columnName: colName,
    columnNames: columns.map((c) => c.name),
    parentSuffix,
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

    if (Object.keys(update).length === 0) {
      console.log("No changes.");
    } else {
      updateTask(db, task.id, update);
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
    throw e;
  }
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

function priorityChip(p: Priority): string {
  if (p === 2) return "";
  return `[${PRIORITY_NAMES[p][0]}] `;
}

function tagChip(tags: string[]): string {
  if (tags.length === 0) return "";
  return ` [${tags.join(", ")}]`;
}

function formatTaskLine(t: Task): string {
  return `${t.id.slice(-6)}  ${priorityChip(t.priority)}${t.title}${tagChip(t.tags)}`;
}

function buildChildrenByParent(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = map.get(t.parentId) ?? [];
    list.push(t);
    map.set(t.parentId, list);
  }
  return map;
}

function renderTaskNode(
  task: Task,
  parentColumnId: string | null,
  depth: number,
  childrenByParent: Map<string, Task[]>,
  columnNameById: Map<string, string>,
): void {
  const indent = "  ".repeat(depth);
  const colMismatch =
    parentColumnId !== null && task.columnId !== parentColumnId
      ? ` [${columnNameById.get(task.columnId) ?? "?"}]`
      : "";
  console.log(
    `${indent}${task.id.slice(-6)}  ${priorityChip(task.priority)}${task.title}${tagChip(task.tags)}${colMismatch}`,
  );
  const children = childrenByParent.get(task.id) ?? [];
  for (const child of children) {
    renderTaskNode(child, task.columnId, depth + 1, childrenByParent, columnNameById);
  }
}

function availableColumns(db: import("../../shared/db").SqliteDb): string {
  const names = listColumns(db)
    .map((c: Column) => c.name)
    .join(", ");
  return `Available: ${names}`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function renderTaskView(task: Task, columns: Column[], allTasks: Task[]): string {
  const colName = columns.find((c) => c.id === task.columnId)?.name ?? "?";
  const parentLabel = task.parentId ? task.parentId.slice(-6) : "—";
  const subtasks = allTasks.filter((t) => t.parentId === task.id);
  const tagLabel = task.tags.length === 0 ? "—" : task.tags.join(", ");
  const pad = (s: string): string => s.padEnd(10);

  const lines: string[] = [
    `${pad("ID")} ${task.id}`,
    `${pad("Title")} ${task.title}`,
    `${pad("Column")} ${colName}`,
    `${pad("Priority")} ${PRIORITY_NAMES[task.priority]}`,
    `${pad("Parent")} ${parentLabel}`,
    `${pad("Tags")} ${tagLabel}`,
    `${pad("Subtasks")} ${subtasks.length}`,
    `${pad("Created")} ${formatTimestamp(task.createdAt)}`,
    `${pad("Updated")} ${formatTimestamp(task.updatedAt)}`,
    "",
  ];

  if (task.description.trim().length === 0) {
    lines.push("  (no description)");
  } else {
    for (const line of task.description.split("\n")) {
      lines.push("  " + line);
    }
  }

  if (subtasks.length > 0) {
    lines.push("");
    lines.push(`Subtasks (${subtasks.length})`);
    for (const sub of subtasks) {
      lines.push(`  ${formatTaskLine(sub)}`);
    }
  }

  return lines.join("\n");
}
