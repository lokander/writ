#!/bin/sh
# AppImage AppRun for writ. Injected into the AppImage staging dir by
# build/afterPack.cjs, replacing electron-builder's default AppRun (which
# would exec the Electron binary directly and bypass our CLI dispatch).
#
# Delegates to the same bin/writ launcher the pacman build ships at
# /opt/writ/bin/writ — inside the AppImage that script sits at
# $APPDIR/bin/writ, and src/cli/index.ts handles bare vs subcommand
# dispatch from there.
#
# To put `writ` on PATH from an AppImage: rename or symlink the
# downloaded .AppImage as `writ` somewhere on PATH (e.g. ~/.local/bin).
# Bare invocation launches the desktop app; subcommands run the CLI.

set -e

if [ -z "$APPDIR" ]; then
  APPDIR="$(dirname -- "$(readlink -f -- "$0")")"
fi

# Detached-desktop boot from a re-exec'd AppImage. See spawnDesktopApp in
# src/cli/launch.ts: the original AppImage instance can't spawn Electron
# detached because its squashfs mount tears down when AppRun exits. The
# CLI re-execs the AppImage with this env set; this branch skips the CLI
# bundle and exec's Electron directly so the new instance's mount is held
# open by the GUI process itself. Without this flag we'd loop forever
# (Electron-as-Node → CLI → launchDesktop → re-exec → CLI → …).
if [ "$WRIT_APPIMAGE_DESKTOP" = "1" ]; then
  unset WRIT_APPIMAGE_DESKTOP
  exec "$APPDIR/writ"
fi

# Strip --no-sandbox if present. electron-builder generates a .desktop file
# with `Exec=AppRun --no-sandbox %U`, so any AppImage desktop integration
# (AppImageLauncher, manual `gtk-launch`, etc.) passes that flag to us. The
# CLI bundle parses argv strictly via commander and would reject it as an
# unknown option, breaking the no-args → desktop dispatch.
i=0
n=$#
while [ "$i" -lt "$n" ]; do
  arg=$1
  shift
  if [ "$arg" != "--no-sandbox" ]; then
    set -- "$@" "$arg"
  fi
  i=$((i + 1))
done

exec "$APPDIR/bin/writ" "$@"
