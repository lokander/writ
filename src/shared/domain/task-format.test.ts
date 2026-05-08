import { describe, expect, it } from "vitest";

import type { Task } from "../types";

import { TaskFileParseError, parseTaskFile, serializeTaskFile } from "./task-format";

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: "01TESTTASKABCDEFGHJKMNPQRS",
    parentId: null,
    columnId: "01COLBACKLOGABCDEFGHJKMNPQ",
    title: "Buy milk",
    description: "Two percent",
    priority: 1,
    position: 1000,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const COLUMNS = ["Backlog", "Todo", "Doing", "Done"];

describe("serializeTaskFile", () => {
  it("renders frontmatter with column-name hint and body hint", () => {
    const text = serializeTaskFile({
      task: makeTask(),
      columnName: "Backlog",
      columnNames: COLUMNS,
    });
    expect(text).toContain("title: Buy milk");
    expect(text).toContain("priority: high");
    expect(text).toContain("col: Backlog");
    expect(text).toContain("# col: Backlog | Todo | Doing | Done  (case-insensitive)");
    expect(text).toContain("<!-- writ-hint:");
    expect(text).toContain("Two percent");
  });

  it("emits parent: null for top-level tasks", () => {
    const text = serializeTaskFile({
      task: makeTask({ parentId: null }),
      columnName: "Backlog",
      columnNames: COLUMNS,
    });
    expect(text).toMatch(/^parent: null$/m);
  });

  it("emits the parent suffix when given", () => {
    const text = serializeTaskFile({
      task: makeTask({ parentId: "01PARENTAAAAAAAAAAAAYYZZZZ" }),
      columnName: "Backlog",
      columnNames: COLUMNS,
      parentSuffix: "YYZZZZ",
    });
    expect(text).toMatch(/^parent: YYZZZZ$/m);
  });
});

describe("parseTaskFile", () => {
  it("strips the writ-hint comment from the body", () => {
    const text = serializeTaskFile({
      task: makeTask({ description: "Two percent\nFrom the store" }),
      columnName: "Backlog",
      columnNames: COLUMNS,
    });
    const parsed = parseTaskFile(text);
    expect(parsed.description).toBe("Two percent\nFrom the store");
    expect(parsed.description).not.toContain("writ-hint");
  });

  it("returns undefined for fields whose lines are removed (= keep current)", () => {
    const minimal = `---\ntitle: Just a title\n---\n\nbody\n`;
    const parsed = parseTaskFile(minimal);
    expect(parsed.title).toBe("Just a title");
    expect(parsed.priority).toBeUndefined();
    expect(parsed.colName).toBeUndefined();
    expect(parsed.parentInput).toBeUndefined();
    expect(parsed.description).toBe("body");
  });

  it("treats parent: null as an explicit clear", () => {
    const text = `---\nparent: null\n---\n\nbody\n`;
    expect(parseTaskFile(text).parentInput).toBeNull();
  });

  it("normalizes priority aliases (u/h/n/l and 0-3)", () => {
    expect(parseTaskFile(`---\npriority: u\n---\n`).priority).toBe(0);
    expect(parseTaskFile(`---\npriority: high\n---\n`).priority).toBe(1);
    expect(parseTaskFile(`---\npriority: 3\n---\n`).priority).toBe(3);
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseTaskFile("just a body\n")).toThrow(TaskFileParseError);
  });

  it("throws on empty title", () => {
    expect(() => parseTaskFile(`---\ntitle: ""\n---\n`)).toThrow(/title/);
  });

  it("throws on invalid priority", () => {
    expect(() => parseTaskFile(`---\npriority: extreme\n---\n`)).toThrow(/priority/);
  });

  it("round-trips a serialized task without dropping content", () => {
    const original = makeTask({ description: "# Heading\n\n- item one\n- item two" });
    const text = serializeTaskFile({
      task: original,
      columnName: "Backlog",
      columnNames: COLUMNS,
    });
    const parsed = parseTaskFile(text);
    expect(parsed.title).toBe(original.title);
    expect(parsed.priority).toBe(original.priority);
    expect(parsed.colName).toBe("Backlog");
    expect(parsed.parentInput).toBeNull();
    expect(parsed.description).toBe(original.description);
  });
});
