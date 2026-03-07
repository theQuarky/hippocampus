// src/tokenChunk.ts — Token-aware chunking using actual tokenizer
// Replaces approxTokens-based sizing with real token counts.
import { AutoTokenizer } from '@xenova/transformers';
import { splitSentences } from './segment';
import {
  EMBED_MODEL,
  EMBED_MAX_TOKENS,
  CHUNK_TARGET_MIN_TOKENS,
  CHUNK_TARGET_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  DEBUG_CHUNKS,
} from './config';

export interface Chunk {
  text: string;
  index: number;
}

// ── Tokenizer singleton ────────────────────────────────────────────────────
let cachedTokenizer: any = null;

async function getTokenizer(): Promise<any> {
  if (!cachedTokenizer) {
    cachedTokenizer = await AutoTokenizer.from_pretrained(EMBED_MODEL);
  }
  return cachedTokenizer;
}

/** Count exact tokens using the model tokenizer. */
export async function countTokens(text: string): Promise<number> {
  const tokenizer = await getTokenizer();
  const encoded = tokenizer.encode(text);
  // encoded may be an array or have input_ids property
  if (Array.isArray(encoded)) return encoded.length;
  if (encoded?.input_ids) return encoded.input_ids.length ?? encoded.input_ids.size;
  return Math.ceil(text.length / 4); // fallback
}

/** Encode text to token ids. */
async function encode(text: string): Promise<number[]> {
  const tokenizer = await getTokenizer();
  const encoded = tokenizer.encode(text);
  if (Array.isArray(encoded)) return encoded;
  if (encoded?.input_ids) {
    const ids = encoded.input_ids;
    if (Array.isArray(ids)) return ids;
    return Array.from(ids.data ?? ids);
  }
  return [];
}

/** Decode token ids back to text. */
async function decode(ids: number[]): Promise<string> {
  const tokenizer = await getTokenizer();
  return tokenizer.decode(ids, { skip_special_tokens: true });
}

// ── Header detection (reused from semanticChunk) ───────────────────────────
function isHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.length > 80) return false;
  if (/[.!?,;]$/.test(t)) return false;
  if (!/^[A-Z]/.test(t)) return false;
  if (t.split(' ').length > 10) return false;
  return true;
}

function splitIntoSections(text: string): Array<{ header: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ header: string; body: string }> = [];

  let currentHeader = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    if (isHeader(line) && currentBody.join('').trim().length > 0) {
      sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
      currentHeader = line.trim();
      currentBody = [];
    } else if (isHeader(line) && currentBody.join('').trim().length === 0) {
      currentHeader = line.trim();
    } else {
      currentBody.push(line);
    }
  }

  if (currentBody.join('').trim().length > 0) {
    sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
  }

  return sections;
}

// ── Token-window chunking ──────────────────────────────────────────────────

/**
 * Split text into chunks using real token counts.
 * Strategy:
 * 1) Split on paragraph breaks first (semantic boundaries)
 * 2) If a paragraph exceeds the max, split on sentences
 * 3) If a sentence still exceeds, split using token window with overlap
 * 4) Merge undersized chunks with neighbors
 * 5) Guarantee no chunk exceeds EMBED_MAX_TOKENS
 */
