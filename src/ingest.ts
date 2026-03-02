// src/ingest.ts
import { v4 as uuidv4 } from 'uuid';
import { stat } from 'node:fs/promises';
import PQueue from 'p-queue';
import { embed } from './embed';
import { parseFile } from './parser';
import { semanticChunkText, Chunk } from './semanticChunk';
import { llmChunkText } from './llmChunk';
import { db, qdrant, COLLECTION } from './db';
import { ProgressBar } from './progress';

/*
Example terminal output:

📥 Ingesting: bigbook.pdf (2.1 MB)
⚠️  Large document — estimated ~6m at concurrency 8

Chunking... done. 847 chunks found.
[████████████████░░░░░░░░░░░░░░░░] 312/847  37%  ●  4.2 chunks/sec  ETA 2m 8s
✓ stored 309  ⊘ 3 dupes  ⟳ 28 connections

✅ Done in 3m 42s — stored 821 chunks, skipped 26 duplicates, seeded 203 connections
*/

type SimilarChunkHit = {
  score?: number;
  payload?: {
    chunk_id?: string;
  };
};

export type IngestResult = {
  success: boolean;
  chunks_stored: number;
  chunks_skipped: number;
  connections_seeded: number;
  source: string;
};

export type ProgressEvent =
  | { type: 'start'; source: string; totalChunks: number }
  | {
    type: 'chunk';
    processed: number;
    total: number;
    stored: number;
    skipped: number;
    connections: number;
    chunksPerSec: number;
    etaSeconds: number;
  }
  | { type: 'done'; stored: number; skipped: number; connections: number; elapsedSeconds: number }
  | { type: 'error'; message: string };

type IngestTextOptions = {
  fileSizeBytes?: number;
  concurrency?: number;
  onProgress?: (event: ProgressEvent) => void;
};

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

function resolveSource(sourceLabel: string): string {
  if (/^https?:\/\//i.test(sourceLabel)) {
    return sourceLabel;
  }

  return sourceLabel.split('/').pop() || sourceLabel;
}

