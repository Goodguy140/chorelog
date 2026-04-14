# =============================================================================
# Chorelog — production image (build from a local clone of the repo)
#
# Build:
#   docker build -t chorelog:latest .
#
# Run (see docker-compose.yml). For TrueNAS + always pull latest from public GitHub
# and restart when the repo changes, use Dockerfile.autopull and docker-compose.autopull.yml.
#
# Secrets (CHORELOG_SECRET, passwords, etc.) are NEVER baked into this Dockerfile — pass at runtime
# via compose, Kubernetes secrets, or TrueNAS app environment UI.
# Web Push VAPID keys: optional. If CHORELOG_VAPID_PUBLIC_KEY/PRIVATE_KEY are unset, entrypoint generates
# once and writes data/vapid-keys.env on the persisted volume (see docker/ensure-vapid.sh).
# =============================================================================

FROM node:22-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Application source (static files, server, client JS, locales)
COPY . .

RUN chmod +x docker/ensure-vapid.sh docker/entrypoint.sh

# Persisted JSON store lives here — must be a volume on TrueNAS / production
RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "server.js"]
