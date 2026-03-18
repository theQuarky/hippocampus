"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkText = chunkText;
function chunkText(text, chunkSize = 400, overlap = 50) {
    const paragraphs = text
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
    const chunks = [];
    let current = '';
    let index = 0;
    for (const para of paragraphs) {
        if ((current + '\n\n' + para).length > chunkSize && current.length > 0) {
            chunks.push({ text: current.trim(), index: index++ });
            // overlap: carry last sentence of previous chunk
            const sentences = current.split(/[.!?]+/);
            current = sentences[sentences.length - 1].trim() + '\n\n' + para;
        }
        else {
            current = current ? current + '\n\n' + para : para;
        }
    }
    if (current.trim().length > 0) {
        chunks.push({ text: current.trim(), index: index++ });
    }
    return chunks;
}
