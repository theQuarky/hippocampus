// src/retrieve/index.ts
import { createHash, randomUUID } from 'crypto';
import { embed } from '../embed';
import { loadXenova } from '../xenova';
import { db, qdrant, COLLECTION, CONCEPT_COLLECTION, DEFAULT_MEMORY_DB } from '../db';
import { buildChunkConceptMembership, conceptScoreForChunk, predictAssociativeScores } from '../associative';
import { INCLUDE_CONCEPTS, DEBUG_PERF, CONCEPT_BOOST, CONCEPT_TOP_K, CONCEPT_MIN_SCORE, MIN_SCORE } from '../config';
import type { RetrievalLayer } from '../types/evidence';

const MAX_HOPS = 2;
const HOP_DECAY = 0.9;
const MIN_EDGE_WEIGHT = 0.3;
const MAX_RERANK_CANDIDATES = 20;

type RelationshipType = 'supports' | 'contradicts' | 'example_of' | 'caused_by' | 'related_to';

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
  path: string[];
  conflicts: string[];
  rerankScore?: number;   // raw cross-encoder relevance (0–1); present only after re-ranking
}

export interface CandidateChunk {
  chunkId: string;
  score: number;
  hopDepth: number;
  path: string[];
  vectorScore: number;
}

export interface RetrieveOptions {
  topK?: number;
  database?: string;
  maxHops?: number;
  relationshipFilter?: string[];
  includeConflicts?: boolean;
}

type EdgeRow = {
  target_chunk: string;
  weight: number | null;
  relationship: string;
};

type ChunkRow = {
  text: string;
  source: string;
};

const VALID_RELATIONSHIPS = new Set<RelationshipType>([
  'supports',
  'contradicts',
  'example_of',
  'caused_by',
  'related_to',
]);

