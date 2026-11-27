# syntax=docker/dockerfile:1
#
# Coolify / Railway Docker deploy:
#   Build context: apps/gateway  (or repo root with Dockerfile path apps/gateway/Dockerfile)
#   Port: 8787
#
# Local:
#   docker build -t vectra-gateway ./apps/gateway
#   docker run --env-file apps/gateway/.env -p 8787:8787 vectra-gateway

# The vectrabot workspace host the gateway installs in each Supercharge
# sandbox, built from a pinned public commit (git checks the content hash).
# The gateway uses /app/sandbox-host when VECTRABOT_HOST_BINARY/URL are unset.
FROM golang:1.23-alpine AS host

ARG VECTRABOT_REPO=https://github.com/supercharge-cli/vectrabot.git
ARG VECTRABOT_SHA=c709742ae10788df4bd35d34764998f4474c43c6

RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git init -q . \
  && git fetch -q --depth 1 "$VECTRABOT_REPO" "$VECTRABOT_SHA" \
  && git checkout -q FETCH_HEAD \
  && test "$(git rev-parse HEAD)" = "$VECTRABOT_SHA"
WORKDIR /src/backend
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o /out/sandbox-host . \
  && sha256sum /out/sandbox-host

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
COPY --from=host /out/sandbox-host /app/sandbox-host

RUN mkdir -p /var/lib/vectra-gateway/lifecycle && chown -R node:node /app /var/lib/vectra-gateway

ENV VECTRA_LIFECYCLE_STATE_DIR=/var/lib/vectra-gateway/lifecycle
VOLUME /var/lib/vectra-gateway

USER node

EXPOSE 8787

ENV PORT=8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
