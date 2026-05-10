import type { Command } from "commander";
import { getColumnByName, listColumns } from "../../../shared/domain/columns";
import { listTasks } from "../../../shared/domain/tasks";
import type { Priority, Task } from "../../../shared/types";
import { withProjectDb } from "../../context";
import { collectPriority, collectString } from "./options";
import { availableColumns, formatTaskLine, priorityChip, tagChip } from "./render";

interface ListOptions {
  col?: string;
  tag?: string[];
  anyTag?: string[];
  priority?: Priority[];
  grep?: string;
  showDone?: boolean;
  showArchived?: boolean;
  ready?: boolean;
  blocked?: boolean;
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

export function listCommand(parent: Command): void {
  parent
    .command("list")
    .alias("ls")
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
    .option(
      "--grep <pattern>",
      "Filter to tasks whose title contains this substring (case-insensitive)",
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
          query: opts.grep,
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

        // Narrowing filters (tag/any-tag/priority/grep/ready/blocked) can leave
        // a child in the visible set without its parent. The hierarchical render
        // would hide such orphans because it walks down from top-level tasks.
        // Switch to a flat per-column render whenever a narrowing filter is
        // on, so every matching task surfaces.
        const flatRender = Boolean(
          (opts.tag && opts.tag.length > 0) ||
          (opts.anyTag && opts.anyTag.length > 0) ||
          (opts.priority && opts.priority.length > 0) ||
          (opts.grep && opts.grep.length > 0) ||
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
}
