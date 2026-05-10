<script lang="ts">
  import type { Component } from "svelte";
  import { CheckCircleIcon, InfoIcon, WarningIcon, WarningOctagonIcon } from "phosphor-svelte";
  import type { ToastVariant } from "./toast.svelte";
  import { toast } from "./toast.svelte";
  import { portal } from "../portal";

  // Mapped explicitly so Tailwind's JIT scanner picks them up.
  const VARIANT_CLASS: Record<ToastVariant, string> = {
    info: "alert-info",
    success: "alert-success",
    warning: "alert-warning",
    error: "alert-error",
  };

  const VARIANT_ICON: Record<ToastVariant, Component> = {
    info: InfoIcon,
    success: CheckCircleIcon,
    warning: WarningIcon,
    error: WarningOctagonIcon,
  };
</script>

<!-- Portaled to <body> so modal/dialog transform-containment doesn't clip
     the toast. z-[1200] sits above ConfirmDialog (z-[1100]) so a confirm
     prompt that triggers an error still surfaces the toast on top.
     pointer-events-none on the container lets clicks fall through the gaps
     between stacked toasts; each toast re-enables them on itself.
     Anchored at the bottom: with `flex-col`, the newest toast (last in the
     array) sits at the bottom edge and older ones stack upward. -->
<div
  use:portal
  class="pointer-events-none fixed bottom-4 left-1/2 z-[1200] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
  aria-live="polite"
  aria-atomic="false"
>
  {#each toast.toasts as t (t.id)}
    {@const Icon = VARIANT_ICON[t.variant]}
    <button
      type="button"
      class="alert {VARIANT_CLASS[
        t.variant
      ]} pointer-events-auto relative cursor-pointer overflow-hidden shadow-lg"
      onclick={() => toast.dismiss(t.id)}
      aria-label="Dismiss notification"
    >
      <Icon size={20} weight="bold" aria-hidden="true" />
      <span>{t.message}</span>
      {#if t.timeoutMs > 0}
        <!-- Countdown bar: animates from full width to zero over the toast's
             configured timeout. `currentColor` inherits the alert's text
             color (DaisyUI picks one with contrast against the alert bg),
             dimmed so it reads as a subtle progress hint rather than a
             second focal point. -->
        <span
          class="toast-countdown absolute bottom-0 left-0 h-0.5 bg-current/50"
          style:animation-duration="{t.timeoutMs}ms"
          aria-hidden="true"
        ></span>
      {/if}
    </button>
  {/each}
</div>

<style>
  @keyframes toast-shrink {
    from {
      width: 100%;
    }
    to {
      width: 0%;
    }
  }
  .toast-countdown {
    animation-name: toast-shrink;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
</style>