async function tokenWindowChunk(
  text: string,
  targetMin: number,
  targetMax: number,
  overlapTokens: number,
): Promise<string[]> {
  const hardMax = EMBED_MAX_TOKENS;
  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  // Phase 1: build a list of "atomic" text units that are each ≤ targetMax tokens
  const atoms: string[] = [];

  for (const paragraph of paragraphs) {
    const pTokens = await countTokens(paragraph);

    if (pTokens <= targetMax) {
      atoms.push(paragraph);
      continue;
    }

    // Try sentence splitting
    const sentences = splitSentences(paragraph);
    if (sentences.length > 1) {
      for (const sentence of sentences) {
        const sTokens = await countTokens(sentence);
        if (sTokens <= targetMax) {
          atoms.push(sentence);
        } else {
          // Sentence still too long — hard split by token window
          const subChunks = await hardTokenSplit(sentence, targetMax, overlapTokens);
          atoms.push(...subChunks);
        }
      }
    } else {
      // Single sentence too long — hard split
      const subChunks = await hardTokenSplit(paragraph, targetMax, overlapTokens);
      atoms.push(...subChunks);
    }
  }

  // Phase 2: greedily merge atoms into chunks of targetMin..targetMax tokens
  const chunks: string[] = [];
  let currentParts: string[] = [];
  let currentTokenCount = 0;

  const flush = () => {
    if (currentParts.length === 0) return;
    chunks.push(currentParts.join('\n\n').trim());
    currentParts = [];
    currentTokenCount = 0;
  };

  for (const atom of atoms) {
    const atomTokens = await countTokens(atom);

    if (currentTokenCount + atomTokens > targetMax && currentParts.length > 0) {
      flush();
    }

    currentParts.push(atom);
    currentTokenCount += atomTokens;
  }
  flush();

  // Phase 3: merge undersized trailing chunks
  const merged: string[] = [];
  for (const chunk of chunks) {
    if (merged.length === 0) {
      merged.push(chunk);
      continue;
    }
    const chunkTokens = await countTokens(chunk);
    if (chunkTokens < targetMin) {
      const prev = merged[merged.length - 1];
      const combined = `${prev}\n\n${chunk}`.trim();
      const combinedTokens = await countTokens(combined);
      if (combinedTokens <= hardMax) {
        merged[merged.length - 1] = combined;
      } else {
        merged.push(chunk);
      }
    } else {
      merged.push(chunk);
    }
  }

  // Phase 4: enforce hard max — any chunk exceeding hardMax gets re-split
  const final: string[] = [];
  for (const chunk of merged) {
    const tokens = await countTokens(chunk);
    if (tokens <= hardMax) {
      final.push(chunk);
    } else {
      const subChunks = await hardTokenSplit(chunk, hardMax, overlapTokens);
      final.push(...subChunks);
    }
  }

  return final;
}

/**
 * Hard-split a single text by token window with overlap.
 */
async function hardTokenSplit(text: string, maxTokens: number, overlapTokens: number): Promise<string[]> {
  const ids = await encode(text);
  if (ids.length <= maxTokens) return [text];

  const step = Math.max(1, maxTokens - overlapTokens);
  const chunks: string[] = [];

  for (let start = 0; start < ids.length; start += step) {
    const end = Math.min(start + maxTokens, ids.length);
    const chunkIds = ids.slice(start, end);
    const decoded = await decode(chunkIds);
    if (decoded.trim()) {
      chunks.push(decoded.trim());
    }
    if (end === ids.length) break;
  }

  return chunks;
}

// ── Main export ────────────────────────────────────────────────────────────

export async function tokenChunkText(
  text: string,
  opts?: {
    targetMinTokens?: number;
    targetMaxTokens?: number;
    overlapTokens?: number;
    debug?: boolean;
  },
): Promise<Chunk[]> {
  const {
    targetMinTokens = CHUNK_TARGET_MIN_TOKENS,
    targetMaxTokens = CHUNK_TARGET_MAX_TOKENS,
    overlapTokens = CHUNK_OVERLAP_TOKENS,
    debug = DEBUG_CHUNKS,
  } = opts ?? {};

  const start = Date.now();

  // Step 1: try header-based sections
  const sections = splitIntoSections(text);

  let allChunks: string[];

  if (sections.length <= 1) {
    // No headers — full text token-window chunking
    if (debug) console.log('   [debug] no headers found — using token-window chunk');
    allChunks = await tokenWindowChunk(text, targetMinTokens, targetMaxTokens, overlapTokens);
  } else {
    // Process each section independently
    if (debug) console.log(`   [debug] found ${sections.length} sections via headers`);
    allChunks = [];
    for (const section of sections) {
      const fullText = section.header
        ? `${section.header}\n${section.body}`
        : section.body;

      const sectionChunks = await tokenWindowChunk(fullText, targetMinTokens, targetMaxTokens, overlapTokens);
      allChunks.push(...sectionChunks);
    }
  }

  // Debug: log max token length observed
  if (debug) {
    let maxObserved = 0;
    for (const chunk of allChunks) {
      const tokens = await countTokens(chunk);
      if (tokens > maxObserved) maxObserved = tokens;
    }
    const ms = Date.now() - start;
    console.log(`[debug] tokenChunk: ${allChunks.length} chunks in ${ms}ms, max tokens observed: ${maxObserved}`);
    allChunks.forEach((c, i) =>
      console.log(`   [debug] chunk[${i}]: "${c.slice(0, 70)}..."`)
    );
  }

  return allChunks.map((t, idx) => ({ text: t, index: idx }));
}
