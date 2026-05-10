import * as fs from "node:fs";
import * as net from "node:net";
import { dirname } from "node:path";

import { getDesktopSocketPath } from "../shared/desktop-ping";

import { broadcastProjectChanged, getCurrentProject, switchProject } from "./project";
import { focusMainWindow } from "./window";

let pingServer: net.Server | null = null;

export function startPingServer(): void {
  const sockPath = getDesktopSocketPath();
  // Unix socket: ensure parent dir exists and remove any stale file from a
  // previous crashed instance. Windows named pipes have neither concern.
  if (process.platform !== "win32") {
    try {
      fs.mkdirSync(dirname(sockPath), { recursive: true });
    } catch (err) {
      console.error("[writ] failed to create socket dir", err);
    }
    try {
      fs.unlinkSync(sockPath);
    } catch {
      // ENOENT is the happy path; anything else surfaces on listen() below.
    }
  }
  pingServer = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) handlePingLine(line);
    });
    sock.on("end", () => {
      if (buf.trim().length > 0) handlePingLine(buf);
    });
    sock.on("error", () => sock.destroy());
  });
  pingServer.on("error", (err) => {
    console.error("[writ] ping server error", err);
  });
  pingServer.listen(sockPath);
}

function handlePingLine(line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let msg: { type?: unknown; root?: unknown };
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  // Two message types share the socket; an absent `type` is treated as
  // "changed" so an in-flight CLI/MCP from an older build still works.
  const type = typeof msg.type === "string" ? msg.type : "changed";

  if (type === "changed") {
    if (typeof msg.root !== "string") return;
    // Filter by project root so a ping for project A doesn't refresh a window
    // viewing project B.
    if (getCurrentProject()?.root !== msg.root) return;
    broadcastProjectChanged();
    return;
  }

  if (type === "open") {
    // The CLI resolves `findProjectRoot(cwd)` before sending, so `root` is
    // either an actual project root or null (cwd had no .writ/). Trust it.
    const root = typeof msg.root === "string" ? msg.root : null;
    // Bare `writ` from a writ-less cwd: focus only, don't wipe the user's
    // current project. The file-dialog picker is the explicit-switch path.
    if (root !== null || getCurrentProject() === null) {
      switchProject(root);
      broadcastProjectChanged();
    }
    focusMainWindow();
    return;
  }
}

export function stopPingServer(): void {
  pingServer?.close();
  pingServer = null;
  if (process.platform !== "win32") {
    try {
      fs.unlinkSync(getDesktopSocketPath());
    } catch {
      // socket may already be gone (clean shutdown closed it)
    }
  }
}
