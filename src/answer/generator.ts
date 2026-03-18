// src/answer/generator.ts — Grounded answer generation via local LLM (with timeout)
import { Ollama } from 'ollama';
import { ANSWER_MODEL, MAX_OUTPUT_TOKENS, LLM_TIMEOUT_MS, OLLAMA_URL } from '../config';

const ollama = new Ollama({ host: OLLAMA_URL });
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

/**
 * Pre-warm the Ollama model so the first real generation doesn't eat the
 * timeout budget on model-load.  Fires a 1-token request and discards the
 * result.  Safe to call multiple times — Ollama de-duplicates loads.
 */
export async function warmupModel(): Promise<void> {
  try {
    const t = Date.now();
    await ollama.generate({
      model: ANSWER_MODEL,
      prompt: 'hi',
      options: { num_predict: 1 },
    });
    console.log(`[GEN] model warmup: ${Date.now() - t}ms`);
  } catch (e) {
    console.warn(`[GEN] model warmup failed: ${e instanceof Error ? e.message : e}`);
  }
}

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

  // ── Instrumentation: prompt size & chunk count ──
  const promptChars = prompt.length;
  const promptTokensEst = Math.ceil(promptChars / 4);
  const chunkCount = contextPackage.chunkIds.length;
  console.log(`[GEN] model=${ANSWER_MODEL}  chunks_in_prompt=${chunkCount}  prompt_chars=${promptChars}  prompt_tokens≈${promptTokensEst}  max_output_tokens=${MAX_OUTPUT_TOKENS}  timeout=${LLM_TIMEOUT_MS}ms`);

  const t0 = Date.now();

  let answerText: string;
  try {
    // Race the LLM call against a timeout so the CLI never hangs indefinitely
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LLM generation timed out after ${LLM_TIMEOUT_MS / 1000}s`)), LLM_TIMEOUT_MS);
      timer.unref(); // Don't prevent process exit
    });

    const response = await Promise.race([
      ollama.generate({
        model: ANSWER_MODEL,
        system: SYSTEM_PROMPT,
        prompt,
        options: { temperature: 0.2, num_predict: MAX_OUTPUT_TOKENS },
      }),
      timeoutPromise,
    ]);
    clearTimeout(timer!);

    answerText = (response.response || '').trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ Ollama answer generation failed: ${msg}`);
    answerText = 'LLM generation failed or timed out. Evidence retrieved successfully.';
  }

  const genMs = Date.now() - t0;
  console.log(`[GEN] ollama_generation: ${genMs}ms  (${(genMs / 1000).toFixed(1)}s)`);

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
