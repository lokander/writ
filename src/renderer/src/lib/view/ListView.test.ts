// @vitest-environment happy-dom
//
// ListView rendering. Verifies:
//   - tab counts reflect the filter scope (top-level only when no filter
//     is active; every visible task when one is),
//   - hierarchical render (no filter) indents children under parents,
//   - the [Col] mismatch badge appears on a child living in a different
//     column from its parent,
//   - flat render (filter active) lists matching tasks without nesting.

import { render, screen, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Column } from "../../../../shared/types";
import { filters } from "../filters.svelte";
import { makeTask } from "../test-fixtures";
import { installApiStub, resetFilters, resetSearch, seedWritState } from "../test-helpers";

import ListView from "./ListView.svelte";

const COLUMNS: Column[] = [
  { id: "col-backlog", name: "Backlog", position: 1000 },
  { id: "col-todo", name: "Todo", position: 2000 },
  { id: "col-doing", name: "Doing", position: 3000 },
  { id: "col-done", name: "Done", position: 4000 },
];

function mountListView(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof render<typeof ListView>> {
  return render(ListView, {
    columns: COLUMNS,
    activeColumnId: "col-todo",
    onTaskClick: vi.fn(),
    onTaskContextMenu: vi.fn(),
    contextMenuTaskId: null,
    ...overrides,
  });
}

beforeEach(() => {
  installApiStub();
  // Reset singletons so a filter / sortMode set in one test doesn't bleed
  // into the next via the module-level instance.
  resetFilters();
  resetSearch();
  seedWritState({ columns: COLUMNS, tasks: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ListView tab counts", () => {
  it("counts top-level tasks per column when no filter is active", () => {
    const t1 = makeTask({ id: "t1", title: "Top A", columnId: "col-todo" });
    const t2 = makeTask({ id: "t2", title: "Top B", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Child",
      parentId: "t1",
      columnId: "col-todo",
    });
    const doingTop = makeTask({ id: "d1", title: "Doing top", columnId: "col-doing" });
    seedWritState({ columns: COLUMNS, tasks: [t1, t2, child, doingTop] });

    mountListView();

    // Todo has 2 top-level (child doesn't count toward the badge),
    // Doing has 1, Backlog and Done are 0.
    const todoTab = screen.getByRole("tab", { name: /Todo/ });
    expect(within(todoTab).getByText("2")).toBeInTheDocument();
    const doingTab = screen.getByRole("tab", { name: /Doing/ });
    expect(within(doingTab).getByText("1")).toBeInTheDocument();
  });

  it("counts every matching task per column when a filter is active", () => {
    // With filters active, ListView counts post-filter `visibleTasks` (any
    // depth) instead of just top-level. So a child in the visible set
    // contributes to its column's count. We flip a real priority filter
    // (which both tasks match by default) instead of faking the prop —
    // the test exercises the same code path as production.
    const top = makeTask({ id: "t1", title: "Top", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Child",
      parentId: "t1",
      columnId: "col-todo",
    });
    seedWritState({ columns: COLUMNS, tasks: [top, child] });
    filters.priorities = [2];

    mountListView();

    const todoTab = screen.getByRole("tab", { name: /Todo/ });
    expect(within(todoTab).getByText("2")).toBeInTheDocument();
  });
});

describe("ListView hierarchical render", () => {
  it("indents children under their parent when no filter is active", () => {
    const parent = makeTask({ id: "p1", title: "Parent", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Child",
      parentId: "p1",
      columnId: "col-todo",
    });
    seedWritState({ columns: COLUMNS, tasks: [parent, child] });

    mountListView();

    // Parent renders at depth 0 (no inline indent).
    const parentCard = screen.getByText("Parent").closest("button")!;
    expect(parentCard.style.marginLeft).toBe("0rem");

    // Child renders at depth 1 (1.5rem indent).
    const childCard = screen.getByText("Child").closest("button")!;
    expect(childCard.style.marginLeft).toBe("1.5rem");
  });

  it("shows the [Col] mismatch badge on a child whose column differs from the parent", () => {
    // Parent in Todo, child in Done — the badge should call this out so
    // the user notices the cross-column child without expanding into the
    // other tab.
    const parent = makeTask({ id: "p1", title: "Parent", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Wandering child",
      parentId: "p1",
      columnId: "col-done",
    });
    seedWritState({ columns: COLUMNS, tasks: [parent, child] });

    mountListView();

    const childCard = screen.getByText("Wandering child").closest("button")!;
    expect(within(childCard).getByText("Done")).toBeInTheDocument();
  });

  it("omits the mismatch badge when the child column matches the parent column", () => {
    const parent = makeTask({ id: "p1", title: "Parent", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Aligned child",
      parentId: "p1",
      columnId: "col-todo",
    });
    seedWritState({ columns: COLUMNS, tasks: [parent, child] });

    mountListView();

    const childCard = screen.getByText("Aligned child").closest("button")!;
    // No "Todo" / "Done" badge inside the child card — that badge only
    // surfaces on a column mismatch.
    expect(within(childCard).queryByText("Todo")).not.toBeInTheDocument();
    expect(within(childCard).queryByText("Done")).not.toBeInTheDocument();
  });
});

describe("ListView flat render (filter active)", () => {
  it("lists every matching task at depth 0 without nesting", () => {
    const parent = makeTask({ id: "p1", title: "Parent", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Child",
      parentId: "p1",
      columnId: "col-todo",
    });
    seedWritState({ columns: COLUMNS, tasks: [parent, child] });
    // Activate a real priority filter so the flat-render branch fires the
    // same way it does in production — no query, so titles stay un-
    // highlighted and the `getByText` lookup below is stable.
    filters.priorities = [2];

    mountListView();

    const childCard = screen.getByText("Child").closest("button")!;
    // Flat render: child sits at depth 0 too, no margin-left indent.
    expect(childCard.style.marginLeft).toBe("0rem");
  });
});
