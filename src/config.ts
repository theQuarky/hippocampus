// src/config.ts — Single source of truth for all configurable parameters
// Override any value via environment variables.
import path from 'path';

// ── Embedding model ─────────────────────────────────────────────────────────
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIMS = Number(process.env.EMBED_DIMS ?? '384');
export const EMBED_MAX_TOKENS = Number(process.env.EMBED_MAX_TOKENS ?? '512');
export const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? '32');

// ── Qdrant ──────────────────────────────────────────────────────────────────
export const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
export const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'hippocampus';

// ── Ollama (for consolidation / LLM chunking) ──────────────────────────────
// OLLAMA_HOST takes precedence (docker-compose sets this); fall back to OLLAMA_URL, then localhost
export const OLLAMA_URL = process.env.OLLAMA_HOST ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'phi3:mini';
export const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'small';
export const VISION_MODEL = process.env.VISION_MODEL ?? 'moondream';
export const KEYFRAME_INTERVAL = Number.parseInt(process.env.KEYFRAME_INTERVAL ?? '60', 10);
export const AUDIO_CHUNK_MINUTES = Number.parseInt(process.env.AUDIO_CHUNK_MINUTES ?? '2', 10);

// ── Feature toggles ────────────────────────────────────────────────────────
export const INCLUDE_CONCEPTS = process.env.INCLUDE_CONCEPTS === 'true';
export const ENABLE_LEARNING_WEIGHTS = process.env.ENABLE_LEARNING_WEIGHTS !== 'false'; // on by default
export const ENABLE_CONCEPT_VALIDATION = process.env.ENABLE_CONCEPT_VALIDATION !== 'false';
export const DEBUG_PERF = process.env.DEBUG_PERF === 'true';
export const DEBUG_CHUNKS = process.env.DEBUG_CHUNKS === 'true';

// ── Concept retrieval tuning ────────────────────────────────────────────────
export const CONCEPT_BOOST = Number(process.env.CONCEPT_BOOST ?? '0.08');
export const CONCEPT_TOP_K = Number(process.env.CONCEPT_TOP_K ?? '3');
export const CONCEPT_MIN_SCORE = Number(process.env.CONCEPT_MIN_SCORE ?? '0.45');

// ── Grounded answer pipeline ────────────────────────────────────────────────
export const ENABLE_GROUNDED_ANSWERS = process.env.ENABLE_GROUNDED_ANSWERS !== 'false'; // on by default
export const ANSWER_MODEL = process.env.ANSWER_MODEL ?? process.env.OLLAMA_MODEL ?? 'phi3:mini';
export const MAX_CONTEXT_TOKENS = Number(process.env.MAX_CONTEXT_TOKENS ?? '500');
export const CONTEXT_TOP_K = Number(process.env.CONTEXT_TOP_K ?? '3');
export const MAX_EVIDENCE_CHUNKS = Number(process.env.MAX_EVIDENCE_CHUNKS ?? '5');
export const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? '128');
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? '120000');

// ── Consolidation tuning ───────────────────────────────────────────────────
export const CONSOLIDATION_BATCH_SIZE = Number(process.env.CONSOLIDATION_BATCH_SIZE ?? '10');
export const CONSOLIDATION_INTERVAL_MS = Number(process.env.CONSOLIDATION_INTERVAL_MS ?? '30000');

// ── Chunk sizing ────────────────────────────────────────────────────────────
export const CHUNK_TARGET_MIN_TOKENS = Number(process.env.CHUNK_TARGET_MIN_TOKENS ?? '350');
export const CHUNK_TARGET_MAX_TOKENS = Number(process.env.CHUNK_TARGET_MAX_TOKENS ?? '500');
export const CHUNK_OVERLAP_TOKENS = Number(process.env.CHUNK_OVERLAP_TOKENS ?? '40');

// ── Retrieval tuning ────────────────────────────────────────────────────────
// Minimum blended score for a result to be returned. Set to 0.35 as a middle
// ground: 0.20 (previous hardcoded value) let in too much noise; 0.40 was the
// documented target but too aggressive before re-ranking was operational.
export const MIN_SCORE = Number(process.env.MIN_SCORE ?? '0.35');

// ── Audio overviews ──────────────────────────────────────────────────────────
export const OVERVIEWS_DIR = process.env.OVERVIEWS_DIR ??
  path.join(process.cwd(), 'overviews');
