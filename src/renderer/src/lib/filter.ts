// Renderer filter composition. Extracted from App.svelte so it's testable
// without mounting a component — the function is pure, takes a task plus
// the current filter state, returns a yes/no match.
//
// Tag chips AND across the selection (task must have every selected tag).
// The OR mode the CLI exposes via `--any-tag` is intentionally not surfaced
// in the UI; if you need it, use the CLI. Priorities OR across the chip
// set, and `state` narrows to ready / blocked / any. An empty filter set
// never excludes; the caller short-circuits via `filtersActive` so we don't
// even have to walk the task list when nothing is selected.

import type { Priority, Task } from "../../../shared/types";

export type StateFilter = "any" | "ready" | "blocked";
export const STATE_FILTERS: StateFilter[] = ["any", "ready", "blocked"];

export interface FilterState {
  /** Selected tag names. ANDed: a task matches only if it carries every one. */
  tags: string[];
  /** Selected priorities. OR semantics across the array. */
  priorities: Priority[];
  /** State narrowing — ready, blocked, or no narrowing ("any"). */
  state: StateFilter;
  /** Free-text fuzzy query over title + description. Applied at the
   *  collection level via lib/search.ts — Fuse needs the full set to
   *  score matches, so matchesFilters intentionally ignores this field. */
  query: string;
}

export function emptyFilter(): FilterState {
  return { tags: [], priorities: [], state: "any", query: "" };
}

export function filtersActive(f: FilterState): boolean {
  return (
    f.tags.length > 0 || f.priorities.length > 0 || f.state !== "any" || f.query.trim().length > 0
  );
}

export function matchesFilters(task: Task, f: FilterState): boolean {
  for (const want of f.tags) {
    if (!task.tags.includes(want)) return false;
  }
  if (f.priorities.length > 0 && !f.priorities.includes(task.priority)) {
    return false;
  }
  if (f.state === "ready" && !task.isReady) return false;
  if (f.state === "blocked" && task.blockedBy.length === 0) return false;
  return true;
}
