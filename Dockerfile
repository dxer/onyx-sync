# syntax=docker/dockerfile:1
# ============================================
# Onyx Sync Server — Alpine 3-stage build
#   deps    : prod-only node_modules (musl-native better-sqlite3)
#   builder : full toolchain, compiles shared + server
#   runner  : minimal node:22-alpine + tini
# ============================================

# ---- Stage 1: production dependencies (built once, reused by runner) ----
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++ \
    && corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json shared/package.json

RUN pnpm install --prod --frozen-lockfile

# ---- Stage 2: build ----
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++ \
    && corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY shared/package.json shared/package.json

RUN pnpm install --frozen-lockfile

COPY shared shared
RUN pnpm --filter=@onyx/shared build

COPY src src
RUN pnpm build:node

# ---- Stage 3: minimal runtime ----
FROM node:22-alpine AS runner
# tini: correct PID-1 signal handling (fast shutdown, zombie reaping)
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/sync.db \
    STORAGE_TYPE=local \
    STORAGE_LOCAL_DIR=/data/blobs

RUN mkdir -p /data/blobs

# prod node_modules (musl-native) + shared dist + compiled server
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/shared shared
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/dist/node dist/node

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/v1/readyz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/node/entry-node.js"]
