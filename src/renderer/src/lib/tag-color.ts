import type { Tag } from "../../../shared/types";

// DaisyUI palette tokens used as `badge-{token}` classes for hash-derived
// auto-coloring when a tag has no explicit color stored.
const PALETTE = [
  "primary",
  "secondary",
  "accent",
  "info",
  "success",
  "warning",
  "error",
  "neutral",
] as const;

function hashSlot(name: string): number {
  // Tiny djb2-ish hash. Stable across renders / sessions.
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % PALETTE.length;
}

export interface TagStyle {
  /** Tailwind/DaisyUI class to apply. Empty string when an inline color overrides. */
  className: string;
  /** Inline background-color when an explicit color is set. */
  inlineBg: string | null;
}

export function tagStyle(name: string, storedColor: string | null): TagStyle {
  if (storedColor) {
    return { className: "text-base-100", inlineBg: storedColor };
  }
  return { className: `badge-${PALETTE[hashSlot(name)]}`, inlineBg: null };
}

export function indexTags(tags: Tag[]): Record<string, string | null> {
  const m: Record<string, string | null> = {};
  for (const t of tags) m[t.name] = t.color;
  return m;
}
