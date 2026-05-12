// @vitest-environment happy-dom
//
// TaskContextMenu rendering. The unit-tested resolver in `workflow.test.ts`
// already covers the "next column" logic across project shapes; here we
// just confirm the menu wires it up (entry visible for a mid-workflow
// card, hidden on the terminal Archived step) and that the existing
// submenu/Edit/Delete entries are still present.

import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Column } from "../../../../shared/types";
import { makeTask } from "../test-fixtures";
import { installApiStub } from "../test-helpers";

import TaskContextMenu from "./TaskContextMenu.svelte";

const COLUMNS: Column[] = [
  { id: "col-backlog", name: "Backlog", position: 1000 },
  { id: "col-todo", name: "Todo", position: 2000 },
  { id: "col-doing", name: "Doing", position: 3000 },
  { id: "col-done", name: "Done", position: 4000 },
  { id: "col-archived", name: "Archived", position: 5000 },
];

function mountMenu(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof render<typeof TaskContextMenu>> {
  return render(TaskContextMenu, {
    task: makeTask({ columnId: "col-todo" }),
    columns: COLUMNS,
    x: 100,
    y: 100,
    onEdit: vi.fn(),
    onSetPriority: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  installApiStub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskContextMenu — advance shortcut", () => {
  it("renders 'Move to <next>' for a Todo card", () => {
    mountMenu({ task: makeTask({ columnId: "col-todo" }) });
    expect(screen.getByRole("button", { name: "Move to Doing" })).toBeInTheDocument();
  });

  it("calls onMove with the next column's id when clicked", async () => {
    const onMove = vi.fn();
    mountMenu({ task: makeTask({ columnId: "col-doing" }), onMove });
    await fireEvent.click(screen.getByRole("button", { name: "Move to Done" }));
    expect(onMove).toHaveBeenCalledExactlyOnceWith("col-done");
  });

  it("hides the shortcut on the terminal Archived column", () => {
    mountMenu({ task: makeTask({ columnId: "col-archived" }) });
    // No "Move to <something>" top-level entry — the submenu still exists
    // with the literal "Move to" trigger, so we match the start.
    expect(screen.queryByRole("button", { name: /^Move to [A-Z]/ })).not.toBeInTheDocument();
    // The submenu trigger is still there.
    expect(screen.getByRole("button", { name: /^Move to$/ })).toBeInTheDocument();
  });

  it("hides the shortcut when the card's column isn't a canonical workflow step", () => {
    // Custom column outside the Backlog/Todo/Doing/Done/Archived flow —
    // the resolver returns null and the shortcut shouldn't render.
    const customColumns: Column[] = [
      { id: "col-review", name: "Review", position: 1000 },
      { id: "col-todo", name: "Todo", position: 2000 },
    ];
    mountMenu({
      task: makeTask({ columnId: "col-review" }),
      columns: customColumns,
    });
    expect(screen.queryByRole("button", { name: /^Move to [A-Z]/ })).not.toBeInTheDocument();
  });
});

describe("TaskContextMenu — existing entries still present", () => {
  it("renders Edit, Priority submenu trigger, Move to submenu trigger, and Delete", () => {
    mountMenu();
    expect(screen.getByRole("button", { name: /Edit task/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Priority$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Move to$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete task/ })).toBeInTheDocument();
  });
});