function resolveConcurrency(): number {
  const configured = Number.parseInt(process.env.OLLAMA_CONCURRENCY ?? '8', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 8;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDurationApprox(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function isGlossaryChunk(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return false;

  const defLines = lines.filter(
    (line) => /^[A-Z][a-z]+.*[A-Z][a-z]/.test(line) && line.length < 120
  );

  return defLines.length / lines.length > 0.5 && lines.length > 5;
}

export async function ingest(
  filePath: string,
  tags: string[] = [],
  sourceOverride?: string,
  onProgress?: (event: ProgressEvent) => void
): Promise<IngestResult> {
  const text = await parseFile(filePath);

  let fileSizeBytes: number | undefined;
  try {
    fileSizeBytes = (await stat(filePath)).size;
  } catch {
    fileSizeBytes = undefined;
  }

  return ingestText(sourceOverride ?? filePath, text, tags, { fileSizeBytes, onProgress });
}

export async function ingestText(
  sourceLabel: string,
  text: string,
  tags: string[] = [],
  options: IngestTextOptions = {}
): Promise<IngestResult> {
  const source = resolveSource(sourceLabel);
  const concurrency = options.concurrency ?? resolveConcurrency();
  const onProgress = options.onProgress;
  const sizeSuffix = typeof options.fileSizeBytes === 'number' ? ` (${formatMegabytes(options.fileSizeBytes)})` : '';

  console.log(`\n📥 Ingesting: ${source}${sizeSuffix}`);
  console.log(`   Parsed ${text.length} characters`);

  onProgress?.({
    type: 'start',
    source,
    totalChunks: 0,
  });

  process.stdout.write('\nChunking...');
  const chunkingStartedMs = Date.now();
  const chunkingHeartbeat = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - chunkingStartedMs) / 1000);
    process.stdout.write(`\rChunking... ${elapsedSeconds}s`);
  }, 5000);

  let chunks: Chunk[];
  const chunkFn = process.env.CHUNK_STRATEGY === 'llm' ? llmChunkText : semanticChunkText;
  try {
    chunks = await chunkFn(text);
  } finally {
    clearInterval(chunkingHeartbeat);
  }

  const glossaryFiltered = chunks.filter((chunk) => !isGlossaryChunk(chunk.text));
  const removedGlossaryChunks = chunks.length - glossaryFiltered.length;
  chunks = glossaryFiltered;

  process.stdout.write(` done. ${chunks.length} chunks found.\n`);
  if (removedGlossaryChunks > 0) {
    console.log(`🧹 Removed ${removedGlossaryChunks} glossary-like chunks before storage`);
  }

  if (typeof options.fileSizeBytes === 'number' && options.fileSizeBytes > 500 * 1024) {
    const estimatedSeconds = (chunks.length * 300) / concurrency / 1000;
    console.log(`⚠️  Large document — estimated ~${formatDurationApprox(estimatedSeconds)} at concurrency ${concurrency}`);
  }

  const duplicateThreshold = 0.97;
  const ingestTimestamp = new Date().toISOString();
  const ingestStartMs = Date.now();
  let stored = 0;
  let skipped = 0;
  let seededConnections = 0;
  const chunkCompletionTimesMs: number[] = [];

  onProgress?.({
    type: 'start',
    source,
    totalChunks: chunks.length,
  });

  const emitChunkProgress = (): void => {
    const processed = stored + skipped;
    const now = Date.now();
    chunkCompletionTimesMs.push(now);

    if (chunkCompletionTimesMs.length > 10) {
      chunkCompletionTimesMs.shift();
    }

    let chunksPerSec = 0;
    if (chunkCompletionTimesMs.length >= 2) {
      const first = chunkCompletionTimesMs[0];
      const last = chunkCompletionTimesMs[chunkCompletionTimesMs.length - 1];
      const durationSec = (last - first) / 1000;
      if (durationSec > 0) {
        chunksPerSec = (chunkCompletionTimesMs.length - 1) / durationSec;
      }
    } else {
      const elapsedSec = (now - ingestStartMs) / 1000;
      if (elapsedSec > 0) {
        chunksPerSec = processed / elapsedSec;
      }
    }

    const remaining = Math.max(0, chunks.length - processed);
    const etaSeconds = chunksPerSec > 0 ? remaining / chunksPerSec : 0;

    onProgress?.({
      type: 'chunk',
      processed,
      total: chunks.length,
      stored,
      skipped,
      connections: seededConnections,
      chunksPerSec,
      etaSeconds,
    });
  };

  if (chunks.length === 0) {
    console.log(`\n✅ Done in 0s — stored 0 chunks, skipped 0 duplicates, seeded 0 connections\n`);

    db.prepare(`
      INSERT INTO ingest_events (event_id, source, chunks_stored, chunks_skipped, connections_seeded, tags, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      source,
      0,
      0,
      0,
      JSON.stringify(tags),
      ingestTimestamp,
    );

    onProgress?.({
      type: 'done',
      stored: 0,
      skipped: 0,
      connections: 0,
      elapsedSeconds: 0,
    });

    return {
      success: true,
      chunks_stored: 0,
      chunks_skipped: 0,
      connections_seeded: 0,
      source,
    };
  }

  const progress = new ProgressBar({ total: chunks.length, fallbackEvery: 50, minColumns: 60 });
  const queue = new PQueue({ concurrency });
  const tasks: Promise<void>[] = [];

  for (const chunk of chunks) {
    const task = queue.add(async () => {
      const chunk_id = uuidv4();
      const vector = await embed(chunk.text);

      const score = await topSimilarityScore(vector);
      if (score >= duplicateThreshold) {
        skipped++;
        progress.tick({ duplicates: 1 });
        emitChunkProgress();
        return;
      }

      const similarExistingChunkIds = await findSimilarExistingChunks(vector, 5);
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

      const createdConnections = seedConnections(chunk_id, similarExistingChunkIds, timestamp);
      stored++;
      seededConnections += createdConnections;

      progress.tick({ stored: 1, connections: createdConnections });
      emitChunkProgress();
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        skipped++;
        progress.tick({ duplicates: 1 });
        emitChunkProgress();
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`\n⚠️  Chunk processing failed for [${source}]: ${message}`);
      });

    tasks.push(task);
  }

  await Promise.allSettled(tasks);

  const summary = progress.finish({
    stored,
    duplicates: skipped,
    connections: seededConnections,
  });

  console.log(`✅ Done in ${summary.duration} — stored ${stored} chunks, skipped ${skipped} duplicates, seeded ${seededConnections} connections\n`);

  onProgress?.({
    type: 'done',
    stored,
    skipped,
    connections: seededConnections,
    elapsedSeconds: summary.durationSeconds,
  });

  db.prepare(`
    INSERT INTO ingest_events (event_id, source, chunks_stored, chunks_skipped, connections_seeded, tags, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    source,
    stored,
    skipped,
    seededConnections,
    JSON.stringify(tags),
    ingestTimestamp,
  );

  return {
    success: true,
    chunks_stored: stored,
    chunks_skipped: skipped,
    connections_seeded: seededConnections,
    source,
  };
}