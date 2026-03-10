// src/retrieve/index.ts
import { embed } from '../embed';
import { db, qdrant, COLLECTION, CONCEPT_COLLECTION } from '../db';
import { INCLUDE_CONCEPTS, DEBUG_PERF, CONCEPT_BOOST, CONCEPT_TOP_K, CONCEPT_MIN_SCORE } from '../config';
import type { RetrievalLayer } from '../types/evidence';

const GRAPH_BOOST_FACTOR = 0.05;
const MAX_RERANK_CANDIDATES = 20;

/**
 * Rescale scores to spread out tightly clustered results.
 * All-MiniLM-L6-v2 compresses cosine similarities into ~0.50–0.75.
 * We apply a power curve relative to the top score so the best result
 * stays at its raw value but weaker results fall off faster.
 */
function rescorePool(candidates: Result[]): Result[] {
  if (candidates.length === 0) return candidates;
  const top = candidates[0].score;
  if (top <= 0) return candidates;
  return candidates.map(c => ({
    ...c,
    score: top * Math.pow(c.score / top, 2.5),
  }));
}

export interface Result {
  text: string;
  source: string;
  score: number;
  chunk_id: string;
  graph_boosted: boolean;
  retrieval_layer: RetrievalLayer;
}

export async function retrieve(query: string, topK: number = 20): Promise<Result[]> {
  const vector = await embed(query);
  const hits = await qdrant.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true
  });

  if (hits.length === 0) return [];

  const MIN_SCORE = 0.40;

  const vectorCandidates: Result[] = [];
  const vectorChunkIds = new Set<string>();

  for (const hit of hits) {
    const payload = hit.payload as any;
    const chunk_id = payload?.chunk_id;
    if (!chunk_id) continue;

    vectorChunkIds.add(chunk_id);
    vectorCandidates.push({
      text: payload.text,
      source: payload.source,
      score: hit.score ?? 0,
      chunk_id,
      graph_boosted: false,
      retrieval_layer: 'vector',
    });
  }

  const graphCandidatesById = new Map<string, Result>();
  const connectionStmt = db.prepare(`
    SELECT target_chunk, weight
    FROM connections
    WHERE source_chunk = ?
  `);
  const chunkStmt = db.prepare(`
    SELECT text, source
    FROM chunks
    WHERE chunk_id = ?
  `);

  for (const vectorResult of vectorCandidates) {
    const neighbors = connectionStmt.all(vectorResult.chunk_id) as Array<{ target_chunk: string; weight: number | null }>;

    for (const neighbor of neighbors) {
      if (!neighbor?.target_chunk) continue;
      if (vectorChunkIds.has(neighbor.target_chunk)) continue;

      const chunkRow = chunkStmt.get(neighbor.target_chunk) as { text: string; source: string } | undefined;
      if (!chunkRow) continue;

      const boostedScore = vectorResult.score + ((neighbor.weight ?? 0) * GRAPH_BOOST_FACTOR);
      const existing = graphCandidatesById.get(neighbor.target_chunk);

      if (!existing || boostedScore > existing.score) {
        graphCandidatesById.set(neighbor.target_chunk, {
          text: chunkRow.text,
          source: chunkRow.source,
          score: boostedScore,
          chunk_id: neighbor.target_chunk,
          graph_boosted: true,
          retrieval_layer: 'graph',
        });
      }
    }
  }

  const mergedPool = [...vectorCandidates, ...graphCandidatesById.values()];

  // PHASE 6: Concept-boosted retrieval via dedicated Qdrant collection
  if (INCLUDE_CONCEPTS) {
    const t0 = DEBUG_PERF ? Date.now() : 0;
    try {
      // Search the concept vector collection — no in-process embedding needed
      const conceptHits = await qdrant.search(CONCEPT_COLLECTION, {
        vector,
        limit: CONCEPT_TOP_K,
        with_payload: true,
        score_threshold: CONCEPT_MIN_SCORE,
      });

      let expandedCount = 0;

      for (const hit of conceptHits) {
        const payload = hit.payload as any;
        if (!payload) continue;

        const conceptSimilarity = hit.score ?? 0;
        const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.5;

        // Parse member_chunks from payload
        let memberChunks: string[] = [];
        if (Array.isArray(payload.member_chunks)) {
          memberChunks = payload.member_chunks;
        } else if (typeof payload.member_chunks === 'string') {
          try { memberChunks = JSON.parse(payload.member_chunks); } catch { continue; }
        } else {
          continue;
        }

        // Score fusion: concept_similarity * (0.5 + 0.5 * confidence) * CONCEPT_BOOST
        // Then add to the base score of the weakest vector candidate
        const membershipFactor = conceptSimilarity * (0.5 + 0.5 * confidence);

        for (const memberId of memberChunks) {
          if (vectorChunkIds.has(memberId)) continue;
          if (graphCandidatesById.has(memberId)) continue;

          const chunkRow = chunkStmt.get(memberId) as { text: string; source: string } | undefined;
          if (!chunkRow) continue;

          // Base score = weakest vector hit score, boosted by concept fusion
          const baseScore = vectorCandidates.length > 0
            ? vectorCandidates[vectorCandidates.length - 1].score
            : 0.5;
          const fusedScore = baseScore + (membershipFactor * CONCEPT_BOOST);

          mergedPool.push({
            text: chunkRow.text,
            source: chunkRow.source,
            score: fusedScore,
            chunk_id: memberId,
            graph_boosted: true,
            retrieval_layer: 'concept',
          });
          expandedCount++;
        }
      }

      if (DEBUG_PERF) {
        const elapsed = Date.now() - t0;
        console.log(`[PERF] Concept search: ${conceptHits.length} hits, ${expandedCount} chunks expanded, ${elapsed}ms`);
      }
    } catch (error) {
      // Concept retrieval is optional — don't fail the query
      if (DEBUG_PERF) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  Concept retrieval failed: ${msg}`);
      }
    }
  }

  mergedPool.sort((a, b) => b.score - a.score);
  const rescored = rescorePool(mergedPool);
  rescored.sort((a, b) => b.score - a.score);

  if (rescored.length <= 1) {
    for (const result of rescored) {
      db.prepare(`
        UPDATE chunks
        SET access_count = access_count + 1,
            last_accessed = ?
        WHERE chunk_id = ?
      `).run(new Date().toISOString(), result.chunk_id);
    }

    return rescored;
  }

  const filtered = rescored
    .slice(0, MAX_RERANK_CANDIDATES)
    .filter((candidate: Result) => candidate.score >= MIN_SCORE)
    .slice(0, 5);

  if (filtered.length === 0) return [];

  for (const result of filtered) {
    const chunk_id = result.chunk_id;

    db.prepare(`
      UPDATE chunks
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE chunk_id = ?
    `).run(new Date().toISOString(), chunk_id);
  }

  return filtered;
}

// ── Concept retrieval for grounded answer pipeline ─────────────────────────

export interface ConceptResult {
  concept_id: string;
  label: string;
  summary: string;
  confidence: number;
}

// ── Modular pipeline functions (used by queryAnswer) ───────────────────────

/**
 * Vector-only search: takes a pre-computed embedding and returns top-k chunks.
 * Does NOT embed internally — the caller is responsible for embedding.
 */
export async function retrieveByVector(embedding: number[], k: number = 10): Promise<Result[]> {
  const hits = await qdrant.search(COLLECTION, {
    vector: embedding,
    limit: k,
    with_payload: true,
  });

  if (hits.length === 0) return [];

  const results: Result[] = [];
  for (const hit of hits) {
    const payload = hit.payload as any;
    const chunk_id = payload?.chunk_id;
    if (!chunk_id) continue;

    results.push({
      text: payload.text ?? '',
      source: payload.source ?? '',
      score: hit.score ?? 0,
      chunk_id,
      graph_boosted: false,
      retrieval_layer: 'vector',
    });
  }

  return results;
}

/**
 * Expand retrieval using the concept graph.
 * Finds concepts related to the query embedding, then retrieves member chunks.
 */
export async function expandWithConcepts(
  embedding: number[],
  maxChunks: number = 20,
  topK: number = CONCEPT_TOP_K,
): Promise<Result[]> {
  try {
    const conceptHits = await qdrant.search(CONCEPT_COLLECTION, {
      vector: embedding,
      limit: topK,
      with_payload: true,
      score_threshold: CONCEPT_MIN_SCORE,
    });

    if (conceptHits.length === 0) return [];

    const chunkStmt = db.prepare('SELECT text, source FROM chunks WHERE chunk_id = ?');
    const results: Result[] = [];

    for (const hit of conceptHits) {
      const payload = hit.payload as any;
      if (!payload) continue;

      const conceptSimilarity = hit.score ?? 0;
      const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.5;

      let memberChunks: string[] = [];
      if (Array.isArray(payload.member_chunks)) {
        memberChunks = payload.member_chunks;
      } else if (typeof payload.member_chunks === 'string') {
        try { memberChunks = JSON.parse(payload.member_chunks); } catch { continue; }
      } else {
        continue;
      }

      const membershipFactor = conceptSimilarity * (0.5 + 0.5 * confidence);

      for (const memberId of memberChunks) {
        if (results.length >= maxChunks) break;

        const chunkRow = chunkStmt.get(memberId) as { text: string; source: string } | undefined;
        if (!chunkRow) continue;

        const fusedScore = membershipFactor * CONCEPT_BOOST + conceptSimilarity;

        results.push({
          text: chunkRow.text,
          source: chunkRow.source,
          score: fusedScore,
          chunk_id: memberId,
          graph_boosted: true,
          retrieval_layer: 'concept',
        });
      }

      if (results.length >= maxChunks) break;
    }

    return results;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  expandWithConcepts failed: ${msg}`);
    return [];
  }
}

