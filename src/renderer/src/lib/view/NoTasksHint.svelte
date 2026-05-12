<script lang="ts">
  import { ListChecksIcon } from "phosphor-svelte";

  interface Props {
    /** Triggered when the user clicks "Add your first task". Wired to the
     *  same AddTaskModal the AppBar's "New task" button opens — kept lifted
     *  so App owns the modal state. */
    onNewTask: () => void;
  }

  const { onNewTask }: Props = $props();
</script>

<!-- Empty-project surface: paints between FilterBar and where the kanban /
     list would normally render, when the open project has zero tasks. The
     per-column "No tasks." state inside KanbanView / ListView still covers
     the partial case (some columns empty, others not). -->
<div class="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
  <ListChecksIcon size={64} weight="duotone" class="opacity-40" />
  <h2 class="text-lg font-semibold">No tasks yet</h2>
  <button type="button" class="btn btn-primary btn-sm" onclick={onNewTask}>
    Add your first task
  </button>
  <div class="flex flex-col gap-2 text-sm opacity-60">
    <p>CLI: <code class="kbd">writ task add "..."</code></p>
    <p>MCP: <code class="kbd">writ mcp install</code>, then ask your agent to add tasks.</p>
    <p class="mt-2">Migrating a TODO file?</p>
    <p>
      Run <code class="kbd">writ import-prompt --file &lt;todo_file&gt;</code> and pipe to your agent.
    </p>
  </div>
</div>
