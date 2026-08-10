# Hippocampus

Hippocampus is a local, schema-free semantic memory system for intelligent agents.
It ingests documents, web pages, audio, images, and video, stores searchable embeddings in Qdrant,
models relationships in SQLite, and answers questions using local LLM grounding.

## What this project does

- Ingests content from files, URLs, audio, images, and video into a local memory database.
- Embeds text and concept summaries with CPU-based Xenova transformers.
- Stores vector embeddings in Qdrant and metadata / relationships in SQLite.
- Retrieves relevant chunks via hybrid search: vector search + graph traversal + optional concept expansion.
- Generates grounded answers with Ollama using explicit context from retrieved memory.
- Provides CLI commands, HTTP API routes, and gRPC service endpoints.
- Supports local development, Docker compose, and native packaging.

## Key architecture

- `src/cli/` — command-line interface entrypoint and commands.
- `src/db/` — Qdrant client configuration, SQLite schema, memory database helpers.
- `src/ingest/` — file/url parsing, chunking, embedding, duplicate detection, and connection seeding.
- `src/retrieve/` — vector retrieval, multi-hop graph expansion, conflict detection, reranking.
- `src/answer/` — context builder and grounded answer generation via Ollama.
- `src/consolidate/` — edge classification, weight reinforcement/decay, concept extraction, concept sync.
- `src/audio/` — audio overview script generation and TTS synthesis.
- `src/server/` — HTTP server, gRPC service, API routes, runtime startup.

## Repository contents

- `src/` — main TypeScript source code.
- `docker-compose.yml` — main service topology.
- `docker-compose.cli.yml` — CLI service support for Docker.
- `Dockerfile` — image build definition.
- `installer/` — packaging scripts and installer support.
- `package.json` — dependency definitions and scripts.
- `tsconfig.json` — TypeScript compiler configuration.

## Prerequisites

- Node 22+ installed.
- Qdrant running at `http://localhost:6333` or configured via `QDRANT_URL`.
- Ollama running at `http://127.0.0.1:11434` or configured via `OLLAMA_URL` / `OLLAMA_HOST`.
- `npm install` to install dependencies.

## Install and build

```bash
git clone https://github.com/theQuarky/hippocampus.git
cd hippocampus
npm install
npm run build
```

The `build` script compiles TypeScript and copies the Protobuf file into `dist/proto`.

## Run locally

### Development CLI

```bash
npm run dev -- ingest README.md
npm run dev -- query "what is hippocampus?"
npm run dev -- query-answer "what is hippocampus?"
```

### Start server

```bash
npm run server:dev
```

This starts the local HTTP + gRPC server and initializes Qdrant + SQLite schema.

## Docker setup

```bash
npm run docker:up
```

Useful Docker commands:

- `npm run docker:up` — build and start services.
- `npm run docker:down` — stop services.
- `npm run docker:logs` — follow container logs.
- `npm run docker:setup` — pull Ollama models inside Docker.

## CLI commands

### `ingest <file|url>`
Ingests a supported file or URL into the memory database.

Supported files:
- `.txt`, `.md`, `.pdf`, `.docx`, `.html`
- audio files via `src/parser/audio` when faster-whisper is available
- image files via `src/parser/image`
- video files via `src/parser/video`

Example:

```bash
npm run dev -- ingest docs/spec.pdf
npm run dev -- ingest https://example.com/article
```

### `ingest-dir <folder>`
Recursively ingests supported files from a directory, skipping hidden files and already-ingested sources.

```bash
npm run dev -- ingest-dir ./content
```

### `watch <folder>`
Watches a folder for new or changed supported files and ingests them automatically.

```bash
npm run dev -- watch ./notes
```

### `query <question>`
Performs raw retrieval and prints the top matching chunks.

```bash
npm run dev -- query "What is memory consolidation?"
```

### `query-answer <question>`
Runs the full grounded answer pipeline and prints the answer plus evidence.

```bash
npm run dev -- query-answer "What is memory consolidation?"
```

### `consolidate`
Runs a one-shot consolidation pipeline:
- classify untyped edges
- reinforce and decay connection weights
- extract concepts
- train associative memory
- sync concept embeddings

```bash
npm run dev -- consolidate
```

### `concepts`
Builds concept abstractions from connected chunks and prints concept metadata.

