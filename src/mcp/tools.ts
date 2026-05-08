import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { openDatabase, type SqliteDb } from "../shared/db";
import { getColumnByName, listColumns } from "../shared/domain/columns";
import { findProjectRoot, getDbPath } from "../shared/domain/project";
import { listTags } from "../shared/domain/tags";
import {
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  resolveTaskId,
  updateTask,
  type ListFilter,
} from "../shared/domain/tasks";
import { PRIORITY_NAMES, type Priority, type Task } from "../shared/types";

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

function withDb<T>(fn: (db: SqliteDb) => T): ToolResult {
  let db: SqliteDb | null = null;
  try {
    const root = findProjectRoot(process.cwd());
    if (!root) {
      return asError(
        "No writ project found by walking up from cwd. Run `writ init` to create one, or start the MCP client in a directory that already has a .writ/ folder.",
      );
    }
    db = openDatabase(getDbPath(root));
    const result = fn(db);
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
}

interface TaskSummary {
  id: string;
  title: string;
  column: string;
  priority: string;
  parent_id: string | null;
  tags: string[];
  subtasks: number;
  created_at: string;
  updated_at: string;
}

interface TaskFull extends TaskSummary {
  description: string;
}

function buildContext(db: SqliteDb): PresentationContext {
  const columnsById = new Map(listColumns(db).map((c) => [c.id, c.name]));
  const all = listTasks(db);
  const childCounts = new Map<string, number>();
  for (const t of all) {
    if (t.parentId) childCounts.set(t.parentId, (childCounts.get(t.parentId) ?? 0) + 1);
  }
  return { columnsById, childCounts };
}

function presentSummary(task: Task, ctx: PresentationContext): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    column: ctx.columnsById.get(task.columnId) ?? "?",
    priority: PRIORITY_NAMES[task.priority],
    parent_id: task.parentId,
    tags: task.tags,
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

export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks in the current writ project, grouped by column. The description field is omitted to keep the output compact — call get_task to retrieve a task's body.",
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
      },
    },
    async ({ column, parent_id, tag, any_tag }) =>
      withDb((db) => {
        const filter: ListFilter = {};
        if (column) filter.columnId = resolveColumnId(db, column);
        if (parent_id !== undefined) filter.parentId = parent_id;
        if (tag !== undefined) filter.tags = tag;
        if (any_tag !== undefined) filter.anyTags = any_tag;
        const ctx = buildContext(db);
        const tasks = listTasks(db, filter);
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
      description: "Fetch a single task's full details including its markdown description.",
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
      },
    },
    async ({ title, description, column, priority, parent_id, tags }) =>
      withDb((db) => {
        const columnId = column ? resolveColumnId(db, column) : undefined;
        const parentId = parent_id ? resolveTaskId(db, parent_id).id : undefined;
        const created = createTask(db, {
          title,
          description,
          columnId,
          parentId,
          priority: priority ? PRIORITY_MAP[priority] : undefined,
          tags,
        });
        return presentFull(created, buildContext(db));
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Update one or more fields on a task. Omit a field to leave it unchanged. Returns the updated task.",
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
      },
    },
    async ({ id, title, description, column, priority, parent_id, tags }) =>
      withDb((db) => {
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
        const updated = updateTask(db, task.id, update);
        if (!updated) throw new Error(`Task ${task.id} disappeared during update.`);
        return presentFull(updated, buildContext(db));
      }),
  );

  server.registerTool(
    "move_task",
    {
      title: "Move task",
      description:
        "Move a task to a different column. Equivalent to update_task with only the column field, but more discoverable.",
      inputSchema: {
        id: z.string().describe("Full ulid or any unique suffix."),
        column: z.string().describe("Target column name (case-insensitive)."),
      },
    },
    async ({ id, column }) =>
      withDb((db) => {
        const task = resolveTaskId(db, id);
        const columnId = resolveColumnId(db, column);
        const moved = moveTask(db, task.id, columnId);
        if (!moved) throw new Error(`Task ${task.id} disappeared during move.`);
        return presentSummary(moved, buildContext(db));
      }),
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
      withDb((db) => {
        const task = resolveTaskId(db, id);
        deleteTask(db, task.id);
        return { deleted: task.id, title: task.title };
      }),
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
        "List all tags in the current project with their stored colors. NULL color means no explicit override — the renderer derives one from the tag name.",
      inputSchema: {},
    },
    async () =>
      withDb((db) => {
        const tags = listTags(db);
        return {
          count: tags.length,
          tags: tags.map((t) => ({ name: t.name, color: t.color })),
        };
      }),
  );
}
