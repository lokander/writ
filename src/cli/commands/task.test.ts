import { describe, expect, it } from "vitest";

import type { Column, Task } from "../../shared/types";

import { renderTaskView } from "./task";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "01TASKAAAABBBBCCCCDDDDEEFF",
    parentId: null,
    columnId: "01COLBACKLOGAAAAAAAAAAAAAA",
    title: "Buy milk",
    description: "",
    priority: 2,
    position: 1000,
    // Fixed timestamps so the formatted output is deterministic.
    createdAt: 1735776000000, // 2025-01-02 00:00 UTC
    updatedAt: 1735776000000,
    ...overrides,
  };
}

const COLUMNS: Column[] = [
  { id: "01COLBACKLOGAAAAAAAAAAAAAA", name: "Backlog", position: 1000 },
  { id: "01COLDOINGAAAAAAAAAAAAAAAA", name: "Doing", position: 2000 },
];

describe("renderTaskView", () => {
  it("renders the header rows with padded labels", () => {
    const text = renderTaskView(makeTask({ priority: 0 }), COLUMNS, []);
    expect(text).toContain("ID         01TASKAAAABBBBCCCCDDDDEEFF");
    expect(text).toContain("Title      Buy milk");
    expect(text).toContain("Column     Backlog");
    expect(text).toContain("Priority   urgent");
    expect(text).toContain("Parent     —");
    expect(text).toContain("Subtasks   0");
    expect(text).toMatch(/Created\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect(text).toMatch(/Updated\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  });

  it("shows the parent as its last 6 chars when set", () => {
    const text = renderTaskView(makeTask({ parentId: "01PARENTAAAAAAAAAAAAYYZZZZ" }), COLUMNS, []);
    expect(text).toContain("Parent     YYZZZZ");
  });

  it("falls back to ? when the column id is unknown", () => {
    const text = renderTaskView(makeTask({ columnId: "missing" }), COLUMNS, []);
    expect(text).toContain("Column     ?");
  });

  it("shows a placeholder for empty/whitespace descriptions", () => {
    expect(renderTaskView(makeTask({ description: "" }), COLUMNS, [])).toContain(
      "  (no description)",
    );
    expect(renderTaskView(makeTask({ description: "   \n\t" }), COLUMNS, [])).toContain(
      "  (no description)",
    );
  });

  it("indents every line of multi-line descriptions by two spaces", () => {
    const desc = "First line\nSecond line\n\n- bullet";
    const text = renderTaskView(makeTask({ description: desc }), COLUMNS, []);
    expect(text).toContain("  First line");
    expect(text).toContain("  Second line");
    expect(text).toContain("  - bullet");
  });

  it("appends a subtasks listing when the task has children", () => {
    const parent = makeTask({ id: "01PARENT00000000000000ABCD" });
    const subOne = makeTask({
      id: "01SUBONEAAAAAAAAAAAAAA1234",
      title: "Sub one",
      parentId: parent.id,
      priority: 1,
    });
    const subTwo = makeTask({
      id: "01SUBTWOAAAAAAAAAAAAAA5678",
      title: "Sub two",
      parentId: parent.id,
    });
    const text = renderTaskView(parent, COLUMNS, [parent, subOne, subTwo]);
    expect(text).toContain("Subtasks (2)");
    expect(text).toMatch(/AA1234\s+\[h\] Sub one/);
    expect(text).toContain("Sub two");
  });

  it("omits the subtasks listing when there are none", () => {
    const text = renderTaskView(makeTask(), COLUMNS, []);
    expect(text).not.toMatch(/^Subtasks \(/m);
  });

  it("only counts direct children, not grandchildren or unrelated tasks", () => {
    const parent = makeTask({ id: "01PARENT00000000000000ABCD" });
    const direct = makeTask({
      id: "01DIRECT0000000000000BBBBB",
      title: "Direct",
      parentId: parent.id,
    });
    const grandchild = makeTask({
      id: "01GRAND00000000000000CCCCC",
      title: "Grand",
      parentId: direct.id,
    });
    const unrelated = makeTask({ id: "01UNREL00000000000000DDDDD", title: "Other" });
    const text = renderTaskView(parent, COLUMNS, [parent, direct, grandchild, unrelated]);
    expect(text).toContain("Subtasks (1)");
    expect(text).toContain("Direct");
    expect(text).not.toContain("Grand");
    expect(text).not.toContain("Other");
  });
});
