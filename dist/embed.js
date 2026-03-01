"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embed = embed;
async function embed(text) {
    const res = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: text })
    });
    const data = await res.json();
    return data.embedding;
}
