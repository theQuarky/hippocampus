// src/ingest.ts
import { v4 as uuidv4 } from 'uuid';
import { embed } from './embed';
import { parseFile } from './parser';
import { semanticChunkText } from './semanticChunk';
import { db, qdrant, COLLECTION } from './db';

type SimilarChunkHit = {
  score?: number;
  payload?: {
    chunk_id?: string;
  };
};

async function topSimilarityScore(vector: number[]): Promise<number> {
  try {
    const results = await qdrant.search(COLLECTION, {
      vector,
      limit: 1,
      with_payload: false,
      with_vector: false,
    });

    if (!results || results.length === 0) return 0;
    return results[0].score ?? 0;
  } catch {
    return 0;
  }
}

async function checkDuplicate(vector: number[], threshold: number): Promise<boolean> {
  const score = await topSimilarityScore(vector);
  return score >= threshold;
}

async function findSimilarExistingChunks(vector: number[], limit: number = 5): Promise<string[]> {
  try {
    const results = await qdrant.search(COLLECTION, {
      vector,
      limit,
      with_payload: true,
      with_vector: false,
    }) as SimilarChunkHit[];

    return results
      .map(r => r.payload?.chunk_id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

function seedConnections(sourceChunkId: string, targetChunkIds: string[], timestamp: string): number {
  if (targetChunkIds.length === 0) return 0;

  const existsStmt = db.prepare(`
    SELECT edge_id
    FROM connections
    WHERE source_chunk = ?
      AND target_chunk = ?
      AND relationship = 'related_to'
    LIMIT 1
  `);

  const insertStmt = db.prepare(`
    INSERT INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let created = 0;
  for (const targetChunkId of targetChunkIds) {
    if (targetChunkId === sourceChunkId) continue;
    const existing = existsStmt.get(sourceChunkId, targetChunkId) as { edge_id: string } | undefined;
    if (existing) continue;

    insertStmt.run(
      uuidv4(),
      sourceChunkId,
      targetChunkId,
      'related_to',
      0.3,
      0.5,
      timestamp,
      null
    );
    created++;
  }

  return created;
}

export async function ingest(filePath: string, tags: string[] = []): Promise<void> {
  console.log(`\n📥 Ingesting: ${filePath}`);

  const text = await parseFile(filePath);
  console.log(`   Parsed ${text.length} characters`);

  const chunks = await semanticChunkText(text);
  console.log(`   Created ${chunks.length} semantic chunks`);

  const source = filePath.split('/').pop() || filePath;
  const duplicateThreshold = 0.97;
  let stored = 0;
  let skipped = 0;
  let seededConnections = 0;

  for (const chunk of chunks) {
    const chunk_id = uuidv4();
    const vector = await embed(chunk.text);
    const similarExistingChunkIds = await findSimilarExistingChunks(vector, 5);

    const isDuplicate = await checkDuplicate(vector, duplicateThreshold);
    if (isDuplicate) {
      const score = await topSimilarityScore(vector);
      skipped++;
      console.warn(`⚠️  Skipping duplicate chunk (score: ${score.toFixed(4)}) from [${source}]`);
      process.stdout.write(`\r   Stored ${stored}/${chunks.length} | Skipped ${skipped}`);
      continue;
    }

    const timestamp = new Date().toISOString();

    await qdrant.upsert(COLLECTION, {
      points: [{
        id: chunk_id,
        vector,
        payload: { text: chunk.text, source, chunk_id }
      }]
    });

    db.prepare(`
      INSERT INTO chunks (chunk_id, text, source, page, timestamp, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chunk_id, chunk.text, source, chunk.index, timestamp, JSON.stringify(tags));

    seededConnections += seedConnections(chunk_id, similarExistingChunkIds, timestamp);

    stored++;
    process.stdout.write(`\r   Stored ${stored}/${chunks.length} | Skipped ${skipped}`);
  }

  console.log(`\n✅ Ingested ${stored} chunks from ${source} (skipped ${skipped} duplicates, seeded ${seededConnections} connections)\n`);
}