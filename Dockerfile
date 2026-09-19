# syntax=docker/dockerfile:1
#
# Node 22, not 20. The AWS SDK v3 warns on every boot that releases after the
# first week of January 2027 will require node >= 22, and this app's only data
# store is reached through that SDK — shipping on a runtime that stops getting
# its security updates in three months is not worth the spec fidelity.
# package.json still declares `engines: node >= 20`, so local development on 20
# keeps working; it is the image that moves.

# ── deps ────────────────────────────────────────────────────────────────────
# Only the manifests and the one postinstall script, so this layer is cached
# until a dependency actually changes.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-pdf-worker.mjs ./scripts/
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Re-run explicitly: .dockerignore keeps the host's copy out, and the worker
# must be the exact version pdfjs-dist in this image expects.
RUN node scripts/copy-pdf-worker.mjs && npm run build

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# `standalone` carries its own pruned node_modules and server.js.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# /api/health answers 503 until the five tables exist, so this is a real
# readiness gate and not just a liveness ping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
