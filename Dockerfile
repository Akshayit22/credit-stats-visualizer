# syntax=docker/dockerfile:1
#
# One image, one service: the NestJS API, which also serves the built React
# app from the same origin. That is how Render runs it — a single free web
# service, one URL, first-party session cookie, no proxy between the two.
#
#   docker build -t cred-stats .
#   docker compose --profile app up --build      (with the local MongoDB)

# ── build ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# Manifests first, so this layer is cached until a dependency changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# The in-memory MongoDB is for tests only; never download its binary here.
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm ci --no-audit --no-fund

COPY shared shared
COPY backend backend
COPY frontend frontend
RUN npm run build -w @cred-stats/shared \
 && npm run build -w @cred-stats/backend \
 && npm run build -w @cred-stats/frontend

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    CRED_STATS_WEB_DIR=/app/frontend/dist

# Production dependencies of the API only; the frontend ships as static files.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --no-audit --no-fund \
      --workspace @cred-stats/shared --workspace @cred-stats/backend \
 && npm cache clean --force

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

USER node
EXPOSE 4000

# /api/health answers 503 until MongoDB is reachable, so this is a readiness
# gate and not just a liveness ping.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "backend/dist/main.js"]
