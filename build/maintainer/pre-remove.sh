# Shared pre-remove body for the pacman and deb targets. fpm wraps it
# into the format-specific uninstall hook (pacman's .INSTALL pre_remove()
# function, or Debian's prerm). Cleans up the /usr/bin/writ symlink the
# post-install hook created — but only if it still points where we
# expect, so a user-managed override at the same path isn't clobbered.

if [ -L /usr/bin/writ ] && [ "$(readlink /usr/bin/writ)" = "/opt/writ/bin/writ" ]; then
  rm -f /usr/bin/writ
fi