```bash
npm run dev -- concepts
```

### `sync-concepts`
Syncs stale concept embeddings from SQLite into the Qdrant concept collection.

```bash
npm run dev -- sync-concepts
```

### `benchmark`
Runs the benchmark helper.

```bash
npm run benchmark
```

### `overview <question> [--format monologue|dialogue|interview]`
Generates a narrated audio overview from retrieved evidence.

```bash
npm run dev -- overview "Explain hippocampal memory" --format dialogue
```

## HTTP API

The HTTP API is exposed by `src/server/httpServer.ts`.
By default it listens on `http://127.0.0.1:3001`.

### `GET /api/stats`
Returns counts for chunks, connections, concepts, and graph health.

### `GET /api/chunks`
Lists stored chunks with optional filters:
- `database`
- `source`
- `search`
- `limit`
- `offset`

### `GET /api/graph`
Returns graph nodes and links for connection visualization.

### `GET /api/concepts`
Returns concepts built by consolidation.

### `POST /api/query`
Body:

```json
{
  "query": "text",
  "top_k": 5,
  "database": "default",
  "maxHops": 2,
  "relationshipFilter": ["related_to"],
  "includeConflicts": true
}
```

Returns raw retrieval results.

### `POST /api/query-answer`
Body:

```json
{ "question": "What is memory consolidation?", "database": "default" }
```

Returns a grounded answer, evidence chunks, concepts, graph edges, and sources.

## gRPC API

The gRPC service is defined in `src/proto/hippocampus.proto`.
It provides the following RPCs:

- `Ingest(IngestRequest) -> IngestResponse`
- `Query(QueryRequest) -> QueryResponse`
- `Health(HealthRequest) -> HealthResponse`

This allows external services to ingest text, query memory, and check service health.

## Storage and schema

### Qdrant

- Main collection: configured by `QDRANT_COLLECTION` (default `hippocampus`).
- Concept collection: `${QDRANT_COLLECTION}_concepts`.
- Image collection: `${QDRANT_COLLECTION}_images`.

### SQLite schema

The local SQLite database is created at `DB_PATH` (default `./hippocampus.db`).
The schema includes:

- `memory_databases` — named memory spaces.
- `chunks` — stored text chunks and metadata.
- `connections` — typed relationships between chunks.
- `concepts` — abstracted concept nodes.
- `ingest_events` — ingest history.
- `co_access_events` — query-driven co-access records.
- `associative_memory` — saved associative model weights.

### Default database

The system uses a default memory database named `default`.
Multi-database support is present via `database_id` columns across tables.

## Ingestion pipeline

1. Parse input with `src/ingest/parser.ts`.
2. Convert content to text.
3. Chunk text via one of the chunking strategies.
4. Embed chunks with Xenova.
5. Search Qdrant for near-duplicate chunks and skip duplicates.
6. Store unique chunks in SQLite and Qdrant.
7. Seed `related_to` connections between similar chunks.

### Supported ingest types

- Plain text / Markdown
- HTML files and parsed web pages
- PDF files with noise stripping
- DOCX documents
- Audio transcripts if audio parsing is installed
- Image captions with optional CLIP embeddings
- Video captions / keyframes via video parser

### Chunking strategies

- `semantic` — heuristic header/paragraph/sentence chunking.
- `token` — exact tokenizer-aware chunking using Xenova tokenizer.
- `llm` — Ollama-based semantic chunking when available.

The default strategy is configured by `CHUNK_STRATEGY`.

## Retrieval pipeline

Retrieval is implemented in `src/retrieve/index.ts`.

1. Embed the query with Xenova.
2. Retrieve top-k chunks from Qdrant.
3. Optionally expand with concept-related chunks.
4. Perform multi-hop graph expansion over typed relationships.
5. Deduplicate and rerank results.
6. Detect contradiction edges between returned chunks.

### Graph traversal

- Graph expansion uses `connections` from SQLite.
- The default maximum hops is 2.
- Relationship filtering is supported.
- Edge weights and decay control search breadth.

### Conflicts and contradictions

The system can detect `contradicts` relationships between evidence chunks
and surface them as warnings in the CLI.

## Grounded answers

The answer pipeline is handled by `src/answer/query.ts`, `src/answer/context.ts`, and `src/answer/generator.ts`.

