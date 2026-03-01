// src/retrieve.ts
import { embed } from './embed';
import { db, qdrant, COLLECTION } from './db';

const GRAPH_BOOST_FACTOR = 0.15;
// Example: vector score 0.72 + (connection weight 0.3 * boost factor 0.15) = 0.765

export interface Result {
  text: string;
  source: string;
  score: number;
  chunk_id: string;
  graph_boosted: boolean;
}

export async function retrieve(query: string, topK: number = 20): Promise<Result[]> {
  const vector = await embed(query);
  const hits = await qdrant.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true
  });

  if (hits.length === 0) return [];

  const best = hits[0].score ?? 0;

  const MIN_SCORE = 0.40;
  const MAX_DROP_FROM_BEST = 0.12;

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

  const mergedPool = [...vectorCandidates, ...graphCandidatesById.values()]
    .sort((a, b) => b.score - a.score);

  const filtered = mergedPool
    .filter(candidate => {
      const s = candidate.score ?? 0;
      return s >= MIN_SCORE && (best - s) <= MAX_DROP_FROM_BEST;
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

