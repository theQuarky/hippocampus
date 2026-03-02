import path from 'path';
import fs from 'fs';
import os from 'os';
import http, { IncomingMessage, ServerResponse } from 'http';
import { v4 as uuidv4 } from 'uuid';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import Busboy from 'busboy';
import { initDB, db, qdrant, COLLECTION } from './db';
import { embed } from './embed';
import { retrieve, Result, warmupReranker } from './retrieve';
import { semanticChunkText } from './semanticChunk';
import { runConsolidationWorker } from './consolidate';
import { ingest, ingestText, ProgressEvent } from './ingest';
import { parseUrl } from './parser';

type SimilarChunkHit = {
  score?: number;
  payload?: {
    chunk_id?: string;
  };
};

type IngestRequest = {
  source?: string;
  text?: string;
  tags?: string[];
};

type IngestResponse = {
  success: boolean;
  chunks_stored: number;
  chunks_skipped: number;
  connections_seeded: number;
  error: string;
};

type IngestJobResponse = {
  jobId: string;
};

type MultipartUpload = {
  tempFilePath: string;
  originalFileName: string;
  tags: string[];
};

type QueryRequest = {
  query?: string;
  top_k?: number;
};

type QueryResponse = {
  results: Array<{
    text: string;
    source: string;
    score: number;
    chunk_id: string;
    graph_boosted: boolean;
  }>;
};

type HealthResponse = {
  status: string;
  total_chunks: number;
  total_connections: number;
  collections: number;
};

const PROTO_PATH = path.join(__dirname, 'proto', 'hippocampus.proto');
const HOST = '0.0.0.0';
const DEFAULT_PORT = '50051';
const DEFAULT_HTTP_PORT = '3001';
const DUPLICATE_THRESHOLD = 0.97;

type RelationshipCounts = {
  supports: number;
  contradicts: number;
  example_of: number;
  caused_by: number;
  related_to: number;
};

const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type JobSnapshot = {
  jobId: string;
  source: string;
  totalChunks: number;
  processed: number;
  stored: number;
  skipped: number;
  connections: number;
  chunksPerSec: number;
  etaSeconds: number;
  status: 'running' | 'done' | 'error';
};

type DoneEventPayload = {
  type: 'done';
  jobId: string;
  stored: number;
  skipped: number;
  connections: number;
  elapsedSeconds: number;
};

type ErrorEventPayload = {
  type: 'error';
  jobId: string;
  message: string;
};

type StartEventPayload = {
  type: 'start';
  jobId: string;
  source: string;
  totalChunks: number;
};

type ChunkEventPayload = {
  type: 'chunk';
  jobId: string;
  processed: number;
  total: number;
  stored: number;
  skipped: number;
  connections: number;
  chunksPerSec: number;
  etaSeconds: number;
};

type SseEventPayload = StartEventPayload | ChunkEventPayload | DoneEventPayload | ErrorEventPayload;

const ingestSseConnections = new Map<string, ServerResponse>();
const ingestJobResults = new Map<string, DoneEventPayload | ErrorEventPayload>();
const ingestJobSnapshots = new Map<string, JobSnapshot>();
const MAX_COMPLETED_JOBS = 20;

function writeSseEvent(res: ServerResponse, payload: SseEventPayload): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function storeCompletedJob(jobId: string, payload: DoneEventPayload | ErrorEventPayload): void {
  if (ingestJobResults.has(jobId)) {
    ingestJobResults.delete(jobId);
  }

  ingestJobResults.set(jobId, payload);

  while (ingestJobResults.size > MAX_COMPLETED_JOBS) {
    const oldest = ingestJobResults.keys().next().value as string | undefined;
    if (!oldest) break;
    ingestJobResults.delete(oldest);
    ingestJobSnapshots.delete(oldest);
  }
}

function closeSseForJob(jobId: string): void {
  const existing = ingestSseConnections.get(jobId);
  if (!existing) return;

  ingestSseConnections.delete(jobId);
  if (!existing.writableEnded) {
    existing.end();
  }
}

