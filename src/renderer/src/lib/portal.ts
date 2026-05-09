// Svelte action that moves the bound element into <body> on mount and
// removes it on destroy. Used to escape ancestors that would otherwise
// clip or contain the element — e.g. DaisyUI's modal-box has `overflow-y: auto`
// AND a `transform` on the wrapper, which clips both `absolute` and `fixed`
// positioning. Anything that needs to render on top of (or outside of) a
// modal — combobox dropdowns, confirm dialogs — uses this.

export function portal(node: HTMLElement): { destroy: () => void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
