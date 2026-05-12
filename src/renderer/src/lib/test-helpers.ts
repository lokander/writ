// Shared helpers for renderer component tests. Two responsibilities:
//
// 1. Install a stub `window.api` so components that reach for IPC under
//    test don't blow up (writState.loadAll calls window.api.* at construct
//    time-ish, and individual methods feed mutating actions).
// 2. Reset `writState` to a known fixture between tests — the module-level
//    singleton would otherwise leak data across cases.
//
// The helpers are deliberately small: each test still owns the fixture
// shapes it needs. We just take care of "the singleton can be observed"
// and "the IPC surface exists."

import { vi, type Mock } from "vitest";

import type { Column, ProjectInfo, Tag, Task, UpdateTaskResult } from "../../../shared/types";
import { filters } from "./filters.svelte";
import { search } from "./search.svelte";
import { writState } from "./state.svelte";

export interface ApiStub {
  project: {
    current: Mock<() => Promise<ProjectInfo | null>>;
    setDisplayName: Mock<(name: string | null) => Promise<ProjectInfo>>;
    openFolder: Mock<() => Promise<{ canceled: true }>>;
    initRoot: Mock<() => Promise<string>>;
    init: Mock<() => Promise<{ canceled: true }>>;
  };
  columns: { list: Mock<() => Promise<Column[]>> };
  tasks: {
    list: Mock<() => Promise<Task[]>>;
    create: Mock<(input: unknown) => Promise<Task>>;
    update: Mock<(id: string, update: unknown) => Promise<UpdateTaskResult>>;
    delete: Mock<(id: string) => Promise<boolean>>;
  };
  tags: { list: Mock<() => Promise<Tag[]>> };
  events: {
    onProjectChanged: Mock<(handler: () => void) => () => void>;
  };
}

/** Replace `window.api` with a mock. Returns the mock so tests can
 *  configure return values (`api.tasks.update.mockResolvedValueOnce(...)`)
 *  and assert calls. */
export function installApiStub(): ApiStub {
  const stub: ApiStub = {
    project: {
      current: vi.fn().mockResolvedValue(null),
      setDisplayName: vi.fn(),
      openFolder: vi.fn().mockResolvedValue({ canceled: true } as const),
      initRoot: vi.fn().mockResolvedValue("~"),
      init: vi.fn().mockResolvedValue({ canceled: true } as const),
    },
    columns: { list: vi.fn().mockResolvedValue([]) },
    tasks: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
    },
    tags: { list: vi.fn().mockResolvedValue([]) },
    events: {
      onProjectChanged: vi.fn().mockReturnValue(() => {}),
    },
  };
  // The renderer declares `window.api` via a `.d.ts` global; the runtime
  // shape is a plain object so assigning a structural match is enough.
  (window as unknown as { api: ApiStub }).api = stub;
  return stub;
}

export interface WritStateSeed {
  project?: ProjectInfo | null;
  columns?: Column[];
  tasks?: Task[];
  tags?: Tag[];
}

/** Reset the writState singleton to a fixture. Sets `loading=false` and
 *  `error=null` so renders are stable; pass `loading=true` explicitly by
 *  mutating after if a specific test needs the spinner branch. */
export function seedWritState(seed: WritStateSeed = {}): void {
  writState.project = seed.project ?? null;
  writState.columns = seed.columns ?? [];
  writState.tasks = seed.tasks ?? [];
  writState.tags = seed.tags ?? [];
  writState.loading = false;
  writState.error = null;
}

/** Reset the filters singleton to its empty state. Needed in test files
 *  that mount FilterBar (or anything that reads from the singleton),
 *  because the module-level instance otherwise carries state across tests
 *  within the same file. localStorage gets cleared too so a test setting
 *  filters.query doesn't bleed into a sibling test via the hydration path
 *  on a future construction (different test file). */
export function resetFilters(): void {
  filters.clear();
  try {
    localStorage.removeItem("writ:filter");
  } catch {
    // ignore — happy-dom always provides localStorage but defend anyway.
  }
}

/** Reset the search singleton back to the default sort. Mirrors
 *  `resetFilters()`: clears localStorage too so a sortMode set in one
 *  test doesn't bleed into the next file's hydration. */
export function resetSearch(): void {
  search.sortMode = "position";
  try {
    localStorage.removeItem("writ:sort");
  } catch {
    // ignore
  }
}
