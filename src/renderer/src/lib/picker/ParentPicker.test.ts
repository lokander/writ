// @vitest-environment happy-dom
//
// ParentPicker selection + the keyboard nav it inherits from Combobox.
// Tests the user-visible contract: parentId binding, the Clear button,
// and the ArrowDown/Enter/Esc keys feeding through the Combobox base.

import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Column } from "../../../../shared/types";
import { writState } from "../state.svelte";
import { makeTask } from "../test-fixtures";
import { installApiStub, seedWritState } from "../test-helpers";

import ParentPicker from "./ParentPicker.svelte";

const COLUMNS: Column[] = [
  { id: "col-todo", name: "Todo", position: 1000 },
  { id: "col-doing", name: "Doing", position: 2000 },
];

function setupTasks(): void {
  seedWritState({
    columns: COLUMNS,
    tasks: [
      makeTask({ id: "a", title: "Apple", columnId: "col-todo" }),
      makeTask({ id: "b", title: "Banana", columnId: "col-todo" }),
      makeTask({ id: "c", title: "Cherry", columnId: "col-doing" }),
    ],
  });
}

beforeEach(() => {
  installApiStub();
  setupTasks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ParentPicker selection", () => {
  it("renders the current parent as a chip and a Clear button when parentId is set", () => {
    render(ParentPicker, { parentId: "b" });
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear parent/i })).toBeInTheDocument();
  });

  it("renders the no-parent placeholder when parentId is null", () => {
    render(ParentPicker, { parentId: null });
    expect(screen.getByText(/no parent/i)).toBeInTheDocument();
  });

  it("clicking Clear resets parentId to null", async () => {
    // Component owns parentId via $bindable; we read it back through the
    // visible DOM (chip presence) since we don't have a bind handle here.
    render(ParentPicker, { parentId: "b" });
    expect(screen.getByText("Banana")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /clear parent/i }));
    // Chip is gone; the no-parent placeholder takes its place.
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
    expect(screen.getByText(/no parent/i)).toBeInTheDocument();
  });

  it("typing filters the picker options", async () => {
    render(ParentPicker, { parentId: null });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // All three render initially. Banana is the only "an" match.
    expect(screen.getByText("Apple")).toBeInTheDocument();
    await fireEvent.input(input, { target: { value: "an" } });
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    expect(screen.queryByText("Cherry")).not.toBeInTheDocument();
  });

  it("ArrowDown + Enter picks the highlighted task and updates the chip", async () => {
    render(ParentPicker, { parentId: null });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // Options are sorted alphabetically: Apple, Banana, Cherry. ArrowDown
    // moves from Apple (0) → Banana (1).
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });

    // The picker swapped the placeholder for the chip showing the chosen
    // task's title. (The combobox dropdown closes on select, so the
    // remaining Banana text in the document is the chip, not the option.)
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText(/no parent/i)).not.toBeInTheDocument();
  });

  it("Escape closes the dropdown without committing a pick", async () => {
    render(ParentPicker, { parentId: null });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    expect(screen.getByText("Apple")).toBeInTheDocument();
    await fireEvent.keyDown(input, { key: "Escape" });
    // Listbox is gone — Apple isn't in the document.
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
    // No parent picked.
    expect(screen.getByText(/no parent/i)).toBeInTheDocument();
  });

  it("excludeIds removes the listed tasks from the options", async () => {
    render(ParentPicker, { parentId: null, excludeIds: { b: true } });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
    expect(screen.getByText("Cherry")).toBeInTheDocument();
  });

  // The tasks list mutates between picks — keep writState updated so the
  // reactive `parentTask` derived can find the chosen row.
  it("survives a writState refresh during a session", async () => {
    render(ParentPicker, { parentId: "b" });
    expect(screen.getByText("Banana")).toBeInTheDocument();
    // Simulate a silent reload: rebuild the tasks array (same ids).
    writState.tasks = [
      makeTask({ id: "a", title: "Apple", columnId: "col-todo" }),
      makeTask({ id: "b", title: "Banana (renamed)", columnId: "col-todo" }),
      makeTask({ id: "c", title: "Cherry", columnId: "col-doing" }),
    ];
    await Promise.resolve();
    expect(screen.getByText("Banana (renamed)")).toBeInTheDocument();
  });
});
