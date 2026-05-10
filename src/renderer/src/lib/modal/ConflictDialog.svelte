<script lang="ts">
  import { CheckIcon, XIcon } from "phosphor-svelte";

  import type { Priority, Task } from "../../../../shared/types";
  import { PRIORITY_NAMES } from "../../../../shared/types";
  import type { ConflictResolutions, EditedTaskFields, TaskDirtyFlags } from "./diff-task";
  import { portal } from "../portal";

  interface Props {
    /** Snapshot at edit-start. The "Original" column. */
    originalTask: Task;
    /** Current local form values. The "Yours" column. */
    edited: EditedTaskFields;
    /** Server's view at conflict-detection time. The "Theirs" column. */
    remoteTask: Task;
    /** Which fields conflict (dirty AND remote-changed). Drives which rows render. */
    conflictFlags: TaskDirtyFlags;
    /** Returns the user's per-field picks. The modal then rebuilds the
     *  payload via `buildResolvedUpdate` and retries the save. */
    onResolve: (resolutions: ConflictResolutions) => void;
    onCancel: () => void;
  }

  const { originalTask, edited, remoteTask, conflictFlags, onResolve, onCancel }: Props = $props();

  // Default to "theirs" everywhere — they have newer info (their write
  // bumped the version after our edit-start). The user explicitly flips
  // back to "mine" for fields they want to override. The footer
  // "Force-save mine" / "Accept all theirs" buttons are shortcuts that
  // skip the per-field review entirely.
  let resolutions = $state<ConflictResolutions>({
    title: "theirs",
    description: "theirs",
    priority: "theirs",
    parentId: "theirs",
    tags: "theirs",
    dependsOn: "theirs",
  });

  function priorityLabel(p: Priority): string {
    return PRIORITY_NAMES[p];
  }

  function parentLabel(id: string | null): string {
    if (id === null) return "(none)";
    return id.slice(-6);
  }

  function tagsLabel(tags: string[]): string {
    if (tags.length === 0) return "(none)";
    return tags.join(", ");
  }

  function depsLabel(ids: string[]): string {
    if (ids.length === 0) return "(none)";
    return ids.map((i) => i.slice(-6)).join(", ");
  }

  function applySaveWithPicks(): void {
    onResolve(resolutions);
  }

  function applyAcceptAllTheirs(): void {
    onResolve({
      title: "theirs",
      description: "theirs",
      priority: "theirs",
      parentId: "theirs",
      tags: "theirs",
      dependsOn: "theirs",
    });
  }

  function applyForceSaveMine(): void {
    onResolve({
      title: "mine",
      description: "mine",
      priority: "mine",
      parentId: "mine",
      tags: "mine",
      dependsOn: "mine",
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Portaled above the edit modal (z-[1100]) so it escapes the modal-box's
     transform containment, matching ConfirmDialog's pattern. -->
<div
  use:portal
  class="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto p-6"
  role="dialog"
  aria-modal="true"
  aria-labelledby="conflict-dialog-title"
>
  <button
    type="button"
    class="absolute inset-0 bg-black/40 backdrop-blur-sm"
    aria-label="Cancel"
    onclick={onCancel}
  ></button>

  <div class="relative my-8 w-full max-w-3xl rounded-box bg-base-100 p-6 shadow-2xl">
    <h3 id="conflict-dialog-title" class="text-lg font-semibold">
      Conflict — task was changed by another writer
    </h3>
    <p class="mt-1 text-sm opacity-70">
      The fields below changed both locally and remotely between when you opened this task and now.
      Pick which version to keep per field, or use the shortcuts below.
    </p>

    <div class="mt-5 flex flex-col gap-4">
      {#if conflictFlags.title}
        <div class="rounded-lg border border-base-300 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-semibold">Title</span>
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.title === "mine"}
                class:btn-soft={resolutions.title !== "mine"}
                onclick={() => (resolutions.title = "mine")}
              >
                Keep mine
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.title === "theirs"}
                class:btn-soft={resolutions.title !== "theirs"}
                onclick={() => (resolutions.title = "theirs")}
              >
                Accept theirs
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Original</div>
              <div class="select-text rounded bg-base-200 px-2 py-1">{originalTask.title}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Yours</div>
              <div class="select-text rounded bg-primary/10 px-2 py-1">{edited.title}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Theirs</div>
              <div class="select-text rounded bg-warning/10 px-2 py-1">{remoteTask.title}</div>
            </div>
          </div>
        </div>
      {/if}

      {#if conflictFlags.description}
        <div class="rounded-lg border border-base-300 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-semibold">Description</span>
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.description === "mine"}
                class:btn-soft={resolutions.description !== "mine"}
                onclick={() => (resolutions.description = "mine")}
              >
                Keep mine
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.description === "theirs"}
                class:btn-soft={resolutions.description !== "theirs"}
                onclick={() => (resolutions.description = "theirs")}
              >
                Accept theirs
              </button>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div class="mb-1 flex items-center justify-between text-xs uppercase opacity-50">
                <span>Yours</span>
                <span class="opacity-60 normal-case">(your edit)</span>
              </div>
              <pre
                class="max-h-48 select-text overflow-auto whitespace-pre-wrap rounded bg-primary/10 px-2 py-1 font-mono text-xs">{edited.description}</pre>
            </div>
            <div>
              <div class="mb-1 flex items-center justify-between text-xs uppercase opacity-50">
                <span>Theirs</span>
                <span class="opacity-60 normal-case">(remote)</span>
              </div>
              <pre
                class="max-h-48 select-text overflow-auto whitespace-pre-wrap rounded bg-warning/10 px-2 py-1 font-mono text-xs">{remoteTask.description}</pre>
            </div>
          </div>
          <details class="mt-2">
            <summary class="cursor-pointer text-xs opacity-60"
              >Show original (at edit-start)</summary
            >
            <pre
              class="mt-1 max-h-48 select-text overflow-auto whitespace-pre-wrap rounded bg-base-200 px-2 py-1 font-mono text-xs">{originalTask.description}</pre>
          </details>
        </div>
      {/if}

      {#if conflictFlags.priority}
        <div class="rounded-lg border border-base-300 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-semibold">Priority</span>
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.priority === "mine"}
                class:btn-soft={resolutions.priority !== "mine"}
                onclick={() => (resolutions.priority = "mine")}
              >
                Keep mine
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.priority === "theirs"}
                class:btn-soft={resolutions.priority !== "theirs"}
                onclick={() => (resolutions.priority = "theirs")}
              >
                Accept theirs
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Original</div>
              <div class="rounded bg-base-200 px-2 py-1">
                {priorityLabel(originalTask.priority)}
              </div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Yours</div>
              <div class="rounded bg-primary/10 px-2 py-1">{priorityLabel(edited.priority)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Theirs</div>
              <div class="rounded bg-warning/10 px-2 py-1">
                {priorityLabel(remoteTask.priority)}
              </div>
            </div>
          </div>
        </div>
      {/if}

      {#if conflictFlags.parentId}
        <div class="rounded-lg border border-base-300 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-semibold">Parent</span>
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.parentId === "mine"}
                class:btn-soft={resolutions.parentId !== "mine"}
                onclick={() => (resolutions.parentId = "mine")}
              >
                Keep mine
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.parentId === "theirs"}
                class:btn-soft={resolutions.parentId !== "theirs"}
                onclick={() => (resolutions.parentId = "theirs")}
              >
                Accept theirs
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Original</div>
              <div class="rounded bg-base-200 px-2 py-1">{parentLabel(originalTask.parentId)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Yours</div>
              <div class="rounded bg-primary/10 px-2 py-1">{parentLabel(edited.parentId)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Theirs</div>
              <div class="rounded bg-warning/10 px-2 py-1">{parentLabel(remoteTask.parentId)}</div>
            </div>
          </div>
        </div>
      {/if}

      {#if conflictFlags.tags}
        <div class="rounded-lg border border-base-300 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-semibold">Tags</span>
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.tags === "mine"}
                class:btn-soft={resolutions.tags !== "mine"}
                onclick={() => (resolutions.tags = "mine")}
              >
                Keep mine
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.tags === "theirs"}
                class:btn-soft={resolutions.tags !== "theirs"}
                onclick={() => (resolutions.tags = "theirs")}
              >
                Accept theirs
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Original</div>
              <div class="rounded bg-base-200 px-2 py-1">{tagsLabel(originalTask.tags)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Yours</div>
              <div class="rounded bg-primary/10 px-2 py-1">{tagsLabel(edited.tagSpecs)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Theirs</div>
              <div class="rounded bg-warning/10 px-2 py-1">{tagsLabel(remoteTask.tags)}</div>
            </div>
          </div>
        </div>
      {/if}

      {#if conflictFlags.dependsOn}
        <div class="rounded-lg border border-base-300 p-3">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-semibold">Depends on</span>
            <div class="join">
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.dependsOn === "mine"}
                class:btn-soft={resolutions.dependsOn !== "mine"}
                onclick={() => (resolutions.dependsOn = "mine")}
              >
                Keep mine
              </button>
              <button
                type="button"
                class="btn btn-xs join-item"
                class:btn-primary={resolutions.dependsOn === "theirs"}
                class:btn-soft={resolutions.dependsOn !== "theirs"}
                onclick={() => (resolutions.dependsOn = "theirs")}
              >
                Accept theirs
              </button>
            </div>
          </div>
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Original</div>
              <div class="rounded bg-base-200 px-2 py-1">{depsLabel(originalTask.dependsOn)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Yours</div>
              <div class="rounded bg-primary/10 px-2 py-1">{depsLabel(edited.dependsOnIds)}</div>
            </div>
            <div>
              <div class="mb-1 text-xs uppercase opacity-50">Theirs</div>
              <div class="rounded bg-warning/10 px-2 py-1">{depsLabel(remoteTask.dependsOn)}</div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="mt-6 flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-soft" onclick={applyAcceptAllTheirs}>
          Accept all theirs
        </button>
        <button type="button" class="btn btn-sm btn-soft btn-warning" onclick={applyForceSaveMine}>
          Force-save mine
        </button>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn btn-sm btn-ghost" onclick={onCancel}>
          <XIcon size={14} weight="bold" />
          Cancel
        </button>
        <button type="button" class="btn btn-sm btn-primary" onclick={applySaveWithPicks}>
          <CheckIcon size={14} weight="bold" />
          Save with picks
        </button>
      </div>
    </div>
  </div>
</div>
