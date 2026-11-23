#!/usr/bin/env bash
# Staging auto-update. If `main` on GitHub moved, it moves the staging checkout to it and
# rebuilds the app container. Otherwise it does nothing. Staging only: never point this at a
# production checkout.
#
# The server does NOT run this file from the checkout. Since 2026-11-23 cron runs a pinned copy,
# owned by root, in /opt/apolles-staging-deploy/ (with the pinned docker-compose.yml), so that no
# commit on main can change how the server runs staging. This file is the reviewed source of that
# copy: the owner reviews a change here and then copies it to /opt by hand. Editing it in the
# repo, or merging a change to it, does not change the server (README section 5).
#
# Safe by design:
# - One run at a time (flock). A run that finds another one still building just exits.
# - The checkout follows origin/main exactly. Local changes to tracked files make git refuse,
#   and the run stops with an error in the log instead of discarding them.
# - If the build fails, `docker compose up --build` keeps the old container running. Each
#   commit is tried once: a failed one is noted (the "failed" file) and not retried every
#   5 minutes, which would load the shared server. The next commit on main is tried as usual.
#   To retry the same commit by hand, delete the failed file.
# - The whole script sits inside main(), so bash has read all of it before git replaces
#   this file with a newer version.
set -euo pipefail

main() {
  local repo="${APOLLES_STAGING_DIR:-/home/moshezbusy/apolles-staging}"
  local lock="${APOLLES_STAGING_LOCK:-/tmp/apolles-staging-update.lock}"
  local deployed_file="${APOLLES_STAGING_DEPLOYED:-$HOME/.apolles-staging-deployed}"
  local failed_file="${APOLLES_STAGING_FAILED:-$HOME/.apolles-staging-failed}"

  exec 9>"$lock"
  flock -n 9 || exit 0

  cd "$repo"
  git fetch --quiet origin main

  local deployed target
  deployed="$(cat "$deployed_file" 2>/dev/null || echo none)"
  target="$(git rev-parse origin/main)"
  [ "$deployed" = "$target" ] && exit 0
  [ "$(cat "$failed_file" 2>/dev/null)" = "$target" ] && exit 0

  echo "$(date -Is) updating staging ${deployed:0:7} -> ${target:0:7}"
  git checkout --quiet -B main origin/main

  cd deploy/staging
  if docker compose -p apolles-staging up -d --build; then
    echo "$target" > "$deployed_file"
    echo "$(date -Is) staging is now at ${target:0:7}"
  else
    echo "$target" > "$failed_file"
    echo "$(date -Is) BUILD FAILED for ${target:0:7}; the previous version keeps running"
    exit 1
  fi
}

main "$@"
