<script lang="ts">
  import { PlusIcon } from "phosphor-svelte";

  import type { Task } from "../../../../shared/types";
  import TagChip from "../chip/TagChip.svelte";
  import TaskIdChip from "../chip/TaskIdChip.svelte";

  interface Props {
    /** Parent task — used for the new-subtask column inheritance. */
    task: Task;
    /** Direct children of `task`, freshly derived in the parent. */
    children: Task[];
    colorByTag: Record<string, string | null>;
    columnNameById: Record<string, string>;
    /** When true, the parent task is gone (CLI delete mid-session). Disables
     *  the "Add subtask" affordance so the user can't orphan rows. */
    taskGone: boolean;
    /** Bindable: whether the inline-add form is visible. Lives in the
     *  parent so the modal's Esc handler can clear it as part of the
     *  layered cancel ladder. */
    isAdding: boolean;
    /** Bindable: the current title input value. Same reasoning as
     *  isAdding — the parent's cancel logic resets it. */
    newTitle: string;
    onSwitch: (id: string) => void;
    /** Submit the inline add form. Parent owns the writState.createTask
     *  call so it can coordinate the result (newTitle reset, isAdding off)
     *  in one place. */
    onAdd: () => void;
  }

  let {
    task,
    children,
    colorByTag,
    columnNameById,
    taskGone,
    isAdding = $bindable(),
    newTitle = $bindable(),
    onSwitch,
    onAdd,
  }: Props = $props();

  function onFormSubmit(event: SubmitEvent | KeyboardEvent): void {
    event.preventDefault();
    onAdd();
  }
</script>

<div class="mb-4">
  <div class="mb-2 flex items-center justify-between">
    <span class="label-text font-medium">Subtasks ({children.length})</span>
    {#if !isAdding}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={() => (isAdding = true)}
        disabled={taskGone}
      >
        <PlusIcon size={14} weight="bold" />
        Subtask
      </button>
    {/if}
  </div>

  {#if children.length > 0}
    <div class="flex flex-col gap-1">
      {#each children as child (child.id)}
        {@const showBadge = child.columnId !== task.columnId}
        <button
          type="button"
          class="card flex flex-row items-baseline gap-3 bg-base-200 px-3 py-2 text-left text-sm hover:bg-base-300"
          onclick={() => onSwitch(child.id)}
        >
          <TaskIdChip id={child.id} />
          <span class="flex-1">{child.title}</span>
          {#each child.tags as tag (tag)}
            <TagChip name={tag} color={colorByTag[tag] ?? null} />
          {/each}
          {#if showBadge}
            <span class="badge badge-outline badge-sm">
              {columnNameById[child.columnId] ?? "?"}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if !isAdding}
    <p class="text-xs italic opacity-40">No subtasks.</p>
  {/if}

  {#if isAdding}
    <!-- A nested <form> would be invalid HTML inside the outer task form, so
         this is a div with explicit submit-on-Enter handling instead. -->
    <div class="mt-2 flex gap-2">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        class="input input-bordered input-sm flex-1"
        placeholder="Subtask title"
        bind:value={newTitle}
        onkeydown={(e) => {
          if (e.key === "Enter") onFormSubmit(e);
        }}
        autofocus
      />
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={onAdd}
        disabled={newTitle.trim().length === 0}
      >
        Add
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        onclick={() => {
          newTitle = "";
          isAdding = false;
        }}
      >
        Cancel
      </button>
    </div>
  {/if}
</div>
