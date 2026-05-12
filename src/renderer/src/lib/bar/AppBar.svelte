<script lang="ts" module>
  export type View = "kanban" | "list";
  export const VIEWS: View[] = ["list", "kanban"];
</script>

<script lang="ts">
  import {
    FolderOpenIcon,
    KanbanIcon,
    ListIcon,
    PlusIcon,
    SortAscendingIcon,
    XIcon,
    HeadCircuitIcon,
  } from "phosphor-svelte";

  import type { SortMode } from "../../../../shared/types";
  import { writState } from "../state.svelte";

  interface Props {
    view: View;
    onViewChange: (v: View) => void;
    sortMode: SortMode;
    onSortChange: (m: SortMode) => void;
    onOpenProject: () => void;
    onNewTask: () => void;
  }

  let { view, onViewChange, sortMode, onSortChange, onOpenProject, onNewTask }: Props = $props();

  // `position` is the implicit default — drag-and-drop writes to it and it
  // matches the underlying row order. We hide it from the menu and call it
  // "default" in the label so the user doesn't have to know about the
  // position-vs-other-modes split, just "sorted" vs "not sorted".
  const ACTIVE_SORT_MODES = ["priority", "updated", "created"] as const;

  // Title-case for the dropdown label. Lowercased single-word modes mean a
  // one-char .toUpperCase() is enough — no locale gymnastics needed.
  function labelFor(m: SortMode): string {
    if (m === "position") return "default";
    return m[0]!.toUpperCase() + m.slice(1);
  }

  // Rename state is purely local to the project-name affordance — no other
  // chrome cares whether the user is mid-edit, so it lives here rather than
  // bubbling up through props.
  let renamingProject = $state(false);
  let renameValue = $state("");

  // Last segment of a path, regardless of separator. The renderer doesn't
  // import node:path; this is fine for both POSIX and Windows roots.
  function basenameOf(path: string): string {
    const segments = path.split(/[/\\]/).filter((s) => s.length > 0);
    return segments[segments.length - 1] ?? path;
  }

  function startRename(): void {
    renameValue = writState.project?.displayName ?? "";
    renamingProject = true;
  }

  async function commitRename(): Promise<void> {
    if (!renamingProject) return;
    const trimmed = renameValue.trim();
    renamingProject = false;
    await writState.setDisplayName(trimmed.length === 0 ? null : trimmed);
  }

  function cancelRename(): void {
    renamingProject = false;
  }
</script>

<header class="grid grid-cols-3 items-center gap-3 border-b border-base-300 bg-base-200 px-4 py-2">
  <div class="flex min-w-0 items-center gap-3">
    <span class="flex shrink-0 items-center">
      <HeadCircuitIcon size={24} weight="duotone" class="opacity-80" />
      <h1 class="ml-1 font-mono text-lg font-semibold opacity-60">writ</h1>
    </span>
    {#if writState.project}
      {@const usingFallback = writState.project.displayName === null}
      {@const displayed = writState.project.displayName ?? basenameOf(writState.project.root)}
      <span class="shrink-0 font-mono text-lg opacity-30" aria-hidden="true">::</span>
      {#if renamingProject}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          class="min-w-0 flex-1 truncate rounded border border-base-content/30 bg-transparent px-2 py-0.5 font-mono text-sm outline-none focus:border-primary"
          placeholder={basenameOf(writState.project.root)}
          bind:value={renameValue}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
          onblur={commitRename}
          autofocus
        />
      {:else}
        <button
          type="button"
          class="shrink-0 cursor-pointer truncate font-mono text-lg hover:opacity-100"
          class:opacity-50={usingFallback}
          class:opacity-80={!usingFallback}
          title="Edit project name"
          onclick={startRename}
        >
          {displayed}
        </button>
        <span
          class="min-w-0 flex-1 truncate font-mono text-xs opacity-40"
          title={writState.project.root}
        >
          {writState.project.prettyRoot}
        </span>
      {/if}
    {/if}
  </div>
  <div class="flex justify-center">
    {#if writState.project && !writState.loading}
      <div class="join">
        {#each VIEWS as v (v)}
          <button
            type="button"
            class="btn btn-primary btn-xs join-item w-24"
            class:btn-soft={view !== v}
            onclick={() => onViewChange(v)}
          >
            {#if v === "list"}
              <ListIcon size={14} weight="bold" />
            {:else}
              <KanbanIcon size={14} weight="bold" />
            {/if}
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="flex justify-end gap-1">
    {#if writState.project && !writState.loading}
      <!-- Sort picker. `position` is treated as "no sort" / default —
           drag-and-drop writes to position and the row order matches it,
           so the user doesn't need to think of it as a sort. The dropdown
           menu lists only the three active modes; when one is selected
           the trigger shows "Sorting: <mode>" and a sibling X button
           appears that returns to default. -->
      <!-- Single visual pill. The wrapper carries the surface (background,
           rounding, text color); the inner dropdown trigger and the
           clear-X are bare-styled buttons so they read as inline parts
           of one control rather than two adjacent buttons. The pill
           takes on a primary tint only when a non-default sort is active. -->
      <div
        class={[
          "flex h-6 items-center rounded-field text-xs",
          sortMode === "position" ? "bg-base-300" : "bg-primary/15 text-primary",
        ]}
      >
        <div class="dropdown dropdown-end">
          <button
            type="button"
            tabindex="0"
            class={[
              "flex h-6 items-center gap-1 rounded-l-field px-2 hover:bg-base-content/10",
              sortMode === "position" && "rounded-r-field",
            ]}
            title="Sort cards by…"
            aria-label="Sort mode"
          >
            <SortAscendingIcon size={14} weight="bold" />
            <span class="hidden sm:inline">Sorting: {labelFor(sortMode)}</span>
          </button>
          <ul
            tabindex="-1"
            class="menu dropdown-content z-10 mt-1 w-40 rounded-box bg-base-200 p-1 text-sm text-base-content shadow"
          >
            {#each ACTIVE_SORT_MODES as m (m)}
              <li>
                <button
                  type="button"
                  class:menu-active={sortMode === m}
                  onclick={(e) => {
                    onSortChange(m);
                    // Daisy dropdowns stay open as long as any element
                    // inside has focus. Clicking a menu item keeps focus
                    // on it, so the dropdown lingers; blur to drop focus
                    // back to body and let the :focus-within close fire.
                    (e.currentTarget as HTMLElement).blur();
                  }}
                >
                  {labelFor(m)}
                </button>
              </li>
            {/each}
          </ul>
        </div>
        {#if sortMode !== "position"}
          <button
            type="button"
            class="flex h-6 items-center rounded-r-field px-1.5 hover:bg-base-content/10"
            title="Clear sort (return to default)"
            aria-label="Clear sort"
            onclick={() => onSortChange("position")}
          >
            <XIcon size={12} weight="bold" />
          </button>
        {/if}
      </div>
    {/if}
    {#if !writState.loading}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={onOpenProject}
        title="Open another writ project…"
        aria-label="Open project"
      >
        <FolderOpenIcon size={14} weight="bold" />
      </button>
    {/if}
    {#if writState.project && !writState.loading}
      <button type="button" class="btn btn-primary btn-xs" onclick={onNewTask}>
        <PlusIcon size={12} weight="bold" />
        New task
      </button>
    {/if}
  </div>
</header>
