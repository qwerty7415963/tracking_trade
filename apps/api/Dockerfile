# API image: Node 24 slim (Debian) + Chromium, because the API now hosts the
# card-render worker (Playwright/Chromium cannot run on Alpine/musl).
# Record the base digest at build time (docker images --digests).
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS builder

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
# NOTE: keep dev deps (incl. prisma CLI for `migrate deploy` one-offs).
RUN npm run build
RUN npx playwright install --with-deps chromium

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runner
RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/package.json ./package.json
# Workspace symlinks (node_modules/@tracking-auto/* -> ../packages/*)
# need real package dirs with built dist behind them.
COPY --from=builder --chown=app:app /app/packages/card-renderer/dist ./packages/card-renderer/dist
COPY --from=builder --chown=app:app /app/packages/card-renderer/package.json ./packages/card-renderer/package.json
COPY --from=builder --chown=app:app /app/packages/connectors/dist ./packages/connectors/dist
COPY --from=builder --chown=app:app /app/packages/connectors/package.json ./packages/connectors/package.json
COPY --from=builder --chown=app:app /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=app:app /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder --chown=app:app /app/packages/domain/dist ./packages/domain/dist
COPY --from=builder --chown=app:app /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=builder --chown=app:app /app/packages/market-data/dist ./packages/market-data/dist
COPY --from=builder --chown=app:app /app/packages/market-data/package.json ./packages/market-data/package.json
COPY --from=builder --chown=app:app /app/packages/reporting/dist ./packages/reporting/dist
COPY --from=builder --chown=app:app /app/packages/reporting/package.json ./packages/reporting/package.json
COPY --from=builder --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
# Chromium needs system libs installed as root, then the browser cache.
RUN npx --no-install playwright install-deps chromium
COPY --from=builder /root/.cache/ms-playwright /home/app/.cache/ms-playwright
RUN chown -R app:app /home/app/.cache \
  && mkdir -p /data/artifacts && chown app:app /data/artifacts
ENV PLAYWRIGHT_BROWSERS_PATH=/home/app/.cache/ms-playwright
ENV ARTIFACTS_DIR=/data/artifacts
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/api/src/main.js"]
