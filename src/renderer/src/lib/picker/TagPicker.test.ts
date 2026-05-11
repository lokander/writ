// @vitest-environment happy-dom
//
// TagPicker — covers the "create new tag" extra-row path that the
// Combobox base exposes, plus chip add/remove. The keyboard nav itself
// is exercised in ParentPicker.test.ts (same Combobox base).

import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installApiStub, seedWritState } from "../test-helpers";

import TagPicker from "./TagPicker.svelte";

beforeEach(() => {
  installApiStub();
  seedWritState({
    columns: [],
    tasks: [],
    tags: [
      { id: "t-ui", name: "ui", color: "red" },
      { id: "t-core", name: "core", color: null },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TagPicker rendering", () => {
  it("renders attached tags as chips", () => {
    render(TagPicker, { tagSpecs: ["ui"] });
    expect(screen.getByText("ui")).toBeInTheDocument();
  });

  it("filters the dropdown to exclude already-attached tags", async () => {
    render(TagPicker, { tagSpecs: ["ui"] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // 'ui' is already attached → not in the option list. 'core' still
    // available. The chip with 'ui' is in the form area above the input;
    // we narrow to the listbox to disambiguate.
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(listbox.textContent).not.toContain("ui");
    expect(listbox.textContent).toContain("core");
  });
});

describe("TagPicker selection", () => {
  it("clicking an existing tag option adds it to tagSpecs (visible chip)", async () => {
    render(TagPicker, { tagSpecs: [] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // The dropdown shows 'ui' and 'core'. Pick 'core'.
    const coreOption = screen.getAllByText("core").find((el) => el.closest("[role='option']"));
    expect(coreOption).toBeDefined();
    await fireEvent.click(coreOption!.closest("[role='option']")!);
    // After pick, 'core' becomes a chip — but the input is also cleared,
    // so the listbox closes (dropdown only renders when there are rows).
    // The chip lives outside the listbox in the form area.
    expect(screen.getByText("core")).toBeInTheDocument();
  });

  it("Create-new path: typing a new tag name + Enter adds it via onExtraSelect", async () => {
    render(TagPicker, { tagSpecs: [] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: "newtag" } });

    // With "newtag" typed and no existing tag matches, the extra row is
    // active. ArrowDown moves past the (now empty) filtered items to the
    // extra row, but in this case 'newtag' filters all existing tags out,
    // so the extra row is index 0 and already active. Enter triggers it.
    await fireEvent.keyDown(input, { key: "Enter" });

    // The new tag is added as a chip — visible in the form area.
    expect(screen.getByText("newtag")).toBeInTheDocument();
  });

  it("rejects invalid new tag names with an inline error and refuses to create", async () => {
    render(TagPicker, { tagSpecs: [] });
    const input = screen.getByRole("combobox");
    await fireEvent.focus(input);
    // Spaces aren't allowed in tag names.
    await fireEvent.input(input, { target: { value: "not valid" } });
    // Inline validation surfaces the message from TagValidationError.
    expect(screen.getByText(/invalid tag name/i)).toBeInTheDocument();
    // Enter should be a no-op — the extra-row "Create new tag" is gated
    // on canCreateNewTag, which is false for invalid input.
    await fireEvent.keyDown(input, { key: "Enter" });
    // No chip with the bad text.
    expect(screen.queryByText("not valid")).not.toBeInTheDocument();
  });

  it("removing a tag chip drops it from tagSpecs", async () => {
    render(TagPicker, { tagSpecs: ["ui", "core"] });
    // TagChip's remove button has aria-label="Remove tag" (no per-chip
    // disambiguation), so we pick the one whose containing chip element
    // also contains the literal "ui" text.
    const removeButtons = screen.getAllByRole("button", { name: /remove tag/i });
    const uiRemove = removeButtons.find((b) => b.closest("span")?.textContent?.includes("ui"));
    expect(uiRemove).toBeDefined();
    await fireEvent.click(uiRemove!);
    expect(screen.queryByText("ui")).not.toBeInTheDocument();
    expect(screen.getByText("core")).toBeInTheDocument();
  });
});
