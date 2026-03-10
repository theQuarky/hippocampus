// src/server/http.ts — HTTP API server and route handlers
import fs from 'fs';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { retrieve, Result } from '../retrieve';
import { queryAnswer } from '../index';
import { ingest, ingestText } from '../ingest';
import { parseUrl } from '../ingest/parser';
import {
  HOST, DEFAULT_HTTP_PORT,
  setCorsHeaders, sendJson, clampNumber, parseBody, parseTags, parseMultipartUpload,
  type RelationshipCounts, type IngestJobResponse,
} from './helpers';
import {
  ingestSseConnections, ingestJobResults, ingestJobSnapshots,
  writeSseEvent, emitIngestProgress,
} from './sse';

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── HTTP Server ────────────────────────────────────────────────────────────

export function startHttpServer(): void {
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

        if (method === 'POST' && route === '/api/query-answer') {
          try {
            const body = await parseBody(req) as { question?: string };
            const question = body.question?.trim() ?? '';

            if (!question) {
              sendJson(res, 400, { error: 'question is required' });
              return;
            }

            const result = await queryAnswer(question);
            sendJson(res, 200, result);
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown API error';
            sendJson(res, 500, { error: message });
            return;
          }
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
          let upload: { tempFilePath: string; originalFileName: string; tags: string[] } | null = null;

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
