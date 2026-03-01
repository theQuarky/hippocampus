"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitSentences = splitSentences;
// src/segment.ts
function splitSentences(text) {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    const out = [];
    for (const part of seg.segment(text)) {
        const s = String(part.segment).trim();
        if (s)
            out.push(s);
    }
    return out;
}
