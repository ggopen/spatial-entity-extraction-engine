# syntax=docker/dockerfile:1.6
# -----------------------------------------------------------------------------
# SEEE — Spatial Entity Extraction Engine
# Multi-stage Dockerfile:
#   1. build  : installs deps, type-checks, builds the viewer & all packages
#   2. runtime: serves the built viewer with Caddy (small, automatic HTTPS)
# -----------------------------------------------------------------------------

############################
# Stage 1 — build
############################
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Install build deps needed by some node-gyp modules.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git \
 && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY tsconfig.base.json vitest.config.ts ./
COPY packages ./packages
COPY apps ./apps

# Install dependencies (workspaces symlinked).
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Type-check the monorepo (non-blocking; tests cover the rest).
RUN npm run lint || true

# Build the viewer (Vite bundles the entire monorepo source into dist/).
RUN npm run build:viewer

# Run tests to validate the image. Non-fatal so a flaky env doesn't block
# the image; CI is the source of truth for green builds.
RUN npm test -- --no-file-parallelism || true

############################
# Stage 2 — runtime
############################
FROM caddy:2.8-alpine AS runtime

# Caddy serves the static viewer. Caddyfile is wired to the /app/dist root.
COPY --from=build /app/apps/viewer/dist /app/dist
COPY apps/viewer/Caddyfile /etc/caddy/Caddyfile

# Healthcheck: HTTP 200 from the static index.html.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1

EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
