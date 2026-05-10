// Toast notifications for transient mutation feedback (drag-drop rollback,
// save failure, etc.). Drop-in replacement for the banner that lived above
// the kanban — toasts stack instead of overwriting, auto-dismiss, and float
// over modals.
//
// The no-project empty-state surface in App.svelte still uses
// `writState.error` directly: that's a sticky message tied to "you picked
// a folder without a writ project," not a transient mutation failure, so
// it shouldn't auto-dismiss.

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /** 0 means "no auto-dismiss"; the renderer hides the countdown bar in
   *  that case. */
  timeoutMs: number;
}

interface ToastOptions {
  variant?: ToastVariant;
  /** Auto-dismiss after this many ms. Pass 0 to keep the toast until the
   *  user clicks it. Defaults: see DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

// Errors are sticky so the user can read the full message at their own
// pace (and sometimes copy it). Warnings get a longer dwell than
// info/success since they typically deserve more attention.
const DEFAULT_TIMEOUT_MS: Record<ToastVariant, number> = {
  info: 5000,
  success: 5000,
  warning: 8000,
  error: 0,
};

class ToastState {
  toasts = $state<Toast[]>([]);
  private nextId = 1;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, options: ToastOptions = {}): number {
    const variant = options.variant ?? "info";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[variant];

    const id = this.nextId++;
    this.toasts = [...this.toasts, { id, message, variant, timeoutMs }];

    if (timeoutMs > 0) {
      const handle = setTimeout(() => this.dismiss(id), timeoutMs);
      this.timers.set(id, handle);
    }
    return id;
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const toast = new ToastState();
