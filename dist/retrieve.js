"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retrieve = retrieve;
// src/retrieve.ts
const embed_1 = require("./embed");
const db_1 = require("./db");
async function retrieve(query, topK = 20) {
    const vector = await (0, embed_1.embed)(query);
    const hits = await db_1.qdrant.search(db_1.COLLECTION, {
        vector,
        limit: topK,
        with_payload: true
    });
    if (hits.length === 0)
        return [];
    const best = hits[0].score ?? 0;
    const MIN_SCORE = 0.40;
    const MAX_DROP_FROM_BEST = 0.12;
    const filtered = hits.filter(h => {
        const s = h.score ?? 0;
        return s >= MIN_SCORE && (best - s) <= MAX_DROP_FROM_BEST;
    }).slice(0, 5);
    const results = [];
    for (const hit of filtered) {
        const payload = hit.payload;
        const chunk_id = payload.chunk_id;
        db_1.db.prepare(`
      UPDATE chunks
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE chunk_id = ?
    `).run(new Date().toISOString(), chunk_id);
        results.push({
            text: payload.text,
            source: payload.source,
            score: hit.score ?? 0,
            chunk_id
        });
    }
    return results;
}
