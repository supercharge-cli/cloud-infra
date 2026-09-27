# syntax=docker/dockerfile:1
#
# Coolify / Railway Docker deploy:
#   Build context: apps/gateway  (or repo root with Dockerfile path apps/gateway/Dockerfile)
#   Port: 8787
#
# Local:
#   docker build -t vectra-gateway ./apps/gateway
#   docker run --env-file apps/gateway/.env -p 8787:8787 vectra-gateway

FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install && npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p /var/lib/vectra-gateway/lifecycle && chown -R node:node /app /var/lib/vectra-gateway

ENV VECTRA_LIFECYCLE_STATE_DIR=/var/lib/vectra-gateway/lifecycle
VOLUME /var/lib/vectra-gateway

USER node

EXPOSE 8787

ENV PORT=8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
