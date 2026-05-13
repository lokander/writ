// electron-builder afterPack hook. Drops a custom AppRun into appOutDir
// when AppImage is among the targets. The default electron-builder AppRun
// would exec the Electron binary directly and skip our CLI dispatch; ours
// delegates to bin/writ instead so `./writ-*.AppImage task list` works.
//
// appOutDir is the unpacked-app directory (e.g. dist/linux-unpacked) that
// every linux target copies from. When AppImage stages the build it copies
// appOutDir into the stage AFTER writing its generated AppRun, so a file
// named AppRun in appOutDir overwrites the default — exactly what we want.
//
// Side effect: pacman / deb builds also pick up the file at
// /opt/writ/AppRun. It's dead weight there (never executed) but harmless
// and < 1KB.

import { chmod, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), "maintainer", "appimage-AppRun.sh");

export default async function afterPack(context) {
  const { electronPlatformName, appOutDir, targets } = context;
  if (electronPlatformName !== "linux") return;
  const wantsAppImage = (targets ?? []).some((target) => target.name?.toLowerCase() === "appimage");
  if (!wantsAppImage) return;

  const dest = join(appOutDir, "AppRun");
  await copyFile(SOURCE, dest);
  await chmod(dest, 0o755);
}
