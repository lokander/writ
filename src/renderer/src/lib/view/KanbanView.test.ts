// @vitest-environment happy-dom
//
// KanbanView rendering. Verifies tasks land under the right column,
// child-count badges and parent breadcrumbs render only when relevant,
// and `dragEnabled={false}` keeps Pragmatic from attaching the draggable
// listener.

import { render, screen, within } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Column, Task } from "../../../../shared/types";
import { makeTask } from "../test-fixtures";
import { installApiStub, seedWritState } from "../test-helpers";

import KanbanView from "./KanbanView.svelte";

const COLUMNS: Column[] = [
  { id: "col-backlog", name: "Backlog", position: 1000 },
  { id: "col-todo", name: "Todo", position: 2000 },
  { id: "col-doing", name: "Doing", position: 3000 },
  { id: "col-done", name: "Done", position: 4000 },
  { id: "col-archived", name: "Archived", position: 5000 },
];

function mountKanban(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof render<typeof KanbanView>> {
  return render(KanbanView, {
    columns: COLUMNS,
    visibleTasks: [] as Task[],
    dragEnabled: true,
    onTaskClick: vi.fn(),
    onTaskContextMenu: vi.fn(),
    contextMenuTaskId: null,
    ...overrides,
  });
}

beforeEach(() => {
  installApiStub();
  seedWritState({ columns: COLUMNS, tasks: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KanbanView column layout", () => {
  it("places tasks under the heading of their column", () => {
    const todo = makeTask({ title: "Todo card", columnId: "col-todo" });
    const doing = makeTask({ title: "Doing card", columnId: "col-doing" });
    seedWritState({ columns: COLUMNS, tasks: [todo, doing] });

    mountKanban({ visibleTasks: [todo, doing] });

    // The Todo heading and the "Todo card" should share an ancestor that
    // doesn't include the Doing card — i.e. each lives in its own column
    // container.
    const todoColumn = screen.getByRole("heading", { name: "Todo" }).closest("div.flex.w-80");
    expect(todoColumn).not.toBeNull();
    expect(within(todoColumn as HTMLElement).getByText("Todo card")).toBeInTheDocument();
    expect(within(todoColumn as HTMLElement).queryByText("Doing card")).not.toBeInTheDocument();
  });

  it("hides Backlog and Archived from the visible columns (they have edge drop zones instead)", () => {
    mountKanban();
    expect(screen.queryByRole("heading", { name: "Backlog" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Archived" })).not.toBeInTheDocument();
    // Active columns still surface.
    expect(screen.getByRole("heading", { name: "Todo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
  });
});

describe("KanbanView card metadata", () => {
  it("renders the child-count badge only when subtasks exist", () => {
    // childCount is derived from writState.tasks (via writDerived), so we
    // seed three real children under the parent rather than passing a fake
    // count — the test exercises the same code path as production.
    const parent = makeTask({ id: "p1", title: "Parent", columnId: "col-todo" });
    const lone = makeTask({ id: "l1", title: "Lone", columnId: "col-todo" });
    const c1 = makeTask({ id: "c1", title: "C1", parentId: "p1", columnId: "col-todo" });
    const c2 = makeTask({ id: "c2", title: "C2", parentId: "p1", columnId: "col-todo" });
    const c3 = makeTask({ id: "c3", title: "C3", parentId: "p1", columnId: "col-todo" });
    seedWritState({ columns: COLUMNS, tasks: [parent, lone, c1, c2, c3] });

    // visibleTasks intentionally omits the children — kanban only renders
    // what's in visibleTasks, but the badge count comes from the derived
    // store, which sees the full task set.
    mountKanban({ visibleTasks: [parent, lone] });

    // The badge surfaces the count next to the parent.
    const parentCard = screen.getByText("Parent").closest("button")!;
    expect(within(parentCard).getByText("3")).toBeInTheDocument();

    // No badge on the lone card.
    const loneCard = screen.getByText("Lone").closest("button")!;
    expect(within(loneCard).queryByText("3")).not.toBeInTheDocument();
  });

  it("renders the parent breadcrumb on a subtask whose parent is in writState.tasks", () => {
    const parent = makeTask({ id: "p1", title: "Auth refactor", columnId: "col-todo" });
    const child = makeTask({
      id: "c1",
      title: "Drop session middleware",
      parentId: "p1",
      columnId: "col-todo",
    });
    seedWritState({ columns: COLUMNS, tasks: [parent, child] });

    mountKanban({ visibleTasks: [parent, child] });

    // The subtask card prefixes its parent's title with the breadcrumb arrow.
    const childCard = screen.getByText("Drop session middleware").closest("button")!;
    expect(within(childCard).getByText(/Auth refactor/)).toBeInTheDocument();
  });

  it("omits the breadcrumb on a top-level task", () => {
    const top = makeTask({ id: "t1", title: "Standalone", columnId: "col-todo" });
    seedWritState({ columns: COLUMNS, tasks: [top] });

    mountKanban({ visibleTasks: [top] });

    const card = screen.getByText("Standalone").closest("button")!;
    // The breadcrumb element has a `title="Subtask of …"` attribute, which
    // is the most stable hook (the visible text is the parent title).
    expect(card.querySelector("[title^='Subtask of']")).toBeNull();
  });
});

describe("KanbanView drag enable/disable", () => {
  // Pragmatic's draggable() adds a `draggable="true"` attribute to the
  // element when it attaches. With dragEnabled=false, our dnd wrapper
  // skips the attach entirely → the attribute stays absent.
  it("cards are draggable when dragEnabled=true", () => {
    const task = makeTask({ id: "t1", title: "Drag me", columnId: "col-todo" });
    seedWritState({ columns: COLUMNS, tasks: [task] });

    mountKanban({ visibleTasks: [task], dragEnabled: true });
    const card = screen.getByText("Drag me").closest("button")!;
    expect(card.getAttribute("draggable")).toBe("true");
  });

  it("cards are not draggable when dragEnabled=false", () => {
    const task = makeTask({ id: "t1", title: "Drag me", columnId: "col-todo" });
    seedWritState({ columns: COLUMNS, tasks: [task] });

    mountKanban({ visibleTasks: [task], dragEnabled: false });
    const card = screen.getByText("Drag me").closest("button")!;
    // The attribute was never added because Pragmatic was never wired up.
    expect(card.getAttribute("draggable")).not.toBe("true");
  });
});
