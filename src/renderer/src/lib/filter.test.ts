import { describe, expect, it } from "vitest";

import { emptyFilter, filtersActive, matchesFilters, type FilterState } from "./filter";
import { makeTask } from "./test-fixtures";

function f(overrides: Partial<FilterState> = {}): FilterState {
  return { ...emptyFilter(), ...overrides };
}

describe("filtersActive", () => {
  it("returns false for the empty filter", () => {
    expect(filtersActive(emptyFilter())).toBe(false);
  });

  it("returns true when any chip group has a selection", () => {
    expect(filtersActive(f({ tags: ["ui"] }))).toBe(true);
    expect(filtersActive(f({ priorities: [0] }))).toBe(true);
    expect(filtersActive(f({ state: "ready" }))).toBe(true);
  });
});

describe("matchesFilters — tags", () => {
  it("ANDs across the selection — task must have every selected tag", () => {
    const task = makeTask({ tags: ["ui", "core"] });
    expect(matchesFilters(task, f({ tags: ["ui", "core"] }))).toBe(true);
    expect(matchesFilters(task, f({ tags: ["ui", "missing"] }))).toBe(false);
  });

  it("empty tags array is a no-op (task matches regardless of its own tags)", () => {
    const tagged = makeTask({ tags: ["ui"] });
    const untagged = makeTask({ tags: [] });
    expect(matchesFilters(tagged, f({ tags: [] }))).toBe(true);
    expect(matchesFilters(untagged, f({ tags: [] }))).toBe(true);
  });
});

describe("matchesFilters — priorities", () => {
  it("ORs across the selected priority chips", () => {
    const urgent = makeTask({ priority: 0 });
    const high = makeTask({ priority: 1 });
    const low = makeTask({ priority: 3 });
    const filter = f({ priorities: [0, 1] });
    expect(matchesFilters(urgent, filter)).toBe(true);
    expect(matchesFilters(high, filter)).toBe(true);
    expect(matchesFilters(low, filter)).toBe(false);
  });

  it("empty priorities is a no-op", () => {
    expect(matchesFilters(makeTask({ priority: 3 }), emptyFilter())).toBe(true);
  });
});

describe("matchesFilters — state", () => {
  it("`ready` narrows to tasks with isReady=true", () => {
    const ready = makeTask({ isReady: true, blockedBy: [] });
    const blocked = makeTask({ isReady: false, blockedBy: ["x"] });
    const filter = f({ state: "ready" });
    expect(matchesFilters(ready, filter)).toBe(true);
    expect(matchesFilters(blocked, filter)).toBe(false);
  });

  it("`blocked` narrows to tasks with at least one open blocker", () => {
    const open = makeTask({ isReady: false, blockedBy: ["x"] });
    const ready = makeTask({ isReady: true, blockedBy: [] });
    const filter = f({ state: "blocked" });
    expect(matchesFilters(open, filter)).toBe(true);
    expect(matchesFilters(ready, filter)).toBe(false);
  });

  it("`any` doesn't narrow on state", () => {
    const filter = f({ state: "any" });
    expect(matchesFilters(makeTask({ isReady: true }), filter)).toBe(true);
    expect(matchesFilters(makeTask({ isReady: false, blockedBy: ["x"] }), filter)).toBe(true);
  });
});

describe("matchesFilters — composition", () => {
  it("ANDs across filter groups (tag + priority + state)", () => {
    const task = makeTask({ tags: ["ui"], priority: 0, isReady: true });
    const passingFilter = f({ tags: ["ui"], priorities: [0], state: "ready" });
    expect(matchesFilters(task, passingFilter)).toBe(true);

    // Same task fails if any one group rejects it.
    expect(matchesFilters(task, f({ ...passingFilter, tags: ["core"] }))).toBe(false);
    expect(matchesFilters(task, f({ ...passingFilter, priorities: [3] }))).toBe(false);
    expect(matchesFilters(task, f({ ...passingFilter, state: "blocked" }))).toBe(false);
  });
});
