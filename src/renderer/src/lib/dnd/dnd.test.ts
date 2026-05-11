// @vitest-environment happy-dom
//
// Smoke test for the dnd action wrappers. We don't fully simulate a drag
// (Pragmatic uses real PointerEvents and that's heavier than the wrappers'
// surface is worth) — instead, verify:
//   - draggable / dropTarget mount returns the {update, destroy} action
//     shape Svelte expects.
//   - `disabled` toggling on a draggable swaps Pragmatic's attach/detach
//     without throwing or leaking listeners.
//   - destroy() is idempotent-ish (callable from any state).

import { describe, expect, it } from "vitest";

import { draggable, dropTarget } from "./dnd";

function makeNode(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("draggable action", () => {
  it("returns the {update, destroy} shape", () => {
    const node = makeNode();
    const action = draggable(node, { data: { type: "card", taskId: "x" } });
    expect(typeof action.update).toBe("function");
    expect(typeof action.destroy).toBe("function");
    action.destroy();
  });

  it("destroy() is safe to call when the action was never attached (starts disabled)", () => {
    const node = makeNode();
    const action = draggable(node, { data: { type: "card", taskId: "x" }, disabled: true });
    expect(() => action.destroy()).not.toThrow();
  });

  it("update() can flip disabled → enabled → disabled without throwing", () => {
    const node = makeNode();
    const action = draggable(node, { data: { type: "card", taskId: "x" }, disabled: true });
    // start disabled → enable → disable → enable
    expect(() => {
      action.update({ data: { type: "card", taskId: "x" }, disabled: false });
      action.update({ data: { type: "card", taskId: "x" }, disabled: true });
      action.update({ data: { type: "card", taskId: "x" }, disabled: false });
    }).not.toThrow();
    action.destroy();
  });

  it("update() to the same disabled value is a no-op (doesn't double-attach)", () => {
    const node = makeNode();
    const action = draggable(node, { data: { type: "card", taskId: "x" } });
    // Same enabled→enabled update must not throw; if it double-attached
    // Pragmatic, the second destroy below would also throw.
    expect(() => action.update({ data: { type: "card", taskId: "y" } })).not.toThrow();
    expect(() => action.destroy()).not.toThrow();
  });
});

describe("dropTarget action", () => {
  it("returns the {update, destroy} shape", () => {
    const node = makeNode();
    const action = dropTarget(node, { data: { type: "column", columnId: "c1" } });
    expect(typeof action.update).toBe("function");
    expect(typeof action.destroy).toBe("function");
    action.destroy();
  });

  it("update() can swap the data payload without throwing", () => {
    const node = makeNode();
    const action = dropTarget(node, { data: { type: "column", columnId: "c1" } });
    expect(() => action.update({ data: { type: "column", columnId: "c2" } })).not.toThrow();
    action.destroy();
  });
});
