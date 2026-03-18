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

# Prune to production-only deps so we can copy node_modules to the runtime
# stage without needing any npm network access there.
RUN npm prune --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Layer 1: system packages + Node.js (cached independently)
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-eng \
    make \
    g++ \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Layer 2: Python venv + faster-whisper (cached independently)
RUN python3 -m venv /opt/whisper-venv \
    && /opt/whisper-venv/bin/python -m pip install --upgrade pip \
    && /opt/whisper-venv/bin/pip install faster-whisper

# Layer 3: piper standalone binary (cached independently)
RUN curl -L https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    | tar xz -C /usr/local/lib \
    && ln -s /usr/local/lib/piper/piper /usr/local/bin/piper

COPY package*.json ./
# Copy pre-pruned node_modules from builder — no npm network access needed here.
COPY --from=builder /app/node_modules ./node_modules

# Rebuild native modules (better-sqlite3) against this Node version / glibc
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
# Point audio code to the venv binaries
ENV WHISPER_PYTHON=/opt/whisper-venv/bin/python
ENV PIPER_BIN=/usr/local/bin/piper

# Default: run server
ENTRYPOINT ["node"]
CMD ["dist/server/index.js"]