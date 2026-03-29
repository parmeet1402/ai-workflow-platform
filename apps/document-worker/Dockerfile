# Build from monorepo root:
#   docker build -f apps/document-worker/Dockerfile .
#
# Requires root package.json, pnpm-lock.yaml, pnpm-workspace.yaml, and apps/document-worker.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/document-worker/package.json ./apps/document-worker/

RUN pnpm install --frozen-lockfile --filter document-worker...

COPY apps/document-worker ./apps/document-worker

RUN pnpm --filter document-worker build

WORKDIR /app/apps/document-worker
CMD ["node", "dist/index.js"]
