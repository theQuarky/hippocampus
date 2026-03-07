# ── Stage 1: builder ────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Rebuild native modules against the runtime node version
RUN npm rebuild better-sqlite3

COPY --from=builder /app/dist ./dist
COPY src/proto ./dist/proto

# Data volume — SQLite db lives here
VOLUME ["/app/data"]

# Ports
EXPOSE 50051
EXPOSE 3001

# Environment defaults
ENV NODE_ENV=production
ENV GRPC_PORT=50051
ENV HTTP_PORT=3001
ENV OLLAMA_CONCURRENCY=8
ENV CHUNK_STRATEGY=fast

# Model cache — transformers downloads go here, mount for persistence
ENV TRANSFORMERS_CACHE=/app/models
VOLUME ["/app/models"]

# Default: run server. Override CMD for CLI:
#   docker run hippocampus dist/index.js ingest /uploads/file.pdf
ENTRYPOINT ["node"]
CMD ["dist/server.js"]
