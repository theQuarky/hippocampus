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
# CUDA 12.2 base — matches onnxruntime-node's bundled CUDA provider exactly
# This solves the libcufft/libcublasLt version mismatch on bare metal Arch
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS runtime

WORKDIR /app

# Install Node.js 22 + build tools for native modules
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    make \
    g++ \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install @huggingface/transformers

# Rebuild native modules (better-sqlite3) against this Node version
RUN npm rebuild better-sqlite3

COPY --from=builder /app/dist ./dist
COPY src/proto ./dist/proto

# Volumes
VOLUME ["/app/data"]
VOLUME ["/app/models"]

# Ports
EXPOSE 50051
EXPOSE 3001

# Environment defaults
ENV NODE_ENV=production
ENV GRPC_PORT=50051
ENV HTTP_PORT=3001
ENV OLLAMA_CONCURRENCY=8
ENV CHUNK_STRATEGY=fast
ENV TRANSFORMERS_CACHE=/app/models

# Default: run server
# Override for CLI: docker run hippocampus dist/index.js ingest /uploads/file.pdf
ENTRYPOINT ["node"]
CMD ["dist/server.js"]