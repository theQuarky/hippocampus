// src/answer/index.ts — Grounded answer generation via local LLM
import ollama from 'ollama';
import { ANSWER_MODEL, DEBUG_PERF } from '../config';
import type { ContextPackage } from './context';
import type { EvidenceBundle, EvidenceChunk } from '../types/evidence';

// ── Types ───────────────────────────────────────────────────────────────────

export interface GroundedAnswer {
  answer: string;
  sources: string[];
  evidence_used: EvidenceChunk[];
  concepts_used: string[];
}

// ── Prompt construction ─────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You answer questions using only the provided knowledge context. ' +
  'Do not use any outside knowledge. Cite sources when relevant.';

function buildPrompt(query: string, contextText: string): string {
  return `Question:
${query}

Knowledge Context:
${contextText}

Instructions:
- Answer the question using ONLY the context above.
- If the answer cannot be found, say: "The available memory does not contain enough information."
- Cite sources when relevant.`;
}

// ── Generator ───────────────────────────────────────────────────────────────

export async function generateGroundedAnswer(
  query: string,
  contextPackage: ContextPackage,
  evidence?: EvidenceBundle,
): Promise<GroundedAnswer> {
  // Handle empty retrieval
  if (contextPackage.chunkIds.length === 0 && contextPackage.conceptLabels.length === 0) {
    return {
      answer: 'The available memory does not contain enough information.',
      sources: [],
      evidence_used: [],
      concepts_used: [],
    };
  }

  const prompt = buildPrompt(query, contextPackage.contextText);

  const t0 = DEBUG_PERF ? Date.now() : 0;

  let answerText: string;
  try {
    const response = await ollama.generate({
      model: ANSWER_MODEL,
      system: SYSTEM_PROMPT,
      prompt,
      options: { temperature: 0.2 },
    });
    answerText = (response.response || '').trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Ollama answer generation failed: ${msg}`);
    answerText = 'Answer generation failed — the LLM could not be reached.';
  }

  if (DEBUG_PERF) {
    console.log(`[PERF] answer_generation: ${Date.now() - t0}ms`);
  }

  // Build evidence_used from the bundle, limited to chunks that were actually
  // included in the context (by chunk_id).
  const usedChunkIdSet = new Set(contextPackage.chunkIds);
  const evidenceUsed: EvidenceChunk[] = evidence
    ? evidence.chunks.filter(c => usedChunkIdSet.has(c.chunk_id))
    : [];

  const conceptsUsed: string[] = evidence
    ? evidence.concepts.map(c => c.label)
    : contextPackage.conceptLabels;

  return {
    answer: answerText,
    sources: contextPackage.sources,
    evidence_used: evidenceUsed,
    concepts_used: conceptsUsed,
  };
}
