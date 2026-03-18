// src/ingest/filters.ts — Chunk quality filters for the ingestion pipeline

/**
 * Detect Wikipedia-style citation/reference blocks.
 * These chunks are pure bibliography — no knowledge value.
 * Pattern: >50% of lines start with "^ " (footnote marker) or
 * look like "Author (Year). Title. Journal."
 */
export function isCitationChunk(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 2) return false;

  const citationLines = lines.filter((line) => {
    const t = line.trim();
    if (t.startsWith('^ ')) return true;
    // "Author A, Author B (Year). Title..." pattern
    if (/^[A-Z][a-z]+.{0,60}\(\d{4}\)/.test(t)) return true;
    return false;
  });

  return citationLines.length / lines.length > 0.5;
}

export function isGlossaryChunk(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 3) return false;

  const defLines = lines.filter((line) => {
    const t = line.trim();
    // Two title-case words (original heuristic)
    if (/^[A-Z][a-z]+.*[A-Z][a-z]/.test(t) && t.length < 120) return true;
    // "Term: definition" or "ABBR: definition"
    if (/^[A-Z][A-Za-z\s\-]{0,40}:\s/.test(t) && t.length < 150) return true;
    // "Term — definition" or "Term – definition"
    if (/^[A-Z][A-Za-z\s]{0,40}\s[—–]\s/.test(t) && t.length < 150) return true;
    return false;
  });

  return defLines.length / lines.length > 0.45 && lines.length >= 4;
}
