// src/server/grpc.ts — gRPC service handlers
import { v4 as uuidv4 } from 'uuid';
import * as grpc from '@grpc/grpc-js';
import { db, qdrant, COLLECTION } from '../db';
import { embed } from '../embed';
import { retrieve } from '../retrieve';
import { semanticChunkText } from '../ingest';
import type {
  SimilarChunkHit, IngestRequest, IngestResponse,
  QueryRequest, QueryResponse, HealthResponse,
} from './helpers';
import { DUPLICATE_THRESHOLD } from './helpers';

// ── gRPC helpers ───────────────────────────────────────────────────────────

export function makeGrpcError(code: grpc.status, message: string): grpc.ServiceError {
  return {
    name: grpc.status[code],
    message,
    code,
  } as grpc.ServiceError;
}

async function topSimilarityScore(vector: number[]): Promise<number> {
  try {
    const results = await qdrant.search(COLLECTION, {
      vector,
      limit: 10,
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

async function findSimilarExistingChunks(vector: number[], limit = 5): Promise<string[]> {
  try {
    const results = await qdrant.search(COLLECTION, {
      vector,
      limit,
      with_payload: true,
      with_vector: false,
    }) as SimilarChunkHit[];

    return results
      .map((result) => result.payload?.chunk_id)
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
      null,
    );
    created++;
  }

  return created;
}

// ── Handlers ───────────────────────────────────────────────────────────────

export const ingestHandler: grpc.handleUnaryCall<IngestRequest, IngestResponse> = (call, callback) => {
  void (async () => {
    const source = call.request.source?.trim();
    const text = call.request.text?.trim();
    const tags = Array.isArray(call.request.tags) ? call.request.tags : [];

    console.log(`➡️  Ingest request source=${source ?? ''}`);

    if (!source || !text) {
      const message = 'Invalid ingest request: source and text are required.';
      console.error(`❌ Ingest failed: ${message}`);
      callback(makeGrpcError(grpc.status.INVALID_ARGUMENT, message), {
        success: false,
        chunks_stored: 0,
        chunks_skipped: 0,
        connections_seeded: 0,
        error: message,
      });
      return;
    }

    try {
      const chunks = await semanticChunkText(text);

      let stored = 0;
      let skipped = 0;
      let seededConnections = 0;

      for (const chunk of chunks) {
        const chunk_id = uuidv4();
        const vector = await embed(chunk.text);
        const similarExistingChunkIds = await findSimilarExistingChunks(vector, 5);

        const isDuplicate = await checkDuplicate(vector, DUPLICATE_THRESHOLD);
        if (isDuplicate) {
          skipped++;
          continue;
        }

        const timestamp = new Date().toISOString();

        await qdrant.upsert(COLLECTION, {
          points: [{
            id: chunk_id,
            vector,
            payload: { text: chunk.text, source, chunk_id },
          }],
        });

        db.prepare(`
          INSERT INTO chunks (chunk_id, text, source, page, timestamp, tags)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(chunk_id, chunk.text, source, chunk.index, timestamp, JSON.stringify(tags));

        seededConnections += seedConnections(chunk_id, similarExistingChunkIds, timestamp);
        stored++;
      }

      const response: IngestResponse = {
        success: true,
        chunks_stored: stored,
        chunks_skipped: skipped,
        connections_seeded: seededConnections,
        error: '',
      };

      console.log(`✅ Ingest response stored=${stored} skipped=${skipped} seeded=${seededConnections}`);
      callback(null, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingest error';
      console.error('❌ Ingest failed:', error);
      callback(makeGrpcError(grpc.status.INTERNAL, message), {
        success: false,
        chunks_stored: 0,
        chunks_skipped: 0,
        connections_seeded: 0,
        error: message,
      });
    }
  })();
};

export const queryHandler: grpc.handleUnaryCall<QueryRequest, QueryResponse> = (call, callback) => {
  void (async () => {
    const query = call.request.query?.trim() ?? '';
    const topK = call.request.top_k && call.request.top_k > 0 ? call.request.top_k : 5;

    console.log(`➡️  Query request query=${query}`);

    if (!query) {
      const message = 'Invalid query request: query is required.';
      console.error(`❌ Query failed: ${message}`);
      callback(makeGrpcError(grpc.status.INVALID_ARGUMENT, message));
      return;
    }

    try {
      const results = await retrieve(query, topK);
      console.log(`✅ Query response results=${results.length}`);
      callback(null, { results });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown query error';
      console.error('❌ Query failed:', error);
      callback(makeGrpcError(grpc.status.INTERNAL, message));
    }
  })();
};

export const healthHandler: grpc.handleUnaryCall<Record<string, never>, HealthResponse> = (_call, callback) => {
  void (async () => {
    console.log('➡️  Health request');

    try {
      const chunksRow = db.prepare('SELECT COUNT(*) AS total FROM chunks').get() as { total: number };
      const connectionsRow = db.prepare('SELECT COUNT(*) AS total FROM connections').get() as { total: number };
      const collections = await qdrant.getCollections();

      const response: HealthResponse = {
        status: 'ok',
        total_chunks: chunksRow.total,
        total_connections: connectionsRow.total,
        collections: collections.collections.length,
      };

      console.log(`✅ Health response chunks=${response.total_chunks} connections=${response.total_connections} collections=${response.collections}`);
      callback(null, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown health error';
      console.error('❌ Health failed:', error);
      callback(makeGrpcError(grpc.status.INTERNAL, message));
    }
  })();
};
