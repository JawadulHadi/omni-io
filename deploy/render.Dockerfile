# Single-container image for hosts that run one service, such as Render's free plan:
# the API serves the console from the same origin and runs the ingestion worker
# in-process. Postgres (pgvector >= 0.8) and Redis are external, e.g. Neon and Redis Cloud.
FROM node:24-alpine AS backend
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json backend/tsconfig.build.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    RUN_WORKER_IN_PROCESS=true \
    DB_POOL_MAX=5 \
    PDF_MAX_HEAP_MB=128 \
    PDF_MAX_PARALLEL=1 \
    PDF_TIMEOUT_MS=120000 \
    NODE_OPTIONS=--max-old-space-size=320
WORKDIR /app
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=frontend /app/dist ./public
COPY backend/package.json ./
COPY backend/migrations ./migrations
COPY deploy/render-start.sh ./start.sh
USER node
EXPOSE 10000
CMD ["sh", "start.sh"]
