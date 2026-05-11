// Test fixtures for renderer unit tests. Avoids inlining "the full Task
// shape" in every spec — just call `makeTask({ overrides })` and override
// only the fields the case cares about.

import type { Priority, Task } from "../../../shared/types";

let nextSuffix = 0;

/** Build a `Task` with sensible defaults. Override any field via the
 *  partial. The id is auto-incremented so adjacent tasks in the same test
 *  don't collide; pass `id` explicitly for stable assertions. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  // Mint a fake 26-char ulid-shaped string. Real ulids matter for sort
  // tie-breaking in the domain layer, but the renderer only reads `id` as
  // an opaque key, so a stable, monotonically increasing suffix is enough.
  const suffix = (nextSuffix++).toString(36).padStart(6, "0").toUpperCase();
  const id = overrides.id ?? `01KR000000000000000000${suffix}`;
  return {
    id,
    parentId: null,
    columnId: "col-todo",
    title: `Task ${suffix}`,
    description: "",
    priority: 2 as Priority,
    position: 1000,
    version: 0,
    tags: [],
    dependsOn: [],
    blockedBy: [],
    isReady: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
