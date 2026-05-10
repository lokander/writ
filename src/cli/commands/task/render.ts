import { listColumns } from "../../../shared/domain/columns";
import { PRIORITY_NAMES, type Column, type Priority, type Task } from "../../../shared/types";

export function priorityChip(p: Priority): string {
  return `[${PRIORITY_NAMES[p][0]}] `;
}

export function tagChip(tags: string[]): string {
  if (tags.length === 0) return "";
  return ` [${tags.join(", ")}]`;
}

export function formatTaskLine(t: Task): string {
  return `${t.id.slice(-6)}  ${priorityChip(t.priority)}${t.title}${tagChip(t.tags)}`;
}

export function availableColumns(db: import("../../../shared/db").SqliteDb): string {
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
