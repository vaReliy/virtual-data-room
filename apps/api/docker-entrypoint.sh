#!/bin/sh
#
# Migrate, then become the server.
#
# Decision #22 makes a deploy the ONLY migration mechanism: there is no manual step
# against Neon. Two consequences are load-bearing here.
#
# First, the retries. A fresh Neon compute is suspended and takes a few seconds to wake,
# and Cloud Run starts a revision the instant the image is available, so the first
# connection attempt losing the race is the normal case, not a fault. Backing off and
# retrying turns that into a slower start instead of a failed deploy.
#
# Second, the bound. Retrying forever would turn a genuinely wrong DATABASE_URL into a
# container that never starts and never says why — Cloud Run would keep failing the
# startup probe while the logs showed only "retrying". Five attempts over ~1 minute is
# long enough for a cold database and short enough to fail loudly.
#
# `exec` on the last line matters: it replaces this shell with node, so node inherits
# PID 1's signal delivery from tini rather than sitting behind a shell that forwards
# nothing.

set -eu

MAX_ATTEMPTS=5
delay=2
attempt=1

while : ; do
  if pnpm_out=$(./node_modules/.bin/prisma migrate deploy 2>&1); then
    echo "$pnpm_out"
    echo "entrypoint: migrations applied"
    break
  fi

  echo "$pnpm_out" >&2

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "entrypoint: migrations failed after ${MAX_ATTEMPTS} attempts, giving up" >&2
    exit 1
  fi

  echo "entrypoint: migration attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${delay}s" >&2
  sleep "$delay"
  delay=$((delay * 2))
  attempt=$((attempt + 1))
done

echo "entrypoint: starting API"
exec node dist/main.js
