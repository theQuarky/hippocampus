// src/consolidate/weights.ts — Cycle 3: reinforce & decay connections
import { randomUUID } from 'crypto';
import { db, DEFAULT_MEMORY_DB } from '../db';
import { embed } from '../embed';
import {
  S,
  REINFORCE_ACCESS_THRESHOLD,
  MAX_CONNECTION_WEIGHT,
  MIN_CONNECTION_WEIGHT,
  DECAY_FACTOR,
  ENABLE_LEARNING_WEIGHTS,
  clamp,
  cosineSimilarity,
  type ChunkRow, type ConnectionRow,
} from './helpers';

const HEBBIAN_RATE = 0.05;
const BASE_DECAY = 0.01;
const STALE_THRESHOLD = 7 * 24 * 60 * 60 * 1000;

type CoAccessEventRow = {
  event_id: string;
  chunk_ids: string;
  query_hash: string;
  query_embedding: string | null;
  timestamp: number;
  database_id: string | null;
};

function chunkPairs(chunkIds: string[]): Array<[string, string]> {
  const unique = [...new Set(chunkIds)].filter(Boolean);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      pairs.push([unique[i], unique[j]]);
    }
  }
  return pairs;
}

function parseChunkIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function getConnection(a: string, b: string, database: string): { edge_id: string; weight: number } | null {
  const row = db.prepare(`
    SELECT edge_id, weight
    FROM connections
    WHERE source_chunk = ?
      AND target_chunk = ?
      AND database_id = ?
    LIMIT 1
  `).get(a, b, database) as { edge_id: string; weight: number } | undefined;

  if (row) return row;

  const reverse = db.prepare(`
    SELECT edge_id, weight
    FROM connections
    WHERE source_chunk = ?
      AND target_chunk = ?
      AND database_id = ?
    LIMIT 1
  `).get(b, a, database) as { edge_id: string; weight: number } | undefined;

  return reverse ?? null;
}

async function chunkSimilarity(a: string, b: string, database: string, cache: Map<string, number[]>): Promise<number> {
  const ensureEmbedding = async (chunkId: string): Promise<number[] | null> => {
    const existing = cache.get(chunkId);
    if (existing) return existing;

    const row = db.prepare(`
      SELECT text
      FROM chunks
      WHERE chunk_id = ?
        AND database_id = ?
      LIMIT 1
    `).get(chunkId, database) as { text: string } | undefined;
    if (!row?.text) return null;
    const vector = await embed(row.text);
    cache.set(chunkId, vector);
    return vector;
  };

  const [vecA, vecB] = await Promise.all([ensureEmbedding(a), ensureEmbedding(b)]);
  if (!vecA || !vecB) return 0;
  return cosineSimilarity(vecA, vecB);
}

export async function hebbianStrengthen(since: number): Promise<number> {
  const rows = db.prepare(`
    SELECT event_id, chunk_ids, query_hash, query_embedding, timestamp, database_id
    FROM co_access_events
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `).all(since) as CoAccessEventRow[];

  if (rows.length === 0) return 0;

  let updates = 0;
  const embeddingCache = new Map<string, number[]>();
  const now = new Date().toISOString();

  for (const event of rows) {
    const database = event.database_id || DEFAULT_MEMORY_DB;
    const ids = parseChunkIds(event.chunk_ids);

    for (const [a, b] of chunkPairs(ids)) {
      const existing = getConnection(a, b, database);
      if (existing) {
        const currentWeight = Number.isFinite(existing.weight) ? existing.weight : MIN_CONNECTION_WEIGHT;
        const nextWeight = clamp(
          currentWeight + HEBBIAN_RATE * (1 - currentWeight),
          MIN_CONNECTION_WEIGHT,
          MAX_CONNECTION_WEIGHT,
        );

        db.prepare(`
          UPDATE connections
          SET weight = ?,
              last_reinforced = ?,
              access_count = COALESCE(access_count, 0) + 1
          WHERE edge_id = ?
        `).run(nextWeight, now, existing.edge_id);
        updates++;
        continue;
      }

      const sim = await chunkSimilarity(a, b, database, embeddingCache);
      if (sim <= 0.4) continue;

      db.prepare(`
        INSERT OR IGNORE INTO connections (
          edge_id, source_chunk, target_chunk, relationship, weight, confidence,
          created_at, last_reinforced, avg_sim, seen_count, last_seen, database_id, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        a,
        b,
        'co_accessed',
        HEBBIAN_RATE,
        0.5,
        now,
        now,
        sim,
        1,
        now,
        database,
        1,
      );
      updates++;
    }
  }

  if (updates > 0) {
    console.log(`🧠 Hebbian strengthening updated ${updates} connections from ${rows.length} co-access events`);
  }

  return updates;
}

/**
 * Reinforce connections for highly-accessed chunks.
 * With learning weights: uses access_count, confidence, avg_sim.
 * Without: flat +0.05 increment.
 */
export function reinforceConnections(): void {
  const s = S();
  const now = new Date().toISOString();
  const chunks = s.selectHighlyAccessedChunks.all(REINFORCE_ACCESS_THRESHOLD) as ChunkRow[];
  let count = 0;

  for (const chunk of chunks) {
    const edges = s.selectOutgoingEdges.all(chunk.chunk_id) as ConnectionRow[];

    for (const edge of edges) {
      const current = edge.weight ?? MIN_CONNECTION_WEIGHT;
      let next: number;

      if (ENABLE_LEARNING_WEIGHTS) {
        const accessFactor = Math.min(1.0, (chunk.access_count ?? 1) / 20);
        const confidence = edge.confidence ?? 0.5;
        const avgSim = edge.avg_sim ?? 0.5;
        const increment = 0.02 + 0.08 * accessFactor * confidence * avgSim;
        next = clamp(current + increment, MIN_CONNECTION_WEIGHT, MAX_CONNECTION_WEIGHT);
      } else {
        next = Math.min(MAX_CONNECTION_WEIGHT, current + 0.05);
      }

      db.prepare(`
        UPDATE connections
        SET weight = ?,
            last_reinforced = ?,
            access_count = COALESCE(access_count, 0) + 1
        WHERE edge_id = ?
      `).run(next, now, edge.edge_id);
      count++;
    }
  }

  console.log(`🔗 Reinforced ${count} connections across ${chunks.length} chunks`);
}

/**
 * Decay connections not seen/reinforced recently.
 * With learning weights: only decays when last_seen is old.
 */
export function decayConnections(daysOld: number = 7): void {
  const s = S();
  const nowMs = Date.now();
  const edges = db.prepare(`
    SELECT edge_id, weight, access_count, last_reinforced, created_at
    FROM connections
  `).all() as Array<ConnectionRow & { access_count?: number | null }>;
  let decayed = 0;

  for (const edge of edges) {
    const current = edge.weight ?? MIN_CONNECTION_WEIGHT;
    const accessCount = Math.max(1, Number(edge.access_count ?? 0));
    const decayRate = BASE_DECAY / Math.log(1 + accessCount);

    const lastReinforcedMs = edge.last_reinforced ? new Date(edge.last_reinforced).getTime() : new Date(edge.created_at).getTime();
    const stalePenalty = (nowMs - lastReinforcedMs) > STALE_THRESHOLD ? 1.5 : 1.0;

    const next = Math.max(
      MIN_CONNECTION_WEIGHT,
      current * (1 - decayRate * stalePenalty),
    );
    s.updateEdgeWeight.run(next, edge.edge_id);
    decayed++;
  }

  console.log(`📉 Decayed ${decayed} connections`);
}
