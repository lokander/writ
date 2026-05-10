import { Command, InvalidArgumentError } from "commander";
import { getColumnByName, listColumns } from "../../shared/domain/columns";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  resolveTaskId,
  StaleReadError,
  updateTask,
} from "../../shared/domain/tasks";
import {
  parseTaskFile,
  serializeTaskFile,
  TaskFileParseError,
} from "../../shared/domain/task-format";
import { PRIORITY_NAMES, type Priority, type Task } from "../../shared/types";
import type { Column } from "../../shared/types";
import { withProjectDb } from "../context";
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

function collectPriority(value: string, prev: Priority[] | undefined): Priority[] {
  const p = parsePriority(value);
  return prev ? [...prev, p] : [p];
}

interface AddOptions {
  priority?: Priority;
  col?: string;
  description?: string;
  parent?: string;
  tag?: string[];
  dependsOn?: string[];
}

interface ListOptions {
  col?: string;
  tag?: string[];
  anyTag?: string[];
  priority?: Priority[];
  showDone?: boolean;
  showArchived?: boolean;
  ready?: boolean;
  blocked?: boolean;
}

interface EditOptions {
  tag?: string[];
  dependsOn?: string[];
}

function viewTask(idInput: string): void {
  withProjectDb(({ db }) => {
    const resolved = resolveTaskId(db, idInput);
    const columns = listColumns(db);
    const allTasks = listTasks(db);
    // resolveTaskId returns a tag-empty / dep-empty stub (it's a cheap suffix
    // resolver, not a full hydrator). Pull the fully populated row out of the
    // listTasks result so renderTaskView sees real tags / blockers / etc.
    const task = allTasks.find((t) => t.id === resolved.id) ?? resolved;
    process.stdout.write(renderTaskView(task, columns, allTasks) + "\n");
  });
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
    .option(
      "--depends-on <id>",
      "Make this task depend on another (full ulid or unique suffix). Repeatable.",
      collectString,
    )
    .action((title: string, opts: AddOptions) => {
      withProjectDb(
        ({ db }) => {
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

          const dependsOn = opts.dependsOn?.map((ref) => resolveTaskId(db, ref).id);

          const task = createTask(db, {
            title,
            description: opts.description,
            columnId,
            parentId,
            priority: opts.priority,
            tags: opts.tag,
            dependsOn,
          });
          console.log(`Created ${task.id.slice(-6)}  ${task.title}`);
        },
        { notify: true },
      );
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
    .option(
      "--priority <level>",
      "Filter to tasks at this priority (u/h/n/l or 0-3). Repeatable; multiple --priority flags OR.",
      collectPriority,
    )
    .option("--show-done", "Include the Done column (hidden by default)")
    .option("--show-archived", "Include the Archived column (hidden by default)")
    .option("--ready", "Only tasks whose blockers (if any) are all in Done or Archived")
    .option("--blocked", "Only tasks with at least one open blocker")
    .action((opts: ListOptions) => {
      withProjectDb(({ db }) => {
        const columns = listColumns(db);
        const allTasks = listTasks(db, {
          tags: opts.tag,
          anyTags: opts.anyTag,
          priorities: opts.priority,
          ready: opts.ready,
          blocked: opts.blocked,
        });

        if (allTasks.length === 0) {
          console.log('No tasks. Use `writ task add "title"` to create one.');
          return;
        }

        // An explicit `--col Done` (or `--col Archived`) overrides the
        // default hide. If the user asked for one of these specifically,
        // the matching --show-* flag is implied.
        const colLower = opts.col?.toLowerCase();
        const includeDone = opts.showDone || colLower === "done";
        const includeArchived = opts.showArchived || colLower === "archived";
        const hiddenColumnIds = new Set(
          columns
            .filter((c) => {
              const n = c.name.toLowerCase();
              if (n === "done" && !includeDone) return true;
              if (n === "archived" && !includeArchived) return true;
              return false;
            })
            .map((c) => c.id),
        );
        const visibleTasks = allTasks.filter((t) => !hiddenColumnIds.has(t.columnId));

        let filteredColumns = columns;
        if (opts.col) {
          const col = getColumnByName(db, opts.col);
          if (!col) {
            throw new Error(`Column '${opts.col}' not found. ${availableColumns(db)}`);
          }
          filteredColumns = [col];
        } else {
          filteredColumns = columns.filter((c) => !hiddenColumnIds.has(c.id));
        }

        // Narrowing filters (tag/any-tag/priority/ready/blocked) can leave a
        // child in the visible set without its parent. The hierarchical render
        // would hide such orphans because it walks down from top-level tasks.
        // Switch to a flat per-column render whenever a narrowing filter is
        // on, so every matching task surfaces.
        const flatRender = Boolean(
          (opts.tag && opts.tag.length > 0) ||
          (opts.anyTag && opts.anyTag.length > 0) ||
          (opts.priority && opts.priority.length > 0) ||
          opts.ready ||
          opts.blocked,
        );

        const columnNameById = new Map(columns.map((c) => [c.id, c.name]));

        if (flatRender) {
          for (const col of filteredColumns) {
            const inCol = visibleTasks.filter((t) => t.columnId === col.id);
            if (inCol.length === 0) continue;
            console.log(`\n${col.name}`);
            for (const t of inCol) {
              console.log(`  ${formatTaskLine(t)}`);
            }
          }
        } else {
          // Default: group per column with subtasks indented under their
          // parents. Subtasks follow the parent regardless of the child's own
          // column; a `[Col]` badge on the line flags any column mismatch.
          const childrenByParent = buildChildrenByParent(visibleTasks);
          for (const col of filteredColumns) {
            const topInCol = visibleTasks.filter(
              (t) => t.parentId === null && t.columnId === col.id,
            );
            if (topInCol.length === 0) continue;
            console.log(`\n${col.name}`);
            for (const t of topInCol) {
              renderTaskNode(t, null, 1, childrenByParent, columnNameById);
            }
          }
        }
      });
    });

  cmd
    .command("move <id> <column>")
    .description("Move a task to a different column (case-insensitive)")
    .action((idInput: string, columnName: string) => {
      withProjectDb(
        ({ db }) => {
          const task = resolveTaskId(db, idInput);
          const col = getColumnByName(db, columnName);
          if (!col) {
            throw new Error(`Column '${columnName}' not found. ${availableColumns(db)}`);
          }
          moveTask(db, task.id, col.id);
          console.log(`Moved ${task.id.slice(-6)}  ${task.title}  →  ${col.name}`);
        },
        { notify: true },
      );
    });

  cmd
    .command("rm <id>")
    .description("Delete a task and its subtasks")
    .action((idInput: string) => {
      withProjectDb(
        ({ db }) => {
          const task = resolveTaskId(db, idInput);
          deleteTask(db, task.id);
          console.log(`Deleted ${task.id.slice(-6)}  ${task.title}`);
        },
        { notify: true },
      );
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
  const dependents = allTasks.filter((t) => t.dependsOn.includes(task.id));
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
    `${pad("Ready")} ${task.isReady ? "yes" : `no — ${task.blockedBy.length} open blocker${task.blockedBy.length === 1 ? "" : "s"}`}`,
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

  if (task.dependsOn.length > 0) {
    lines.push("");
    lines.push(`Blocked by (${task.dependsOn.length})`);
    for (const blockerId of task.dependsOn) {
      const blocker = allTasks.find((t) => t.id === blockerId);
      if (!blocker) continue;
      const stillBlocking = task.blockedBy.includes(blockerId);
      const marker = stillBlocking ? "  " : "✓ ";
      lines.push(`  ${marker}${formatTaskLine(blocker)}`);
    }
  }

  if (dependents.length > 0) {
    lines.push("");
    lines.push(`Blocks (${dependents.length})`);
    for (const dep of dependents) {
      lines.push(`  ${formatTaskLine(dep)}`);
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
