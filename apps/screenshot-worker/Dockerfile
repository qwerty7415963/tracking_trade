# Render/publish worker image: Debian slim (Playwright Chromium needs apt deps).
FROM node:22-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/screenshot-worker/package.json apps/screenshot-worker/package.json
COPY packages/card-renderer/package.json packages/card-renderer/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/market-data/package.json packages/market-data/package.json
COPY packages/reporting/package.json packages/reporting/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.*.json jest.config.cjs ./
COPY apps apps
COPY packages packages
# NOTE: keep dev deps (see api/Dockerfile).
RUN npm run build
RUN npx playwright install --with-deps chromium

FROM node:22-slim AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/card-renderer/dist ./packages/card-renderer/dist
COPY --from=builder /app/packages/card-renderer/package.json ./packages/card-renderer/package.json
COPY --from=builder /app/packages/connectors/dist ./packages/connectors/dist
COPY --from=builder /app/packages/connectors/package.json ./packages/connectors/package.json
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist
COPY --from=builder /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder /app/packages/market-data/dist ./packages/market-data/dist
COPY --from=builder /app/packages/market-data/package.json ./packages/market-data/package.json
COPY --from=builder /app/packages/reporting/dist ./packages/reporting/dist
COPY --from=builder /app/packages/reporting/package.json ./packages/reporting/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
RUN npx --no-install playwright install-deps chromium
COPY --from=builder /root/.cache/ms-playwright /home/app/.cache/ms-playwright
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/package.json ./package.json
RUN addgroup --system app && adduser --system --ingroup app app \
  && chown -R app:app /home/app/.cache \
  && mkdir -p /data/artifacts && chown app:app /data/artifacts
ENV PLAYWRIGHT_BROWSERS_PATH=/home/app/.cache/ms-playwright
ENV ARTIFACTS_DIR=/data/artifacts
USER app
CMD ["node", "dist/apps/screenshot-worker/src/main.js"]

