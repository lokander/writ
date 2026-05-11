<script lang="ts">
  import { FlagIcon } from "phosphor-svelte";

  import { PRIORITY_NAMES, type Priority } from "../../../../shared/types";
  import { PRIORITY_DOT_CLASS } from "../priority-color";

  interface Props {
    /** Selected priorities (multi-select). Bindable so callers can read the
     *  current selection without an explicit onChange. */
    priorities: Priority[];
  }

  let { priorities = $bindable() }: Props = $props();

  const PRIORITY_CHIPS: { value: Priority; label: string; dotClass: string }[] = [
    { value: 0, label: PRIORITY_NAMES[0], dotClass: PRIORITY_DOT_CLASS[0] },
    { value: 1, label: PRIORITY_NAMES[1], dotClass: PRIORITY_DOT_CLASS[1] },
    { value: 2, label: PRIORITY_NAMES[2], dotClass: PRIORITY_DOT_CLASS[2] },
    { value: 3, label: PRIORITY_NAMES[3], dotClass: PRIORITY_DOT_CLASS[3] },
  ];

  function togglePriority(p: Priority): void {
    priorities = priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p];
  }
</script>

<div
  class="flex items-center gap-0.5 rounded-full border p-1 transition-colors {priorities.length > 0
    ? 'border-base-content/50'
    : 'border-base-content/20'}"
>
  <FlagIcon
    size={14}
    weight="duotone"
    class="mx-1 {priorities.length > 0 ? 'opacity-80' : 'opacity-50'}"
    data-tip="Priority"
    aria-label="Priority"
  />
  {#each PRIORITY_CHIPS as chip (chip.value)}
    {@const active = priorities.includes(chip.value)}
    <button
      type="button"
      class="tooltip tooltip-bottom flex h-5 w-5 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-base-content/10 {active
        ? 'bg-base-content/10'
        : ''}"
      aria-pressed={active}
      aria-label="Toggle {chip.label} priority filter"
      data-tip={chip.label}
      onclick={() => togglePriority(chip.value)}
    >
      <span
        class="inline-block h-3 w-3 rounded-full transition-opacity {chip.dotClass} {active
          ? ''
          : 'opacity-30'}"
      ></span>
    </button>
  {/each}
</div>
