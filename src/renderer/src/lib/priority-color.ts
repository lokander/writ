// Priority → Tailwind color class maps. Centralized so the kanban card,
// list row, and context-menu dot all stay in lockstep when the palette
// changes. Class strings are literal so Tailwind's JIT picks them up
// during the source scan; don't construct them dynamically.

import type { Priority } from "../../../shared/types";

/** Border-left utility for kanban cards / list rows. */
export const PRIORITY_BORDER_CLASS: Record<Priority, string> = {
  0: "border-l-warning", // urgent — orange
  1: "border-l-info", // high — blue
  2: "border-l-success", // normal — green
  3: "border-l-base-content/20", // low — muted gray
};

/** Background utility for the small dot rendered next to each priority
 *  label in the context menu's Priority submenu. Mirrors the border
 *  colors so the legend matches what the user sees on cards. */
export const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  0: "bg-warning",
  1: "bg-info",
  2: "bg-success",
  3: "bg-base-content/30",
};
