import { writState } from "./state.svelte";
import { indexTags } from "./tag-color";

/** Derived projections of `writState` that multiple components consume.
 *  Keeping them on a module-level singleton instead of re-deriving in each
 *  caller (or threading them through props) avoids two anti-patterns:
 *
 *   1. Each component recomputing the same Object.fromEntries / map-build —
 *      cheap individually, but the same work N times per write tick.
 *   2. App.svelte deriving + drilling them through KanbanView / ListView /
 *      TaskEditModal / their child panels — the deepest path was 4 layers
 *      for `colorByTag` (App → Modal → SubtasksPanel → TagChip).
 *
 *  Anything that needs filter-, sort-, or search-aware derivations lives
 *  elsewhere (see `filters.svelte.ts` / `search.svelte.ts`); this module is
 *  only the writState-pure projections.
 */
class WritDerived {
  /** Tag name → color (hex or CSS named color, lowercase). Null means
   *  "no color set; renderer hashes the name to a DaisyUI palette slot." */
  colorByTag = $derived(indexTags(writState.tags));

  /** Column id → name. Used for the [Col] mismatch badge in ListView and
   *  for the column label in the view-mode modal header. */
  columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  /** Parent task id → number of direct children. Drives the subtask-count
   *  badge on kanban cards and list rows. Order-independent, so this
   *  iterates `writState.tasks` directly rather than the sort-mode-aware
   *  list owned by `search.svelte.ts`. */
  childCount = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const t of writState.tasks) {
      if (t.parentId === null) continue;
      counts[t.parentId] = (counts[t.parentId] ?? 0) + 1;
    }
    return counts;
  });
}

export const writDerived = new WritDerived();
