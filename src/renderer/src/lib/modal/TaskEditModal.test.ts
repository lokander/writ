// @vitest-environment happy-dom
//
// TaskEditModal behavior — view ↔ edit toggle, dirty tracking, discard
// confirm, conflict banner. We mount the real component against a seeded
// writState and stub the IPC layer so the save path is observable without
// going through Electron.

import { fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writState } from "../state.svelte";
import { makeTask } from "../test-fixtures";
import { installApiStub, seedWritState } from "../test-helpers";

import TaskEditModal from "./TaskEditModal.svelte";

const TASK_ID = "01KR000000000000000000ABCDEF";

function mountModal(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof render<typeof TaskEditModal>> {
  return render(TaskEditModal, {
    taskId: TASK_ID,
    initialMode: "view",
    isTop: true,
    stackIndex: 0,
    onClose: vi.fn(),
    onSwitch: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  installApiStub();
  // Always seed the target task in writState — the modal asserts it exists
  // at mount and throws if not. Individual tests can mutate
  // writState.tasks afterwards to simulate external state changes.
  seedWritState({
    project: {
      projectId: "p1",
      root: "/tmp/p",
      prettyRoot: "/tmp/p",
      dbPath: "/tmp/p/.writ/writ.db",
      displayName: null,
    },
    columns: [{ id: "col-todo", name: "Todo", position: 1000 }],
    tasks: [
      makeTask({
        id: TASK_ID,
        title: "Original title",
        description: "Original description",
        priority: 2,
        columnId: "col-todo",
      }),
    ],
    tags: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskEditModal mode toggle", () => {
  it("renders the view panel initially when initialMode='view'", () => {
    mountModal();
    // Title shown in the view body.
    expect(screen.getByText("Original title")).toBeInTheDocument();
    // The Edit button is the giveaway that we're in view mode (TaskEditPanel
    // would show a Save button instead).
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("switches to edit panel when the Edit button is clicked", async () => {
    mountModal();
    await fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    // The edit panel surfaces a title input prefilled from the task and the
    // Save button replaces Edit in the action bar.
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput).toBeInTheDocument();
    expect(titleInput.value).toBe("Original title");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("opens directly in edit mode when initialMode='edit'", () => {
    mountModal({ initialMode: "edit" });
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});

describe("TaskEditModal dirty tracking", () => {
  it("Save is disabled until the user actually changes a field", async () => {
    mountModal({ initialMode: "edit" });
    const save = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(save).toBeDisabled();

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    await fireEvent.input(titleInput, { target: { value: "Edited title" } });
    expect(save).not.toBeDisabled();
  });

  it("Save stays disabled when the title is whitespace only", async () => {
    mountModal({ initialMode: "edit" });
    const save = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    // Clear and replace with only spaces — dirty but empty.
    await fireEvent.input(titleInput, { target: { value: "   " } });
    expect(save).toBeDisabled();
  });

  it("opens the discard-confirm dialog when Cancel is pressed with dirty edits", async () => {
    mountModal({ initialMode: "edit" });
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Edited title" },
    });
    await fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText(/discard your edits/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^discard$/i })).toBeInTheDocument();
  });

  it("Cancel without dirty edits skips the confirm and exits edit mode immediately", async () => {
    mountModal({ initialMode: "edit" });
    await fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    // Confirm dialog never appears.
    expect(screen.queryByText(/discard your edits/i)).not.toBeInTheDocument();
    // Back in view mode → Edit button visible again.
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });
});

describe("TaskEditModal save flow", () => {
  it("opens the conflict dialog when updateTask returns a conflict on an overlapping field", async () => {
    mountModal({ initialMode: "edit" });
    // Drive a dirty title.
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Local title" },
    });

    // Stub updateTask to return a conflict where the remote also changed
    // title — that's the overlap path that opens the dialog (no overlap
    // would silently auto-merge with a retry, which we cover separately).
    const remote = makeTask({
      id: TASK_ID,
      title: "Remote title",
      description: "Original description",
      priority: 2,
      columnId: "col-todo",
      version: 5,
    });
    vi.spyOn(writState, "updateTask").mockResolvedValueOnce({
      kind: "conflict",
      current: remote,
    });

    await fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // Let the microtask queue drain so the awaited updateTask resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByText(/conflict — task was changed by another writer/i)).toBeInTheDocument();
  });

  it("auto-merges (no dialog) when updateTask conflicts on a field the user did not touch", async () => {
    mountModal({ initialMode: "edit" });
    // User touches title only.
    await fireEvent.input(screen.getByLabelText("Title"), {
      target: { value: "Local title" },
    });

    // Remote changed description (different field). First call → conflict;
    // the modal's auto-merge path retries with the new version pinned, and
    // we let that second call succeed.
    const remote = makeTask({
      id: TASK_ID,
      title: "Original title",
      description: "Remote description",
      priority: 2,
      columnId: "col-todo",
      version: 5,
    });
    const okTask = makeTask({
      id: TASK_ID,
      title: "Local title",
      description: "Remote description",
      priority: 2,
      columnId: "col-todo",
      version: 6,
    });
    const updateSpy = vi
      .spyOn(writState, "updateTask")
      .mockResolvedValueOnce({ kind: "conflict", current: remote })
      .mockResolvedValueOnce({ kind: "ok", task: okTask });

    await fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // Two microtask hops for the two awaits.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText(/conflict — task was changed by another writer/i),
    ).not.toBeInTheDocument();
  });
});

describe("TaskEditModal task-gone banner", () => {
  it("renders the 'Deleted by another writer' banner when the task vanishes from writState", async () => {
    mountModal();
    // Simulate an external delete landing: remove the task from writState.
    writState.tasks = [];
    // Wait one microtask so $derived recomputes.
    await Promise.resolve();
    expect(screen.getByText(/deleted by another writer/i)).toBeInTheDocument();
  });
});
