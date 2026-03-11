// src/server/routes/ingestRoute.ts — Ingest and progress routes
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { ingest, ingestText } from '../../ingest';
import { parseUrl } from '../../ingest/parser';
import {
  setCorsHeaders, sendJson, parseBody, parseTags, parseMultipartUpload,
  type IngestJobResponse,
} from '../helpers';
import {
  ingestSseConnections, ingestJobResults, ingestJobSnapshots,
  writeSseEvent, emitIngestProgress,
} from '../sse';

export async function handleIngestRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname.startsWith('/api/ingest/progress/')) {
    const jobId = decodeURIComponent(url.pathname.slice('/api/ingest/progress/'.length)).trim();
    if (!jobId) {
      sendJson(res, 400, { error: 'jobId is required' });
      return true;
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
      return true;
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

    return true;
  }

  if (method === 'POST' && url.pathname === '/api/ingest/file') {
    const database = url.searchParams.get('database')?.trim();
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
          await ingest(upload!.tempFilePath, upload?.tags ?? [], upload?.originalFileName, (event) => {
            emitIngestProgress(jobId, event);
          }, database);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown ingest error';
          emitIngestProgress(jobId, { type: 'error', message });
        } finally {
          if (upload?.tempFilePath) {
            void fs.promises.unlink(upload.tempFilePath).catch(() => undefined);
          }
        }
      })();

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingest error';
      sendJson(res, 500, { error: message, source: upload?.originalFileName ?? '' });
      if (upload?.tempFilePath) {
        void fs.promises.unlink(upload.tempFilePath).catch(() => undefined);
      }
      return true;
    }
  }

  if (method === 'POST' && url.pathname === '/api/ingest/url') {
    try {
      const body = await parseBody(req) as { url?: string; tags?: string[] | string; database?: string };
      const urlValue = body.url?.trim() ?? '';
      const database = typeof body.database === 'string' ? body.database.trim() : url.searchParams.get('database')?.trim();

      if (!urlValue) {
        sendJson(res, 400, { error: 'url is required' });
        return true;
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
          }, database);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown ingest error';
          emitIngestProgress(jobId, { type: 'error', message });
        }
      })();

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingest error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  return false;
}