function emitIngestProgress(jobId: string, event: ProgressEvent): void {
  const existingSnapshot = ingestJobSnapshots.get(jobId);
  const stream = ingestSseConnections.get(jobId);

  if (event.type === 'start') {
    const payload: StartEventPayload = {
      type: 'start',
      jobId,
      source: event.source,
      totalChunks: event.totalChunks,
    };

    ingestJobSnapshots.set(jobId, {
      jobId,
      source: event.source,
      totalChunks: event.totalChunks,
      processed: 0,
      stored: 0,
      skipped: 0,
      connections: 0,
      chunksPerSec: 0,
      etaSeconds: 0,
      status: 'running',
    });

    if (stream) {
      writeSseEvent(stream, payload);
    }
    return;
  }

  if (event.type === 'chunk') {
    const source = existingSnapshot?.source ?? '';
    const payload: ChunkEventPayload = {
      type: 'chunk',
      jobId,
      processed: event.processed,
      total: event.total,
      stored: event.stored,
      skipped: event.skipped,
      connections: event.connections,
      chunksPerSec: event.chunksPerSec,
      etaSeconds: event.etaSeconds,
    };

    ingestJobSnapshots.set(jobId, {
      jobId,
      source,
      totalChunks: event.total,
      processed: event.processed,
      stored: event.stored,
      skipped: event.skipped,
      connections: event.connections,
      chunksPerSec: event.chunksPerSec,
      etaSeconds: event.etaSeconds,
      status: 'running',
    });

    if (stream) {
      writeSseEvent(stream, payload);
    }
    return;
  }

  if (event.type === 'done') {
    const payload: DoneEventPayload = {
      type: 'done',
      jobId,
      stored: event.stored,
      skipped: event.skipped,
      connections: event.connections,
      elapsedSeconds: event.elapsedSeconds,
    };

    const snapshot = ingestJobSnapshots.get(jobId);
    if (snapshot) {
      snapshot.status = 'done';
      snapshot.stored = event.stored;
      snapshot.skipped = event.skipped;
      snapshot.connections = event.connections;
      snapshot.processed = snapshot.totalChunks;
    }

    if (stream) {
      writeSseEvent(stream, payload);
    }

    storeCompletedJob(jobId, payload);
    closeSseForJob(jobId);
    return;
  }

  const payload: ErrorEventPayload = {
    type: 'error',
    jobId,
    message: event.message,
  };

  const snapshot = ingestJobSnapshots.get(jobId);
  if (snapshot) {
    snapshot.status = 'error';
  }

  if (stream) {
    writeSseEvent(stream, payload);
  }

  storeCompletedJob(jobId, payload);
  closeSseForJob(jobId);
}

function setCorsHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(BASE_CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString();
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function parseTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  if (typeof rawTags === 'string') {
    return rawTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

async function parseMultipartUpload(req: IncomingMessage): Promise<MultipartUpload> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data request.'));
      return;
    }

    const busboy = Busboy({ headers: req.headers });
    let tempFilePath = '';
    let originalFileName = '';
    let tags: string[] = [];
    let fileWritePromise: Promise<void> | null = null;

    busboy.on('field', (fieldName, value) => {
      if (fieldName !== 'tags') return;
      tags = parseTags(value);
    });

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'file') {
        file.resume();
        return;
      }

      originalFileName = info.filename?.trim() || 'upload';
      const extension = path.extname(originalFileName) || '.tmp';
      tempFilePath = path.join(os.tmpdir(), `hippocampus-upload-${Date.now()}-${uuidv4()}${extension}`);

      const output = fs.createWriteStream(tempFilePath);
      file.pipe(output);

      fileWritePromise = new Promise((writeResolve, writeReject) => {
        output.on('finish', () => writeResolve());
        output.on('error', writeReject);
        file.on('error', writeReject);
      });
    });

    busboy.on('error', reject);

    busboy.on('finish', async () => {
      if (!tempFilePath || !fileWritePromise) {
        reject(new Error('No file uploaded.'));
        return;
      }

      try {
        await fileWritePromise;
        resolve({ tempFilePath, originalFileName, tags });
      } catch (error) {
        reject(error);
      }
    });

    req.pipe(busboy);
  });
}

