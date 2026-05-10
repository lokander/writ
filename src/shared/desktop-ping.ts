import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

// Hybrid B (design.md): after a successful write, the CLI / MCP server fires a
// fire-and-forget message at the desktop app's socket so an open UI refreshes
// immediately. The app falls back to fs.watch on the DB so correctness never
// depends on the ping landing.
//
// The same socket carries two message types: `changed` (mutation just landed,
// refresh if you're viewing this project) and `open` (bare-`writ` from the
// CLI — focus the app and switch to this project if it's not already open).

const SOCKET_NAME = "app.sock";
const PIPE_NAME = "writ-app";
const PING_TIMEOUT_MS = 250;

export type DesktopMessage =
  | { type: "changed"; root: string }
  | { type: "open"; root: string | null };

function configHome(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  }
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

export function getDesktopSocketPath(): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\${PIPE_NAME}`;
  return path.join(configHome(), "writ", SOCKET_NAME);
}

/** Connect, write the message, return whether the message reached a listening
 *  app. Never rejects. Resolves false if no app is listening (ENOENT,
 *  ECONNREFUSED), the connect times out, or the socket errors before flushing.
 *
 *  The socket is `unref`d so a pending send never blocks process exit — the
 *  CLI can finish and exit while any in-flight connect/write is dropped. */
function send(msg: DesktopMessage): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sockPath = getDesktopSocketPath();
    const sock = net.connect(sockPath);
    sock.unref();
    let settled = false;
    let connected = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(PING_TIMEOUT_MS);
    sock.once("connect", () => {
      connected = true;
      // Resolve as soon as the bytes are flushed to the kernel — the message
      // is on its way. We don't wait for an application-layer ack because the
      // protocol is fire-and-forget.
      sock.end(JSON.stringify(msg) + "\n", () => done(true));
    });
    // If we never connected, the app isn't running. If we connected and then
    // errored mid-write, treat as success-ish — connect proves the app is
    // up; the message may or may not have flushed but we shouldn't double-
    // launch. Same on timeout post-connect.
    sock.once("error", () => done(connected));
    sock.once("timeout", () => done(connected));
  });
}

/** Best-effort change notification used by mutating CLI / MCP commands.
 *  Resolves regardless of outcome; callers don't branch on the result. */
export async function pingDesktopApp(payload: { root: string }): Promise<void> {
  await send({ type: "changed", root: payload.root });
}

/** Tell a running desktop app to focus and (optionally) switch to a project.
 *  Resolves true if a listening app received the message, false otherwise.
 *  The CLI uses the result to decide whether to spawn Electron itself. */
export function openInDesktop(payload: { root: string | null }): Promise<boolean> {
  return send({ type: "open", root: payload.root });
}
