import { describe, expect, it } from "vitest";

import { closeGuard } from "./close-guard.svelte";

// The singleton state leaks across tests within this file. Each test
// resets via leave() loops; the value is "registration count", so any
// sequence balanced enter/leave returns it to zero.
function resetToZero(): void {
  while (closeGuard.count > 0) closeGuard.leave();
}

describe("closeGuard", () => {
  it("starts with no dirty modals", () => {
    resetToZero();
    expect(closeGuard.count).toBe(0);
    expect(closeGuard.hasDirty).toBe(false);
  });

  it("hasDirty flips true once a modal enters", () => {
    resetToZero();
    closeGuard.enter();
    expect(closeGuard.hasDirty).toBe(true);
    expect(closeGuard.count).toBe(1);
  });

  it("counts multiple concurrent dirty modals", () => {
    resetToZero();
    closeGuard.enter();
    closeGuard.enter();
    closeGuard.enter();
    expect(closeGuard.count).toBe(3);
    expect(closeGuard.hasDirty).toBe(true);
  });

  it("hasDirty stays true until the last leave()", () => {
    resetToZero();
    closeGuard.enter();
    closeGuard.enter();
    closeGuard.leave();
    expect(closeGuard.hasDirty).toBe(true);
    closeGuard.leave();
    expect(closeGuard.hasDirty).toBe(false);
  });

  it("leave() clamps at zero on an unbalanced cleanup", () => {
    // Double-cleanup shouldn't drag the count negative — would mask later
    // enters as still-dirty when they're actually fresh.
    resetToZero();
    closeGuard.leave();
    closeGuard.leave();
    expect(closeGuard.count).toBe(0);
    expect(closeGuard.hasDirty).toBe(false);
  });
});