function sanitizeRelationshipFilter(filter?: string[]): RelationshipType[] | undefined {
  if (!Array.isArray(filter) || filter.length === 0) return undefined;

  const normalized = filter
    .map(value => value.trim().toLowerCase())
    .filter((value): value is RelationshipType => VALID_RELATIONSHIPS.has(value as RelationshipType));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRetrieveArgs(
  topKOrOptions: number | RetrieveOptions | undefined,
  databaseOrOptions?: string | RetrieveOptions,
  options?: RetrieveOptions,
): {
  topK: number;
  database: string;
  maxHops: number;
  includeConflicts: boolean;
  relationshipFilter?: RelationshipType[];
} {
  let topK = 20;
  let database = DEFAULT_MEMORY_DB;
  let mergedOptions: RetrieveOptions = {};

  if (typeof topKOrOptions === 'number') {
    topK = Number.isFinite(topKOrOptions) && topKOrOptions > 0 ? Math.floor(topKOrOptions) : 20;
  } else if (topKOrOptions && typeof topKOrOptions === 'object') {
    mergedOptions = { ...mergedOptions, ...topKOrOptions };
  }

  if (typeof databaseOrOptions === 'string') {
    database = databaseOrOptions || DEFAULT_MEMORY_DB;
  } else if (databaseOrOptions && typeof databaseOrOptions === 'object') {
    mergedOptions = { ...mergedOptions, ...databaseOrOptions };
  }

  if (options && typeof options === 'object') {
    mergedOptions = { ...mergedOptions, ...options };
  }

  if (typeof mergedOptions.topK === 'number' && Number.isFinite(mergedOptions.topK) && mergedOptions.topK > 0) {
    topK = Math.floor(mergedOptions.topK);
  }

  if (typeof mergedOptions.database === 'string' && mergedOptions.database.trim()) {
    database = mergedOptions.database.trim();
  }

  const maxHops =
    typeof mergedOptions.maxHops === 'number' && Number.isFinite(mergedOptions.maxHops)
      ? Math.max(0, Math.floor(mergedOptions.maxHops))
      : MAX_HOPS;

  const includeConflicts = mergedOptions.includeConflicts !== false;
  const relationshipFilter = sanitizeRelationshipFilter(mergedOptions.relationshipFilter);

  return {
    topK,
    database,
    maxHops,
    includeConflicts,
    relationshipFilter,
  };
}

function buildConnectionQuery(filter?: RelationshipType[]): { sql: string; paramsFactory: (chunkId: string, database: string) => unknown[] } {
  if (!filter || filter.length === 0) {
    return {
      sql: `
        SELECT target_chunk, weight, relationship
        FROM connections
        WHERE source_chunk = ?
          AND database_id = ?
          AND weight > ?
      `,
      paramsFactory: (chunkId, database) => [chunkId, database, MIN_EDGE_WEIGHT],
    };
  }

  const placeholders = filter.map(() => '?').join(', ');
  return {
    sql: `
      SELECT target_chunk, weight, relationship
      FROM connections
      WHERE source_chunk = ?
        AND database_id = ?
        AND weight > ?
        AND relationship IN (${placeholders})
    `,
    paramsFactory: (chunkId, database) => [chunkId, database, MIN_EDGE_WEIGHT, ...filter],
  };
}

async function multiHopExpand(
  seeds: CandidateChunk[],
  visited: Set<string>,
  options: {
    database: string;
    maxHops: number;
    relationshipFilter?: RelationshipType[];
  },
): Promise<CandidateChunk[]> {
  if (seeds.length === 0 || options.maxHops <= 0) return [...seeds];

  const allCandidates = new Map<string, CandidateChunk>();
  const queue: CandidateChunk[] = [];

  for (const seed of seeds) {
    queue.push(seed);
    allCandidates.set(seed.chunkId, seed);
  }

  const connectionQuery = buildConnectionQuery(options.relationshipFilter);
  const connectionStmt = db.prepare(connectionQuery.sql);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.hopDepth >= options.maxHops) continue;

    visited.add(current.chunkId);

    const edges = connectionStmt.all(...connectionQuery.paramsFactory(current.chunkId, options.database)) as EdgeRow[];
    for (const edge of edges) {
      const target = edge?.target_chunk;
      const edgeWeight = edge?.weight ?? 0;
      if (!target || edgeWeight <= 0) continue;

      const nextDepth = current.hopDepth + 1;
      const nextScore = current.score * Math.pow(HOP_DECAY, nextDepth) * edgeWeight;
      const nextCandidate: CandidateChunk = {
        chunkId: target,
        score: nextScore,
        hopDepth: nextDepth,
        path: [...current.path, `${target} (w:${edgeWeight.toFixed(2)})`],
        vectorScore: current.vectorScore,
      };

      const existing = allCandidates.get(target);
      if (!existing || nextCandidate.score > existing.score) {
        allCandidates.set(target, nextCandidate);
        if (!visited.has(target) && nextDepth < options.maxHops) {
          queue.push(nextCandidate);
        }
      }
    }
  }

  return Array.from(allCandidates.values());
}

function buildConflictMap(chunkIds: string[], database: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (chunkIds.length < 2) return map;

  const placeholders = chunkIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT source_chunk, target_chunk
    FROM connections
    WHERE database_id = ?
      AND relationship = 'contradicts'
      AND source_chunk IN (${placeholders})
      AND target_chunk IN (${placeholders})
  `).all(database, ...chunkIds, ...chunkIds) as Array<{ source_chunk: string; target_chunk: string }>;

  for (const row of rows) {
    if (!map.has(row.source_chunk)) map.set(row.source_chunk, new Set());
    if (!map.has(row.target_chunk)) map.set(row.target_chunk, new Set());
    map.get(row.source_chunk)!.add(row.target_chunk);
    map.get(row.target_chunk)!.add(row.source_chunk);
  }

  return map;
}

async function recordCoAccess(
  chunkIds: string[],
  queryHash: string,
  queryEmbedding: number[],
  database: string,
): Promise<void> {
  if (chunkIds.length === 0) return;

  const uniqueChunkIds = [...new Set(chunkIds)];
  const timestamp = Date.now();

  db.prepare(`
    INSERT INTO co_access_events (event_id, chunk_ids, query_hash, query_embedding, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    JSON.stringify(uniqueChunkIds),
    queryHash,
    JSON.stringify(queryEmbedding),
    timestamp,
    database,
  );
}

