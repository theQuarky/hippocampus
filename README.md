# 🧠 Hippocampus

Hippocampus is a **local semantic memory system** for intelligent agents.
It ingests documents, builds a vector + graph index, and uses a local LLM
to answer questions grounded in that memory.

This README is intentionally concise so you can get in, run it, and
integrate it quickly. See the source for deeper internals.

---

## Features

- Ingest PDFs, DOCX, HTML, text, and URLs
- Local embeddings (no external API calls)
- Qdrant vector search + graph connections
- Optional concept layer (when data is populated)
- Grounded answers with explicit evidence & scores
- HTTP and gRPC APIs
- CLI + optional dashboard

---

## Architecture

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Documents   │────▶│    Ingest     │────▶│   Qdrant      │
│  PDF/URL/TXT  │     │  Parse/Chunk  │     │  Vector Store  │
└───────────────┘     │  Embed/Store  │     └───────┬───────┘
                      └───────┬───────┘             │
                              │                     │
                      ┌───────▼───────┐     ┌───────▼───────┐
                      │    SQLite     │     │   Retrieval   │
                      │   Metadata    │◀───▶│  Vector+Graph │
                      │  Connections  │     │  +Concepts    │
                      └───────────────┘     └───────┬───────┘
                                                    │
                                            ┌───────▼───────┐
                                            │   Answer Gen  │
                                            │  Ollama LLM   │
                                            │  (grounded)   │
                                            └───────────────┘
```

---

## Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | 22+ | Runtime |
| **Qdrant** | latest | Vector storage and similarity search |
| **Ollama** | latest | Local LLM for answer generation and consolidation |
| **Docker** *(optional)* | 24+ | Containerised deployment |

---

## Quick Start

### Docker (recommended)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/hippocampus.git
cd hippocampus

# 2. Start all services (Qdrant, Ollama, Hippocampus)
docker compose up -d --build

# 3. Pull the default LLM model into Ollama
docker compose --profile setup up ollama-pull

# 4. Ingest a document
docker compose -f docker-compose.yml -f docker-compose.cli.yml \
  run --rm hippocampus dist/cli/cli.js ingest /uploads/my-doc.pdf

# 5. Query
docker compose -f docker-compose.yml -f docker-compose.cli.yml \
  run --rm hippocampus dist/cli/cli.js query-answer "What does the document say about X?"
```

**Ports exposed:**

| Service | Port |
|---|---|
| Hippocampus HTTP | `3001` |
| Hippocampus gRPC | `50051` |
| Qdrant HTTP | `6333` |
| Qdrant gRPC | `6334` |
| Ollama | `11434` |

### Local development

```bash
# 1. Start Qdrant and Ollama (or use Docker for just these)
docker compose up -d qdrant ollama

# 2. Pull the LLM model
ollama pull phi3:mini

# 3. Install dependencies
npm install

# 4. Ingest a document
npm run ingest -- ./path/to/document.pdf

# 5. Ask a question
npm run query-answer -- "What is the hippocampus?"
```

---

## CLI Reference

All CLI commands run via `ts-node src/cli/cli.ts <command>` (dev) or
`node dist/cli/cli.js <command>` (production).

| Command | Usage | Description |
|---|---|---|
| `ingest` | `npm run ingest -- <file\|url>` | Parse, chunk, embed, and store a single document or URL |
| `ingest-dir` | `npm run ingest-dir -- <folder>` | Recursively ingest all supported files in a directory |
| `watch` | `npm run watch -- <folder>` | Watch a folder for new/changed files and auto-ingest |
| `query` | `npm run query -- "<question>"` | Retrieve relevant chunks by semantic similarity |
| `query-answer` | `npm run query-answer -- "<question>"` | Retrieve chunks **and** generate a grounded LLM answer |
| `consolidate` | `npm run consolidate` | Type weak connections in the graph |
| `concepts` | `npm run concepts` | Build concept abstractions and print all concepts |
| `sync-concepts` | `npm run dev -- sync-concepts` | Sync concept embeddings to Qdrant |
| `benchmark` | `npm run benchmark` | Run benchmark on fixed queries |

### query-answer output

```
Answer:
The hippocampus is a region of the brain that is part of the limbic system...

Concepts Used:                        # only when INCLUDE_CONCEPTS=true and data exists
  * memory  (id: abc123, confidence: 0.92)

Evidence Chunks:
  [1] https://en.wikipedia.org/wiki/Hippocampus (score 0.67) [vector]
      The hippocampus is a major component of the brain...

  [2] Neuroscience.pdf (score 0.67) [vector]
      Hippocampus — widespread projections from association neocortex...

Graph Connections:
  abc123 -> def456  [related_to] (w: 0.30)
```

---

## API Reference

### HTTP endpoints

