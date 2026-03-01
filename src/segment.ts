// src/segment.ts
export function splitSentences(text: string): string[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: string[] = [];
  for (const part of seg.segment(text)) {
    const s = String(part.segment).trim();
    if (s) out.push(s);
  }
  return out;
}