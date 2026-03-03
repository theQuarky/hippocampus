"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embedMany = embedMany;
// src/embedMany.ts
const embed_1 = require("./embed");
async function embedMany(texts, batchSize = 64) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const vs = await (0, embed_1.embedBatch)(batch);
        vectors.push(...vs);
    }
    return vectors;
}