- `queryAnswer()` embeds the question, retrieves chunks, merges and ranks them, and builds context.
- `buildContext()` deduplicates text, budgets tokens, and assembles a prompt.
- `generateGroundedAnswer()` sends a strict prompt to Ollama and returns a safe fallback if the LLM fails.

## Concepts and consolidation

Consolidation runs in the background and via CLI.
It includes:

- `cycle2ClassifyBatch()` — LLM classifies untyped `related_to` edges.
- `reinforceConnections()` / `decayConnections()` — adjusts weights over time.
- `abstractConcepts()` / `clusterIntoConcepts()` — groups chunk clusters into concepts.
- `syncConceptEmbeddings()` — embeds concept summaries into Qdrant.
- `trainAssociativeMemory()` — trains a small TF.js MLP to predict useful concepts from query embeddings.

## Audio overviews

Audio overviews generate spoken summaries from retrieved evidence.
The workflow:

1. Retrieve relevant chunks.
2. Generate a script (`src/audio/scriptWriter.ts`).
3. Synthesize audio with Piper TTS (`src/audio/tts.ts`).
4. Save output under `OVERVIEWS_DIR`.

Supported overview formats:
- `monologue`
- `dialogue`
- `interview`

## Configuration environment variables

The project is driven by environment variables.
Key options:

- `EMBED_MODEL` — embedding model (`Xenova/all-MiniLM-L6-v2` by default).
- `EMBED_DIMS` — embedding dimension (`384`).
- `EMBED_MAX_TOKENS` — text max tokens (`512`).
- `QDRANT_URL` — Qdrant endpoint.
- `QDRANT_COLLECTION` — Qdrant collection name.
- `OLLAMA_URL` / `OLLAMA_HOST` — Ollama host.
- `OLLAMA_MODEL` — Ollama model for generation.
- `WHISPER_MODEL` — audio transcription model.
- `VISION_MODEL` — vision model for images.
- `KEYFRAME_INTERVAL` — seconds between video keyframes.
- `AUDIO_CHUNK_MINUTES` — audio segment duration.
- `INCLUDE_CONCEPTS` — enable concept expansion.
- `ENABLE_LEARNING_WEIGHTS` — dynamic connection learning.
- `ENABLE_CONCEPT_VALIDATION` — concept validation flag.
- `DEBUG_PERF` — log performance timing.
- `DEBUG_CHUNKS` — log chunking debug details.
- `MIN_SCORE` — minimum retrieval score.
- `MAX_CONTEXT_TOKENS` — context token budget for LLM.
- `CONTEXT_TOP_K` — number of chunks to retrieve for grounding.
- `MAX_EVIDENCE_CHUNKS` — top evidence used in reported results.
- `DB_PATH` — path to SQLite database.
- `OVERVIEWS_DIR` — output directory for audio overviews.

## Packaging and releases

The repository includes packaging support in `package.json`:

- `npm run pkg:linux` — package a Linux standalone binary.
- `npm run pkg:win` — package a Windows binary.
- `npm run pkg:all` — package both platforms.
- `npm run release:linux` — build and package Linux release.

The `pkg` configuration includes the Protobuf file and native bindings required for packaging.

## Compatibility notes

- `@xenova/transformers` is loaded specially for pkg binaries via `src/xenova.ts`.
- `better-sqlite3` uses an explicit native binding path when packaged.
- `OLLAMA_URL` defaults to local Ollama if not configured.

## Troubleshooting

- If Qdrant collection vector dimension mismatches, delete the collection or change `QDRANT_COLLECTION`.
- If Ollama generation times out, increase `LLM_TIMEOUT_MS`.
- If audio ingest fails, ensure `faster-whisper` is installed or use Docker.
- If concept sync does not update, run `npm run dev -- sync-concepts`.

## Example workflows

### Ingest a document and ask a question

```bash
npm run dev -- ingest docs/whitepaper.pdf
npm run dev -- query-answer "What are the main features of Hippocampus?"
```

### Start the server and call the API

```bash
npm run server:dev
curl -X POST http://127.0.0.1:3001/api/query-answer \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is Hippocampus?"}'
```

### Generate an audio overview

```bash
npm run dev -- overview "Explain hippocampus" --format interview
```

## Contributing

Pull requests are welcome. Create issues for bugs, feature requests, or documentation improvements.

## License

MIT
