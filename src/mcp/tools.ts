import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyMigrations, openDatabase, type SqliteDb } from "../shared/db";
import { pingDesktopApp } from "../shared/desktop-ping";
import { getColumnByName, listColumns } from "../shared/domain/columns";
import { findProjectRoot, getDbPath } from "../shared/domain/project";
import {
  deleteTag,
  listTags,
  listTagsWithCounts,
  pruneOrphanTags,
  renameTag,
  setTagColor,
} from "../shared/domain/tags";
import {
  createTask,
  deleteTask,
  listTasks,
  resolveTaskId,
  sortTasks,
  StaleReadError,
  updateTask,
  type ListFilter,
} from "../shared/domain/tasks";
import {
  PRIORITY_NAMES,
  SORT_MODES,
  type Priority,
  type SortMode,
  type Task,
} from "../shared/types";

const PriorityInput = z.enum(["urgent", "high", "normal", "low", "u", "h", "n", "l"]);
const PRIORITY_MAP: Record<string, Priority> = {
  urgent: 0,
  u: 0,
  high: 1,
  h: 1,
  normal: 2,
  n: 2,
  low: 3,
  l: 3,
};

// Index signature satisfies the MCP SDK's CallToolResult shape, which uses [x: string]: unknown.
interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function asJson(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function asError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

interface WithDbOptions {
  /** Fire a best-effort ping at the desktop app socket after `fn` returns
   *  successfully. Mutating tools (create/update/move/delete) set this so an
   *  open UI refreshes immediately. Read-only tools leave it off. */
  notify?: boolean;
}

function withDb<T>(fn: (db: SqliteDb) => T, options: WithDbOptions = {}): ToolResult {
  let db: SqliteDb | null = null;
  try {
    const root = findProjectRoot(process.cwd());
    if (!root) {
      return asError(
        "No writ project found by walking up from cwd. Run `writ init` to create one, or start the MCP client in a directory that already has a .writ/ folder.",
      );
    }
    db = openDatabase(getDbPath(root));
    applyMigrations(db);
    const result = fn(db);
    if (options.notify) {
      // Detached: don't await. The MCP server stays up across many calls and
      // we don't want to block the next tool call on the socket round-trip.
      void pingDesktopApp({ root });
    }
    return asJson(result);
  } catch (e) {
    return asError(e instanceof Error ? e.message : String(e));
  } finally {
    db?.close();
  }
}

interface PresentationContext {
  columnsById: Map<string, string>;
  childCounts: Map<string, number>;
  /** Inverse of dependsOn: id → list of task ids that depend on it. Lets every
   *  summary surface a `blocks` array without an extra DB hit per row. */
  dependentsByTaskId: Map<string, string[]>;
}

interface TaskSummary {
  id: string;
  /** Last 6 chars of `id`. Matches what `task list` and the renderer cards
   *  display, so it's the canonical short form to quote when referring to a
   *  task in chat. Cross-task references (parent_id, depends_on, blocks) stay
   *  as full ulids — they're meant to feed straight back into other tools. */
  short_id: string;
  title: string;
  column: string;
  priority: string;
  parent_id: string | null;
  tags: string[];
  depends_on: string[];
  blocks: string[];
  is_ready: boolean;
  subtasks: number;
  created_at: string;
  updated_at: string;
}

interface TaskFull extends TaskSummary {
  description: string;
}

export function buildContext(db: SqliteDb): PresentationContext {
  const columnsById = new Map(listColumns(db).map((c) => [c.id, c.name]));
  const all = listTasks(db);
  const childCounts = new Map<string, number>();
  const dependentsByTaskId = new Map<string, string[]>();
  for (const t of all) {
    if (t.parentId) childCounts.set(t.parentId, (childCounts.get(t.parentId) ?? 0) + 1);
    for (const blockerId of t.dependsOn) {
      const list = dependentsByTaskId.get(blockerId) ?? [];
      list.push(t.id);
      dependentsByTaskId.set(blockerId, list);
    }
  }
  return { columnsById, childCounts, dependentsByTaskId };
}

export function presentSummary(task: Task, ctx: PresentationContext): TaskSummary {
  return {
    id: task.id,
    short_id: task.id.slice(-6),
    title: task.title,
    column: ctx.columnsById.get(task.columnId) ?? "?",
    priority: PRIORITY_NAMES[task.priority],
    parent_id: task.parentId,
    tags: task.tags,
    depends_on: task.dependsOn,
    blocks: ctx.dependentsByTaskId.get(task.id) ?? [],
    is_ready: task.isReady,
    subtasks: ctx.childCounts.get(task.id) ?? 0,
    created_at: new Date(task.createdAt).toISOString(),
    updated_at: new Date(task.updatedAt).toISOString(),
  };
}

function presentFull(task: Task, ctx: PresentationContext): TaskFull {
  return { ...presentSummary(task, ctx), description: task.description };
}

function resolveColumnId(db: SqliteDb, name: string): string {
  const col = getColumnByName(db, name);
  if (!col) {
    const available = listColumns(db)
      .map((c) => c.name)
      .join(", ");
    throw new Error(`Column '${name}' not found. Available: ${available}`);
  }
  return col.id;
}

/** Drives the OCC dance for the mutating MCP tools.
 *
 *  When the agent passes `expected_version`, we pin the same value on the
 *  domain call. A stale read becomes a tool error so the agent can re-fetch
 *  with `get_task` and reissue (or escalate to the user). When the agent
 *  did NOT pin, we still pin internally — to whatever version we just read
 *  for `task` — and retry once on stale read with the refreshed version.
 *  Internal pinning is what lets us *see* the staleness in the unpinned
 *  case at all; without it the write would silently overwrite. */
export function runMcpUpdate(
  db: SqliteDb,
  taskId: string,
  initialVersion: number,
  update: Parameters<typeof updateTask>[2],
  callerPinned: number | undefined,
): Task {
  const firstPin = callerPinned ?? initialVersion;
  try {
    const out = updateTask(db, taskId, { ...update, expectedVersion: firstPin });
    if (!out) throw new Error(`Task ${taskId} disappeared during update.`);
    return out;
  } catch (e) {
    if (!(e instanceof StaleReadError)) throw e;
    if (callerPinned !== undefined) {
      // Caller pinned, so they wanted to bail rather than auto-merge.
      throw new Error(
        `Stale read: task ${e.currentTask.id} is now at version ${e.currentTask.version} ` +
          `(you pinned ${callerPinned}). Refetch with get_task and reissue if you want to overwrite.`,
      );
    }
    // Unpinned: re-pin to the fresh version and retry once.
    const out = updateTask(db, taskId, { ...update, expectedVersion: e.currentTask.version });
    if (!out) throw new Error(`Task ${taskId} disappeared during update.`);
    return out;
  }
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks in the current writ project, grouped by column. The description field is omitted to keep the output compact — call get_task to retrieve a task's body. Each task includes both `id` (full 26-char ulid) and `short_id` (last 6 chars, what the CLI / desktop UI display); when referring to a task in chat, quote `short_id` or the full `id` — never an arbitrary substring of the ulid.",
      inputSchema: {
        column: z
          .string()
          .optional()
          .describe("Filter to one column by name (case-insensitive). Omit for all columns."),
        parent_id: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Filter by parent: `null` for top-level tasks only, or a task id for that task's children. Omit for all tasks regardless of nesting.",
          ),
        tag: z
          .array(z.string())
          .optional()
          .describe(
            "Filter to tasks tagged with ALL of these names (AND). Each entry is a tag name (no `=COLOR` suffix here — this is a filter, not an upsert).",
          ),
        any_tag: z
          .array(z.string())
          .optional()
          .describe(
            "Filter to tasks tagged with ANY of these names (OR). Combine with `tag` to AND across the union.",
          ),
        query: z
          .string()
          .optional()
          .describe(
            "Filter to tasks whose title contains this substring (case-insensitive). Empty string is a no-op.",
          ),
        ready: z
          .boolean()
          .optional()
          .describe(
            "When true, return only tasks whose blockers (if any) are all in a Done column.",
          ),
        blocked: z
          .boolean()
          .optional()
          .describe("When true, return only tasks with at least one open blocker."),
        sort: z
          .enum(SORT_MODES)
          .optional()
          .describe(
            "Sort sibling tasks by `position` (default — manual order), `priority` (urgent first), `updated`, or `created` (most recent first for the timestamp modes). The sort is applied after the column/parent grouping; cross-column structure is preserved.",
          ),
      },
    },
    async ({ column, parent_id, tag, any_tag, query, ready, blocked, sort }) =>
      withDb((db) => {
        const filter: ListFilter = {};
        if (column) filter.columnId = resolveColumnId(db, column);
        if (parent_id !== undefined) filter.parentId = parent_id;
        if (tag !== undefined) filter.tags = tag;
        if (any_tag !== undefined) filter.anyTags = any_tag;
        if (query !== undefined) filter.query = query;
        if (ready !== undefined) filter.ready = ready;
        if (blocked !== undefined) filter.blocked = blocked;
        const ctx = buildContext(db);
        const sortMode: SortMode = sort ?? "position";
        const tasks = sortTasks(listTasks(db, filter), sortMode);
        return {
          project_root: findProjectRoot(process.cwd()),
          count: tasks.length,
          tasks: tasks.map((t) => presentSummary(t, ctx)),
        };
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task",
      description:
        "Fetch a single task's full details including its markdown description. The returned object includes both `id` (full 26-char ulid) and `short_id` (last 6 chars, what the CLI / desktop UI display); quote `short_id` or full `id` when referring to the task in chat — never an arbitrary substring.",
      inputSchema: {
        id: z.string().describe("Full ulid or any unique suffix (e.g. last 6 chars)."),
      },
    },
    async ({ id }) =>
      withDb((db) => {
        const task = resolveTaskId(db, id);
        return presentFull(task, buildContext(db));
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Create a new task. Defaults to the first column (Backlog) at normal priority. Returns the created task.",
      inputSchema: {
        title: z.string().min(1).describe("Short summary (required)."),
        description: z.string().optional().describe("Markdown body."),
        column: z
          .string()
          .optional()
          .describe("Column name (case-insensitive). Defaults to the first column."),
        priority: PriorityInput.optional().describe(
          "urgent | high | normal | low (defaults to normal).",
        ),
        parent_id: z
          .string()
          .optional()
          .describe("Make this a subtask of the given task (full ulid or unique suffix)."),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Tag specs: `NAME` or `NAME=COLOR`. Tags are auto-created on first use; passing `=COLOR` upserts the color globally for that tag. Color accepts hex (`#rgb`/`#rrggbb`) or a CSS named color.",
          ),
        depends_on: z
          .array(z.string())
          .optional()
          .describe(
            "Tasks that block this one (full ulids or unique suffixes). Cycles are rejected.",
          ),
      },
    },
    async ({ title, description, column, priority, parent_id, tags, depends_on }) =>
      withDb(
        (db) => {
          const columnId = column ? resolveColumnId(db, column) : undefined;
          const parentId = parent_id ? resolveTaskId(db, parent_id).id : undefined;
          const dependsOn = depends_on?.map((ref) => resolveTaskId(db, ref).id);
          const created = createTask(db, {
            title,
            description,
            columnId,
            parentId,
            priority: priority ? PRIORITY_MAP[priority] : undefined,
            tags,
            dependsOn,
          });
          return presentFull(created, buildContext(db));
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Update one or more fields on a task. Omit a field to leave it unchanged. Returns the updated task.\n\nOCC: pass `expected_version` (read from `get_task` / `list_tasks`) to refuse the write if a concurrent edit landed first — the conflict surfaces as a tool error so you can re-read and decide. Omit `expected_version` for last-writer-wins; the server still pins internally and retries once on a detected race so transient concurrent writes don't silently drop your edit.",
      inputSchema: {
        id: z.string().describe("Full ulid or any unique suffix."),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        column: z.string().optional().describe("Column name (case-insensitive)."),
        priority: PriorityInput.optional(),
        parent_id: z
          .string()
          .nullable()
          .optional()
          .describe("New parent task id, or null to make this a top-level task."),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Replace the task's tag set. Each entry is `NAME` or `NAME=COLOR` — the latter upserts that tag's color globally. Pass `[]` to clear all tags. Omit to leave tags unchanged.",
          ),
        depends_on: z
          .array(z.string())
          .optional()
          .describe(
            "Replace the task's dependency set (full ulids or unique suffixes). Pass `[]` to clear all dependencies. Omit to leave them unchanged. Cycles are rejected.",
          ),
        expected_version: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Optimistic-concurrency pin. When set, the write is refused with a tool error if the task's stored version no longer matches — refetch via `get_task` and reissue with the new version (or new field values) if you still want the edit. When omitted, the server falls back to last-writer-wins after one internal retry on a detected race.",
          ),
      },
    },
    async ({
      id,
      title,
      description,
      column,
      priority,
      parent_id,
      tags,
      depends_on,
      expected_version,
    }) =>
      withDb(
        (db) => {
          const task = resolveTaskId(db, id);
          const update: Parameters<typeof updateTask>[2] = {};
          if (title !== undefined) update.title = title;
          if (description !== undefined) update.description = description;
          if (column !== undefined) update.columnId = resolveColumnId(db, column);
          if (priority !== undefined) update.priority = PRIORITY_MAP[priority];
          if (parent_id !== undefined) {
            if (parent_id === null) {
              update.parentId = null;
            } else {
              const parent = resolveTaskId(db, parent_id);
              if (parent.id === task.id) throw new Error("A task cannot be its own parent.");
              update.parentId = parent.id;
            }
          }
          if (tags !== undefined) update.tags = tags;
          if (depends_on !== undefined) {
            update.dependsOn = depends_on.map((ref) => resolveTaskId(db, ref).id);
          }
          const updated = runMcpUpdate(db, task.id, task.version, update, expected_version);
          return presentFull(updated, buildContext(db));
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "move_task",
    {
      title: "Move task",
      description:
        "Move a task to a different column. Equivalent to update_task with only the column field, but more discoverable.\n\nOCC: pass `expected_version` to refuse the move if a concurrent edit landed first — the conflict surfaces as a tool error so you can decide whether to override. Omit it for last-writer-wins (with one internal retry on a detected race).",
      inputSchema: {
        id: z.string().describe("Full ulid or any unique suffix."),
        column: z.string().describe("Target column name (case-insensitive)."),
        expected_version: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Optimistic-concurrency pin (see update_task). When omitted, the server retries once on a detected race.",
          ),
      },
    },
    async ({ id, column, expected_version }) =>
      withDb(
        (db) => {
          const task = resolveTaskId(db, id);
          const columnId = resolveColumnId(db, column);
          // Match the moveTask domain helper: append at the bottom of the
          // target column. We inline here so we can route the write through
          // runMcpUpdate (and its retry-once / OCC handling) instead of
          // calling moveTask directly.
          const max = db
            .prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE column_id = ?`)
            .get(columnId) as { m: number };
          const moved = runMcpUpdate(
            db,
            task.id,
            task.version,
            { columnId, position: max.m + 1000 },
            expected_version,
          );
          return presentSummary(moved, buildContext(db));
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete task",
      description: "Delete a task. Subtasks are deleted as well (cascade).",
      inputSchema: {
        id: z.string().describe("Full ulid or any unique suffix."),
      },
    },
    async ({ id }) =>
      withDb(
        (db) => {
          const task = resolveTaskId(db, id);
          deleteTask(db, task.id);
          return { deleted: task.id, title: task.title };
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "list_columns",
    {
      title: "List columns",
      description: "List the columns of the current project in display order.",
      inputSchema: {},
    },
    async () =>
      withDb((db) => {
        const columns = listColumns(db);
        return { count: columns.length, columns: columns.map((c) => ({ id: c.id, name: c.name })) };
      }),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "List all tags in the current project with their stored colors. NULL color means no explicit override — the renderer derives one from the tag name. Pass `with_counts` to also include the number of tasks currently using each tag.",
      inputSchema: {
        with_counts: z
          .boolean()
          .optional()
          .describe(
            "When true, each returned tag also includes `usage_count` — the number of tasks currently referencing it. Useful for spotting orphan tags before calling `prune_tags`.",
          ),
      },
    },
    async ({ with_counts }) =>
      withDb((db) => {
        if (with_counts) {
          const tags = listTagsWithCounts(db);
          return {
            count: tags.length,
            tags: tags.map((t) => ({ name: t.name, color: t.color, usage_count: t.usageCount })),
          };
        }
        const tags = listTags(db);
        return {
          count: tags.length,
          tags: tags.map((t) => ({ name: t.name, color: t.color })),
        };
      }),
  );

  server.registerTool(
    "rename_tag",
    {
      title: "Rename tag",
      description:
        "Rename a tag in place. Preserves the tag's id, color, and every task association. Fails if the destination name already exists (no merge — the caller would need to retag tasks explicitly first).",
      inputSchema: {
        from: z.string().describe("Current tag name (case-sensitive)."),
        to: z
          .string()
          .describe(
            "New tag name. Must match `^[a-zA-Z0-9][a-zA-Z0-9_-]*$` and not collide with an existing tag.",
          ),
      },
    },
    async ({ from, to }) =>
      withDb(
        (db) => {
          const updated = renameTag(db, from, to);
          return { renamed: { from, to: updated.name, color: updated.color } };
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "delete_tag",
    {
      title: "Delete tag",
      description:
        "Delete a tag globally. Detaches it from every task that references it (the schema's ON DELETE CASCADE handles the task_tags rows).",
      inputSchema: {
        name: z.string().describe("Tag name to delete."),
      },
    },
    async ({ name }) =>
      withDb(
        (db) => {
          if (!deleteTag(db, name)) throw new Error(`Tag '${name}' not found.`);
          return { deleted: name };
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "set_tag_color",
    {
      title: "Set tag color",
      description:
        "Set or clear a tag's color. Color accepts hex (`#rgb`/`#rrggbb`) or a CSS named color; pass `null` to clear the override and let the renderer hash the name to a palette slot.",
      inputSchema: {
        name: z.string().describe("Tag name."),
        color: z
          .string()
          .nullable()
          .describe("Hex (`#rgb`/`#rrggbb`) or CSS named color, or `null` to clear."),
      },
    },
    async ({ name, color }) =>
      withDb(
        (db) => {
          const updated = setTagColor(db, name, color);
          return { name: updated.name, color: updated.color };
        },
        { notify: true },
      ),
  );

  server.registerTool(
    "prune_tags",
    {
      title: "Prune orphan tags",
      description:
        "Remove every tag with zero task references. Returns the list of pruned names. Pass `dry_run: true` to preview without deleting.",
      inputSchema: {
        dry_run: z
          .boolean()
          .optional()
          .describe("When true, report the orphan tags that would be deleted but don't delete."),
      },
    },
    async ({ dry_run }) =>
      withDb(
        (db) => {
          if (dry_run) {
            const candidates = listTagsWithCounts(db)
              .filter((t) => t.usageCount === 0)
              .map((t) => t.name);
            return { dry_run: true, would_prune: candidates };
          }
          const pruned = pruneOrphanTags(db);
          return { dry_run: false, pruned };
        },
        { notify: !dry_run },
      ),
  );
}
