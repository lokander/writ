// @vitest-environment happy-dom
//
// DependsOnPicker — covers adding/removing blockers plus the cycle
// rejection in the candidate list. Keyboard nav is exercised by
// ParentPicker.test.ts; this file focuses on the multi-select and cycle
// semantics that are specific to depends-on.

import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Column } from "../../../../shared/types";
import { makeTask } from "../test-fixtures";
import { installApiStub, seedWritState } from "../test-helpers";

import DependsOnPicker from "./DependsOnPicker.svelte";

const COLUMNS: Column[] = [{ id: "col-todo", name: "Todo", position: 1000 }];

beforeEach(() => {
  installApiStub();
  seedWritState({
    columns: COLUMNS,
    tasks: [
      makeTask({ id: "a", title: "Apple", columnId: "col-todo" }),
      makeTask({ id: "b", title: "Banana", columnId: "col-todo" }),
      makeTask({ id: "c", title: "Cherry", columnId: "col-todo" }),
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DependsOnPicker", () => {
  it("renders existing blockers as TaskRefRow entries", () => {
    render(DependsOnPicker, { dependsOnIds: ["a"] });
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("picking a candidate appends it to dependsOnIds", async () => {
    render(DependsOnPicker, { dependsOnIds: [] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // Candidate options are sorted alphabetically: Apple, Banana, Cherry.
    // Click the first option's button.
    const appleOption = screen.getAllByText(/Apple/).find((el) => el.closest("[role='option']"));
    expect(appleOption).toBeDefined();
    await fireEvent.click(appleOption!.closest("[role='option']")!);
    // Apple is now in the blockers list. The candidate list redraws to
    // exclude it — picking another candidate adds it independently.
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("excludes already-attached blockers from candidates", async () => {
    render(DependsOnPicker, { dependsOnIds: ["a"] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    // Apple is attached → not a candidate. Banana and Cherry remain.
    expect(listbox.textContent).not.toContain("Apple");
    expect(listbox.textContent).toContain("Banana");
    expect(listbox.textContent).toContain("Cherry");
  });

  it("excludes the cycle-check task itself from candidates", async () => {
    render(DependsOnPicker, { dependsOnIds: [], taskIdForCycleCheck: "b" });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    // 'b' is the task being edited — picking itself as a blocker is a
    // direct cycle.
    expect(listbox.textContent).not.toContain("Banana");
    // The other two are fine.
    expect(listbox.textContent).toContain("Apple");
    expect(listbox.textContent).toContain("Cherry");
  });

  it("excludes a candidate whose own depends-on graph reaches the cycle-check task", async () => {
    // Build a graph: Apple → Cherry (Apple depends on Cherry). The cycle
    // check is on Cherry → picking Apple would mean Cherry → Apple → Cherry.
    seedWritState({
      columns: COLUMNS,
      tasks: [
        makeTask({ id: "a", title: "Apple", columnId: "col-todo", dependsOn: ["c"] }),
        makeTask({ id: "b", title: "Banana", columnId: "col-todo" }),
        makeTask({ id: "c", title: "Cherry", columnId: "col-todo" }),
      ],
    });

    render(DependsOnPicker, { dependsOnIds: [], taskIdForCycleCheck: "c" });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    // Apple is excluded — picking it would form Cherry → Apple → Cherry.
    expect(listbox.textContent).not.toContain("Apple");
    // Banana has no graph; safe.
    expect(listbox.textContent).toContain("Banana");
  });

  it("removing a blocker via the X drops it from dependsOnIds", async () => {
    render(DependsOnPicker, { dependsOnIds: ["a", "b"] });
    // TaskRefRow's X button has aria-label="Remove" (one per row).
    const removeButtons = screen.getAllByRole("button", { name: /^remove$/i });
    expect(removeButtons.length).toBe(2);
    // First row corresponds to 'a' (Apple, listed first in dependsOnIds).
    await fireEvent.click(removeButtons[0]!);
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });
});
