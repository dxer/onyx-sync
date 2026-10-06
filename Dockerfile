# Multi-stage Dockerfile for lightweight VPS deployment (Onyx Sync)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY shared ./shared

RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter=@onyx/shared build
RUN pnpm build:node

# Production Image
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/sync.db
ENV STORAGE_TYPE=local
ENV STORAGE_LOCAL_DIR=/data/blobs

RUN mkdir -p /data/blobs

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 8080
VOLUME ["/data"]

CMD ["node", "dist/node/entry-node.js"]
