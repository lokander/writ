<script lang="ts" module>
  export type View = "kanban" | "list";
  export const VIEWS: View[] = ["list", "kanban"];
</script>

<script lang="ts">
  import { FolderOpenIcon, KanbanIcon, ListIcon, NotepadIcon, PlusIcon } from "phosphor-svelte";

  import { writState } from "../state.svelte";

  interface Props {
    view: View;
    onViewChange: (v: View) => void;
    onOpenProject: () => void;
    onNewTask: () => void;
  }

  let { view, onViewChange, onOpenProject, onNewTask }: Props = $props();

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
      <NotepadIcon size={24} weight="duotone" />
      <h1 class="ml-1 font-mono text-lg font-semibold">writ</h1>
    </span>
    {#if writState.project}
      {@const usingFallback = writState.project.displayName === null}
      {@const displayed = writState.project.displayName ?? basenameOf(writState.project.root)}
      <span class="shrink-0 font-mono text-lg opacity-30" aria-hidden="true">::</span>
      {#if renamingProject}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          class="min-w-0 flex-1 truncate rounded border border-base-content/30 bg-transparent px-2 py-0.5 font-mono text-lg outline-none focus:border-primary"
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
          class:opacity-60={usingFallback}
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
