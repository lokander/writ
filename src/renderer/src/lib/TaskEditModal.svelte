<script lang="ts">
  import { X, Trash, Plus } from "phosphor-svelte";

  import type { Priority, Task } from "../../../shared/types";
  import { PRIORITY_NAMES } from "../../../shared/types";
  import { writState } from "./state.svelte";

  interface Props {
    task: Task;
    onClose: () => void;
    onSwitch: (id: string) => void;
  }

  const { task, onClose, onSwitch }: Props = $props();

  let title = $state(task.title);
  let description = $state(task.description);
  let priority = $state<Priority>(task.priority);
  let parentId = $state<string | null>(task.parentId);
  let saving = $state(false);

  let addingSubtask = $state(false);
  let newSubtaskTitle = $state("");

  const dirty = $derived(
    title !== task.title ||
      description !== task.description ||
      priority !== task.priority ||
      parentId !== task.parentId,
  );

  const canSave = $derived(dirty && title.trim().length > 0 && !saving);

  // Self + all descendants — must be excluded from the parent picker so the
  // user can't make a cycle.
  const descendantIds = $derived.by(() => {
    const set: Record<string, true> = { [task.id]: true };
    let added = true;
    while (added) {
      added = false;
      for (const t of writState.tasks) {
        if (t.parentId !== null && set[t.parentId] && !set[t.id]) {
          set[t.id] = true;
          added = true;
        }
      }
    }
    return set;
  });

  const parentOptions = $derived(
    writState.tasks
      .filter((t) => !descendantIds[t.id])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const children = $derived(writState.tasks.filter((t) => t.parentId === task.id));

  const columnNameById = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of writState.columns) m[c.id] = c.name;
    return m;
  });

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    const updated = await writState.updateTask(task.id, {
      title: title.trim(),
      description,
      priority,
      parentId,
    });
    saving = false;
    if (updated) onClose();
  }

  async function remove(): Promise<void> {
    const ok = await writState.deleteTask(task.id);
    if (ok) onClose();
  }

  async function addSubtask(): Promise<void> {
    const trimmed = newSubtaskTitle.trim();
    if (trimmed.length === 0) return;
    const created = await writState.createTask({
      title: trimmed,
      parentId: task.id,
      columnId: task.columnId,
    });
    if (created) {
      newSubtaskTitle = "";
      addingSubtask = false;
    }
  }

  function cancelAddSubtask(): void {
    newSubtaskTitle = "";
    addingSubtask = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (addingSubtask) {
        cancelAddSubtask();
        event.stopPropagation();
      } else {
        onClose();
      }
    }
  }

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    save();
  }

  function onSubtaskFormSubmit(event: SubmitEvent): void {
    event.preventDefault();
    addSubtask();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="modal modal-open"
  role="dialog"
  aria-modal="true"
  aria-labelledby="task-edit-title"
  tabindex="-1"
>
  <button type="button" class="modal-backdrop" aria-label="Close" onclick={onClose}></button>
  <form class="modal-box w-[70vw] max-w-none" onsubmit={onSubmit}>
    <div class="mb-4 flex items-baseline justify-between gap-3">
      <h2 id="task-edit-title" class="text-lg font-semibold">Edit task</h2>
      <span class="font-mono text-xs opacity-50">{task.id.slice(-6)}</span>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
        <X size={16} weight="bold" />
      </button>
    </div>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Title</span>
      <input type="text" class="input input-bordered w-full" bind:value={title} autofocus />
    </label>

    <label class="form-control mb-3 w-full">
      <span class="label label-text">Description</span>
      <textarea class="textarea textarea-bordered w-full" rows="10" bind:value={description}
      ></textarea>
    </label>

    <div class="mb-4 flex flex-wrap gap-4">
      <label class="form-control w-full max-w-xs">
        <span class="label label-text">Priority</span>
        <select class="select select-bordered" bind:value={priority}>
          {#each [0, 1, 2, 3] as p (p)}
            <option value={p}>{PRIORITY_NAMES[p as Priority]}</option>
          {/each}
        </select>
      </label>

      <label class="form-control w-full max-w-md">
        <span class="label label-text">Parent</span>
        <select class="select select-bordered" bind:value={parentId}>
          <option value={null}>(no parent)</option>
          {#each parentOptions as p (p.id)}
            <option value={p.id}>{p.title}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="mb-4">
      <div class="mb-2 flex items-center justify-between">
        <span class="label-text font-medium">Subtasks ({children.length})</span>
        {#if !addingSubtask}
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (addingSubtask = true)}>
            <Plus size={14} weight="bold" />
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
              <span class="font-mono text-xs opacity-50">{child.id.slice(-6)}</span>
              <span class="flex-1">{child.title}</span>
              {#if showBadge}
                <span class="badge badge-outline badge-sm">
                  {columnNameById[child.columnId] ?? "?"}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {:else if !addingSubtask}
        <p class="text-xs italic opacity-40">No subtasks.</p>
      {/if}

      {#if addingSubtask}
        <!-- A nested <form> would be invalid HTML inside the outer form, so this
             is a div with explicit submit-on-Enter handling instead. -->
        <div class="mt-2 flex gap-2">
          <input
            type="text"
            class="input input-bordered input-sm flex-1"
            placeholder="Subtask title"
            bind:value={newSubtaskTitle}
            onkeydown={(e) => {
              if (e.key === "Enter") onSubtaskFormSubmit(e as unknown as SubmitEvent);
            }}
            autofocus
          />
          <button
            type="button"
            class="btn btn-primary btn-sm"
            onclick={addSubtask}
            disabled={newSubtaskTitle.trim().length === 0}
          >
            Add
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={cancelAddSubtask}>
            Cancel
          </button>
        </div>
      {/if}
    </div>

    <div class="modal-action mt-6 flex items-center justify-between">
      <button type="button" class="btn btn-error btn-outline" onclick={remove}>
        <Trash size={16} weight="bold" />
        Delete
      </button>
      <div class="flex gap-2">
        <button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled={!canSave}>Save</button>
      </div>
    </div>
  </form>
</div>
