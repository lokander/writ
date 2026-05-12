import type { RangeTuple } from "fuse.js";

import { SORT_MODES, sortTasks, type SortMode, type Task } from "../../../shared/types";
import { filters } from "./filters.svelte";
import { matchesFilters } from "./filter";
import { fuzzySearch, makeSnippet, type Snippet } from "./search";
import { writState } from "./state.svelte";

const STORAGE_KEY = "writ:sort";

/** The sort + search + filter pipeline that produces the task collections
 *  the kanban / list views render. Owning it as a singleton instead of
 *  re-deriving in App.svelte does two things:
 *
 *   - keeps `sortMode` next to the derivations that depend on it (drag
 *     enable, sorted list, hierarchical children grouping), rather than
 *     stranding the persistence + hydration in App,
 *   - eliminates the deepest prop drill in the renderer — `visibleTasks`,
 *     `titleMatchesById`, and `descSnippetById` previously rode through
 *     KanbanView/ListView into card-rendering templates and the
 *     `<Highlighted />` component.
 *
 *  Pure derived state: views and the AppBar read from it directly; only
 *  `sortMode` is writable (AppBar's dropdown / clear-X assigns it).
 */
class Search {
  sortMode = $state<SortMode>("position");

  /** Drag-and-drop on cards writes to `position` and the row order matches
   *  it, so any non-position sort would make a drop visually invisible —
   *  the moved card jumps back to whatever priority/updated/created ranks
   *  it for. Kanban reads this to disable Pragmatic on cards entirely. */
  dragEnabled = $derived(this.sortMode === "position");

  /** Full task set, sorted by the active mode. The flat (kanban) and
   *  hierarchical (list) paths both read this so siblings under a parent
   *  appear in the same order as top-level rows. */
  sortedTasks = $derived(sortTasks(writState.tasks, this.sortMode));

  /** Fuse rank order for the current query — null when the query is empty
   *  so consumers can skip the per-task work. Title is weighted 2× over
   *  description; ties break by original order. */
  results = $derived(fuzzySearch(this.sortedTasks, filters.query));

  /** Post-filter, post-sort task set. Two cases when a query is active:
   *
   *    - sort = "position" (the default — drag-and-drop order, which the
   *      user hasn't expressed a preference over): use Fuse rank so each
   *      column / list surfaces best matches first. Best-match-first is
   *      the right default when the user is searching with no other
   *      ordering hint.
   *    - any other sort: the user has explicitly picked priority /
   *      updated / created order. That intent wins; Fuse is reduced to a
   *      membership filter (which tasks match) and `sortedTasks` provides
   *      the order.
   *
   *  Tag / priority / state filters compose on top — they're a per-task
   *  predicate, Fuse isn't, so the search runs at the collection level
   *  here rather than via matchesFilters. */
  visibleTasks = $derived.by(() => {
    let base: Task[];
    if (this.results) {
      if (this.sortMode === "position") {
        base = this.results.map((r) => r.task);
      } else {
        const hits = new Set(this.results.map((r) => r.task.id));
        base = this.sortedTasks.filter((t) => hits.has(t.id));
      }
    } else {
      base = this.sortedTasks;
    }
    return filters.active ? base.filter((t) => matchesFilters(t, filters.asState)) : base;
  });

  /** Title-field match indices per task, for inline <Highlighted /> in the
   *  task cards. null when no query is active so consumers can skip the
   *  segment-splitting work entirely. Description matches also drive
   *  ranking but aren't rendered in cards. */
  titleMatchesById = $derived.by<Record<string, ReadonlyArray<RangeTuple>> | null>(() => {
    if (!this.results) return null;
    const m: Record<string, ReadonlyArray<RangeTuple>> = {};
    for (const r of this.results) {
      for (const match of r.matches) {
        if (match.key === "title") {
          m[r.task.id] = match.indices;
          break;
        }
      }
    }
    return m;
  });

  /** Description-field snippet per task. Built around the first description
   *  match so cards can answer "why did this hit?" inline — title-only
   *  matches don't get a snippet (the title highlight already explains
   *  it). */
  descSnippetById = $derived.by<Record<string, Snippet> | null>(() => {
    if (!this.results) return null;
    const m: Record<string, Snippet> = {};
    for (const r of this.results) {
      for (const match of r.matches) {
        if (match.key === "description" && match.value) {
          const s = makeSnippet(match.value, match.indices);
          if (s) m[r.task.id] = s;
          break;
        }
      }
    }
    return m;
  });

  /** Parent id → ordered children. Iterates `sortedTasks` rather than the
   *  raw writState set so siblings under a parent inherit the active
   *  sort. Only used by ListView's hierarchical render (no-filter mode). */
  childrenByParent = $derived.by(() => {
    const map: Record<string, Task[]> = {};
    for (const t of this.sortedTasks) {
      if (t.parentId === null) continue;
      (map[t.parentId] ??= []).push(t);
    }
    return map;
  });

  constructor() {
    this.#hydrate();
    // Module-level singleton: the root never gets disposed, which is fine
    // because the renderer process exits when the window closes.
    $effect.root(() => {
      $effect(() => {
        try {
          localStorage.setItem(STORAGE_KEY, this.sortMode);
        } catch {
          // private mode / full quota — UI keeps working, the chosen sort
          // just won't survive a reload.
        }
      });
    });
  }

  #hydrate(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      if ((SORT_MODES as readonly string[]).includes(raw)) {
        this.sortMode = raw as SortMode;
      }
    } catch {
      // ignore — corrupted / missing
    }
  }
}

export const search = new Search();