// ── Cross-encoder re-ranker ─────────────────────────────────────────────────
// Xenova/ms-marco-MiniLM-L-6-v2 is a cross-encoder: it takes the full
// [CLS] query [SEP] passage [SEP] sequence and outputs a relevance score.
// @xenova/transformers handles the concatenation via the `text_pair` field.

const RERANK_WEIGHT = 0.4;   // share of cross-encoder score in blended final score

let rerankPipeline: any = null;
let rerankPipelineLoading = false;
let rerankErrorLogged = false;

async function getRerankPipeline(): Promise<any> {
  if (rerankPipeline) return rerankPipeline;
  if (rerankPipelineLoading) return null;   // avoid double-loading

  rerankPipelineLoading = true;
  try {
    const { pipeline } = await loadXenova();
    rerankPipeline = await pipeline(
      'text-classification',
      'Xenova/ms-marco-MiniLM-L-6-v2',
      { quantized: true },   // quantized model: smaller download, same quality
    );
    console.log('✅ Re-ranker loaded: Xenova/ms-marco-MiniLM-L-6-v2');
    return rerankPipeline;
  } catch (err) {
    console.warn('⚠️  Re-ranker model failed to load:', err);
    return null;
  } finally {
    rerankPipelineLoading = false;
  }
}

export async function predictRelevanceScore(query: string, passage: string): Promise<number> {
  try {
    const ranker = await getRerankPipeline();
    if (!ranker) return 0;

    // Cross-encoder input: text = query, text_pair = passage.
    // @xenova/transformers concatenates as [CLS] query [SEP] passage [SEP].
    const result = await ranker(query, { text_pair: passage });

    // Output is [{ label: 'LABEL_0', score: 0.XX }] after softmax — take first score.
    if (Array.isArray(result) && result.length > 0) {
      return result[0].score ?? 0;
    }
    return 0;
  } catch (err) {
    if (!rerankErrorLogged) {
      console.warn('⚠️  Re-ranker scoring failed, falling back to vector scores:', err);
      rerankErrorLogged = true;
    }
    return 0;
  }
}

export async function rerankCandidates(query: string, candidates: Result[]): Promise<Result[]> {
  if (candidates.length === 0) return candidates;

  const ranker = await getRerankPipeline();
  if (!ranker) return candidates;   // graceful fallback: return in original order

  const scored = await Promise.all(
    candidates.map(async (c) => {
      const rerankScore = await predictRelevanceScore(query, c.text);
      return { ...c, rerankScore };
    }),
  );

  // Blend: preserve vector+graph+MLP signal (60%) while lifting relevant passages (40%).
  const blended = scored.map(c => ({
    ...c,
    score: (1 - RERANK_WEIGHT) * c.score + RERANK_WEIGHT * (c.rerankScore ?? 0),
  }));

  return blended.sort((a, b) => b.score - a.score);
}

