#!/bin/sh
# Production `writ` launcher. Lives at <install-dir>/bin/writ inside the
# packaged app (e.g. /opt/writ/bin/writ for pacman). A package install hook
# symlinks /usr/bin/writ → here so the binary is on PATH.
#
# Always forwards through Electron-as-Node to the bundled CLI; the CLI's own
# argv dispatch (src/cli/index.ts) decides between bare `writ` (launch the
# desktop app) and the commander subcommands.

set -e

# Resolve through the /usr/bin/writ symlink so we find the real install dir.
RESOLVED="$(readlink -f "$0")"
APP_DIR="$(cd -- "$(dirname -- "$RESOLVED")/.." && pwd)"
ELECTRON="$APP_DIR/writ"
ASAR="$APP_DIR/resources/app.asar"
# The CLI bundle lives inside app.asar at this path. ELECTRON_RUN_AS_NODE
# resolves asar paths via Electron's patched fs, so we pass the virtual
# path through verbatim — shell `test` can't peek inside the archive.
CLI_JS="$ASAR/out/cli/index.js"

if [ ! -x "$ELECTRON" ]; then
  echo "writ: Electron binary not found at $ELECTRON" >&2
  exit 1
fi
if [ ! -f "$ASAR" ]; then
  echo "writ: app.asar not found at $ASAR" >&2
  exit 1
fi

exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI_JS" "$@"