function getRelationshipCounts(): RelationshipCounts {
  const base: RelationshipCounts = {
    supports: 0,
    contradicts: 0,
    example_of: 0,
    caused_by: 0,
    related_to: 0,
  };

  const rows = db.prepare(`
    SELECT relationship, COUNT(*) AS count
    FROM connections
    GROUP BY relationship
  `).all() as Array<{ relationship: string; count: number }>;

  for (const row of rows) {
    if (row.relationship in base) {
      base[row.relationship as keyof RelationshipCounts] = row.count;
    }
  }

  return base;
}

function startHttpServer(): void {
  const httpPort = process.env.HTTP_PORT || DEFAULT_HTTP_PORT;

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const route = url.pathname;

        console.log(`${method} ${route}`);

        if (method === 'OPTIONS') {
          setCorsHeaders(res);
          res.statusCode = 204;
          res.end();
          return;
        }

        if (method === 'GET' && route === '/api/stats') {
          try {
            const totalChunksRow = db.prepare('SELECT COUNT(*) AS total FROM chunks').get() as { total: number };
            const totalConnectionsRow = db.prepare('SELECT COUNT(*) AS total FROM connections').get() as { total: number };
            const totalConceptsRow = db.prepare('SELECT COUNT(*) AS total FROM concepts').get() as { total: number };
            const relationshipCounts = getRelationshipCounts();
            const topSources = db.prepare(`
              SELECT source, COUNT(*) AS count
              FROM chunks
              GROUP BY source
              ORDER BY count DESC
              LIMIT 10
            `).all() as Array<{ source: string; count: number }>;
            const recentChunks = db.prepare(`
              SELECT chunk_id, source, timestamp, access_count
              FROM chunks
              ORDER BY timestamp DESC
              LIMIT 10
            `).all() as Array<{
              chunk_id: string;
              source: string;
              timestamp: string;
              access_count: number;
            }>;

            sendJson(res, 200, {
              total_chunks: totalChunksRow.total,
              total_connections: totalConnectionsRow.total,
              total_concepts: totalConceptsRow.total,
              relationship_counts: relationshipCounts,
              top_sources: topSources,
              recent_chunks: recentChunks,
            });
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        if (method === 'GET' && route === '/api/chunks') {
          try {
            const source = url.searchParams.get('source')?.trim();
            const search = url.searchParams.get('search')?.trim();
            const rawLimit = Number(url.searchParams.get('limit') ?? 50);
            const rawOffset = Number(url.searchParams.get('offset') ?? 0);
            const limit = clampNumber(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1, 200);
            const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

            const filters: string[] = [];
            const args: Array<string | number> = [];

            if (source) {
              filters.push('source = ?');
              args.push(source);
            }

            if (search) {
              filters.push('text LIKE ?');
              args.push(`%${search}%`);
            }

            const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
            const rows = db.prepare(`
              SELECT chunk_id, text, source, page, timestamp, access_count, last_accessed, tags, is_duplicate, contradiction_flag
              FROM chunks
              ${whereClause}
              ORDER BY timestamp DESC
              LIMIT ? OFFSET ?
            `).all(...args, limit, offset);

            sendJson(res, 200, rows);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        if (method === 'GET' && route === '/api/graph') {
          try {
            const links = db.prepare(`
              SELECT source_chunk, target_chunk, relationship, weight
              FROM connections
              WHERE weight >= 0.1
            `).all() as Array<{
              source_chunk: string;
              target_chunk: string;
              relationship: string;
              weight: number;
            }>;

            if (links.length === 0) {
              sendJson(res, 200, { nodes: [], links: [] });
              return;
            }

            const nodeIds = new Set<string>();
            for (const link of links) {
              nodeIds.add(link.source_chunk);
              nodeIds.add(link.target_chunk);
            }

            const placeholders = Array.from(nodeIds).map(() => '?').join(',');
            const nodeRows = db.prepare(`
              SELECT chunk_id, text, source, access_count, contradiction_flag
              FROM chunks
              WHERE chunk_id IN (${placeholders})
            `).all(...Array.from(nodeIds)) as Array<{
              chunk_id: string;
              text: string;
              source: string;
              access_count: number;
              contradiction_flag: number;
            }>;

            const graph = {
              nodes: nodeRows.map((node) => ({
                id: node.chunk_id,
                text: node.text.slice(0, 80),
                source: node.source,
                access_count: node.access_count,
                contradiction_flag: node.contradiction_flag,
              })),
              links: links.map((link) => ({
                source: link.source_chunk,
                target: link.target_chunk,
                relationship: link.relationship,
                weight: link.weight,
              })),
            };

            sendJson(res, 200, graph);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        if (method === 'GET' && route === '/api/concepts') {
          try {
            const concepts = db.prepare(`
              SELECT concept_id, label, summary, member_chunks, created_at, last_updated
              FROM concepts
              ORDER BY last_updated DESC
            `).all() as Array<{
              concept_id: string;
              label: string;
              summary: string;
              member_chunks: string;
              created_at: string;
              last_updated: string;
            }>;

            const normalized = concepts.map((concept) => {
              let members: string[] = [];
              try {
                const parsed = JSON.parse(concept.member_chunks);
                if (Array.isArray(parsed)) {
                  members = parsed.filter((item): item is string => typeof item === 'string');
                }
              } catch {
                members = [];
              }

              return {
                concept_id: concept.concept_id,
                label: concept.label,
                summary: concept.summary,
                member_chunks: members,
                created_at: concept.created_at,
                last_updated: concept.last_updated,
              };
            });

            sendJson(res, 200, normalized);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        if (method === 'GET' && route === '/api/ingests/recent') {
          try {
            const rawLimit = Number(url.searchParams.get('limit') ?? 5);
            const limit = clampNumber(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5, 1, 50);

            const rows = db.prepare(`
              SELECT source, chunks_stored, chunks_skipped, connections_seeded, timestamp
              FROM ingest_events
              ORDER BY timestamp DESC
              LIMIT ?
            `).all(limit) as Array<{
              source: string;
              chunks_stored: number;
              chunks_skipped: number;
              connections_seeded: number;
              timestamp: string;
            }>;

            sendJson(res, 200, rows);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        if (method === 'GET' && route.startsWith('/api/ingest/progress/')) {
          const jobId = decodeURIComponent(route.slice('/api/ingest/progress/'.length)).trim();
          if (!jobId) {
            sendJson(res, 400, { error: 'jobId is required' });
            return;
          }

          const finished = ingestJobResults.get(jobId);
          if (finished) {
            setCorsHeaders(res);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');
            writeSseEvent(res, finished);
            res.end();
            return;
          }

          const existing = ingestSseConnections.get(jobId);
          if (existing && !existing.writableEnded) {
            existing.end();
          }

          setCorsHeaders(res);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.flushHeaders?.();

          ingestSseConnections.set(jobId, res);

          const snapshot = ingestJobSnapshots.get(jobId);
          if (snapshot) {
            writeSseEvent(res, {
              type: 'start',
              jobId,
              source: snapshot.source,
              totalChunks: snapshot.totalChunks,
            });

            if (snapshot.processed > 0) {
              writeSseEvent(res, {
                type: 'chunk',
                jobId,
                processed: snapshot.processed,
                total: snapshot.totalChunks,
                stored: snapshot.stored,
                skipped: snapshot.skipped,
                connections: snapshot.connections,
                chunksPerSec: snapshot.chunksPerSec,
                etaSeconds: snapshot.etaSeconds,
              });
            }
          }

          req.on('close', () => {
            const live = ingestSseConnections.get(jobId);
            if (live === res) {
              ingestSseConnections.delete(jobId);
            }
          });

          return;
        }

        if (method === 'POST' && route === '/api/query') {
          try {
            const body = await parseBody(req) as { query?: string; top_k?: number };
            const query = body.query?.trim() ?? '';
            const topK = typeof body.top_k === 'number' && Number.isFinite(body.top_k) && body.top_k > 0
              ? Math.floor(body.top_k)
              : 5;

            const results: Result[] = await retrieve(query, topK);
            sendJson(res, 200, results);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        if (method === 'POST' && route === '/api/ingest/file') {
          let upload: MultipartUpload | null = null;

          try {
            upload = await parseMultipartUpload(req);
            const jobId = uuidv4();
            ingestJobSnapshots.set(jobId, {
              jobId,
              source: upload.originalFileName,
              totalChunks: 0,
              processed: 0,
              stored: 0,
              skipped: 0,
              connections: 0,
              chunksPerSec: 0,
              etaSeconds: 0,
              status: 'running',
            });

            sendJson(res, 202, { jobId } satisfies IngestJobResponse);

            void (async () => {
              try {
                await ingest(upload.tempFilePath, upload?.tags ?? [], upload?.originalFileName, (event) => {
                  emitIngestProgress(jobId, event);
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown ingest error';
                emitIngestProgress(jobId, { type: 'error', message });
              } finally {
                if (upload?.tempFilePath) {
                  void fs.promises.unlink(upload.tempFilePath).catch(() => undefined);
                }
              }
            })();

            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown ingest error';
            sendJson(res, 500, { error: message, source: upload?.originalFileName ?? '' });
            if (upload?.tempFilePath) {
              void fs.promises.unlink(upload.tempFilePath).catch(() => undefined);
            }
            return;
          }
        }

        if (method === 'POST' && route === '/api/ingest/url') {
          try {
            const body = await parseBody(req) as { url?: string; tags?: string[] | string };
            const urlValue = body.url?.trim() ?? '';

            if (!urlValue) {
              sendJson(res, 400, { error: 'url is required' });
              return;
            }

            const tags = parseTags(body.tags);
            const jobId = uuidv4();
            ingestJobSnapshots.set(jobId, {
              jobId,
              source: urlValue,
              totalChunks: 0,
              processed: 0,
              stored: 0,
              skipped: 0,
              connections: 0,
              chunksPerSec: 0,
              etaSeconds: 0,
              status: 'running',
            });

            sendJson(res, 202, { jobId } satisfies IngestJobResponse);

            void (async () => {
              try {
                const text = await parseUrl(urlValue);
                await ingestText(urlValue, text, tags, {
                  onProgress: (event) => {
                    emitIngestProgress(jobId, event);
                  },
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown ingest error';
                emitIngestProgress(jobId, { type: 'error', message });
              }
            })();

            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown ingest error';
            sendJson(res, 500, { error: message });
            return;
          }
        }

        sendJson(res, 404, { error: 'Not Found' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown API error';
        sendJson(res, 500, { error: message });
      }
    })();
  });

  httpServer.listen(Number(httpPort), HOST, () => {
    console.log(`🌐 HTTP API listening on http://${HOST}:${httpPort}`);
  });
}

function makeGrpcError(code: grpc.status, message: string): grpc.ServiceError {
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

const ingestHandler: grpc.handleUnaryCall<IngestRequest, IngestResponse> = (call, callback) => {
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

const queryHandler: grpc.handleUnaryCall<QueryRequest, QueryResponse> = (call, callback) => {
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

const healthHandler: grpc.handleUnaryCall<Record<string, never>, HealthResponse> = (_call, callback) => {
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

async function startServer() {
  await initDB();
  runConsolidationWorker(30000);
  startHttpServer();

  void warmupReranker().catch((error) => {
    console.warn('⚠️ Re-ranker warmup failed. Continuing without warm cache.', error);
  });

  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDef) as any;
  const hippocampusService = proto.hippocampus.Hippocampus.service;

  const grpcServer = new grpc.Server();
  grpcServer.addService(hippocampusService, {
    Ingest: ingestHandler,
    Query: queryHandler,
    Health: healthHandler,
  } as any);

  const port = process.env.GRPC_PORT || DEFAULT_PORT;
  const bindAddress = `${HOST}:${port}`;

  grpcServer.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) {
      console.error('❌ Failed to bind gRPC server:', error);
      return;
    }

    grpcServer.start();
    console.log(`🧠 Hippocampus gRPC server listening on ${bindAddress}`);
  });
}

startServer().catch((error) => {
  console.error('❌ Failed to start gRPC server:', error);
});
