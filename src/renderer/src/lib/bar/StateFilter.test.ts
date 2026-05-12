// @vitest-environment happy-dom
//
// StateFilter — the rounded-pill radio-style toggle for the
// "any | ready | blocked" task-state narrowing in the FilterBar.

import { fireEvent, render, screen, type RenderResult } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StateFilter as StateFilterValue } from "../filter";

import StateFilter from "./StateFilter.svelte";

function renderFilter(stateFilter: StateFilterValue = "any"): RenderResult<typeof StateFilter> {
  return render(StateFilter, { stateFilter });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StateFilter", () => {
  it("renders one button per option (3 total)", () => {
    renderFilter();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("aria-pressed marks the active option", () => {
    renderFilter("ready");
    const all = screen.getByRole("button", { name: /^all$/i });
    const ready = screen.getByRole("button", { name: /^ready$/i });
    const blocked = screen.getByRole("button", { name: /^blocked$/i });
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(ready).toHaveAttribute("aria-pressed", "true");
    expect(blocked).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an option switches the active mode", async () => {
    renderFilter("any");
    const blocked = screen.getByRole("button", { name: /^blocked$/i });
    expect(blocked).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(blocked);
    expect(blocked).toHaveAttribute("aria-pressed", "true");
    // 'all' is no longer active.
    expect(screen.getByRole("button", { name: /^all$/i })).toHaveAttribute("aria-pressed", "false");
  });
});
