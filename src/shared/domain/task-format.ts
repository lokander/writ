import { parse as parseYaml } from "yaml";
import { PRIORITY_NAMES, type Priority, type Task } from "../types";

export interface SerializeContext {
  task: Task;
  columnName: string;
  parentSuffix?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const PRIORITY_BY_NAME: Record<string, Priority> = {
  urgent: 0,
  u: 0,
  "0": 0,
  high: 1,
  h: 1,
  "1": 1,
  normal: 2,
  n: 2,
  "2": 2,
  low: 3,
  l: 3,
  "3": 3,
};

export function serializeTaskFile({ task, columnName, parentSuffix }: SerializeContext): string {
  return [
    "---",
    `# writ task ${task.id.slice(-6)}`,
    "# Edit fields below, save and close to apply.",
    "# Comments (lines starting with #) are ignored.",
    "",
    "# title: short summary (required)",
    `title: ${yamlScalar(task.title)}`,
    "",
    "# priority: urgent | high | normal | low  (also accepts u/h/n/l, 0-3)",
    `priority: ${PRIORITY_NAMES[task.priority]}`,
    "",
    "# col: existing column name (case-insensitive)",
    `col: ${yamlScalar(columnName)}`,
    "",
    "# parent: ulid suffix of parent task, or null for top-level",
    `parent: ${parentSuffix ? yamlScalar(parentSuffix) : "null"}`,
    "---",
    "",
    task.description,
    "",
  ].join("\n");
}

export interface ParsedTaskFile {
  // Each field is undefined when absent in the file (= keep current value).
  title?: string;
  priority?: Priority;
  colName?: string;
  parentInput?: string | null;
  description: string;
}

export class TaskFileParseError extends Error {
  override readonly name = "TaskFileParseError";
}

export function parseTaskFile(content: string): ParsedTaskFile {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new TaskFileParseError(
      "Missing or malformed frontmatter (expected `---` delimiters at the top).",
    );
  }
  const [, fmText, body] = match;

  let fm: Record<string, unknown>;
  try {
    fm = (parseYaml(fmText) as Record<string, unknown> | null) ?? {};
  } catch (e) {
    throw new TaskFileParseError(
      `YAML frontmatter failed to parse: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const out: ParsedTaskFile = { description: stripBodyEnvelope(body) };

  if ("title" in fm) {
    if (typeof fm.title !== "string" || fm.title.trim().length === 0) {
      throw new TaskFileParseError("title: must be a non-empty string");
    }
    out.title = fm.title.trim();
  }

  if ("priority" in fm) {
    if (typeof fm.priority !== "string" && typeof fm.priority !== "number") {
      throw new TaskFileParseError(
        "priority: must be one of urgent | high | normal | low (or 0-3)",
      );
    }
    const key = String(fm.priority).toLowerCase();
    const p = PRIORITY_BY_NAME[key];
    if (p === undefined) {
      throw new TaskFileParseError(
        `priority: '${fm.priority}' is not valid. Use urgent | high | normal | low (or 0-3).`,
      );
    }
    out.priority = p;
  }

  if ("col" in fm) {
    if (typeof fm.col !== "string" || fm.col.trim().length === 0) {
      throw new TaskFileParseError("col: must be the name of an existing column");
    }
    out.colName = fm.col.trim();
  }

  if ("parent" in fm) {
    const v = fm.parent;
    if (v === null) {
      out.parentInput = null;
    } else if (typeof v === "string" && v.trim().length > 0) {
      out.parentInput = v.trim();
    } else {
      throw new TaskFileParseError("parent: must be a ulid suffix or null");
    }
  }

  return out;
}

function stripBodyEnvelope(body: string): string {
  // Trim a leading and trailing blank line that we add when serializing.
  return body.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function yamlScalar(value: string): string {
  // Quote anything that isn't trivially safe as an unquoted YAML scalar.
  // JSON's escaping is a strict subset of YAML's double-quoted form, so
  // JSON.stringify always produces valid YAML for any string.
  if (/^[A-Za-z][\w -]*$/.test(value) && !/^(null|true|false|yes|no|on|off)$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
