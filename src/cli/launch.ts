import { spawn } from "node:child_process";

import { openInDesktop } from "../shared/desktop-ping";
import { findProjectRoot } from "../shared/domain/project";

/** Bare `writ` (no subcommand) launches or focuses the desktop app on the
 *  cwd-resolved project. If a desktop instance is already running, we send
 *  it an "open" message over the same socket the live-update pings use; the
 *  app focuses + switches projects without paying Chromium boot cost. If no
 *  app is running, we spawn the Electron binary detached so the CLI can exit
 *  while the GUI takes over. */
export async function launchDesktop(): Promise<void> {
  const root = findProjectRoot(process.cwd());

  const focused = await openInDesktop({ root });
  if (focused) return;

  spawnDesktopApp(root);
}

function spawnDesktopApp(root: string | null): void {
  // Strip ELECTRON_RUN_AS_NODE so the spawned process boots Electron in GUI
  // mode rather than re-running the CLI under itself.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // Pin the cwd to the resolved project root if we have one, so main's boot
  // path (`findProjectRoot(process.cwd())`) opens the project the user
  // typed `writ` in — even if their shell cwd was a subdir.
  const cwd = root ?? process.cwd();

  // AppImage case: the squashfs mount is owned by the AppImage runtime
  // process tree, and tears down as soon as AppRun (our parent) exits. A
  // detached spawn of process.execPath would lose its filesystem before
  // Electron finishes booting. Re-exec the AppImage itself, detached, with
  // a marker the AppRun checks (see build/maintainer/appimage-AppRun.sh)
  // to skip the CLI and exec Electron directly — the new instance owns
  // its own mount, which stays alive as long as the GUI does.
  if (process.env.APPIMAGE && !process.env.WRIT_APPIMAGE_DESKTOP) {
    const child = spawn(process.env.APPIMAGE, [], {
      detached: true,
      stdio: "ignore",
      env: { ...env, WRIT_APPIMAGE_DESKTOP: "1" },
      cwd,
    });
    child.unref();
    return;
  }

  // In dev, `process.execPath` is `<repo>/node_modules/electron/dist/electron`,
  // and Electron with no args has no app to run. Pointing it at the repo root
  // makes it pick up the built `out/main/index.js` from package.json's `main`
  // field (so `npm run build` is a prerequisite for the dev path). In a
  // packaged build, electron-builder's resources layout makes the bare
  // `process.execPath` find the bundled app on its own — no arg needed.
  const args: string[] = [];
  const devAppDir = findDevAppDir();
  if (devAppDir) args.push(devAppDir);

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env,
    cwd,
  });
  child.unref();
}

/** Dev detection by `process.execPath` shape. Returns the repo root in dev,
 *  null in a packaged build. */
function findDevAppDir(): string | null {
  const m = /^(.+?)[\\/]node_modules[\\/]electron[\\/]dist[\\/]electron(?:\.exe)?$/.exec(
    process.execPath,
  );
  return m ? m[1]! : null;
}
