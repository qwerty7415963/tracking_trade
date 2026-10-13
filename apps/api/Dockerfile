# API image: Node 22 alpine, non-root, production deps only.
# Record the base digest at build time (docker images --digests).
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/screenshot-worker/package.json apps/screenshot-worker/package.json
COPY packages/card-renderer/package.json packages/card-renderer/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/mt5-bridge-contract/package.json packages/mt5-bridge-contract/package.json
COPY packages/reporting/package.json packages/reporting/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.*.json jest.config.cjs ./
COPY apps apps
COPY packages packages
# NOTE: keep dev deps (incl. prisma CLI for `migrate deploy` one-offs).
# Slimming the runner (prune + prisma reinstall) is a later optimization.
RUN npm run build

FROM node:22-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
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
COPY --from=builder --chown=app:app /app/packages/mt5-bridge-contract/dist ./packages/mt5-bridge-contract/dist
COPY --from=builder --chown=app:app /app/packages/mt5-bridge-contract/package.json ./packages/mt5-bridge-contract/package.json
COPY --from=builder --chown=app:app /app/packages/reporting/dist ./packages/reporting/dist
COPY --from=builder --chown=app:app /app/packages/reporting/package.json ./packages/reporting/package.json
COPY --from=builder --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/api/src/main.js"]
