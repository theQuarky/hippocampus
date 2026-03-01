"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.warmupReranker = warmupReranker;
exports.retrieve = retrieve;
// src/retrieve.ts
const embed_1 = require("./embed");
const db_1 = require("./db");
const GRAPH_BOOST_FACTOR = 0.15;
// Example: vector score 0.72 + (connection weight 0.3 * boost factor 0.15) = 0.765
const MAX_RERANK_CANDIDATES = 20;
let crossEncoderPromise = null;
async function getCrossEncoder() {
    if (!crossEncoderPromise) {
        crossEncoderPromise = (async () => {
            try {
                const { pipeline } = await Promise.resolve().then(() => __importStar(require('@xenova/transformers')));
                return await pipeline('text-classification', 'cross-encoder/ms-marco-MiniLM-L-6-v2');
            }
            catch (error) {
                console.warn('⚠️ Failed to load @xenova/transformers re-ranker. Skipping re-ranking.', error);
                return null;
            }
        })();
    }
    return crossEncoderPromise;
}
async function warmupReranker() {
    const startedAt = Date.now();
    const model = await getCrossEncoder();
    const elapsedMs = Date.now() - startedAt;
    if (model) {
        console.log(`🔥 Re-ranker warmup complete in ${elapsedMs}ms`);
    }
}
function extractScore(output) {
    if (typeof output === 'number')
        return output;
    if (Array.isArray(output)) {
        if (output.length === 0)
            return undefined;
        const first = output[0];
        if (Array.isArray(first))
            return extractScore(first[0]);
        if (first && typeof first.score === 'number')
            return first.score;
        return extractScore(first);
    }
    if (output && typeof output.score === 'number')
        return output.score;
    if (output && output.data)
        return extractScore(output.data);
    return undefined;
}
async function predictRelevanceScore(crossEncoder, query, candidateText) {
    const attempts = [
        () => crossEncoder(query, { text_pair: candidateText, topk: 1 }),
        () => crossEncoder({ text: query, text_pair: candidateText }, { topk: 1 }),
        () => crossEncoder([query, candidateText], { topk: 1 }),
        () => crossEncoder([[query, candidateText]], { topk: 1 })
    ];
    let lastError;
    for (const attempt of attempts) {
        try {
            const output = await attempt();
            const score = extractScore(output);
            if (typeof score === 'number' && Number.isFinite(score)) {
                return score;
            }
        }
        catch (error) {
            lastError = error;
        }
    }
    throw new Error(`Unable to extract rerank score from cross-encoder output${lastError ? `: ${String(lastError)}` : ''}`);
}
async function rerankCandidates(query, candidates) {
    if (candidates.length <= 1)
        return candidates;
    const crossEncoder = await getCrossEncoder();
    if (!crossEncoder)
        return candidates;
    const startedAt = Date.now();
    try {
        const reranked = [];
        for (const candidate of candidates) {
            const rerank_score = await predictRelevanceScore(crossEncoder, query, candidate.text);
            reranked.push({
                ...candidate,
                rerank_score
            });
        }
        reranked.sort((a, b) => (b.rerank_score ?? Number.NEGATIVE_INFINITY) - (a.rerank_score ?? Number.NEGATIVE_INFINITY));
        const elapsedMs = Date.now() - startedAt;
        console.log(`🔢 Re-ranked ${reranked.length} candidates in ${elapsedMs}ms`);
        return reranked;
    }
    catch (error) {
        console.warn('⚠️ Re-ranking failed. Falling back to vector/graph score ordering.', error);
        return candidates;
    }
}
async function retrieve(query, topK = 20) {
    const vector = await (0, embed_1.embed)(query);
    const hits = await db_1.qdrant.search(db_1.COLLECTION, {
        vector,
        limit: topK,
        with_payload: true
    });
    if (hits.length === 0)
        return [];
    const MIN_SCORE = 0.40;
    const vectorCandidates = [];
    const vectorChunkIds = new Set();
    for (const hit of hits) {
        const payload = hit.payload;
        const chunk_id = payload?.chunk_id;
        if (!chunk_id)
            continue;
        vectorChunkIds.add(chunk_id);
        vectorCandidates.push({
            text: payload.text,
            source: payload.source,
            score: hit.score ?? 0,
            chunk_id,
            graph_boosted: false
        });
    }
    const graphCandidatesById = new Map();
    const connectionStmt = db_1.db.prepare(`
    SELECT target_chunk, weight
    FROM connections
    WHERE source_chunk = ?
  `);
    const chunkStmt = db_1.db.prepare(`
    SELECT text, source
    FROM chunks
    WHERE chunk_id = ?
  `);
    for (const vectorResult of vectorCandidates) {
        const neighbors = connectionStmt.all(vectorResult.chunk_id);
        for (const neighbor of neighbors) {
            if (!neighbor?.target_chunk)
                continue;
            if (vectorChunkIds.has(neighbor.target_chunk))
                continue;
            const chunkRow = chunkStmt.get(neighbor.target_chunk);
            if (!chunkRow)
                continue;
            const boostedScore = vectorResult.score + ((neighbor.weight ?? 0) * GRAPH_BOOST_FACTOR);
            const existing = graphCandidatesById.get(neighbor.target_chunk);
            if (!existing || boostedScore > existing.score) {
                graphCandidatesById.set(neighbor.target_chunk, {
                    text: chunkRow.text,
                    source: chunkRow.source,
                    score: boostedScore,
                    chunk_id: neighbor.target_chunk,
                    graph_boosted: true
                });
            }
        }
    }
    const mergedPool = [...vectorCandidates, ...graphCandidatesById.values()]
        .sort((a, b) => b.score - a.score);
    if (mergedPool.length <= 1) {
        for (const result of mergedPool) {
            db_1.db.prepare(`
        UPDATE chunks
        SET access_count = access_count + 1,
            last_accessed = ?
        WHERE chunk_id = ?
      `).run(new Date().toISOString(), result.chunk_id);
        }
        return mergedPool;
    }
    const rerankPool = mergedPool.slice(0, MAX_RERANK_CANDIDATES);
    const rankedPool = await rerankCandidates(query, rerankPool);
    const filtered = rankedPool
        .filter(candidate => {
        const s = candidate.rerank_score ?? candidate.score ?? 0;
        return s >= MIN_SCORE;
    })
        .slice(0, 5);
    if (filtered.length === 0)
        return [];
    for (const result of filtered) {
        const chunk_id = result.chunk_id;
        db_1.db.prepare(`
      UPDATE chunks
      SET access_count = access_count + 1,
          last_accessed = ?
      WHERE chunk_id = ?
    `).run(new Date().toISOString(), chunk_id);
    }
    return filtered;
}
