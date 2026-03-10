// src/ingest/chunking/semantic.ts
// Strategy: headers first → paragraph/sentence split for oversized sections → merge tiny chunks
import { splitSentences } from './segment';

export interface Chunk { text: string; index: number; }

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function paragraphSplit(
  text: string,
  maxTokens: number,
  minTokens: number,
): string[] {
  const paragraphs = text
    .split(/\n\n+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (currentParts.length === 0) return;
    chunks.push(currentParts.join('\n\n').trim());
    currentParts = [];
    currentTokens = 0;
  };

  const addBySentences = (paragraph: string) => {
    const sentences = splitSentences(paragraph);

    if (sentences.length <= 1) {
      flush();
      chunks.push(paragraph.trim());
      return;
    }

    for (const sentence of sentences) {
      const sentenceTokens = approxTokens(sentence);

      if (currentTokens + sentenceTokens > maxTokens && currentParts.length > 0) {
        flush();
      }

      currentParts.push(sentence);
      currentTokens += sentenceTokens;
    }
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = approxTokens(paragraph);

    if (paragraphTokens > maxTokens) {
      addBySentences(paragraph);
      continue;
    }

    if (currentTokens + paragraphTokens > maxTokens && currentParts.length > 0) {
      flush();
    }

    currentParts.push(paragraph);
    currentTokens += paragraphTokens;
  }

  flush();

  const merged: string[] = [];
  for (const chunk of chunks) {
    if (merged.length === 0) {
      merged.push(chunk);
      continue;
    }

    if (approxTokens(chunk) < minTokens) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${chunk}`.trim();
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}

// ── Header detection ────────────────────────────────────────────────────────
// A header is a short line that doesn't end with sentence punctuation
function isHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.length > 80) return false;                        // too long
  if (/[.!?,;]$/.test(t)) return false;                  // ends with punctuation
  if (!/^[A-Z]/.test(t)) return false;                   // must start with capital
  if (t.split(' ').length > 10) return false;             // too many words
  return true;
}

// Split raw text into sections using header lines as dividers
function splitIntoSections(text: string): Array<{ header: string; body: string }> {
  const lines = text.split('\n');
  const sections: Array<{ header: string; body: string }> = [];

  let currentHeader = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    if (isHeader(line) && currentBody.join('').trim().length > 0) {
      // save previous section
      sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
      currentHeader = line.trim();
      currentBody = [];
    } else if (isHeader(line) && currentBody.join('').trim().length === 0) {
      // first header or consecutive headers — just update header
      currentHeader = line.trim();
    } else {
      currentBody.push(line);
    }
  }

  // push last section
  if (currentBody.join('').trim().length > 0) {
    sections.push({ header: currentHeader, body: currentBody.join('\n').trim() });
  }

  return sections;
}

// ── Main export ─────────────────────────────────────────────────────────────
export async function semanticChunkText(
  text: string,
  opts?: {
    targetMinTokens?: number;
    targetMaxTokens?: number;
    debug?: boolean;
  }
): Promise<Chunk[]> {
  const {
    targetMinTokens = 60,
    targetMaxTokens = 400,
    debug = false,
  } = opts ?? {};

  const start = Date.now();

  // Step 1: split on headers
  const sections = splitIntoSections(text);

  if (debug) {
    console.log(`   [debug] found ${sections.length} sections via headers`);
    sections.forEach((s, i) =>
      console.log(`   [debug] section[${i}] header="${s.header}" body=${approxTokens(s.body)}t`)
    );
  }

  // Step 2: if no headers found, fall back to paragraph split on full text
  if (sections.length <= 1) {
    if (debug) console.log(`   [debug] no headers found — using paragraph split`);
    const chunks = paragraphSplit(text, targetMaxTokens, targetMinTokens);
    if (debug) {
      const ms = Date.now() - start;
      console.log(`[debug] chunked ${chunks.length} chunks in ${ms}ms (heuristic, 0 embed calls)`);
    }
    return chunks.map((t, idx) => ({ text: t, index: idx }));
  }

  // Step 3: process each section
  const allChunks: string[] = [];

  for (const section of sections) {
    // prepend header to body so context isn't lost
    const fullText = section.header
      ? `${section.header}\n${section.body}`
      : section.body;

    const tokens = approxTokens(fullText);

    if (tokens <= targetMaxTokens) {
      // fits in one chunk — keep as is
      allChunks.push(fullText.trim());
    } else {
      // too large — paragraph/sentence split within section
      if (debug) console.log(`   [debug] section "${section.header}" is ${tokens}t — paragraph splitting`);
      const subChunks = paragraphSplit(fullText, targetMaxTokens, targetMinTokens);
      allChunks.push(...subChunks);
    }
  }

  // Step 4: merge sections that are too small
  const merged: string[] = [];
  for (const c of allChunks) {
    if (merged.length === 0) { merged.push(c); continue; }
    if (approxTokens(c) < targetMinTokens) {
      merged[merged.length - 1] = (merged[merged.length - 1] + '\n' + c).trim();
    } else merged.push(c);
  }

  if (debug) {
    const ms = Date.now() - start;
    console.log(`[debug] chunked ${merged.length} chunks in ${ms}ms (heuristic, 0 embed calls)`);
    console.log(`   [debug] final chunks: ${merged.length}`);
    merged.forEach((c, i) =>
      console.log(`   [debug] chunk[${i}] (~${approxTokens(c)}t): "${c.slice(0, 70)}"`)
    );
  }

  return merged.map((t, idx) => ({ text: t, index: idx }));
}
