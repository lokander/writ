// Fuzzy search over the renderer's in-memory task set. Fuse takes the
// whole collection and returns ranked matches, so unlike matchesFilters
// (a per-task predicate) this can't be slotted into a .filter() chain —
// callers swap the source list for the Fuse-ranked one when a query is
// active. Title is weighted higher than description because a hit in
// the title is almost always the more relevant match.

import Fuse, { type FuseResultMatch, type IFuseOptions, type RangeTuple } from "fuse.js";

import type { Task } from "../../../shared/types";

export interface SearchResult {
  task: Task;
  /** Per-field match indices (from Fuse). Each entry's `key` is the field
   *  name ("title" / "description") and `indices` is the matched
   *  character ranges. Empty when the field didn't contribute. */
  matches: ReadonlyArray<FuseResultMatch>;
}

export interface Snippet {
  /** Excerpt around the first match, with leading/trailing ellipsis when
   *  the snippet doesn't cover the full source. */
  text: string;
  /** Match indices relative to `text` (not the original source). Already
   *  shifted by the ellipsis offset and clipped to the snippet window so
   *  consumers can pass them straight to <Highlighted />. */
  indices: ReadonlyArray<RangeTuple>;
}

const FUSE_OPTIONS: IFuseOptions<Task> = {
  keys: [
    { name: "title", weight: 2 },
    { name: "description", weight: 1 },
  ],
  threshold: 0.2,
  minMatchCharLength: 2,
  ignoreLocation: true,
  useTokenSearch: true,
  includeMatches: true,
  findAllMatches: true,
};

/** Returns search results in Fuse rank order (best first), each carrying
 *  the matched task and the per-field index ranges for highlighting.
 *  Returns null when the query is empty/whitespace so callers can fall
 *  back to the unranked source list without an extra branch on length.
 *  Index is built per call — fine for typical project size; memoize if
 *  it shows up in a profile. */
export function fuzzySearch(tasks: Task[], query: string): SearchResult[] | null {
  const q = query.trim();
  if (!q) return null;
  const fuse = new Fuse(tasks, FUSE_OPTIONS);
  return fuse.search(q).map((r) => ({ task: r.item, matches: r.matches ?? [] }));
}

/** Builds a short context window around the first matched range in `value`,
 *  shifting indices so they're relative to the snippet text. Used for the
 *  inline "matched in description" excerpt on task cards — the full
 *  description would be too long to render inline. `radius` is the number
 *  of characters before the first match; the tail extends 2× that so the
 *  user sees more context after the match than before. */
export function makeSnippet(
  value: string,
  indices: ReadonlyArray<RangeTuple>,
  radius = 40,
): Snippet | null {
  if (!value || indices.length === 0) return null;
  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  const first = sorted[0][0];
  const start = Math.max(0, first - radius);
  const end = Math.min(value.length, first + radius * 2);
  const head = start > 0 ? "…" : "";
  const tail = end < value.length ? "…" : "";
  const slice = value.slice(start, end);
  const offset = head.length - start;
  const sliceMin = head.length;
  const sliceMax = head.length + slice.length - 1;
  const shifted: RangeTuple[] = [];
  for (const [s, e] of sorted) {
    const ns = s + offset;
    const ne = e + offset;
    if (ne < sliceMin || ns > sliceMax) continue;
    shifted.push([Math.max(ns, sliceMin), Math.min(ne, sliceMax)] as RangeTuple);
  }
  return { text: head + slice + tail, indices: shifted };
}