export async function retrieve(
  query: string,
  topKOrOptions: number | RetrieveOptions = 20,
  databaseOrOptions?: string | RetrieveOptions,
  options?: RetrieveOptions,
): Promise<Result[]> {
  const normalized = normalizeRetrieveArgs(topKOrOptions, databaseOrOptions, options);
  const dbName = normalized.database || DEFAULT_MEMORY_DB;
  const vector = await embed(query);
  const queryHash = createHash('sha256').update(query).digest('hex');

  const seedLimit = Math.max(10, normalized.topK);
  const hits = await qdrant.search(COLLECTION, {
    vector,
    limit: seedLimit,
    with_payload: true,
    filter: {
      must: [
        { key: 'database_id', match: { value: dbName } },
      ],
    },
  });

  if (hits.length === 0) return [];

  const seeds: CandidateChunk[] = [];
  const seedRowsById = new Map<string, ChunkRow>();
  const visited = new Set<string>();

  for (const hit of hits) {
    const payload = hit.payload as any;
    const chunk_id = payload?.chunk_id;
    if (!chunk_id) continue;

    seedRowsById.set(chunk_id, {
      text: payload.text ?? '',
      source: payload.source ?? '',
    });

    seeds.push({
      chunkId: chunk_id,
      score: hit.score ?? 0,
      hopDepth: 0,
      path: [chunk_id],
      vectorScore: hit.score ?? 0,
    });
  }

  const expandedCandidates = await multiHopExpand(seeds, visited, {
    database: dbName,
    maxHops: normalized.maxHops,
    relationshipFilter: normalized.relationshipFilter,
  });

  const chunkStmt = db.prepare(`
    SELECT text, source
    FROM chunks
    WHERE chunk_id = ?
      AND database_id = ?
  `);

  const mergedPool: Array<Result & { vectorScore: number; graphScore: number; mlpConceptScore: number }> = [];
  const seenIds = new Set<string>();

  for (const candidate of expandedCandidates) {
    if (seenIds.has(candidate.chunkId)) continue;

    const seedRow = seedRowsById.get(candidate.chunkId);
    const chunkRow = seedRow ?? (chunkStmt.get(candidate.chunkId, dbName) as ChunkRow | undefined);
    if (!chunkRow) continue;

    seenIds.add(candidate.chunkId);
    mergedPool.push({
      text: chunkRow.text,
      source: chunkRow.source,
      score: candidate.score,
      chunk_id: candidate.chunkId,
      graph_boosted: candidate.hopDepth > 0,
      retrieval_layer: candidate.hopDepth > 0 ? 'graph' : 'vector',
      path: candidate.path,
      conflicts: [],
      vectorScore: candidate.vectorScore,
      graphScore: candidate.hopDepth > 0 ? candidate.score : 0,
      mlpConceptScore: 0,
    });
  }

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
        const weakSeedScore = seeds.length > 0 ? seeds[seeds.length - 1].score : 0.5;

        for (const memberId of memberChunks) {
          if (seenIds.has(memberId)) continue;

          const chunkRow = chunkStmt.get(memberId, dbName) as { text: string; source: string } | undefined;
          if (!chunkRow) continue;

          // Base score = weakest vector hit score, boosted by concept fusion
          const baseScore = weakSeedScore;
          const fusedScore = baseScore + (membershipFactor * CONCEPT_BOOST);

          seenIds.add(memberId);
          mergedPool.push({
            text: chunkRow.text,
            source: chunkRow.source,
            score: fusedScore,
            chunk_id: memberId,
            graph_boosted: true,
            retrieval_layer: 'concept',
            path: [memberId],
            conflicts: [],
            vectorScore: baseScore,
            graphScore: 0,
            mlpConceptScore: 0,
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

  try {
    const { conceptScores, mlpWeight } = await predictAssociativeScores(vector, dbName);
    const chunkConceptMap = buildChunkConceptMembership(dbName);

    for (const candidate of mergedPool) {
      const mlpConceptScore = conceptScoreForChunk(candidate.chunk_id, conceptScores, chunkConceptMap);
      candidate.mlpConceptScore = mlpConceptScore;
      candidate.score =
        (0.6 * candidate.vectorScore) +
        (0.25 * candidate.graphScore) +
        (mlpWeight * mlpConceptScore);
    }
  } catch (error) {
    if (DEBUG_PERF) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Associative rerank skipped: ${msg}`);
    }
  }

  mergedPool.sort((a, b) => b.score - a.score);
  const rescored = rescorePool(mergedPool).map(candidate => ({
    text: candidate.text,
    source: candidate.source,
    score: candidate.score,
    chunk_id: candidate.chunk_id,
    graph_boosted: candidate.graph_boosted,
    retrieval_layer: candidate.retrieval_layer,
    path: candidate.path,
    conflicts: candidate.conflicts,
  }));
  rescored.sort((a, b) => b.score - a.score);

  if (normalized.includeConflicts) {
    const conflictMap = buildConflictMap(rescored.map(r => r.chunk_id), dbName);
    for (const result of rescored) {
      result.conflicts = Array.from(conflictMap.get(result.chunk_id) ?? []);
    }
  }

  if (rescored.length <= 1) {
    for (const result of rescored) {
      db.prepare(`
        UPDATE chunks
        SET access_count = access_count + 1,
            last_accessed = ?
        WHERE chunk_id = ?
          AND database_id = ?
      `).run(new Date().toISOString(), result.chunk_id, dbName);
    }

    await recordCoAccess(rescored.map(r => r.chunk_id), queryHash, vector, dbName);

    return rescored;
  }

  const topCandidates = rescored.slice(0, MAX_RERANK_CANDIDATES);
  const reranked = await rerankCandidates(query, topCandidates);
  const filtered = reranked
    .filter(c => c.score >= MIN_SCORE)
    .slice(0, normalized.topK);

  if (filtered.length === 0) return [];

  for (const result of filtered) {
    const chunk_id = result.chunk_id;

    db.prepare(`
      UPDATE chunks
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE chunk_id = ?
        AND database_id = ?
    `).run(new Date().toISOString(), chunk_id, dbName);
  }

  await recordCoAccess(filtered.map(r => r.chunk_id), queryHash, vector, dbName);

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
export async function retrieveByVector(embedding: number[], k: number = 10, database: string = DEFAULT_MEMORY_DB): Promise<Result[]> {
  const dbName = database || DEFAULT_MEMORY_DB;
  const hits = await qdrant.search(COLLECTION, {
    vector: embedding,
    limit: k,
    with_payload: true,
    filter: {
      must: [
        { key: 'database_id', match: { value: dbName } },
      ],
    },
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
      path: [chunk_id],
      conflicts: [],
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
  database: string = DEFAULT_MEMORY_DB,
): Promise<Result[]> {
  const dbName = database || DEFAULT_MEMORY_DB;
  try {
    const conceptHits = await qdrant.search(CONCEPT_COLLECTION, {
      vector: embedding,
      limit: topK,
      with_payload: true,
      score_threshold: CONCEPT_MIN_SCORE,
      filter: {
        must: [
          { key: 'database_id', match: { value: dbName } },
        ],
      },
    });

    if (conceptHits.length === 0) return [];

    const chunkStmt = db.prepare('SELECT text, source FROM chunks WHERE chunk_id = ? AND database_id = ?');
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

        const chunkRow = chunkStmt.get(memberId, dbName) as { text: string; source: string } | undefined;
        if (!chunkRow) continue;

        const fusedScore = membershipFactor * CONCEPT_BOOST + conceptSimilarity;

        results.push({
          text: chunkRow.text,
          source: chunkRow.source,
          score: fusedScore,
          chunk_id: memberId,
          graph_boosted: true,
          retrieval_layer: 'concept',
          path: [memberId],
          conflicts: [],
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

export async function retrieveConcepts(query: string, topK: number = CONCEPT_TOP_K, database: string = DEFAULT_MEMORY_DB): Promise<ConceptResult[]> {
  const t0 = DEBUG_PERF ? Date.now() : 0;
  const dbName = database || DEFAULT_MEMORY_DB;

  try {
    const vector = await embed(query);
    const hits = await qdrant.search(CONCEPT_COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
      score_threshold: CONCEPT_MIN_SCORE,
      filter: {
        must: [
          { key: 'database_id', match: { value: dbName } },
        ],
      },
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
