# Shared post-install body for the pacman and deb targets. fpm wraps it
# into the format-specific install hook (pacman's .INSTALL post_install()
# function, or Debian's postinst), so the same body runs on install and
# on every upgrade.
#
# Creates a /usr/bin/writ symlink to the launcher shipped inside the
# package. The launcher itself (build/writ-launcher.sh, installed at
# /opt/writ/bin/writ) handles the Electron-as-Node dispatch.

ln -sf /opt/writ/bin/writ /usr/bin/writ
