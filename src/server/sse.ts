// src/server/sse.ts — Server-Sent Events state management and progress emission
import { ServerResponse } from 'http';
import type { ProgressEvent } from '../ingest';

// ── Types ──────────────────────────────────────────────────────────────────

export type JobSnapshot = {
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

export type DoneEventPayload = {
  type: 'done';
  jobId: string;
  stored: number;
  skipped: number;
  connections: number;
  elapsedSeconds: number;
};

export type ErrorEventPayload = {
  type: 'error';
  jobId: string;
  message: string;
};

export type StartEventPayload = {
  type: 'start';
  jobId: string;
  source: string;
  totalChunks: number;
};

export type ChunkEventPayload = {
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

export type SseEventPayload = StartEventPayload | ChunkEventPayload | DoneEventPayload | ErrorEventPayload;

// ── Shared state ───────────────────────────────────────────────────────────

export const ingestSseConnections = new Map<string, ServerResponse>();
export const ingestJobResults = new Map<string, DoneEventPayload | ErrorEventPayload>();
export const ingestJobSnapshots = new Map<string, JobSnapshot>();
export const MAX_COMPLETED_JOBS = 20;

// ── SSE functions ──────────────────────────────────────────────────────────

export function writeSseEvent(res: ServerResponse, payload: SseEventPayload): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function storeCompletedJob(jobId: string, payload: DoneEventPayload | ErrorEventPayload): void {
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

export function closeSseForJob(jobId: string): void {
  const existing = ingestSseConnections.get(jobId);
  if (!existing) return;

  ingestSseConnections.delete(jobId);
  if (!existing.writableEnded) {
    existing.end();
  }
}

export function emitIngestProgress(jobId: string, event: ProgressEvent): void {
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
