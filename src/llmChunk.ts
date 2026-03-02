// src/llmChunk.ts
// Expected: ~30-60s per 100 pages at concurrency 3 with phi3:mini

export interface Chunk { text: string; index: number; }

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = process.env.OLLAMA_CHUNK_MODEL ?? 'phi3:mini';
const WINDOW_TOKENS = 1200;
const OVERLAP_TOKENS = 200;
const MIN_WORDS = 60;
const MAX_WORDS = 400;

const SYSTEM_PROMPT = `You are a precise document segmentation assistant.
Your job is to split text into semantically coherent chunks.
Each chunk must cover exactly ONE complete idea or topic.
Rules:
- Minimum chunk size: 60 words
- Maximum chunk size: 400 words
- Never cut mid-sentence
- Never cut mid-paragraph if avoidable
- Prefer splitting at paragraph breaks and topic shifts
- Return ONLY a JSON array of strings, no explanation, no markdown`;

function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function sentenceSplit(text: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: string[] = [];
  for (const part of seg.segment(text)) {
    const s = String(part.segment).trim();
    if (s) out.push(s);
  }
  return out;
}

function fallbackParagraphSplit(text: string): string[] {
  const chunks = text
    .split(/\n\n+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (chunks.length === 0) return [text.trim()].filter(Boolean);
  return chunks;
}

async function chunkWindow(text: string, model: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const userPrompt = `Split this text into semantic chunks:\n\n${text}\n\nReturn ONLY a JSON array of chunk strings.`;

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        stream: false,
        options: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as { response?: string };
    const raw = (payload.response ?? '').replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        const chunks = parsed.map((item) => item.trim()).filter(Boolean);
        if (chunks.length > 0) return chunks;
      }
    } catch {
      return fallbackParagraphSplit(text);
    }

    return [text].map((value) => value.trim()).filter(Boolean);
  } finally {
    clearTimeout(timeout);
  }
}

function splitIntoWindows(text: string, windowTokens: number, overlapTokens: number): string[] {
  const sentences = sentenceSplit(text);
  if (sentences.length === 0) return [text.trim()].filter(Boolean);

  const windows: string[] = [];
  let start = 0;

  while (start < sentences.length) {
    let end = start;
    let tokens = 0;

    while (end < sentences.length) {
      const sentenceTokens = approxTokens(sentences[end]);
      if (tokens + sentenceTokens > windowTokens && end > start) {
        break;
      }
      tokens += sentenceTokens;
      end++;
    }

    const windowText = sentences.slice(start, end).join(' ').trim();
    if (windowText) windows.push(windowText);
    if (end >= sentences.length) break;

    let overlapStart = end;
    let overlapCount = 0;
    for (let cursor = end - 1; cursor >= start; cursor--) {
      overlapCount += approxTokens(sentences[cursor]);
      overlapStart = cursor;
      if (overlapCount >= overlapTokens) break;
    }

    start = overlapStart <= start ? end : overlapStart;
  }

  return windows;
}

async function deduplicateChunks(chunks: string[]): Promise<string[]> {
  const deduped: string[] = [];
  const byPrefix = new Map<string, number>();

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const prefix = trimmed.slice(0, 50).toLowerCase();
    const existingIndex = byPrefix.get(prefix);

    if (existingIndex === undefined) {
      byPrefix.set(prefix, deduped.length);
      deduped.push(trimmed);
      continue;
    }

    if (trimmed.length > deduped[existingIndex].length) {
      deduped[existingIndex] = trimmed;
    }
  }

  return deduped;
}

export async function llmChunkText(
  text: string,
  opts?: { debug?: boolean; concurrency?: number }
): Promise<Chunk[]> {
  const debug = opts?.debug ?? false;
  const concurrency = Math.max(1, opts?.concurrency ?? 3);
  const model = DEFAULT_MODEL;

  const startedAt = Date.now();
  const windows = splitIntoWindows(text, WINDOW_TOKENS, OVERLAP_TOKENS);
  const results: string[][] = new Array(windows.length);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, windows.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor++;
      if (index >= windows.length) return;

      const windowText = windows[index];

      try {
        results[index] = await chunkWindow(windowText, model);
      } catch {
        console.warn(`⚠️  LLM chunking failed for window ${index + 1}, using heuristic fallback`);
        results[index] = fallbackParagraphSplit(windowText);
      }
    }
  });

  await Promise.all(workers);

  const merged = results.flat();
  const deduped = await deduplicateChunks(merged);
  const out = deduped.map((value, index) => ({ text: value, index }));

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`🤖 LLM chunked ${out.length} chunks from ${windows.length} windows in ${elapsedSeconds}s`);

  if (debug) {
    console.log(`   [debug] model=${model} concurrency=${concurrency} windowTokens=${WINDOW_TOKENS} overlapTokens=${OVERLAP_TOKENS}`);
    console.log(`   [debug] chunk limits: ${MIN_WORDS}-${MAX_WORDS} words`);
  }

  return out;
}