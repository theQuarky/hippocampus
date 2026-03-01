"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticChunkText = semanticChunkText;
// src/semanticChunk.ts
// Strategy: headers first → semantic split for oversized sections → merge tiny sections
const segment_1 = require("./segment");
const embedMany_1 = require("./embedMany");
const sim_1 = require("./sim");
function approxTokens(s) {
    return Math.ceil(s.length / 4);
}
// ── Header detection ────────────────────────────────────────────────────────
// A header is a short line that doesn't end with sentence punctuation
function isHeader(line) {
    const t = line.trim();
    if (t.length === 0)
        return false;
    if (t.length > 80)
        return false; // too long
    if (/[.!?,;]$/.test(t))
        return false; // ends with punctuation
    if (!/^[A-Z]/.test(t))
        return false; // must start with capital
    if (t.split(' ').length > 10)
        return false; // too many words
    return true;
}
// Split raw text into sections using header lines as dividers
function splitIntoSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let currentHeader = '';
    let currentBody = [];
    for (const line of lines) {
        if (isHeader(line) && currentBody.join('').trim().length > 0) {
            // save previous section
            sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
            currentHeader = line.trim();
            currentBody = [];
        }
        else if (isHeader(line) && currentBody.join('').trim().length === 0) {
            // first header or consecutive headers — just update header
            currentHeader = line.trim();
        }
        else {
            currentBody.push(line);
        }
    }
    // push last section
    if (currentBody.join('').trim().length > 0) {
        sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
    }
    return sections;
}
// ── Semantic split for oversized sections ───────────────────────────────────
async function semanticSplit(text, targetMaxTokens, targetMinTokens, debug) {
    const sentences = (0, segment_1.splitSentences)(text);
    if (sentences.length <= 1)
        return [text];
    const vecs = await (0, embedMany_1.embedMany)(sentences);
    const sims = [];
    for (let i = 0; i < vecs.length - 1; i++) {
        sims.push((0, sim_1.cosine)(vecs[i], vecs[i + 1]));
    }
    // find the lowest similarity points as split candidates
    const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
    const splitPoints = new Set();
    for (let i = 0; i < sims.length; i++) {
        if (sims[i] < avg - 0.05)
            splitPoints.add(i + 1);
    }
    // build chunks from split points
    const starts = [0, ...Array.from(splitPoints).sort((a, b) => a - b), sentences.length];
    const chunks = [];
    for (let i = 0; i < starts.length - 1; i++) {
        chunks.push(sentences.slice(starts[i], starts[i + 1]).join(' ').trim());
    }
    // merge tiny chunks
    const merged = [];
    for (const c of chunks) {
        if (merged.length === 0) {
            merged.push(c);
            continue;
        }
        if (approxTokens(c) < targetMinTokens) {
            merged[merged.length - 1] = (merged[merged.length - 1] + ' ' + c).trim();
        }
        else
            merged.push(c);
    }
    return merged;
}
// ── Main export ─────────────────────────────────────────────────────────────
async function semanticChunkText(text, opts) {
    const { targetMinTokens = 60, targetMaxTokens = 400, debug = false, } = opts ?? {};
    // Step 1: split on headers
    const sections = splitIntoSections(text);
    if (debug) {
        console.log(`   [debug] found ${sections.length} sections via headers`);
        sections.forEach((s, i) => console.log(`   [debug] section[${i}] header="${s.header}" body=${approxTokens(s.body)}t`));
    }
    // Step 2: if no headers found, fall back to full semantic split
    if (sections.length <= 1) {
        if (debug)
            console.log(`   [debug] no headers found — falling back to semantic split`);
        const chunks = await semanticSplit(text, targetMaxTokens, targetMinTokens, debug);
        return chunks.map((t, idx) => ({ text: t, index: idx }));
    }
    // Step 3: process each section
    const allChunks = [];
    for (const section of sections) {
        // prepend header to body so context isn't lost
        const fullText = section.header
            ? `${section.header}\n${section.body}`
            : section.body;
        const tokens = approxTokens(fullText);
        if (tokens <= targetMaxTokens) {
            // fits in one chunk — keep as is
            allChunks.push(fullText.trim());
        }
        else {
            // too large — semantic split within section
            if (debug)
                console.log(`   [debug] section "${section.header}" is ${tokens}t — semantic splitting`);
            const subChunks = await semanticSplit(fullText, targetMaxTokens, targetMinTokens, debug);
            allChunks.push(...subChunks);
        }
    }
    // Step 4: merge sections that are too small
    const merged = [];
    for (const c of allChunks) {
        if (merged.length === 0) {
            merged.push(c);
            continue;
        }
        if (approxTokens(c) < targetMinTokens) {
            merged[merged.length - 1] = (merged[merged.length - 1] + '\n' + c).trim();
        }
        else
            merged.push(c);
    }
    if (debug) {
        console.log(`   [debug] final chunks: ${merged.length}`);
        merged.forEach((c, i) => console.log(`   [debug] chunk[${i}] (~${approxTokens(c)}t): "${c.slice(0, 70)}"`));
    }
    return merged.map((t, idx) => ({ text: t, index: idx }));
}
