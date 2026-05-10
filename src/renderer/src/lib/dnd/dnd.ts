// Tiny Svelte action wrappers around @atlaskit/pragmatic-drag-and-drop's
// element adapter. Pragmatic's API is imperative (call → cleanup function);
// these turn it into idiomatic `use:draggable={…}` / `use:dropTarget={…}`.
//
// Why bother: every consumer would otherwise repeat a small mount/cleanup
// dance. Centralizing here also gives us one obvious place to add new
// behaviors (closest-edge drop hints, etc.) when later phases need them.
//
// We intentionally read opts through a `current` closure rather than
// capturing it once. Svelte action params can change between mount and
// destroy — without this dance, `data` would freeze at its initial value
// even after the bound element gets new props.

import {
  draggable as pddDraggable,
  dropTargetForElements as pddDropTarget,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";

type DragData = Record<string, unknown>;

export interface DraggableOptions {
  data: DragData;
  onDragStart?: () => void;
  onDrop?: () => void;
}

export function draggable(
  node: HTMLElement,
  opts: DraggableOptions,
): { update: (next: DraggableOptions) => void; destroy: () => void } {
  let current = opts;
  const cleanup = pddDraggable({
    element: node,
    getInitialData: () => current.data,
    onDragStart: () => current.onDragStart?.(),
    onDrop: () => current.onDrop?.(),
  });
  return {
    update(next) {
      current = next;
    },
    destroy: cleanup,
  };
}

export interface DropTargetOptions {
  data: DragData;
  /** Return false to refuse this source. Used to hide drop feedback when the
   *  drop would be a no-op (e.g. dropping a card on its current column). */
  canDrop?: (args: { source: { data: DragData } }) => boolean;
  onDragEnter?: () => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
}

export function dropTarget(
  node: HTMLElement,
  opts: DropTargetOptions,
): { update: (next: DropTargetOptions) => void; destroy: () => void } {
  let current = opts;
  const cleanup = pddDropTarget({
    element: node,
    getData: () => current.data,
    canDrop: ({ source }) => (current.canDrop ? current.canDrop({ source }) : true),
    onDragEnter: () => current.onDragEnter?.(),
    onDragLeave: () => current.onDragLeave?.(),
    onDrop: () => current.onDrop?.(),
  });
  return {
    update(next) {
      current = next;
    },
    destroy: cleanup,
  };
}

export { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
