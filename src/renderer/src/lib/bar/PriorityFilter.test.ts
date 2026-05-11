// @vitest-environment happy-dom
//
// PriorityFilter — the dot-row priority toggle extracted from FilterBar.
// Verifies a click toggles the corresponding priority on/off (reflected
// via aria-pressed on each dot button).

import { fireEvent, render, screen, type RenderResult } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Priority } from "../../../../shared/types";

import PriorityFilter from "./PriorityFilter.svelte";

function renderFilter(priorities: Priority[] = []): RenderResult<typeof PriorityFilter> {
  return render(PriorityFilter, { priorities });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PriorityFilter", () => {
  it("renders one dot per priority level (4 buttons)", () => {
    renderFilter();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("aria-pressed reflects the selected set", () => {
    renderFilter([0, 2]);
    const urgent = screen.getByRole("button", { name: /toggle urgent/i });
    const high = screen.getByRole("button", { name: /toggle high/i });
    const normal = screen.getByRole("button", { name: /toggle normal/i });
    const low = screen.getByRole("button", { name: /toggle low/i });
    expect(urgent).toHaveAttribute("aria-pressed", "true");
    expect(high).toHaveAttribute("aria-pressed", "false");
    expect(normal).toHaveAttribute("aria-pressed", "true");
    expect(low).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an inactive dot toggles it on", async () => {
    renderFilter();
    const high = screen.getByRole("button", { name: /toggle high/i });
    expect(high).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(high);
    expect(high).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking an active dot toggles it off", async () => {
    renderFilter([1]);
    const high = screen.getByRole("button", { name: /toggle high/i });
    expect(high).toHaveAttribute("aria-pressed", "true");
    await fireEvent.click(high);
    expect(high).toHaveAttribute("aria-pressed", "false");
  });
});