The HTTP server listens on port `3001` by default.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/query` | Retrieve relevant chunks |
| `POST` | `/api/query-answer` | Retrieve + generate grounded answer |
| `POST` | `/api/ingest/file` | Upload and ingest a file (multipart) |
| `POST` | `/api/ingest/url` | Ingest a URL |
| `GET`  | `/api/stats` | Collection statistics |
| `GET`  | `/api/chunks` | List stored chunks |
| `GET`  | `/api/graph` | Graph connection data |
| `GET`  | `/api/concepts` | List concepts |
| `GET`  | `/api/recent-ingests` | Recent ingest activity |
| `GET`  | `/api/ingest/progress` | SSE stream of ingest progress |

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
  "concepts_detail": [],
  "graph_edges": [
    {
      "source_chunk": "abc-123",
      "target_chunk": "def-456",
      "relationship": "related_to",
      "weight": 0.30
    }
  ],
  "sources": ["https://en.wikipedia.org/wiki/Memory_consolidation"]
}
```

### gRPC service

The gRPC server listens on port `50051` by default.  The service is
defined in `src/proto/hippocampus.proto`:

```protobuf
service Hippocampus {
  rpc Ingest (IngestRequest) returns (IngestResponse);
  rpc Query  (QueryRequest)  returns (QueryResponse);
  rpc Health (HealthRequest)  returns (HealthResponse);
}
```

---

## Configuration

Every parameter is configurable via environment variables.  Defaults are
chosen for CPU-only hardware running `phi3:mini`.

### Embedding

| Variable | Default | Description |
|---|---|---|
| `EMBED_MODEL` | `Xenova/all-MiniLM-L6-v2` | HuggingFace embedding model |
| `EMBED_DIMS` | `384` | Embedding vector dimensions |
| `EMBED_MAX_TOKENS` | `512` | Max tokens per chunk for embedding |
| `EMBED_BATCH_SIZE` | `8` | Batch size for embedding calls |

### Qdrant

| Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_COLLECTION` | `hippocampus` | Primary collection name |

### LLM / Ollama

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_MODEL` | `phi3:mini` | Model for consolidation and chunking |
| `ANSWER_MODEL` | `phi3:mini` | Model for answer generation (falls back to `OLLAMA_MODEL`) |

### Grounded answer pipeline

| Variable | Default | Description |
|---|---|---|
| `ENABLE_GROUNDED_ANSWERS` | `true` | Enable/disable the answer generation pipeline |
| `MAX_CONTEXT_TOKENS` | `500` | Token budget for context sent to the LLM |
| `CONTEXT_TOP_K` | `3` | Number of chunks retrieved from Qdrant |
| `MAX_EVIDENCE_CHUNKS` | `5` | Max evidence chunks in the response |
| `MAX_OUTPUT_TOKENS` | `128` | Max tokens the LLM may generate |
| `LLM_TIMEOUT_MS` | `120000` | Timeout for LLM generation (ms) |

### Concept retrieval

| Variable | Default | Description |
|---|---|---|
| `INCLUDE_CONCEPTS` | `false` | Include concept-layer in retrieval |
| `CONCEPT_BOOST` | `0.08` | Score boost for concept-linked chunks |
| `CONCEPT_TOP_K` | `3` | Number of concepts to retrieve |
| `CONCEPT_MIN_SCORE` | `0.45` | Minimum similarity for concept match |

### Chunking

| Variable | Default | Description |
|---|---|---|
| `CHUNK_STRATEGY` | `token` | Chunking strategy: `token`, `fast`, or `llm` |
| `CHUNK_TARGET_MIN_TOKENS` | `350` | Minimum tokens per chunk |
| `CHUNK_TARGET_MAX_TOKENS` | `500` | Maximum tokens per chunk |
| `CHUNK_OVERLAP_TOKENS` | `40` | Token overlap between adjacent chunks |

### Feature toggles

| Variable | Default | Description |
|---|---|---|
| `ENABLE_LEARNING_WEIGHTS` | `true` | Dynamic connection weight learning |
| `ENABLE_CONCEPT_VALIDATION` | `true` | LLM self-validation of extracted concepts |
| `DEBUG_PERF` | `false` | Print performance timing logs |
| `DEBUG_CHUNKS` | `false` | Print chunk-level debug logs |

### Consolidation

| Variable | Default | Description |
|---|---|---|
| `CONSOLIDATION_BATCH_SIZE` | `10` | Connections per consolidation batch |
| `CONSOLIDATION_INTERVAL_MS` | `30000` | Interval between consolidation runs (ms) |

---

## Dashboard

A React + Vite dashboard for browsing memory, running queries, and
monitoring ingestion.

```bash
# Start the dashboard dev server
npm run dashboard

# Or from the dashboard directory
cd dashboard && npm run dev
```

The dashboard connects to the HTTP API on port `3001`.

---

## Project Structure

