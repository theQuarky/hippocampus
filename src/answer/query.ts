// src/answer/query.ts — Full query-answer pipeline
import { embed } from '../embed';
import { retrieveByVector, retrieveConcepts, expandWithConcepts, mergeChunks, rankChunks } from '../retrieve';
import type { Result, ConceptResult } from '../retrieve';
import { buildContext } from './context';
import { generateGroundedAnswer, warmupModel } from './generator';
import { db, DEFAULT_MEMORY_DB } from '../db';
import { CONTEXT_TOP_K, INCLUDE_CONCEPTS, DEBUG_PERF, MAX_EVIDENCE_CHUNKS } from '../config';
import type { EvidenceBundle, EvidenceChunk } from '../types/evidence';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GraphEdge {
  source_chunk: string;
  target_chunk: string;
  relationship: string;
  weight: number;
}

export interface ConceptDetail {
  concept_id: string;
  label: string;
  confidence: number;
}

export interface QueryAnswerResult {
  answer: string;
  evidence: EvidenceChunk[];
  concepts_used: string[];
  concepts_detail: ConceptDetail[];
  graph_edges: GraphEdge[];
  sources: string[];
  database: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lookup graph connections between a set of chunk IDs.
 * Used for the explainability contract — shows which edges connect
 * the returned evidence chunks.
 */
function lookupGraphEdges(chunkIds: string[], database: string): GraphEdge[] {
  if (chunkIds.length < 2) return [];

  try {
    const placeholders = chunkIds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT source_chunk, target_chunk, relationship, weight
      FROM connections
      WHERE source_chunk IN (${placeholders})
        AND target_chunk IN (${placeholders})
        AND database_id = ?
      ORDER BY weight DESC
    `).all(...chunkIds, ...chunkIds, database) as GraphEdge[];

    return rows;
  } catch {
    return [];
  }
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Full Hippocampus query-answer pipeline:
 *
 *  1. Embed the question
 *  2. Retrieve top-k chunks from Qdrant via vector search
 *  3. Retrieve related concepts
 *  4. Expand retrieval using concept graph (member chunks)
 *  5. Merge and deduplicate chunks (by chunk_id, keep highest score)
 *  6. Rank chunks by similarity (concept-layer boost applied)
 *  7. Build structured context (token-budgeted)
 *  8. Generate final answer using LLM
 *  9. Collect graph connections for explainability
 */
export async function queryAnswer(question: string, database: string = DEFAULT_MEMORY_DB): Promise<QueryAnswerResult> {
  const t0 = Date.now();
  const dbName = database || DEFAULT_MEMORY_DB;

  // Warm up the LLM model while we embed + retrieve (avoids cold-start timeout)
  const warmupPromise = warmupModel();

  // Step 1: Embed the question (single embedding call, reused everywhere)
  const embedding = await embed(question);
  if (DEBUG_PERF) console.log(`[PIPELINE] embed: ${Date.now() - t0}ms`);

  // Step 2: Retrieve top-k chunks from Qdrant via vector search
  const tRetrieve = Date.now();
  const retrieved = await retrieveByVector(embedding, CONTEXT_TOP_K, dbName);
  if (DEBUG_PERF) console.log(`[PIPELINE] retrieval: ${Date.now() - tRetrieve}ms  (${retrieved.length} chunks, top_k=${CONTEXT_TOP_K})`);

  // Wait for warmup to finish before we call generate
  await warmupPromise;

  // Step 3 & 4: Retrieve concepts and expand retrieval with concept neighbours
  let expandedChunks: Result[] = [];
  let concepts: ConceptResult[] = [];

  if (INCLUDE_CONCEPTS) {
    const tConcepts = Date.now();
    concepts = await retrieveConcepts(question, undefined, dbName);
    expandedChunks = await expandWithConcepts(embedding, 20, undefined, dbName);
    if (DEBUG_PERF) console.log(`[PERF] concept expansion: ${Date.now() - tConcepts}ms (${concepts.length} concepts, ${expandedChunks.length} expanded chunks)`);
  }

  // Step 5: Merge and deduplicate chunks
  const merged = mergeChunks(retrieved, expandedChunks);

  // Step 6: Rank by similarity (with concept boost)
  const ranked = rankChunks(merged);

  // Step 7: Build evidence bundle
  const evidenceChunks: EvidenceChunk[] = ranked.map(c => ({
    chunk_id: c.chunk_id,
    text: typeof c.text === 'string' ? c.text : '',
    source: typeof c.source === 'string' ? c.source : '',
    score: typeof c.score === 'number' ? c.score : 0,
    retrieval_layer: c.retrieval_layer ?? 'vector',
  }));

  const evidenceBundle: EvidenceBundle = {
    chunks: evidenceChunks,
    concepts: concepts.map(c => ({
      concept_id: typeof c.concept_id === 'string' ? c.concept_id : '',
      label: typeof c.label === 'string' ? c.label : '',
      confidence: typeof c.confidence === 'number' ? c.confidence : 0,
    })),
  };

  // Step 8: Build structured context
  const tContext = Date.now();
  const contextPackage = buildContext(
    question,
    ranked.map(c => ({
      chunk_id: c.chunk_id,
      text: typeof c.text === 'string' ? c.text : '',
      source: typeof c.source === 'string' ? c.source : '',
      score: typeof c.score === 'number' ? c.score : 0,
    })),
    concepts.length > 0 ? concepts : undefined,
  );
  if (DEBUG_PERF) console.log(`[PIPELINE] context_build: ${Date.now() - tContext}ms  (${contextPackage.chunkIds.length} chunks used, context_chars=${contextPackage.contextText.length})`);

  // Step 9: Generate final answer using LLM
  const tAnswer = Date.now();
  const result = await generateGroundedAnswer(question, contextPackage, evidenceBundle);
  if (DEBUG_PERF) console.log(`[PIPELINE] answer_generation: ${Date.now() - tAnswer}ms`);

  // Step 10: Graph edge lookup for explainability
  const topEvidence = evidenceChunks.slice(0, MAX_EVIDENCE_CHUNKS);
  const graphEdges = lookupGraphEdges(topEvidence.map(e => e.chunk_id), dbName);

  // Build concepts_detail with full info
  const conceptsDetail: ConceptDetail[] = concepts.map(c => ({
    concept_id: c.concept_id,
    label: c.label,
    confidence: c.confidence,
  }));

  if (DEBUG_PERF) console.log(`[PIPELINE] total: ${Date.now() - t0}ms`);

  return {
    answer: result.answer,
    evidence: topEvidence,
    concepts_used: result.concepts_used,
    concepts_detail: conceptsDetail,
    graph_edges: graphEdges,
    sources: result.sources,
    database: dbName,
  };
}
