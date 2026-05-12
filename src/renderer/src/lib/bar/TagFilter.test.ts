// @vitest-environment happy-dom
//
// TagFilter — the rounded-pill tag typeahead extracted from FilterBar.
// Selected tags render as click-to-remove chips after the input; the
// Combobox dropdown surfaces the unselected pool. Typing filters the
// dropdown; ArrowDown + Enter toggles a tag into the active set;
// clicking the chip itself removes it.

import { fireEvent, render, screen, type RenderResult } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Tag } from "../../../../shared/types";

import TagFilter from "./TagFilter.svelte";

const TAGS: Tag[] = [
  { id: "t-ui", name: "ui", color: "red" },
  { id: "t-core", name: "core", color: null },
  { id: "t-docs", name: "docs", color: "blue" },
];

function renderFilter(tags: string[] = []): RenderResult<typeof TagFilter> {
  return render(TagFilter, { tags, visibleTagChips: TAGS });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TagFilter", () => {
  it("renders all in-scope tags in the dropdown when nothing is selected", async () => {
    renderFilter();
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).toContain("ui");
    expect(listbox.textContent).toContain("core");
    expect(listbox.textContent).toContain("docs");
  });

  it("typing narrows the dropdown to substring matches", async () => {
    renderFilter();
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "co" } });
    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).toContain("core");
    expect(listbox.textContent).not.toContain("ui");
    expect(listbox.textContent).not.toContain("docs");
  });

  it("ArrowDown + Enter toggles the highlighted tag into the filter set", async () => {
    renderFilter();
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
    renderFilter(["ui"]);
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

  it("Backspace on an empty input removes the last selected tag", async () => {
    renderFilter(["ui", "core"]);
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // 'ui' and 'core' are both shown as chips; the last in order is 'core'.
    expect(screen.getByRole("button", { name: /remove tag ui/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove tag core/i })).toBeInTheDocument();
    await fireEvent.keyDown(input, { key: "Backspace" });
    // Last chip ('core') is gone; 'ui' remains.
    expect(screen.queryByRole("button", { name: /remove tag core/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove tag ui/i })).toBeInTheDocument();
  });

  it("Backspace with a non-empty query is a no-op for selections (input handles its own delete)", async () => {
    renderFilter(["ui"]);
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "x" } });
    await fireEvent.keyDown(input, { key: "Backspace" });
    // The chip stays put — the browser's default Backspace handles the
    // typed character; we only fire the chip removal when the input is
    // already empty.
    expect(screen.getByRole("button", { name: /remove tag ui/i })).toBeInTheDocument();
  });

  it("selected tags are excluded from the dropdown's available pool", async () => {
    renderFilter(["ui"]);
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
