"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingest = ingest;
// src/ingest.ts
const uuid_1 = require("uuid");
const embed_1 = require("./embed");
const parser_1 = require("./parser");
const semanticChunk_1 = require("./semanticChunk");
const db_1 = require("./db");
async function topSimilarityScore(vector) {
    try {
        const results = await db_1.qdrant.search(db_1.COLLECTION, {
            vector,
            limit: 1,
            with_payload: false,
            with_vector: false,
        });
        if (!results || results.length === 0)
            return 0;
        return results[0].score ?? 0;
    }
    catch {
        return 0;
    }
}
async function checkDuplicate(vector, threshold) {
    const score = await topSimilarityScore(vector);
    return score >= threshold;
}
async function findSimilarExistingChunks(vector, limit = 5) {
    try {
        const results = await db_1.qdrant.search(db_1.COLLECTION, {
            vector,
            limit,
            with_payload: true,
            with_vector: false,
        });
        return results
            .map(r => r.payload?.chunk_id)
            .filter((id) => Boolean(id));
    }
    catch {
        return [];
    }
}
function seedConnections(sourceChunkId, targetChunkIds, timestamp) {
    if (targetChunkIds.length === 0)
        return 0;
    const existsStmt = db_1.db.prepare(`
    SELECT edge_id
    FROM connections
    WHERE source_chunk = ?
      AND target_chunk = ?
      AND relationship = 'related_to'
    LIMIT 1
  `);
    const insertStmt = db_1.db.prepare(`
    INSERT INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    let created = 0;
    for (const targetChunkId of targetChunkIds) {
        if (targetChunkId === sourceChunkId)
            continue;
        const existing = existsStmt.get(sourceChunkId, targetChunkId);
        if (existing)
            continue;
        insertStmt.run((0, uuid_1.v4)(), sourceChunkId, targetChunkId, 'related_to', 0.3, 0.5, timestamp, null);
        created++;
    }
    return created;
}
async function ingest(filePath, tags = []) {
    console.log(`\n📥 Ingesting: ${filePath}`);
    const text = await (0, parser_1.parseFile)(filePath);
    console.log(`   Parsed ${text.length} characters`);
    const chunks = await (0, semanticChunk_1.semanticChunkText)(text);
    console.log(`   Created ${chunks.length} semantic chunks`);
    const source = filePath.split('/').pop() || filePath;
    const duplicateThreshold = 0.97;
    let stored = 0;
    let skipped = 0;
    let seededConnections = 0;
    for (const chunk of chunks) {
        const chunk_id = (0, uuid_1.v4)();
        const vector = await (0, embed_1.embed)(chunk.text);
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
        await db_1.qdrant.upsert(db_1.COLLECTION, {
            points: [{
                    id: chunk_id,
                    vector,
                    payload: { text: chunk.text, source, chunk_id }
                }]
        });
        db_1.db.prepare(`
      INSERT INTO chunks (chunk_id, text, source, page, timestamp, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chunk_id, chunk.text, source, chunk.index, timestamp, JSON.stringify(tags));
        seededConnections += seedConnections(chunk_id, similarExistingChunkIds, timestamp);
        stored++;
        process.stdout.write(`\r   Stored ${stored}/${chunks.length} | Skipped ${skipped}`);
    }
    console.log(`\n✅ Ingested ${stored} chunks from ${source} (skipped ${skipped} duplicates, seeded ${seededConnections} connections)\n`);
}
