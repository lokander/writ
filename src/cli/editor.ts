import { spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export class EditorError extends Error {
  override readonly name = "EditorError";
}

export interface EditedFile {
  content: string;
  /** Path to the temp file. Caller is responsible for cleanup on success. */
  tempPath: string;
}

export function resolveEditor(): { cmd: string; args: string[] } {
  const raw = process.env.WRIT_EDITOR || process.env.VISUAL || process.env.EDITOR;
  const [cmd, ...args] = raw?.match(/\S+/g) ?? [];
  if (!cmd) {
    throw new EditorError(
      'No editor configured. Set $WRIT_EDITOR, $VISUAL, or $EDITOR (e.g. "code --wait" for VS Code).',
    );
  }
  return { cmd, args };
}

/**
 * Open `initialContent` in the user's editor. Returns the saved content plus
 * the temp path so the caller can either delete it (success) or surface it to
 * the user (parse failure) so their edits aren't lost.
 */
export function editInExternalEditor(initialContent: string, filename: string): EditedFile {
  const { cmd, args } = resolveEditor();
  const dir = mkdtempSync(join(tmpdir(), "writ-edit-"));
  const tempPath = join(dir, filename);
  writeFileSync(tempPath, initialContent, "utf8");

  const result = spawnSync(cmd, [...args, tempPath], { stdio: "inherit" });
  if (result.error) {
    throw new EditorError(
      `Failed to launch editor '${cmd}': ${result.error.message}. File saved at ${tempPath}.`,
    );
  }
  if (result.status !== 0) {
    throw new EditorError(
      `Editor '${cmd}' exited with status ${result.status}. File saved at ${tempPath}.`,
    );
  }

  const content = readFileSync(tempPath, "utf8");
  return { content, tempPath };
}

export function cleanupTempFile(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
    rmSync(join(tempPath, ".."), { force: true, recursive: true });
  } catch {
    // best-effort cleanup
  }
}
