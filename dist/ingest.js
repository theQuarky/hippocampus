"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingest = ingest;
exports.ingestText = ingestText;
// src/ingest.ts
const uuid_1 = require("uuid");
const promises_1 = require("node:fs/promises");
const embed_1 = require("./embed");
const parser_1 = require("./parser");
const semanticChunk_1 = require("./semanticChunk");
const llmChunk_1 = require("./llmChunk");
const db_1 = require("./db");
const progress_1 = require("./progress");
function formatPerfSeconds(milliseconds) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
}
function rateForStage(chunks, milliseconds) {
    if (milliseconds <= 0 || chunks <= 0)
        return '0.0';
    return ((chunks * 1000) / milliseconds).toFixed(1);
}
async function searchSimilar(vector) {
    try {
        const results = await db_1.qdrant.search(db_1.COLLECTION, {
            vector, limit: 6, with_payload: true, with_vector: false,
        });
        return {
            topScore: results[0]?.score ?? 0,
            similarIds: results.map(r => r.payload?.chunk_id).filter((id) => Boolean(id)),
        };
    }
    catch {
        return { topScore: 0, similarIds: [] };
    }
}
function seedConnectionsBatch(entries, timestamp) {
    const insertStmt = db_1.db.prepare(`
    INSERT OR IGNORE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertAll = db_1.db.transaction((items) => {
        let total = 0;
        for (const { sourceId, targetIds } of items) {
            for (const targetId of targetIds) {
                if (targetId === sourceId)
                    continue;
                const result = insertStmt.run((0, uuid_1.v4)(), sourceId, targetId, 'related_to', 0.3, 0.5, timestamp, null);
                total += result.changes;
            }
        }
        return total;
    });
    return insertAll(entries);
}
function resolveSource(sourceLabel) {
    if (/^https?:\/\//i.test(sourceLabel)) {
        return sourceLabel;
    }
    return sourceLabel.split('/').pop() || sourceLabel;
}
function resolveConcurrency() {
    const configured = Number.parseInt(process.env.OLLAMA_CONCURRENCY ?? '8', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 8;
}
function formatMegabytes(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDurationApprox(totalSeconds) {
    const rounded = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    if (minutes === 0)
        return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
}
function isGlossaryChunk(text) {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length === 0)
        return false;
    const defLines = lines.filter((line) => /^[A-Z][a-z]+.*[A-Z][a-z]/.test(line) && line.length < 120);
    return defLines.length / lines.length > 0.5 && lines.length > 5;
}
async function ingest(filePath, tags = [], sourceOverride, onProgress) {
    const text = await (0, parser_1.parseFile)(filePath);
    let fileSizeBytes;
    try {
        fileSizeBytes = (await (0, promises_1.stat)(filePath)).size;
    }
    catch {
        fileSizeBytes = undefined;
    }
    return ingestText(sourceOverride ?? filePath, text, tags, { fileSizeBytes, onProgress });
}
async function ingestText(sourceLabel, text, tags = [], options = {}) {
    const wallStartedMs = Date.now();
    const debugPerf = process.env.DEBUG_PERF === 'true';
    const perfTotals = {
        embeddingMs: 0,
        qdrantSearchMs: 0,
        qdrantUpsertMs: 0,
        sqliteMs: 0,
        connectionSeedingMs: 0,
    };
    const perfCounts = {
        embeddingChunks: 0,
        qdrantSearchChunks: 0,
        qdrantUpsertChunks: 0,
        sqliteChunks: 0,
        connectionSeedingChunks: 0,
    };
    let cpuSnapshotTimer = null;
    const logPerf = (line) => {
        if (!debugPerf)
            return;
        console.log(line);
    };
    const logBatchPerf = (snapshot) => {
        if (!debugPerf)
            return;
        const embedRate = rateForStage(snapshot.batchSize, snapshot.embedMs);
        const searchRate = rateForStage(snapshot.batchSize, snapshot.searchMs);
        const upsertRate = rateForStage(snapshot.batchSize, snapshot.upsertMs);
        const sqliteRate = rateForStage(snapshot.batchSize, snapshot.sqliteMs);
        console.log(`[PERF][Batch ${snapshot.batchIndex}] size=${snapshot.batchSize} ` +
            `embed=${(snapshot.embedMs / 1000).toFixed(3)}s (${embedRate} chunks/sec) ` +
            `search=${(snapshot.searchMs / 1000).toFixed(3)}s (${searchRate} chunks/sec) ` +
            `upsert=${(snapshot.upsertMs / 1000).toFixed(3)}s (${upsertRate} chunks/sec) ` +
            `sqlite=${(snapshot.sqliteMs / 1000).toFixed(3)}s (${sqliteRate} chunks/sec) ` +
            `seed=${(snapshot.seedingMs / 1000).toFixed(3)}s`);
    };
    if (debugPerf) {
        const cpuIntervalMsRaw = Number.parseInt(process.env.PERF_CPU_SNAPSHOT_INTERVAL_MS ?? '15000', 10);
        const cpuIntervalMs = Number.isFinite(cpuIntervalMsRaw) && cpuIntervalMsRaw > 0
            ? cpuIntervalMsRaw
            : 15000;
        const cpuStartedAtMs = Date.now();
        const cpuTotalStart = process.cpuUsage();
        let cpuLast = process.cpuUsage();
        cpuSnapshotTimer = setInterval(() => {
            const delta = process.cpuUsage(cpuLast);
            cpuLast = process.cpuUsage();
            const elapsedMs = Date.now() - cpuStartedAtMs;
            const total = process.cpuUsage(cpuTotalStart);
            console.log(`[PERF][CPU] elapsed=${(elapsedMs / 1000).toFixed(1)}s ` +
                `delta_user=${(delta.user / 1000).toFixed(1)}ms delta_sys=${(delta.system / 1000).toFixed(1)}ms ` +
                `total_user=${(total.user / 1000).toFixed(1)}ms total_sys=${(total.system / 1000).toFixed(1)}ms`);
        }, cpuIntervalMs);
    }
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
    let chunks;
    const chunkFn = process.env.CHUNK_STRATEGY === 'llm' ? llmChunk_1.llmChunkText : semanticChunk_1.semanticChunkText;
    try {
        chunks = await chunkFn(text);
    }
    finally {
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
    const skipDuplicateCheck = process.env.SKIP_DUPLICATE_CHECK === 'true';
    const deferGraphBuild = process.env.DEFER_GRAPH_BUILD === 'true';
    const BATCH_SIZE = 32;
    const ingestTimestamp = new Date().toISOString();
    const ingestStartMs = Date.now();
    let stored = 0;
    let skipped = 0;
    let seededConnections = 0;
    const chunkCompletionTimesMs = [];
    onProgress?.({
        type: 'start',
        source,
        totalChunks: chunks.length,
    });
    const emitChunkProgress = (recordCompletion = true) => {
        const processed = stored + skipped;
        const now = Date.now();
        if (recordCompletion) {
            chunkCompletionTimesMs.push(now);
            if (chunkCompletionTimesMs.length > 10) {
                chunkCompletionTimesMs.shift();
            }
        }
        let chunksPerSec = 0;
        if (chunkCompletionTimesMs.length >= 2) {
            const first = chunkCompletionTimesMs[0];
            const last = chunkCompletionTimesMs[chunkCompletionTimesMs.length - 1];
            const durationSec = (last - first) / 1000;
            if (durationSec > 0) {
                chunksPerSec = (chunkCompletionTimesMs.length - 1) / durationSec;
            }
        }
        else {
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
        if (cpuSnapshotTimer) {
            clearInterval(cpuSnapshotTimer);
            cpuSnapshotTimer = null;
        }
        console.log(`\n✅ Done in 0s — stored 0 chunks, skipped 0 duplicates, seeded 0 connections\n`);
        db_1.db.prepare(`
      INSERT INTO ingest_events (event_id, source, chunks_stored, chunks_skipped, connections_seeded, tags, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run((0, uuid_1.v4)(), source, 0, 0, 0, JSON.stringify(tags), ingestTimestamp);
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
    const progress = new progress_1.ProgressBar({ total: chunks.length, fallbackEvery: 50, minColumns: 60 });
    const insertChunkStmt = db_1.db.prepare(`
    INSERT INTO chunks (chunk_id, text, source, page, timestamp, tags)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    const batchInsertChunks = db_1.db.transaction((items) => {
        for (const item of items) {
            insertChunkStmt.run(item.chunkId, item.text, item.source, item.page, item.timestamp, item.tagsJson);
        }
    });
    try {
        const deferredSeeds = [];
        let completedBatchCount = 0;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            completedBatchCount++;
            const batchIndex = completedBatchCount;
            // Fix 2: Batch embedding — one inference call per batch
            const embedStart = Date.now();
            const vectors = await (0, embed_1.embedBatch)(batch.map(c => c.text));
            const embedMs = Date.now() - embedStart;
            perfTotals.embeddingMs += embedMs;
            perfCounts.embeddingChunks += batch.length;
            // Fix 1: Single searchSimilar call per chunk (parallel within batch)
            const skipSearch = skipDuplicateCheck && deferGraphBuild;
            const searchStart = Date.now();
            const searchResults = skipSearch
                ? batch.map(() => ({ topScore: 0, similarIds: [] }))
                : await Promise.all(vectors.map(v => searchSimilar(v)));
            const searchMs = skipSearch ? 0 : (Date.now() - searchStart);
            perfTotals.qdrantSearchMs += searchMs;
            perfCounts.qdrantSearchChunks += skipSearch ? 0 : batch.length;
            const toStore = [];
            for (let j = 0; j < batch.length; j++) {
                const { topScore, similarIds } = searchResults[j];
                if (!skipDuplicateCheck && topScore >= duplicateThreshold) {
                    skipped++;
                    progress.tick({ duplicates: 1 });
                    emitChunkProgress();
                    continue;
                }
                toStore.push({
                    chunk: batch[j],
                    chunkId: (0, uuid_1.v4)(),
                    vector: vectors[j],
                    timestamp: new Date().toISOString(),
                    similarIds: deferGraphBuild ? [] : similarIds,
                });
            }
            if (toStore.length === 0) {
                logBatchPerf({ batchIndex, batchSize: batch.length, embedMs, searchMs, upsertMs: 0, sqliteMs: 0, seedingMs: 0 });
                continue;
            }
            // Batch Qdrant upsert
            let upsertMs = 0;
            try {
                const upsertStart = Date.now();
                await db_1.qdrant.upsert(db_1.COLLECTION, {
                    points: toStore.map(c => ({
                        id: c.chunkId,
                        vector: c.vector,
                        payload: { text: c.chunk.text, source, chunk_id: c.chunkId },
                    })),
                });
                upsertMs = Date.now() - upsertStart;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`\n⚠️  Qdrant upsert failed for batch [${source}]: ${message}`);
                skipped += toStore.length;
                for (let k = 0; k < toStore.length; k++) {
                    progress.tick({ duplicates: 1 });
                    emitChunkProgress();
                }
                logBatchPerf({ batchIndex, batchSize: batch.length, embedMs, searchMs, upsertMs: 0, sqliteMs: 0, seedingMs: 0 });
                continue;
            }
            perfTotals.qdrantUpsertMs += upsertMs;
            perfCounts.qdrantUpsertChunks += toStore.length;
            // Fix 3: Batch SQLite chunk inserts with transaction
            const sqliteStart = Date.now();
            batchInsertChunks(toStore.map(c => ({
                chunkId: c.chunkId,
                text: c.chunk.text,
                source,
                page: c.chunk.index,
                timestamp: c.timestamp,
                tagsJson: JSON.stringify(tags),
            })));
            const sqliteMs = Date.now() - sqliteStart;
            perfTotals.sqliteMs += sqliteMs;
            perfCounts.sqliteChunks += toStore.length;
            // Fix 4: Batch seedConnections with INSERT OR IGNORE
            let seedingMs = 0;
            if (!deferGraphBuild) {
                const seedStart = Date.now();
                const entries = toStore.map(c => ({ sourceId: c.chunkId, targetIds: c.similarIds }));
                const conns = seedConnectionsBatch(entries, ingestTimestamp);
                seededConnections += conns;
                seedingMs = Date.now() - seedStart;
                perfTotals.connectionSeedingMs += seedingMs;
                perfCounts.connectionSeedingChunks += toStore.length;
            }
            else {
                deferredSeeds.push(...toStore.map(c => ({ chunkId: c.chunkId, vector: c.vector, timestamp: c.timestamp })));
            }
            // Update progress per stored chunk
            for (const _item of toStore) {
                stored++;
                progress.tick({ stored: 1, connections: 0 });
                emitChunkProgress();
            }
            logBatchPerf({ batchIndex, batchSize: batch.length, embedMs, searchMs, upsertMs, sqliteMs, seedingMs });
        }
        // Deferred graph build phase
        if (deferGraphBuild && deferredSeeds.length > 0) {
            for (let i = 0; i < deferredSeeds.length; i += BATCH_SIZE) {
                completedBatchCount++;
                const seedBatch = deferredSeeds.slice(i, i + BATCH_SIZE);
                const deferredSearchStart = Date.now();
                const searchResults = await Promise.all(seedBatch.map(s => searchSimilar(s.vector)));
                const deferredSearchMs = Date.now() - deferredSearchStart;
                perfTotals.qdrantSearchMs += deferredSearchMs;
                perfCounts.qdrantSearchChunks += seedBatch.length;
                const seedStart = Date.now();
                const entries = seedBatch.map((s, j) => ({
                    sourceId: s.chunkId,
                    targetIds: searchResults[j].similarIds,
                }));
                const conns = seedConnectionsBatch(entries, ingestTimestamp);
                seededConnections += conns;
                const seedingMs = Date.now() - seedStart;
                perfTotals.connectionSeedingMs += seedingMs;
                perfCounts.connectionSeedingChunks += seedBatch.length;
                emitChunkProgress(false);
                logBatchPerf({
                    batchIndex: completedBatchCount,
                    batchSize: seedBatch.length,
                    embedMs: 0,
                    searchMs: deferredSearchMs,
                    upsertMs: 0,
                    sqliteMs: 0,
                    seedingMs,
                });
            }
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onProgress?.({ type: 'error', message });
        if (cpuSnapshotTimer) {
            clearInterval(cpuSnapshotTimer);
            cpuSnapshotTimer = null;
        }
        throw error;
    }
    const summary = progress.finish({
        stored,
        duplicates: skipped,
        connections: seededConnections,
    });
    if (cpuSnapshotTimer) {
        clearInterval(cpuSnapshotTimer);
        cpuSnapshotTimer = null;
    }
    if (debugPerf) {
        const wallMs = Date.now() - wallStartedMs;
        logPerf(`[PERF] Embed total: ${formatPerfSeconds(perfTotals.embeddingMs)}`);
        logPerf(`[PERF] Qdrant search total: ${formatPerfSeconds(perfTotals.qdrantSearchMs)}`);
        logPerf(`[PERF] Qdrant upsert total: ${formatPerfSeconds(perfTotals.qdrantUpsertMs)}`);
        logPerf(`[PERF] SQLite total: ${formatPerfSeconds(perfTotals.sqliteMs)}`);
        logPerf(`[PERF] Connection seeding total: ${formatPerfSeconds(perfTotals.connectionSeedingMs)}`);
        logPerf(`[PERF] Wall time: ${formatPerfSeconds(wallMs)}`);
        console.log('[PERF] Summary table:');
        console.table([
            {
                stage: 'Embedding',
                total_seconds: Number((perfTotals.embeddingMs / 1000).toFixed(3)),
                chunks: perfCounts.embeddingChunks,
                avg_chunks_per_sec: Number(rateForStage(perfCounts.embeddingChunks, perfTotals.embeddingMs)),
            },
            {
                stage: 'Qdrant Search',
                total_seconds: Number((perfTotals.qdrantSearchMs / 1000).toFixed(3)),
                chunks: perfCounts.qdrantSearchChunks,
                avg_chunks_per_sec: Number(rateForStage(perfCounts.qdrantSearchChunks, perfTotals.qdrantSearchMs)),
            },
            {
                stage: 'Qdrant Upsert',
                total_seconds: Number((perfTotals.qdrantUpsertMs / 1000).toFixed(3)),
                chunks: perfCounts.qdrantUpsertChunks,
                avg_chunks_per_sec: Number(rateForStage(perfCounts.qdrantUpsertChunks, perfTotals.qdrantUpsertMs)),
            },
            {
                stage: 'SQLite Writes',
                total_seconds: Number((perfTotals.sqliteMs / 1000).toFixed(3)),
                chunks: perfCounts.sqliteChunks,
                avg_chunks_per_sec: Number(rateForStage(perfCounts.sqliteChunks, perfTotals.sqliteMs)),
            },
            {
                stage: 'Connection Seeding',
                total_seconds: Number((perfTotals.connectionSeedingMs / 1000).toFixed(3)),
                chunks: perfCounts.connectionSeedingChunks,
                avg_chunks_per_sec: Number(rateForStage(perfCounts.connectionSeedingChunks, perfTotals.connectionSeedingMs)),
            },
            {
                stage: 'Wall Time',
                total_seconds: Number((wallMs / 1000).toFixed(3)),
                chunks: stored + skipped,
                avg_chunks_per_sec: Number(rateForStage(stored + skipped, wallMs)),
            },
        ]);
    }
    console.log(`✅ Done in ${summary.duration} — stored ${stored} chunks, skipped ${skipped} duplicates, seeded ${seededConnections} connections\n`);
    onProgress?.({
        type: 'done',
        stored,
        skipped,
        connections: seededConnections,
        elapsedSeconds: summary.durationSeconds,
    });
    db_1.db.prepare(`
    INSERT INTO ingest_events (event_id, source, chunks_stored, chunks_skipped, connections_seeded, tags, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run((0, uuid_1.v4)(), source, stored, skipped, seededConnections, JSON.stringify(tags), ingestTimestamp);
    return {
        success: true,
        chunks_stored: stored,
        chunks_skipped: skipped,
        connections_seeded: seededConnections,
        source,
    };
}
