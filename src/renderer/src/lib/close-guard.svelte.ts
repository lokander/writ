import { untrack } from "svelte";

/** Tracks how many modals currently hold unsaved edits, so App.svelte can
 *  decide whether the window-close request needs a "discard?" prompt.
 *  Reference-counted rather than a Set<uid> so the call sites stay
 *  symmetric (`enter()` / `leave()` from a single $effect cleanup) — see
 *  TaskEditModal's $effect that registers when `mode === "edit" && dirty`.
 *
 *  No persistence: an unresolved dirty state from a previous session is
 *  always stale by reload time, and there's nothing to do with it
 *  anyway (the modal isn't mounted). */
class CloseGuard {
  count = $state(0);
  hasDirty = $derived(this.count > 0);

  /** Increment when a modal enters the dirty-and-editing state. The
   *  caller is responsible for a matching `leave()` — typically the
   *  return value of a `$effect(...)` block.
   *
   *  The compound `+= 1` would read `this.count` before writing it; when
   *  this method is invoked from inside an effect, that read leaks as a
   *  dependency and the subsequent write triggers an immediate re-run
   *  (Svelte's `effect_update_depth_exceeded`). `untrack` suppresses the
   *  dependency tracking around the read while the write still notifies
   *  consumers (`hasDirty`) normally. */
  enter(): void {
    untrack(() => {
      this.count = this.count + 1;
    });
  }

  /** Decrement when the modal leaves the dirty-and-editing state (saved,
   *  reverted, mode switched, or unmounted). Clamped at zero so a
   *  double-cleanup doesn't go negative. Same untrack reasoning as
   *  enter(). */
  leave(): void {
    untrack(() => {
      if (this.count > 0) this.count = this.count - 1;
    });
  }
}

export const closeGuard = new CloseGuard();
