// src/answer/context.ts — Build a structured context package from retrieved candidates
import { MAX_CONTEXT_TOKENS } from '../config';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  chunk_id: string;
  text: string;
  source: string;
  score: number;
}

export interface RetrievedConcept {
  concept_id: string;
  label: string;
  summary: string;
  confidence: number;
}

export interface ContextPackage {
  contextText: string;
  chunkIds: string[];
  conceptLabels: string[];
  sources: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Simple deduplication: drop chunks whose text overlaps >80% with a prior chunk */
function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    const dominated = kept.some(existing => textOverlap(existing.text, chunk.text) > 0.8);
    if (!dominated) kept.push(chunk);
  }

  return kept;
}

function textOverlap(a: string, b: string): number {
  const sa = safeText(a);
  const sb = safeText(b);
  const shorter = sa.length <= sb.length ? sa : sb;
  const longer = sa.length <= sb.length ? sb : sa;
  if (shorter.length === 0) return 0;

  // Substring containment ratio
  let matchChars = 0;
  const windowSize = Math.min(60, shorter.length);
  for (let i = 0; i <= shorter.length - windowSize; i += windowSize) {
    const window = shorter.slice(i, i + windowSize);
    if (longer.includes(window)) matchChars += windowSize;
  }

  return matchChars / shorter.length;
}

// ── Main ────────────────────────────────────────────────────────────────────

export function buildContext(
  query: string,
  retrievedChunks: RetrievedChunk[],
  retrievedConcepts?: RetrievedConcept[],
): ContextPackage {
  const maxTokens = MAX_CONTEXT_TOKENS;

  // Sort by score descending
  const sorted = [...retrievedChunks]
    .sort((a, b) => b.score - a.score);

  // Deduplicate
  const deduped = deduplicateChunks(sorted);

  // Build concept section first (if available)
  let conceptSection = '';
  const conceptLabels: string[] = [];

  if (retrievedConcepts && retrievedConcepts.length > 0) {
    const conceptLines: string[] = ['=== Relevant Concepts ===', ''];
    for (const concept of retrievedConcepts) {
      const safeLabel = safeText(concept.label);
      const safeSummary = safeText(concept.summary);
      conceptLines.push(`• ${safeLabel}: ${safeSummary}`);
      conceptLabels.push(concept.label);
    }
    conceptLines.push('');
    conceptSection = conceptLines.join('\n');
  }

  // Budget remaining tokens for chunks
  const conceptTokens = estimateTokens(conceptSection);
  let remainingTokens = maxTokens - conceptTokens;

  // Build chunk sections within budget
  const usedChunkIds: string[] = [];
  const usedSources = new Set<string>();
  const chunkSections: string[] = [];

  for (const chunk of deduped) {
    const chunkText = safeText(chunk.text);
    const entry = `----\nSource: ${chunk.source}\n\n${chunkText}\n\n----`;
    const entryTokens = estimateTokens(entry);

    if (entryTokens > remainingTokens) break;

    chunkSections.push(entry);
    usedChunkIds.push(chunk.chunk_id);
    usedSources.add(chunk.source);
    remainingTokens -= entryTokens;
  }

  const contextText = [conceptSection, ...chunkSections]
    .filter(Boolean)
    .join('\n');

  return {
    contextText,
    chunkIds: usedChunkIds,
    conceptLabels,
    sources: [...usedSources],
  };
}

/** Guard against malformed text values */
function safeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