```
hippocampus/
├── src/
│   ├── index.ts              # Barrel file — public API re-exports
│   ├── config.ts             # All configurable parameters
│   ├── cli/
│   │   ├── cli.ts            # CLI entry point and arg dispatch
│   │   └── commands.ts       # CLI command implementations
│   ├── answer/
│   │   ├── index.ts          # Barrel re-exports
│   │   ├── generator.ts      # LLM answer generation with timeout
│   │   ├── query.ts          # Full query-answer pipeline
│   │   └── context.ts        # Token-budgeted context builder
│   ├── server/
│   │   ├── index.ts          # Server startup (gRPC + HTTP)
│   │   ├── httpServer.ts     # HTTP dispatch
│   │   ├── grpc.ts           # gRPC handlers
│   │   ├── helpers.ts        # Shared HTTP utilities
│   │   ├── sse.ts            # Server-Sent Events helper
│   │   └── routes/
│   │       ├── queryRoute.ts
│   │       ├── healthRoute.ts
│   │       └── ingestRoute.ts
│   ├── ingest/
│   │   ├── index.ts          # Ingest orchestration
│   │   ├── parser.ts         # PDF / DOCX / HTML / URL parsing
│   │   ├── filters.ts        # Content filters
│   │   └── chunking/
│   │       ├── token.ts      # Tokenizer-based chunking
│   │       ├── segment.ts    # Heuristic segmentation
│   │       ├── semantic.ts   # LLM-driven semantic chunking
│   │       └── llm.ts        # LLM chunking helpers
│   ├── embed/
│   │   └── index.ts          # Embedding via Xenova/transformers
│   ├── retrieve/
│   │   └── index.ts          # Vector + graph + concept retrieval
│   ├── consolidate/
│   │   ├── index.ts          # Consolidation worker
│   │   ├── classify.ts       # Connection classification
│   │   ├── concepts.ts       # Concept extraction
│   │   ├── weights.ts        # Dynamic weight learning
│   │   └── helpers.ts        # Consolidation utilities
│   ├── concepts/
│   │   └── sync.ts           # Sync concept embeddings to Qdrant
│   ├── db/
│   │   └── index.ts          # SQLite + Qdrant initialization
│   ├── types/
│   │   └── evidence.ts       # Evidence & explanation types
│   ├── proto/
│   │   └── hippocampus.proto # gRPC service definition
│   ├── tests/
│   │   └── integration.test.ts
│   └── tools/
│       └── benchmark.ts
├── dashboard/                 # React + Vite dashboard
├── data/                      # Runtime data (Qdrant, Ollama, SQLite)
├── uploads/                   # File upload staging
├── docker-compose.yml
├── docker-compose.cli.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## How It Works

### Ingest

1. **Parse** — Extract text from PDF (`pdf-parse`), DOCX (`mammoth`),
   HTML/URLs (`cheerio`), or plain text.
2. **Chunk** — Split into overlapping chunks using one of three strategies:
   token-based (default), heuristic (`fast`), or LLM-driven (`llm`).
3. **Embed** — Generate 384-dimensional vectors with `all-MiniLM-L6-v2`
   running locally via `@xenova/transformers`.
4. **Store** — Write vectors to Qdrant and metadata (chunk text, source,
   checksums) to SQLite.
5. **Connect** — Seed initial graph connections between chunks from the
   same document based on proximity.

### Retrieval

1. **Vector search** — Embed the query and retrieve top-k similar chunks
   from Qdrant.
2. **Concept expansion** *(optional)* — Retrieve matching concepts and
   expand the result set with concept-member chunks.
3. **Graph boost** — Look up graph connections between retrieved chunks in
   SQLite and boost scores for connected pairs.
4. **Merge & rank** — Deduplicate, merge scores, and rank by final
   similarity.

### Grounded Answer Generation

1. **Build context** — Select the highest-scored chunks that fit within
   the token budget (`MAX_CONTEXT_TOKENS`).
2. **Construct prompt** — Wrap the question and context in a strict
   grounding prompt: *"Answer using ONLY the context above."*
3. **Generate** — Call Ollama with `Promise.race` against a configurable
   timeout (`LLM_TIMEOUT_MS`).  A parallel model warmup runs during
   embed + retrieve to avoid cold-start penalty.
4. **Fallback** — If the LLM times out or errors, return a safe fallback
   message while still providing the retrieved evidence.

### Explainability Contract

Every `query-answer` response includes:

| Field | Description |
|---|---|
| `evidence` | Top chunks with `chunk_id`, `text`, `source`, `score`, `retrieval_layer` |
| `graph_edges` | Connections between evidence chunks: `source_chunk → target_chunk [relationship] (weight)` |
| `concepts_detail` | Matched concepts with `concept_id`, `label`, `confidence` |
| `sources` | Deduplicated list of source documents |

If the evidence is insufficient, the LLM responds:
*"The available memory does not contain enough information."*

---

## Testing

```bash
# Run integration tests
npm test

# Run benchmark suite
npm run benchmark

# TypeScript type-check (no emit)
npx tsc --noEmit
```

---

## License

[MIT](LICENSE)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).