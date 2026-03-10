// src/concepts/sync.ts — Syncs concept embeddings into a dedicated Qdrant collection.
// Only re-embeds concepts whose `version` has changed since last sync.

import { db, qdrant, CONCEPT_COLLECTION } from '../db';
import { embedBatch } from '../embed';
import { EMBED_BATCH_SIZE, DEBUG_PERF } from '../config';

interface ConceptRow {
  concept_id: string;
  label: string;
  summary: string;
  confidence: number;
  version: number;
  embedding_version: number;
  member_chunks: string;
}

/**
 * Sync stale concept embeddings into the Qdrant concept collection.
 *
 * A concept is "stale" when its SQLite `version` exceeds its `embedding_version`.
 * After embedding, we upsert into Qdrant and update the tracking columns.
 *
 * @param limit  Maximum number of concepts to sync per call (default: all stale)
 */
export async function syncConceptEmbeddings(limit?: number): Promise<{ synced: number; skipped: number }> {
  const t0 = Date.now();

  // Select concepts where embedding is out-of-date
  const query = limit
    ? `SELECT concept_id, label, summary, confidence, version,
              COALESCE(embedding_version, 0) AS embedding_version, member_chunks
       FROM concepts
       WHERE COALESCE(embedding_version, 0) < COALESCE(version, 1)
       LIMIT ?`
    : `SELECT concept_id, label, summary, confidence, version,
              COALESCE(embedding_version, 0) AS embedding_version, member_chunks
       FROM concepts
       WHERE COALESCE(embedding_version, 0) < COALESCE(version, 1)`;

  const stale: ConceptRow[] = limit
    ? (db.prepare(query).all(limit) as ConceptRow[])
    : (db.prepare(query).all() as ConceptRow[]);

  if (stale.length === 0) {
    if (DEBUG_PERF) console.log('[PERF] conceptSync: 0 stale concepts, nothing to sync');
    return { synced: 0, skipped: 0 };
  }

  // Filter out concepts with empty summaries
  const valid = stale.filter(c => c.summary && c.summary.trim().length > 0);
  const skipped = stale.length - valid.length;

  if (valid.length === 0) {
    return { synced: 0, skipped };
  }

  const updateStmt = db.prepare(`
    UPDATE concepts
    SET embedding_version = ?, embedding_updated_at = ?
    WHERE concept_id = ?
  `);

  let synced = 0;

  // Process in batches
  for (let i = 0; i < valid.length; i += EMBED_BATCH_SIZE) {
    const batch = valid.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(c => c.summary);

    let vectors: number[][];
    try {
      vectors = await embedBatch(texts);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  conceptSync embedBatch failed: ${msg}`);
      continue;
    }

    if (vectors.length !== batch.length) {
      console.warn(`⚠️  conceptSync: embedBatch returned ${vectors.length} vectors for ${batch.length} texts, skipping batch`);
      continue;
    }

    // Build Qdrant upsert points
    const points = batch.map((concept, idx) => {
      let memberChunks: string[] = [];
      try {
        const parsed = JSON.parse(concept.member_chunks);
        if (Array.isArray(parsed)) memberChunks = parsed;
      } catch { /* ignore bad JSON */ }

      return {
        id: concept.concept_id,
        vector: vectors[idx],
        payload: {
          concept_id: concept.concept_id,
          label: concept.label,
          summary: concept.summary,
          confidence: concept.confidence ?? 0.5,
          version: concept.version ?? 1,
          member_chunks: memberChunks,
        },
      };
    });

    try {
      await qdrant.upsert(CONCEPT_COLLECTION, { points });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  conceptSync Qdrant upsert failed: ${msg}`);
      continue;
    }

    // Update SQLite tracking
    const now = new Date().toISOString();
    const updateMany = db.transaction(() => {
      for (const concept of batch) {
        updateStmt.run(concept.version, now, concept.concept_id);
      }
    });
    updateMany();

    synced += batch.length;
  }

  const elapsed = Date.now() - t0;
  if (DEBUG_PERF || synced > 0) {
    console.log(`🔄 conceptSync: synced ${synced} concept embeddings in ${elapsed}ms (${skipped} skipped)`);
  }

  return { synced, skipped };
}
