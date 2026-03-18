# 🧠 Hippocampus

Hippocampus is a **local AI memory system** — like Google NotebookLM, but private, offline,
and open source. Ingest documents, audio, images, and video; then query your personal
knowledge base using natural language.

Everything runs on your machine. No cloud. No API keys.

---

## Features

- **Multi-modal ingestion** — PDF, DOCX, HTML, URLs, audio (Whisper transcription), images (vision LLM), video (keyframe extraction + captioning)
- **Local embeddings** — `nomic-embed-text-v1` (768d) via `@xenova/transformers`, CPU-only
- **Hybrid retrieval** — vector search (Qdrant) + graph traversal (SQLite) + concept layer + Hebbian associative memory
- **Grounded answers** — LLM answers backed by explicit evidence, scores, and sources
- **Audio overviews** — generate spoken summaries (monologue / dialogue / interview) with Piper TTS
- **Multi-database** — isolated memory databases, switch with `--db <name>`
- **HTTP + gRPC APIs** — for agent and service integrations
- **React dashboard** — chat, library, graph, timeline, concepts, and ingest views
- **One-command installers** — native Electron app (Windows/macOS/Linux) or Docker

---

## Install

### Option A — Native installer (recommended, no Docker required)

Download the installer for your platform from the [latest release](https://github.com/yourusername/hippocampus/releases/latest):

| Platform | File |
|----------|------|
| Windows | `Hippocampus-Setup-*.exe` |
| macOS | `Hippocampus-*.dmg` |
| Linux | `Hippocampus-*.AppImage` / `.deb` / `.snap` |

The installer bundles Qdrant and Ollama — no separate installs needed. A setup wizard
walks through choosing an install location and downloading AI models (~4 GB first run).

After install, Hippocampus runs in your system tray and the dashboard opens at
`http://localhost:3001`.

**CLI (installed automatically):**
```bash
hippocampus ingest /path/to/file.pdf
hippocampus query-answer "What does the document say about X?"
```

---

### Option B — Docker installer script

**Linux / macOS:**
```bash
curl -fsSL https://github.com/yourusername/hippocampus/releases/latest/download/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://github.com/yourusername/hippocampus/releases/latest/download/install.ps1 | iex
```

The script installs Docker (if missing on Linux), pulls all images, downloads AI models,
and adds the `hippocampus` CLI wrapper to your PATH. Safe to run twice — idempotent.

---

### Option C — Docker Compose (from source)

```bash
git clone https://github.com/yourusername/hippocampus.git
cd hippocampus

# Start all services
docker compose up -d --build

# Download AI models into Ollama
docker compose --profile setup up ollama-pull

# Ingest a file
docker compose -f docker-compose.yml -f docker-compose.cli.yml \
  run --rm hippocampus ingest /uploads/my-doc.pdf

# Ask a question
docker compose -f docker-compose.yml -f docker-compose.cli.yml \
  run --rm hippocampus query-answer "What is memory consolidation?"
```

---

### Option D — Local development

```bash
# 1. Start Qdrant and Ollama
docker compose up -d qdrant ollama
ollama pull phi3:mini
ollama pull moondream

# 2. Install and build
npm install
npm run build

# 3. Run
npm run ingest -- ./path/to/document.pdf
npm run query-answer -- "What is the hippocampus?"
```

---

## Ports

| Service | Port |
|---------|------|
| Hippocampus HTTP | `3001` |
| Hippocampus gRPC | `50051` |
| Qdrant HTTP | `6333` |
| Qdrant gRPC | `6334` |
| Ollama | `11434` |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          Ingest                                │
│  PDF/DOCX/HTML/URL  ──▶  parse  ──▶  chunk  ──▶  embed        │
│  Audio (MP3/WAV)    ──▶  Whisper transcription ──▶  chunk      │
│  Image (PNG/JPG)    ──▶  moondream caption ──▶  embed          │
│  Video (MP4/MKV)    ──▶  keyframes + audio track ──▶  embed    │
└────────────────────────────────┬───────────────────────────────┘
                                 │
               ┌─────────────────▼──────────────────┐
               │            Storage                  │
               │  Qdrant (vectors) + SQLite          │
               │  chunks · connections · concepts    │
               │  co-access events (Hebbian)         │
               └─────────────────┬──────────────────┘
                                 │
┌────────────────────────────────▼───────────────────────────────┐
│                         Retrieval                              │
│  embed(query) → vector search → graph expansion               │
│  → concept expansion → associative MLP boost                  │
│  → re-rank → filter → top-k                                   │
└────────────────────────────────┬───────────────────────────────┘
                                 │
               ┌─────────────────▼──────────────────┐
               │         Answer / Overview           │
               │  Grounded LLM answer (Ollama)       │
               │  Audio overview (Piper TTS)         │
               └────────────────────────────────────┘
```

---

## CLI Reference

```bash
# Dev
ts-node src/cli/cli.ts <command> [args]

# Production / after install
hippocampus <command> [args]
node dist/cli/cli.js <command> [args]
```

All commands accept `--db <name>` to target a specific memory database.

| Command | Example | Description |
|---------|---------|-------------|
| `ingest` | `hippocampus ingest file.pdf` | Parse, chunk, embed, and store a document or URL |
| `ingest-dir` | `hippocampus ingest-dir ./docs` | Recursively ingest a folder |
| `watch` | `hippocampus watch ./docs` | Watch a folder and auto-ingest on change |
| `query` | `hippocampus query "what is X?"` | Retrieve relevant chunks |
| `query-answer` | `hippocampus query-answer "what is X?"` | Retrieve + generate grounded answer |
| `overview` | `hippocampus overview "topic" --format dialogue` | Generate a spoken audio overview |
| `consolidate` | `hippocampus consolidate` | Type weak connections in the knowledge graph |
| `concepts` | `hippocampus concepts` | Build concept abstractions |
| `sync-concepts` | `hippocampus sync-concepts` | Sync concept embeddings to Qdrant |
| `benchmark` | `hippocampus benchmark` | Run benchmark on fixed queries |

### `overview` formats

| Flag | Output |
|------|--------|
| `--format monologue` | Single-narrator spoken summary (default) |
| `--format dialogue` | Two-voice conversation exploring the topic |
| `--format interview` | Q&A interview format |

Audio is saved to `$OVERVIEWS_DIR` (default: `data/overviews/`) as `.wav`.

---

## API Reference

### HTTP — `http://localhost:3001`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health + component status |
| `GET` | `/api/overview` | System overview stats |
| `POST` | `/api/query` | Retrieve relevant chunks |
| `POST` | `/api/query-answer` | Retrieve + generate grounded answer |
| `POST` | `/api/ingest/file` | Upload and ingest a file (multipart) |
| `POST` | `/api/ingest/url` | Ingest a URL |
| `GET` | `/api/stats` | Collection statistics |
| `GET` | `/api/chunks` | List stored chunks |
| `GET` | `/api/graph` | Graph connection data |
| `GET` | `/api/concepts` | List concepts |
| `GET` | `/api/recent-ingests` | Recent ingest events |
| `GET` | `/api/ingest/progress` | SSE stream of ingest progress |

**Example — query-answer:**
```bash
curl -X POST http://localhost:3001/api/query-answer \
  -H 'Content-Type: application/json' \
  -d '{"query": "What is memory consolidation?"}'
```

**Response:**
```json
{
  "answer": "Memory consolidation is a biological process...",
  "evidence": [
    {
      "chunk_id": "abc-123",
      "text": "Memory consolidation is a category of...",
      "source": "https://en.wikipedia.org/wiki/Memory_consolidation",
      "score": 0.78,
      "retrieval_layer": "vector"
    }
  ],
  "concepts_used": [],
  "graph_edges": [
    { "source_chunk": "abc-123", "target_chunk": "def-456",
      "relationship": "related_to", "weight": 0.30 }
  ],
  "sources": ["https://en.wikipedia.org/wiki/Memory_consolidation"]
}
```

### gRPC — `localhost:50051`

Defined in [src/proto/hippocampus.proto](src/proto/hippocampus.proto):

```protobuf
service Hippocampus {
  rpc Ingest (IngestRequest)  returns (IngestResponse);
  rpc Query  (QueryRequest)   returns (QueryResponse);
  rpc Health (HealthRequest)  returns (HealthResponse);
}
```

---

## Configuration

All parameters are set via environment variables. Defaults suit CPU-only hardware with `phi3:mini`.

### Embedding

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBED_MODEL` | `nomic-ai/nomic-embed-text-v1` | HuggingFace embedding model |
| `EMBED_DIMS` | `768` | Vector dimensions (must match model) |
| `EMBED_MAX_TOKENS` | `512` | Max tokens per chunk |
| `EMBED_BATCH_SIZE` | `8` | Embedding batch size |

### Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_COLLECTION` | `hippocampus` | Primary vector collection |
| `DB_PATH` | `./hippocampus.db` | SQLite database path |

### LLM / Ollama

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `phi3:mini` | Model for consolidation / chunking |
| `ANSWER_MODEL` | `phi3:mini` | Model for answer generation |
| `VISION_MODEL` | `moondream` | Vision model for image/video captions |
| `OLLAMA_CONCURRENCY` | `8` | Max concurrent Ollama requests |

### Audio

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_MODEL` | `small` | Whisper model for audio transcription |
| `AUDIO_CHUNK_MINUTES` | `2` | Duration of audio chunks |
| `PIPER_VOICES_DIR` | `./piper-voices` | Path to Piper TTS voice files |
| `OVERVIEWS_DIR` | `./data/overviews` | Output directory for audio overviews |

### Video

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYFRAME_INTERVAL` | `60` | Seconds between extracted keyframes |

### Retrieval

| Variable | Default | Description |
|----------|---------|-------------|
| `INCLUDE_CONCEPTS` | `false` | Include concept layer in retrieval |
| `CONCEPT_BOOST` | `0.08` | Score boost for concept-linked chunks |
| `CONCEPT_TOP_K` | `3` | Concepts to retrieve |
| `CONCEPT_MIN_SCORE` | `0.45` | Minimum concept similarity |

### Chunking

| Variable | Default | Description |
|----------|---------|-------------|
| `CHUNK_STRATEGY` | `token` | `token` (default), `fast`, or `llm` |
| `CHUNK_TARGET_MIN_TOKENS` | `350` | Min tokens per chunk |
| `CHUNK_TARGET_MAX_TOKENS` | `500` | Max tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | `40` | Overlap between adjacent chunks |

### Grounded answers

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_GROUNDED_ANSWERS` | `true` | Enable LLM answer generation |
| `MAX_CONTEXT_TOKENS` | `500` | Token budget for context |
| `CONTEXT_TOP_K` | `3` | Chunks retrieved from Qdrant |
| `MAX_EVIDENCE_CHUNKS` | `5` | Max chunks in response |
| `MAX_OUTPUT_TOKENS` | `128` | Max LLM output tokens |
| `LLM_TIMEOUT_MS` | `120000` | LLM generation timeout (ms) |

### Feature toggles

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LEARNING_WEIGHTS` | `true` | Dynamic connection weight learning |
| `ENABLE_CONCEPT_VALIDATION` | `true` | LLM self-validation of concepts |
| `DEBUG_PERF` | `false` | Performance timing logs |
| `DEBUG_CHUNKS` | `false` | Chunk-level debug logs |

---

## Dashboard

A React + Vite dashboard at `http://localhost:3001`.

| View | Description |
|------|-------------|
| Chat | Conversational query-answer interface |
| Library | Browse all ingested chunks with search and filters |
| Graph | Interactive knowledge graph visualization |
| Timeline | Chronological ingest history |
| Concepts | Concept map and abstractions |
| Ingest | Upload files or URLs and monitor progress |

```bash
# Dev server (hot reload)
npm run dashboard
# or
cd dashboard && npm run dev
```

---

## Project Structure

```
hippocampus/
├── src/
│   ├── index.ts                  # Barrel — public API re-exports
│   ├── config.ts                 # All env-var configuration
│   ├── associative.ts            # Hebbian associative memory (MLP)
│   ├── cli/
│   │   ├── cli.ts                # CLI entry point + arg dispatch
│   │   └── commands.ts           # CLI command implementations
│   ├── answer/
│   │   └── generator.ts          # Grounded LLM answer generation
│   ├── audio/
│   │   ├── overview.ts           # Audio overview orchestration
│   │   ├── scriptWriter.ts       # LLM script generation
│   │   └── tts.ts                # Piper TTS synthesis
│   ├── parser/
│   │   ├── audio.ts              # Whisper audio transcription
│   │   ├── image.ts              # Vision LLM image captioning
│   │   └── video.ts              # Video keyframe + audio extraction
│   ├── server/
│   │   ├── index.ts              # Server startup (gRPC + HTTP)
│   │   ├── httpServer.ts         # HTTP dispatch
│   │   ├── grpc.ts               # gRPC handlers
│   │   ├── helpers.ts            # Shared HTTP utilities
│   │   └── routes/
│   │       ├── queryRoute.ts
│   │       ├── healthRoute.ts
│   │       └── overviewRoute.ts
│   ├── ingest/
│   │   ├── index.ts              # Ingest orchestration
│   │   ├── parser.ts             # PDF / DOCX / HTML / URL parsing
│   │   └── chunking/
│   │       └── semantic.ts       # LLM-driven semantic chunking
│   ├── embed/
│   │   └── index.ts              # ONNX embeddings (CPU)
│   ├── retrieve/
│   │   └── index.ts              # Vector + graph + concept + associative retrieval
│   ├── consolidate/
│   │   ├── index.ts              # Consolidation worker
│   │   ├── classify.ts           # Connection classification
│   │   ├── cluster.ts            # Concept clustering
│   │   ├── concepts.ts           # Concept extraction
│   │   └── weights.ts            # Dynamic weight learning
│   ├── db/
│   │   └── index.ts              # Qdrant + SQLite init, multi-DB support
│   ├── proto/
│   │   └── hippocampus.proto
│   └── tests/
│       ├── integration.test.ts
│       └── retrieval.test.ts
├── dashboard/                     # React + Vite dashboard
│   └── src/
│       ├── views/                 # Chat, Library, Graph, Timeline, Concepts, Ingest
│       └── components/            # AudioOverviewPanel, ChunkPopover, MiniSparkline, …
├── installer/                     # Cross-platform installer
│   ├── electron/                  # Electron main process (main.ts, preload.ts, tray.ts)
│   ├── wizard/                    # 5-step React installer wizard
│   ├── scripts/                   # install.sh, install.ps1, bundle-binaries.sh
│   └── package.json               # electron-builder config
├── .github/
│   └── workflows/
│       └── release.yml            # CI/CD: builds all installers on git tag
├── docker-compose.yml
├── docker-compose.cli.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## How It Works

### Ingest pipeline

1. **Parse** — text from PDF (`pdf-parse`), DOCX (`mammoth`), HTML/URLs (`cheerio`); audio transcribed by Whisper; images captioned by `moondream`; video split into keyframes + audio track then processed by both.
2. **Chunk** — split into overlapping chunks with `token` (default), `fast`, or `llm` strategy.
3. **Embed** — 768-dimensional vectors via `nomic-embed-text-v1` on CPU.
4. **Store** — vectors to Qdrant, metadata + connections to SQLite.
5. **Connect** — seed proximity-based graph edges between chunks from the same document.

### Retrieval pipeline

```
embed(query)
  → Qdrant vector search (top-20)
  → graph expansion (GRAPH_BOOST_FACTOR=0.05, max 2 hops)
  → concept expansion (if INCLUDE_CONCEPTS)
  → associative MLP boost (Hebbian co-access patterns)
  → merge + re-rank
  → filter (MIN_SCORE=0.40)
  → top-5
  → update access_count
```

### Grounded answer generation

1. **Build context** — select highest-scored chunks within token budget.
2. **Prompt** — strict grounding: *"Answer using ONLY the context above."*
3. **Generate** — Ollama with timeout; model warmup runs in parallel during embed+retrieve.
4. **Fallback** — on timeout/error, returns evidence with a safe fallback message.

### Audio overviews

1. **Retrieve** — semantic search across the knowledge base for the topic.
2. **Script** — LLM generates a spoken script in the chosen format (monologue/dialogue/interview).
3. **Synthesise** — Piper TTS converts script to `.wav`, saved to `OVERVIEWS_DIR`.

### Background consolidation

Runs every 30 seconds:
1. **Classify** weak edges — LLM assigns relationship types (`supports`, `contradicts`, `related_to`, etc.)
2. **Update weights** — dynamic Hebbian-style weight decay and reinforcement.
3. **Extract concepts** — cluster semantically close chunks into named concept nodes.

---

## Release Pipeline

Triggered on any `git tag v*`:

| Job | Runner | Output |
|-----|--------|--------|
| `build-docker-scripts` | ubuntu | `hippocampus-docker-installer.zip` |
| `build-linux` | ubuntu | `.AppImage`, `.deb`, `.snap` |
| `build-windows` | windows-latest | `.exe` (NSIS) |
| `build-mac` | macos-latest | `.dmg` (notarized) |
| `release` | ubuntu | GitHub Release with all artifacts |

**macOS notarization** requires GitHub Actions secrets:
`APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`, `MAC_CERT_P12`, `MAC_CERT_PASSWORD`.
See [installer/scripts/notarize.js](installer/scripts/notarize.js).

---

## Testing

```bash
# Integration tests
npm test

# Retrieval-specific tests
npx ts-node src/tests/retrieval.test.ts

# Benchmark
npm run benchmark

# TypeScript check
npx tsc --noEmit
```

---

## License

[MIT](LICENSE)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
