# Body of pacman's post_install / post_upgrade hook. fpm wraps this into
# the .INSTALL file inside the .pkg.tar.zst so pacman runs it on install
# and on every upgrade.
#
# Creates a /usr/bin/writ symlink to the launcher shipped inside the
# package. The launcher itself (build/writ-launcher.sh, installed at
# /opt/writ/bin/writ) handles the Electron-as-Node dispatch.

ln -sf /opt/writ/bin/writ /usr/bin/writ
