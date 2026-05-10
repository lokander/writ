<script lang="ts">
  import { LockSimpleIcon, XIcon } from "phosphor-svelte";

  import { PRIORITY_NAMES, type Task } from "../../../../shared/types";
  import TagChip from "../chip/TagChip.svelte";
  import TaskIdChip from "../chip/TaskIdChip.svelte";
  import TaskRefRow from "../chip/TaskRefRow.svelte";
  import { renderMarkdown } from "../markdown/markdown";
  import { writState } from "../state.svelte";
  import { toast } from "../toast/toast.svelte";

  interface Props {
    task: Task;
    parentTask: Task | null;
    dependents: Task[];
    columnNameById: Record<string, string>;
    colorByTag: Record<string, string | null>;
    onSwitch: (id: string) => void;
    onClose: () => void;
  }

  const { task, parentTask, dependents, columnNameById, colorByTag, onSwitch, onClose }: Props =
    $props();

  // Delegated click handler for markdown-rendered task id links (see
  // `linkifyTaskIds` in `markdown.ts`). Walks up from the click target to
  // find the nearest `[data-task-id]`, resolves it against the live task
  // list, and pushes a new modal on top via onSwitch — no discard prompt
  // because the current modal isn't being torn down, just covered.
  //
  // - No-match: silent no-op (the task description acceptance criterion
  //   explicitly calls out "no error spam" for unresolvable backticked
  //   strings — a user typing a random uppercase 6-char token shouldn't
  //   trigger a toast every click).
  // - Ambiguous: a 6-char suffix can in theory collide across two tasks.
  //   Surface a warning so the user knows why the click did nothing.
  // - Clicking your own id is a no-op (pushing a duplicate of the topmost
  //   would just stack the same task on top of itself for no benefit).
  function onDescriptionClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLElement>("[data-task-id]");
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const ref = link.dataset.taskId;
    if (!ref) return;

    const matches = writState.tasks.filter((t) => t.id === ref || t.id.endsWith(ref));
    if (matches.length === 0) return;
    if (matches.length > 1) {
      toast.show(`Ambiguous task id '${ref}' — ${matches.length} matches`, {
        variant: "warning",
      });
      return;
    }
    const resolved = matches[0]!;
    if (resolved.id === task.id) return;
    onSwitch(resolved.id);
  }
</script>

<div class="mb-4 flex items-start justify-between gap-3">
  <h2 id="task-modal-title" class="select-text text-2xl font-semibold leading-tight">
    {task.title}
  </h2>
  <div class="flex shrink-0 items-baseline gap-2">
    <TaskIdChip id={task.id} />
    <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
      <XIcon size={16} weight="bold" />
    </button>
  </div>
</div>

<div class="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
  <span class="badge badge-outline">
    {columnNameById[task.columnId] ?? "?"}
  </span>
  <span><span class="opacity-60">Priority:</span> {PRIORITY_NAMES[task.priority]}</span>
  <span class="flex items-center gap-2">
    <span class="opacity-60">Parent:</span>
    {#if parentTask}
      <button type="button" class="link link-hover" onclick={() => onSwitch(parentTask.id)}>
        {parentTask.title}
      </button>
    {:else}
      <span class="opacity-50 italic">(none)</span>
    {/if}
  </span>
  {#if task.tags.length > 0}
    <span class="flex flex-wrap items-center gap-1">
      <span class="opacity-60">Tags:</span>
      {#each task.tags as tag (tag)}
        <TagChip name={tag} color={colorByTag[tag] ?? null} />
      {/each}
    </span>
  {/if}
</div>

{#if task.dependsOn.length > 0}
  <div class="mb-4">
    <div class="label label-text mb-1 flex items-center gap-2 opacity-60">
      <LockSimpleIcon
        size={14}
        weight="fill"
        class={task.isReady ? "opacity-40" : "text-warning"}
      />
      Blocked by ({task.blockedBy.length}/{task.dependsOn.length} open)
    </div>
    <div class="flex flex-col gap-1">
      {#each task.dependsOn as blockerId (blockerId)}
        {@const blocker = writState.tasks.find((t) => t.id === blockerId)}
        {#if blocker}
          <TaskRefRow
            task={blocker}
            columnName={columnNameById[blocker.columnId] ?? "?"}
            onClick={() => onSwitch(blocker.id)}
            muted={!task.blockedBy.includes(blockerId)}
          />
        {/if}
      {/each}
    </div>
  </div>
{/if}

{#if dependents.length > 0}
  <div class="mb-4">
    <div class="label label-text mb-1 opacity-60">
      Blocks ({dependents.length})
    </div>
    <div class="flex flex-col gap-1">
      {#each dependents as dep (dep.id)}
        <TaskRefRow
          task={dep}
          columnName={columnNameById[dep.columnId] ?? "?"}
          onClick={() => onSwitch(dep.id)}
        />
      {/each}
    </div>
  </div>
{/if}

<div class="mb-6">
  <div class="label label-text mb-1 opacity-60">Description</div>
  {#if task.description.trim().length > 0}
    <!-- markdown.ts strips raw HTML at parse time (html: false), so {@html}
         here is safe — no script/iframe/etc. tags can ride through. eslint
         can't see that, so the rule is suppressed. onclick is delegated:
         linkifyTaskIds inserts <a> tags with data-task-id attrs that we
         route to onSwitch. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="prose prose-sm max-w-none select-text rounded-lg bg-base-200 px-4 py-3"
      onclick={onDescriptionClick}
    >
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html renderMarkdown(task.description)}
    </div>
  {:else}
    <p class="text-sm italic opacity-40">No description.</p>
  {/if}
</div>
