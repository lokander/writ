import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

// Hybrid B (design.md): after a successful write, the CLI / MCP server fires a
// fire-and-forget message at the desktop app's socket so an open UI refreshes
// immediately. The app falls back to fs.watch on the DB so correctness never
// depends on the ping landing.

const SOCKET_NAME = "app.sock";
const PIPE_NAME = "writ-app";
const PING_TIMEOUT_MS = 250;

export interface PingPayload {
  /** Absolute project root (the dir containing `.writ/`). The desktop app
   *  filters incoming pings by this so a ping for project A doesn't refresh
   *  a window viewing project B. */
  root: string;
}

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

/** Best-effort one-shot notification. Resolves when the message has been
 *  flushed, the socket fails (no listener, refused, timed out), or the timeout
 *  fires — never rejects. Callers can `await` if they want bounded latency or
 *  drop the promise on the floor.
 *
 *  The socket is `unref`d so a pending ping never blocks process exit — the
 *  CLI can finish its command and exit immediately while any in-flight
 *  connect/write is dropped. The only cost is "ping not delivered" in the
 *  rare case the process exits faster than the connect resolves, which is
 *  exactly the fs.watch-fallback case the design accepts. */
export function pingDesktopApp(payload: PingPayload): Promise<void> {
  return new Promise<void>((resolve) => {
    const sockPath = getDesktopSocketPath();
    const sock = net.connect(sockPath);
    sock.unref();
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve();
    };
    sock.setTimeout(PING_TIMEOUT_MS);
    sock.once("connect", () => {
      sock.end(JSON.stringify(payload) + "\n", done);
    });
    sock.once("error", done);
    sock.once("timeout", done);
  });
}
