<script lang="ts">
  import type { Column } from "../../../../shared/types";
  import { writState } from "../state.svelte";
  import { dropTarget } from "./dnd";

  interface Props {
    /** Column drops will be moved into. */
    target: Column;
    /** Reveal + accept drops only when the drag's source card is currently
     *  in a column with this name (case-insensitive). The zone stays
     *  invisible — but still occupies layout — for any other drag, so
     *  revealing it doesn't shift sibling columns. */
    fromColumnName: string;
    /** Centered label shown when revealed. */
    label: string;
    /** Currently-being-dragged task id from the parent KanbanView. Used to
     *  derive whether this zone should reveal. Pass `null` when no drag is
     *  in flight. */
    draggingTaskId: string | null;
  }

  const { target, fromColumnName, label, draggingTaskId }: Props = $props();

  let hovered = $state(false);

  // Reveal only when there's an active drag AND its source matches.
  const active = $derived.by(() => {
    if (!draggingTaskId) return false;
    const t = writState.tasks.find((tk) => tk.id === draggingTaskId);
    if (!t) return false;
    const col = writState.columns.find((c) => c.id === t.columnId);
    return col?.name.toLowerCase() === fromColumnName.toLowerCase();
  });
</script>

<div
  class="flex min-h-0 min-w-16 flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-opacity {active
    ? 'opacity-100'
    : 'opacity-0'} {hovered ? 'border-primary bg-primary/10' : 'border-base-300'}"
  use:dropTarget={{
    data: { type: "column", columnId: target.id },
    canDrop: ({ source }) => {
      // Only allow drops from the matching source column. Other sources
      // would never see the zone (it's transparent), but defense in depth.
      const srcId = source.data.taskId as string | undefined;
      if (!srcId) return false;
      const src = writState.tasks.find((t) => t.id === srcId);
      if (!src) return false;
      const srcCol = writState.columns.find((c) => c.id === src.columnId);
      return srcCol?.name.toLowerCase() === fromColumnName.toLowerCase();
    },
    onDragEnter: () => (hovered = true),
    onDragLeave: () => (hovered = false),
    onDrop: () => (hovered = false),
  }}
>
  <span class="text-sm opacity-70">{label}</span>
</div>
