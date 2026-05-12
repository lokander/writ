import type { Priority } from "../../../shared/types";
import {
  STATE_FILTERS,
  filtersActive as computeFiltersActive,
  emptyFilter,
  type FilterState,
  type StateFilter,
} from "./filter";

const STORAGE_KEY = "writ:filter";

/** Renderer-wide filter state for the kanban / list views. Owns:
 *
 *   - the four reactive fields (tags, priorities, state, query),
 *   - the derived FilterState consumers feed into matchesFilters,
 *   - a `clear()` reset used on view-toggle and project-switch,
 *   - localStorage hydration at construction time and write-through on
 *     every change.
 *
 *  Single key for the whole user — only one project is open at a time and
 *  tag names rarely collide across projects, so cross-project bleed is
 *  acceptable. App.svelte still owns the project-switch `clear()` call so
 *  that bleed is opt-in.
 */
class Filters {
  tags = $state<string[]>([]);
  priorities = $state<Priority[]>([]);
  state = $state<StateFilter>("any");
  query = $state<string>("");

  /** Single object the matcher / persistence layer consume. Keeping the
   *  fields split lets `bind:` work on individual sub-components without
   *  thrashing the whole object on every keystroke. */
  asState = $derived<FilterState>({
    tags: this.tags,
    priorities: this.priorities,
    state: this.state,
    query: this.query,
  });

  active = $derived(computeFiltersActive(this.asState));

  constructor() {
    this.#hydrate();
    // Module-level singleton: this root never gets disposed, which is fine
    // because the renderer process exits when the window closes. Wrapping
    // in $effect.root is needed because $effect can only be created inside
    // a component or a root scope, and the class constructor runs at
    // import time (no surrounding component).
    $effect.root(() => {
      $effect(() => {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              tags: this.tags,
              priorities: this.priorities,
              state: this.state,
              query: this.query,
            }),
          );
        } catch {
          // private mode / full quota — UI keeps working, filters just
          // won't survive a reload.
        }
      });
    });
  }

  clear(): void {
    const empty = emptyFilter();
    this.tags = empty.tags;
    this.priorities = empty.priorities;
    this.state = empty.state;
    this.query = empty.query;
  }

  /** Read the persisted filter snapshot. Validates field-by-field so a
   *  partially-corrupted payload (or one written by an older schema)
   *  surfaces whatever is still parseable, instead of resetting the lot. */
  #hydrate(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const parsed = JSON.parse(raw) as {
        tags?: unknown;
        priorities?: unknown;
        state?: unknown;
        query?: unknown;
      };
      if (Array.isArray(parsed.tags) && parsed.tags.every((v) => typeof v === "string")) {
        this.tags = parsed.tags;
      }
      if (
        Array.isArray(parsed.priorities) &&
        parsed.priorities.every((v) => v === 0 || v === 1 || v === 2 || v === 3)
      ) {
        this.priorities = parsed.priorities as Priority[];
      }
      if (typeof parsed.state === "string" && (STATE_FILTERS as string[]).includes(parsed.state)) {
        this.state = parsed.state as StateFilter;
      }
      if (typeof parsed.query === "string") {
        this.query = parsed.query;
      }
    } catch {
      // ignore — corrupted / missing
    }
  }
}

export const filters = new Filters();
