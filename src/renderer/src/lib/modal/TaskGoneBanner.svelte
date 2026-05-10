<script lang="ts">
  import { WarningIcon } from "phosphor-svelte";

  interface Props {
    mode: "view" | "edit";
    dirty: boolean;
  }

  const { mode, dirty }: Props = $props();
</script>

<!-- Shown when the live row backing this modal has vanished (CLI/MCP/sqlite
     cli delete landing mid-session). The modal stays mounted so the user
     doesn't lose typed-but-unsaved edits to a sneaky delete — see project
     task ATF74D for the original failure case. -->
<div class="alert alert-warning mb-4">
  <WarningIcon size={18} weight="fill" />
  <div>
    <div class="font-semibold">Deleted by another writer</div>
    <div class="text-sm opacity-80">
      {#if mode === "edit" && dirty}
        Your unsaved edits are still here — copy them out before closing.
      {:else}
        This task no longer exists. Close when ready.
      {/if}
    </div>
  </div>
</div>
