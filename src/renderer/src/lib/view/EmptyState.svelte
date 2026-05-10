<script lang="ts">
  import { FolderOpenIcon } from "phosphor-svelte";
  import { writState } from "../state.svelte";

  interface Props {
    /** Triggered when the user clicks "Open project…". Lifted because the
     *  native folder-picker flow lives in App (it has to call window.api
     *  and then drive writState.loadAll). */
    onOpenProject: () => void;
  }

  const { onOpenProject }: Props = $props();
</script>

<!-- Two-state surface for the area between AppBar and the kanban/list:
     - Mid-load → minimal "Loading…" placeholder
     - No project loaded → folder-picker CTA + writ init hint. If a folder
       open failed (writState.error is sticky here), surface the reason
       inline so the user knows why the app is project-less. -->
{#if writState.loading}
  <div class="flex flex-1 items-center justify-center text-base-content/60">Loading…</div>
{:else if !writState.project}
  <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
    {#if writState.error}
      <div class="alert alert-error max-w-2xl">{writState.error}</div>
    {:else}
      <p>No writ project found.</p>
    {/if}
    <button type="button" class="btn btn-primary btn-sm" onclick={onOpenProject}>
      <FolderOpenIcon size={14} weight="bold" />
      Open project…
    </button>
    <p class="text-sm opacity-60">
      Or run <code class="kbd">writ init</code> in a project directory.
    </p>
  </div>
{/if}
