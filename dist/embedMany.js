"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embedMany = embedMany;
// src/embedMany.ts
const embed_1 = require("./embed");
async function embedMany(texts, batchSize = 16) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        // naive parallel; later control concurrency with p-queue
        const vs = await Promise.all(batch.map(t => (0, embed_1.embed)(t)));
        vectors.push(...vs);
    }
    return vectors;
}
