// src/retrieve.ts
import { embed } from './embed';
import { db, qdrant, COLLECTION } from './db';

export interface Result {
  text: string;
  source: string;
  score: number;
  chunk_id: string;
}

export async function retrieve(query: string, topK: number = 5): Promise<Result[]> {
  // Step 1: Embed query
  const vector = await embed(query);

  // Step 2: Vector search
  const hits = await qdrant.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true
  });

  // Step 3: Update access count in SQLite + return results
  const results: Result[] = [];

  for (const hit of hits) {
    const payload = hit.payload as any;
    const chunk_id = payload.chunk_id;

    // Update access stats
    db.prepare(`
      UPDATE chunks
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE chunk_id = ?
    `).run(new Date().toISOString(), chunk_id);

    results.push({
      text: payload.text,
      source: payload.source,
      score: hit.score,
      chunk_id
    });
  }

  return results;
}