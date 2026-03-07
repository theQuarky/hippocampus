// src/retrieve.ts
import { embed } from './embed';
import { db, qdrant, COLLECTION, CONCEPT_COLLECTION } from './db';
import { INCLUDE_CONCEPTS, DEBUG_PERF, CONCEPT_BOOST, CONCEPT_TOP_K, CONCEPT_MIN_SCORE } from './config';

const GRAPH_BOOST_FACTOR = 0.05;
const MAX_RERANK_CANDIDATES = 20;

type CrossEncoder = (input: any, options?: any) => Promise<any>;
let crossEncoderPromise: Promise<CrossEncoder | null> | null = null;




async function getCrossEncoder() {
  const { pipeline, env } = await import('@xenova/transformers') as any;
  env.allowLocalModels = false;

  if (!crossEncoderPromise) {
    crossEncoderPromise = (async () => {
      try {
        return await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2');
      } catch (error) {
        console.error('❌ Re-ranker load failed:', error);
        return null;
      }
    })();
  }
  return crossEncoderPromise;
}
export async function warmupReranker(): Promise<void> {
  const startedAt = Date.now();
  const model = await getCrossEncoder();
  const elapsedMs = Date.now() - startedAt;

  if (model) {
    console.log(`🔥 Re-ranker warmup complete in ${elapsedMs}ms`);
  }
}

function extractScore(output: any): number | undefined {
  if (typeof output === 'number') return output;

  if (Array.isArray(output)) {
    if (output.length === 0) return undefined;

    const first = output[0];
    if (Array.isArray(first)) return extractScore(first[0]);
    if (first && typeof first.score === 'number') return first.score;

    return extractScore(first);
  }

  if (output && typeof output.score === 'number') return output.score;
  if (output && output.data) return extractScore(output.data);

  return undefined;
}

async function predictRelevanceScore(crossEncoder: CrossEncoder, query: string, candidateText: string): Promise<number> {
  const attempts = [
    () => crossEncoder(query, { text_pair: candidateText, topk: 1 }),
    () => crossEncoder({ text: query, text_pair: candidateText }, { topk: 1 }),
    () => crossEncoder([query, candidateText], { topk: 1 }),
    () => crossEncoder([[query, candidateText]], { topk: 1 })
  ];

  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const output = await attempt();
      const score = extractScore(output);

      if (typeof score === 'number' && Number.isFinite(score)) {
        return score;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to extract rerank score from cross-encoder output${lastError ? `: ${String(lastError)}` : ''}`);
}

// async function rerankCandidates(query: string, candidates: Result[]): Promise<Result[]> {
//   if (candidates.length <= 1) return candidates;

//   const crossEncoder = await getCrossEncoder();
//   if (!crossEncoder) return candidates;

//   const startedAt = Date.now();

//   try {
//     const reranked: Result[] = [];

//     for (const candidate of candidates) {
//       const rerank_score = await predictRelevanceScore(crossEncoder, query, candidate.text);
//       reranked.push({
//         ...candidate,
//         rerank_score
//       });
//     }

//     reranked.sort((a, b) => (b.rerank_score ?? Number.NEGATIVE_INFINITY) - (a.rerank_score ?? Number.NEGATIVE_INFINITY));

//     const elapsedMs = Date.now() - startedAt;
//     console.log(`🔢 Re-ranked ${reranked.length} candidates in ${elapsedMs}ms`);

//     return reranked;
//   } catch (error) {
//     console.warn('⚠️ Re-ranking failed. Falling back to vector/graph score ordering.', error);
//     return candidates;
//   }
// }

// Replace rerankCandidates with a no-op that just returns sorted by score
async function rerankCandidates(query: string, candidates: Result[]): Promise<Result[]> {
  return candidates; // vector + graph scores are good enough
}

export interface Result {
  text: string;
  source: string;
  score: number;
  chunk_id: string;
  graph_boosted: boolean;
  rerank_score?: number;
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
      graph_boosted: false
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
          graph_boosted: true
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

  if (mergedPool.length <= 1) {
    for (const result of mergedPool) {
      db.prepare(`
        UPDATE chunks
        SET access_count = access_count + 1,
            last_accessed = ?
        WHERE chunk_id = ?
      `).run(new Date().toISOString(), result.chunk_id);
    }

    return mergedPool;
  }

  const rerankPool = mergedPool.slice(0, MAX_RERANK_CANDIDATES);
  const rankedPool = await rerankCandidates(query, rerankPool);

  const filtered = rankedPool
    .filter(candidate => {
      const s = candidate.rerank_score ?? candidate.score ?? 0;
      return s >= MIN_SCORE;
    })
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
