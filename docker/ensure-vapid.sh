#!/bin/sh
# Ensure Web Push VAPID keys exist: use CHORELOG_VAPID_* from the environment,
# or load / persist $DATA_DIR/vapid-keys.env (generated once). Intended for Docker entrypoints.
# Shellcheck: disable=SC1090,SC1091 — we control vapid-keys.env format

set -e

DATA_DIR="${DATA_DIR:-/app/data}"
VAPID_ENV="$DATA_DIR/vapid-keys.env"
export DATA_DIR

if [ -n "${CHORELOG_VAPID_PUBLIC_KEY:-}" ] && [ -n "${CHORELOG_VAPID_PRIVATE_KEY:-}" ]; then
  echo "chorelog: VAPID keys from environment"
elif [ -f "$VAPID_ENV" ]; then
  echo "chorelog: loading VAPID keys from $VAPID_ENV"
  set -a
  . "$VAPID_ENV"
  set +a
else
  echo "chorelog: generating VAPID keys (first run) -> $VAPID_ENV"
  mkdir -p "$DATA_DIR"
  (cd /app && node docker/generate-vapid-env.cjs "$VAPID_ENV")
  chmod 600 "$VAPID_ENV" 2>/dev/null || true
  set -a
  . "$VAPID_ENV"
  set +a
fi
