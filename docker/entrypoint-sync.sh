#!/bin/sh
# Runtime: keep /app in sync with a public GitHub repo and restart Node when HEAD changes.
# Requires: GIT_REPO (https://github.com/OWNER/REPO.git). Optional: GIT_BRANCH, SYNC_INTERVAL.

set -eu

GIT_REPO="${GIT_REPO:?Set GIT_REPO to the public clone URL (e.g. https://github.com/your-org/chorelog.git)}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SYNC_INTERVAL="${SYNC_INTERVAL:-300}"

cd /app

sync_repo() {
  if [ ! -d .git ]; then
    echo "entrypoint-sync: cloning ${GIT_REPO} (branch ${GIT_BRANCH})"
    git clone --depth 1 -b "${GIT_BRANCH}" "${GIT_REPO}" .
  else
    git remote set-url origin "${GIT_REPO}" 2>/dev/null || git remote add origin "${GIT_REPO}"
    git fetch origin
    git reset --hard "origin/${GIT_BRANCH}"
  fi
}

install_deps() {
  su-exec node sh -c 'cd /app && npm ci --omit=dev && npm cache clean --force'
}

mkdir -p /app
sync_repo
install_deps
mkdir -p /app/data
chmod +x /app/docker/ensure-vapid.sh 2>/dev/null || true
chown -R node:node /app

run_node() {
  su-exec node sh -c 'cd /app && . docker/ensure-vapid.sh && exec node server.js' &
  echo $!
}

echo "entrypoint-sync: starting server (sync every ${SYNC_INTERVAL}s)"
SERVER_PID="$(run_node)"

trap 'kill "$SERVER_PID" 2>/dev/null; exit 0' TERM INT

while :; do
  sleep "${SYNC_INTERVAL}" || exit 0
  cd /app
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "entrypoint-sync: restarting Node (process exited)"
    SERVER_PID="$(run_node)"
    trap 'kill "$SERVER_PID" 2>/dev/null; exit 0' TERM INT
  fi
  OLD="$(git rev-parse HEAD)"
  git fetch origin || continue
  git reset --hard "origin/${GIT_BRANCH}"
  NEW="$(git rev-parse HEAD)"
  if [ "${OLD}" = "${NEW}" ]; then
    continue
  fi
  echo "entrypoint-sync: pulled ${OLD} -> ${NEW}"
  if git diff --name-only "${OLD}" "${NEW}" | grep -E '^package(-lock)?\.json$' >/dev/null 2>&1; then
    install_deps
    chown -R node:node /app
  fi
  kill "${SERVER_PID}" 2>/dev/null || true
  wait "${SERVER_PID}" 2>/dev/null || true
  SERVER_PID="$(run_node)"
  trap 'kill "$SERVER_PID" 2>/dev/null; exit 0' TERM INT
done
