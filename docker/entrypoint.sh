#!/bin/sh
# Docker production entrypoint: ensure VAPID keys, then start Node.
set -e
. /app/docker/ensure-vapid.sh
exec "$@"
