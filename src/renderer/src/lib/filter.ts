// Renderer filter composition. Extracted from App.svelte so it's testable
// without mounting a component — the function is pure, takes a task plus
// the current filter state, returns a yes/no match.
//
// Keeps parity with the CLI: tag chips combine via `tagMode` ("all" = AND,
// "any" = OR — same as `--any-tag`), priorities OR across the chip set,
// and `state` narrows to ready / blocked / any. An empty filter set never
// excludes; the caller short-circuits via `filtersActive` so we don't even
// have to walk the task list when nothing is selected.

import type { Priority, Task } from "../../../shared/types";

export type StateFilter = "any" | "ready" | "blocked";
export const STATE_FILTERS: StateFilter[] = ["any", "ready", "blocked"];

export interface FilterState {
  /** Selected tag names. */
  tags: string[];
  /** "all" → task must have every selected tag (AND); "any" → at least one
   *  (OR, parity with the CLI's --any-tag). */
  tagMode: "all" | "any";
  /** Selected priorities. OR semantics across the array. */
  priorities: Priority[];
  /** State narrowing — ready, blocked, or no narrowing ("any"). */
  state: StateFilter;
}

export function emptyFilter(): FilterState {
  return { tags: [], tagMode: "all", priorities: [], state: "any" };
}

export function filtersActive(f: FilterState): boolean {
  return f.tags.length > 0 || f.priorities.length > 0 || f.state !== "any";
}

export function matchesFilters(task: Task, f: FilterState): boolean {
  if (f.tags.length > 0) {
    if (f.tagMode === "any") {
      if (!f.tags.some((want) => task.tags.includes(want))) return false;
    } else {
      for (const want of f.tags) {
        if (!task.tags.includes(want)) return false;
      }
    }
  }
  if (f.priorities.length > 0 && !f.priorities.includes(task.priority)) {
    return false;
  }
  if (f.state === "ready" && !task.isReady) return false;
  if (f.state === "blocked" && task.blockedBy.length === 0) return false;
  return true;
}
