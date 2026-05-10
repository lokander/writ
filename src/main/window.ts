import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import { is } from "@electron-toolkit/utils";

import icon from "../../resources/icon.png?asset";

// Schemes we're willing to hand off to the OS via shell.openExternal. http(s)
// covers ordinary URLs; mailto for contact addresses pasted into descriptions.
// Everything else (file:, javascript:, custom protocols, garbage) is denied.
const ALLOWED_EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    // Malformed URL — refuse.
    return false;
  }
}

export function focusMainWindow(): void {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length === 0) return;
  const win = wins[0]!;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  // External-link handling. markdown-it's link_open override (lib/markdown.ts)
  // adds target="_blank" rel=noopener to every rendered <a>, so clicks fire
  // window.open semantics and land here. We hand off to the OS browser and
  // deny the in-renderer new window.
  //
  // will-navigate is the belt-and-suspenders for anything that somehow
  // bypasses target=_blank (a future bug, an injected link, etc.) — it
  // catches plain navigation attempts that wouldn't trigger the open-handler.
  //
  // Both gates limit themselves to a small allow-list of schemes. javascript:
  // and data: are already filtered by markdown-it's default validateLink, but
  // any other source of links should still be safe.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    // The renderer never navigates internally (single-page app), so any
    // navigation attempt is an external link click. Block it and route to
    // the OS browser if the scheme is allowed.
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
