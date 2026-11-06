#!/bin/sh
# Linux: keep the computer from sleeping while it's plugged in, like `caffeinate -s` on a Mac (scripts/setup.sh awake on
# runs this as a systemd user service). The screen still turns off. A computer with no battery counts as plugged in.
plugged() {
  mains=0
  for d in /sys/class/power_supply/*; do
    [ -r "$d/type" ] && [ "$(cat "$d/type")" = Mains ] || continue
    mains=1; [ "$(cat "$d/online" 2>/dev/null)" = 1 ] && return 0
  done
  [ $mains = 0 ] # no charger listed: a desktop or a server
}
while :; do
  # not allowed (polkit: a background service needs the rule scripts/setup.sh awake on prints): wait, don't spin
  if plugged; then systemd-inhibit --what=sleep:idle --who=Gubernos --why="Gubernos stays reachable from your phone" --mode=block sleep 120 || sleep 60
  else sleep 60; fi
done
