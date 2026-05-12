// Canonical "advance one step" workflow used by the right-click context
// menu's "Move to <next>" shortcut. Mirrors the case-insensitive
// Done/Archived detection in `domain/tasks.ts` — column matching is by
// name, not id, so the shortcut still works if a project's columns were
// rebuilt (id changes) or if naming nuances differ (e.g. "DONE" vs "done").

import type { Column } from "../../../shared/types";

/** Workflow order, lowercased for case-insensitive matching. Terminal
 *  step is "archived" — a card already there has nothing to advance to.
 *  Keeping this private so callers don't accidentally bypass the resolver
 *  and assume the project actually exposes every step (a customized
 *  project might be missing, e.g., "Done"). */
const WORKFLOW_ORDER = ["backlog", "todo", "doing", "done", "archived"] as const;

/** The next column in the canonical workflow given the card's current
 *  column. Returns `null` when:
 *    - the current column is the terminal (`Archived`) step,
 *    - the current column's name isn't one of the canonical steps (the
 *      project was customized; we don't guess where to advance to), or
 *    - no later canonical column exists in the project.
 *
 *  A project missing an intermediate canonical column skips it — e.g.
 *  with no "Done" column, a "Doing" card advances directly to "Archived".
 *  Lookup is case-insensitive (lowercased name match). */
export function nextWorkflowColumn(columns: Column[], currentColumnId: string): Column | null {
  const current = columns.find((c) => c.id === currentColumnId);
  if (!current) return null;
  const currentIdx = WORKFLOW_ORDER.indexOf(
    current.name.toLowerCase() as (typeof WORKFLOW_ORDER)[number],
  );
  if (currentIdx === -1) return null;
  for (let i = currentIdx + 1; i < WORKFLOW_ORDER.length; i++) {
    const want = WORKFLOW_ORDER[i];
    const found = columns.find((c) => c.name.toLowerCase() === want);
    if (found) return found;
  }
  return null;
}
