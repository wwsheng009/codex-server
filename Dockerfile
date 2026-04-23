# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /src/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build && npm run i18n:check

FROM golang:1.24-bookworm AS backend-builder
ARG CODEX_SERVER_BUILD_VERSION=dev
ARG CODEX_SERVER_BUILD_COMMIT=unknown
ARG CODEX_SERVER_BUILD_TIME=

WORKDIR /src

COPY backend/go.mod backend/go.sum ./backend/
RUN cd backend && go mod download

COPY backend/ ./backend/
COPY --from=frontend-builder /src/frontend/dist ./frontend/dist

RUN set -eux; \
    build_time="${CODEX_SERVER_BUILD_TIME}"; \
    if [ -z "$build_time" ]; then \
      build_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"; \
    fi; \
    rm -rf ./backend/internal/webui/dist; \
    mkdir -p ./backend/internal/webui/dist; \
    cp -a ./frontend/dist/. ./backend/internal/webui/dist/; \
    cd ./backend; \
    go build -trimpath -tags embed_frontend \
      -ldflags "-X codex-server/backend/internal/buildinfo.Version=${CODEX_SERVER_BUILD_VERSION} -X codex-server/backend/internal/buildinfo.Commit=${CODEX_SERVER_BUILD_COMMIT} -X codex-server/backend/internal/buildinfo.BuildTime=${build_time}" \
      -o ./bin/codex-server-embedded ./cmd/server

FROM node:22-bookworm-slim AS runtime
WORKDIR /workspace

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends bash ca-certificates curl git; \
    npm install -g @openai/codex; \
    rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /src/backend/bin/codex-server-embedded /usr/local/bin/codex-server

ENV CODEX_SERVER_ADDR=0.0.0.0:18080 \
    CODEX_SERVER_STORE_PATH=/data/metadata.json \
    CODEX_SERVER_PUBLIC_BASE_URL=http://localhost:18080 \
    CODEX_SERVER_ALLOW_REMOTE_ACCESS=true

EXPOSE 18080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:18080/healthz || exit 1

CMD ["codex-server"]
