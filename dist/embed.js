"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embed = embed;
exports.embedBatch = embedBatch;
// embed.ts — working CPU version, keep this
const transformers_1 = require("@xenova/transformers");
let embeddingPipeline = null;
async function getEmbeddingPipeline() {
    if (!embeddingPipeline) {
        embeddingPipeline = await (0, transformers_1.pipeline)('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return embeddingPipeline;
}
async function embed(text) {
    const pipe = await getEmbeddingPipeline();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
}
async function embedBatch(texts) {
    if (texts.length === 0)
        return [];
    const pipe = await getEmbeddingPipeline();
    const result = await pipe(texts, { pooling: 'mean', normalize: true });
    if (Array.isArray(result)) {
        return result.map((row) => Array.from(row.data ?? row));
    }
    const tensorData = result?.data;
    const dims = result?.dims;
    if (!tensorData || !Array.isArray(dims) || dims.length < 2) {
        return texts.map(() => []);
    }
    const rows = Number(dims[0]);
    const cols = Number(dims[1]);
    const vectors = [];
    for (let row = 0; row < rows; row++) {
        const start = row * cols;
        const end = start + cols;
        vectors.push(Array.from(tensorData.slice(start, end)));
    }
    return vectors;
}