/**
 * Merge multiple result arrays, deduplicating by chunk_id.
 * When duplicates exist, the entry with the highest score is kept.
 */
export function mergeChunks(...arrays: Result[][]): Result[] {
  const byId = new Map<string, Result>();

  for (const arr of arrays) {
    for (const chunk of arr) {
      const existing = byId.get(chunk.chunk_id);
      if (!existing || chunk.score > existing.score) {
        byId.set(chunk.chunk_id, chunk);
      }
    }
  }

  return Array.from(byId.values());
}

/**
 * Rank chunks by score descending. Optionally boost concept-layer results.
 */
export function rankChunks(chunks: Result[], conceptBoost: number = CONCEPT_BOOST): Result[] {
  const boosted = chunks.map(chunk => {
    if (chunk.retrieval_layer === 'concept') {
      return { ...chunk, score: chunk.score + conceptBoost };
    }
    return chunk;
  });

  return boosted.sort((a, b) => b.score - a.score);
}

// ── Concept retrieval for grounded answer pipeline ─────────────────────────

export async function retrieveConcepts(query: string, topK: number = CONCEPT_TOP_K): Promise<ConceptResult[]> {
  const t0 = DEBUG_PERF ? Date.now() : 0;

  try {
    const vector = await embed(query);
    const hits = await qdrant.search(CONCEPT_COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
      score_threshold: CONCEPT_MIN_SCORE,
    });

    const results: ConceptResult[] = [];

    for (const hit of hits) {
      const payload = hit.payload as any;
      if (!payload) continue;

      const conceptId = payload.concept_id ?? '';
      const label = payload.label ?? '';
      const summary = payload.summary ?? '';
      const confidence = typeof payload.confidence === 'number' ? payload.confidence : 0.5;

      if (!label) continue;

      results.push({
        concept_id: conceptId,
        label,
        summary,
        confidence,
      });
    }

    if (DEBUG_PERF) {
      console.log(`[PERF] concept_retrieval: ${Date.now() - t0}ms (${results.length} concepts)`);
    }

    return results;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (DEBUG_PERF) console.warn(`⚠️  Concept retrieval failed: ${msg}`);
    return [];
  }
}
