# Body of pacman's pre_remove hook. Cleans up the /usr/bin/writ symlink
# the post_install hook created — but only if it still points where we
# expect, so a user-managed override at the same path isn't clobbered.

if [ -L /usr/bin/writ ] && [ "$(readlink /usr/bin/writ)" = "/opt/writ/bin/writ" ]; then
  rm -f /usr/bin/writ
fi
