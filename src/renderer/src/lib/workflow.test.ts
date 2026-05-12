import { describe, expect, it } from "vitest";

import type { Column } from "../../../shared/types";

import { nextWorkflowColumn } from "./workflow";

function col(id: string, name: string, position: number): Column {
  return { id, name, position };
}

// The canonical column set every fresh project starts with. Most tests
// run against this; the "customized" cases override.
const CANONICAL: Column[] = [
  col("c-backlog", "Backlog", 1000),
  col("c-todo", "Todo", 2000),
  col("c-doing", "Doing", 3000),
  col("c-done", "Done", 4000),
  col("c-archived", "Archived", 5000),
];

describe("nextWorkflowColumn — canonical project", () => {
  it("advances Backlog → Todo", () => {
    expect(nextWorkflowColumn(CANONICAL, "c-backlog")?.id).toBe("c-todo");
  });

  it("advances Todo → Doing", () => {
    expect(nextWorkflowColumn(CANONICAL, "c-todo")?.id).toBe("c-doing");
  });

  it("advances Doing → Done", () => {
    expect(nextWorkflowColumn(CANONICAL, "c-doing")?.id).toBe("c-done");
  });

  it("advances Done → Archived", () => {
    expect(nextWorkflowColumn(CANONICAL, "c-done")?.id).toBe("c-archived");
  });

  it("returns null for Archived (terminal)", () => {
    expect(nextWorkflowColumn(CANONICAL, "c-archived")).toBeNull();
  });
});

describe("nextWorkflowColumn — case-insensitive matching", () => {
  it("matches column names regardless of case", () => {
    const mixedCase: Column[] = [
      col("c-todo", "TODO", 1000),
      col("c-doing", "doing", 2000),
      col("c-done", "Done", 3000),
    ];
    expect(nextWorkflowColumn(mixedCase, "c-todo")?.id).toBe("c-doing");
    expect(nextWorkflowColumn(mixedCase, "c-doing")?.id).toBe("c-done");
  });
});

describe("nextWorkflowColumn — customized project", () => {
  it("skips a missing intermediate step", () => {
    // No "Done" column — a "Doing" card should land in "Archived".
    const noDone: Column[] = [
      col("c-todo", "Todo", 1000),
      col("c-doing", "Doing", 2000),
      col("c-archived", "Archived", 3000),
    ];
    expect(nextWorkflowColumn(noDone, "c-doing")?.id).toBe("c-archived");
  });

  it("returns null when no canonical column exists past the current one", () => {
    // No Archived, current is Done — nothing further in the workflow.
    const noArchived: Column[] = [
      col("c-todo", "Todo", 1000),
      col("c-doing", "Doing", 2000),
      col("c-done", "Done", 3000),
    ];
    expect(nextWorkflowColumn(noArchived, "c-done")).toBeNull();
  });

  it("returns null when the current column's name isn't a canonical step", () => {
    // A project renamed Backlog to "Inbox" — we don't guess where to
    // advance from a custom name, so the shortcut hides.
    const custom: Column[] = [col("c-inbox", "Inbox", 1000), col("c-todo", "Todo", 2000)];
    expect(nextWorkflowColumn(custom, "c-inbox")).toBeNull();
  });
});

describe("nextWorkflowColumn — edge cases", () => {
  it("returns null when the current column id isn't in the list", () => {
    expect(nextWorkflowColumn(CANONICAL, "c-bogus")).toBeNull();
  });

  it("returns null for an empty column list", () => {
    expect(nextWorkflowColumn([], "c-anything")).toBeNull();
  });
});
