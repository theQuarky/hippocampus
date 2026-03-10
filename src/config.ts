// src/config.ts — Single source of truth for all configurable parameters
// Override any value via environment variables.

// ── Embedding model ─────────────────────────────────────────────────────────
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIMS = Number(process.env.EMBED_DIMS ?? '384');
export const EMBED_MAX_TOKENS = Number(process.env.EMBED_MAX_TOKENS ?? '512');
export const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? '8');

// ── Qdrant ──────────────────────────────────────────────────────────────────
export const QDRANT_URL = process.env.QDRANT_URL ?? 'http://localhost:6333';
export const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION ?? 'hippocampus';

// ── Ollama (for consolidation / LLM chunking) ──────────────────────────────
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'phi3:mini';

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
export const MAX_CONTEXT_TOKENS = Number(process.env.MAX_CONTEXT_TOKENS ?? '3000');
export const CONTEXT_TOP_K = Number(process.env.CONTEXT_TOP_K ?? '12');

// ── Consolidation tuning ───────────────────────────────────────────────────
export const CONSOLIDATION_BATCH_SIZE = Number(process.env.CONSOLIDATION_BATCH_SIZE ?? '10');
export const CONSOLIDATION_INTERVAL_MS = Number(process.env.CONSOLIDATION_INTERVAL_MS ?? '30000');

// ── Chunk sizing ────────────────────────────────────────────────────────────
export const CHUNK_TARGET_MIN_TOKENS = Number(process.env.CHUNK_TARGET_MIN_TOKENS ?? '350');
export const CHUNK_TARGET_MAX_TOKENS = Number(process.env.CHUNK_TARGET_MAX_TOKENS ?? '500');
export const CHUNK_OVERLAP_TOKENS = Number(process.env.CHUNK_OVERLAP_TOKENS ?? '40');
