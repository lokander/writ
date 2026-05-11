// @vitest-environment happy-dom
//
// FilterBar — covers the typeahead tag picker added for many-tag projects.
// Selected tags render as chips (with an X to remove); the Combobox shows
// the unselected pool. Typing filters the dropdown; ArrowDown + Enter
// toggles a tag into the active set; clicking the chip's X removes it.

import { fireEvent, render, screen, type RenderResult } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tag } from "../../../../shared/types";

import FilterBar from "./FilterBar.svelte";

const TAGS: Tag[] = [
  { id: "t-ui", name: "ui", color: "red" },
  { id: "t-core", name: "core", color: null },
  { id: "t-docs", name: "docs", color: "blue" },
];

interface RenderOpts {
  tags?: string[];
}

function renderBar({ tags = [] }: RenderOpts = {}): RenderResult<typeof FilterBar> {
  return render(FilterBar, {
    tags,
    priorities: [],
    stateFilter: "any",
    visibleTagChips: TAGS,
    filtersActive: tags.length > 0,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FilterBar tag typeahead", () => {
  it("renders all in-scope tags in the dropdown when nothing is selected", async () => {
    renderBar();
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).toContain("ui");
    expect(listbox.textContent).toContain("core");
    expect(listbox.textContent).toContain("docs");
  });

  it("typing narrows the dropdown to substring matches", async () => {
    renderBar();
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "co" } });
    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).toContain("core");
    expect(listbox.textContent).not.toContain("ui");
    expect(listbox.textContent).not.toContain("docs");
  });

  it("ArrowDown + Enter toggles the highlighted tag into the filter set", async () => {
    renderBar();
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // Items are in the order from visibleTagChips: ui, core, docs.
    // activeIndex starts at 0 (ui); ArrowDown advances to core.
    await fireEvent.keyDown(input, { key: "ArrowDown" });
    await fireEvent.keyDown(input, { key: "Enter" });
    // After pick, the chip area renders the selected tag as a single
    // "Remove tag <name>" button (clicking it removes the tag).
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove tag core/i })).toBeInTheDocument();
  });

  it("clicking a selected tag's chip removes it from the filter set", async () => {
    renderBar({ tags: ["ui"] });
    expect(screen.getByText("ui")).toBeInTheDocument();
    const chipButton = screen.getByRole("button", { name: /remove tag ui/i });
    await fireEvent.click(chipButton);
    expect(screen.queryByRole("button", { name: /remove tag ui/i })).not.toBeInTheDocument();
    // 'ui' returns to the available pool in the dropdown.
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).toContain("ui");
  });

  it("selected tags are excluded from the dropdown's available pool", async () => {
    renderBar({ tags: ["ui"] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    // 'ui' is selected → not in the dropdown. The others are.
    // The selected 'ui' chip lives outside the listbox in the bar above.
    expect(listbox.textContent).not.toContain("ui");
    expect(listbox.textContent).toContain("core");
    expect(listbox.textContent).toContain("docs");
  });
});
