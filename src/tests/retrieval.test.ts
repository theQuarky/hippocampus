// src/tests/retrieval.test.ts
// Tests for the cross-encoder re-ranker in src/retrieve/index.ts.
//
// Usage:  npx ts-node src/tests/retrieval.test.ts
//
// The first run downloads Xenova/ms-marco-MiniLM-L-6-v2 (~80 MB); expect
// ~30 s on a slow connection. Subsequent runs use the local model cache.

import { predictRelevanceScore, rerankCandidates } from '../retrieve';
import type { Result } from '../retrieve';

function expect(actual: unknown, expected: unknown, message: string): void {
  const pass =
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.abs(actual - expected) < 1e-9
      : actual === expected;
  if (!pass) throw new Error(`FAIL  ${message}\n  expected: ${expected}\n  received: ${actual}`);
}
function expectGt(actual: number, threshold: number, message: string): void {
  if (actual <= threshold) throw new Error(`FAIL  ${message}\n  expected > ${threshold}\n  received: ${actual}`);
}
function expectType(actual: unknown, type: string, message: string): void {
  if (typeof actual !== type) throw new Error(`FAIL  ${message}\n  expected typeof: ${type}\n  received: ${typeof actual}`);
}
function expectGte(actual: number, threshold: number, message: string): void {
  if (actual < threshold) throw new Error(`FAIL  ${message}\n  expected >= ${threshold}\n  received: ${actual}`);
}

function makeResult(id: string, text: string, score: number): Result {
  return {
    text,
    source: 'test',
    score,
    chunk_id: id,
    graph_boosted: false,
    retrieval_layer: 'vector',
    path: [id],
    conflicts: [],
  };
}

async function test(name: string, fn: () => Promise<void>): Promise<boolean> {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('✅');
    return true;
  } catch (err) {
    console.log('❌');
    console.error('  ', err instanceof Error ? err.message : err);
    return false;
  }
}

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const run = async (name: string, fn: () => Promise<void>) => {
    const ok = await test(name, fn);
    ok ? passed++ : failed++;
  };

  console.log('\n── predictRelevanceScore ──────────────────────────────────');

  await run('relevant passage scores higher than irrelevant', async () => {
    const relevantScore = await predictRelevanceScore(
      'what is long term potentiation?',
      'Long-term potentiation (LTP) is a persistent strengthening of synapses based on recent patterns of activity.',
    );
    const irrelevantScore = await predictRelevanceScore(
      'what is long term potentiation?',
      'The capital of France is Paris and it has a population of 2 million.',
    );
    expectGt(relevantScore, irrelevantScore, 'relevant > irrelevant');
    expectGt(relevantScore, 0.5, 'relevant score > 0.5');
  });

  await run('returns a number >= 0 for an empty passage (no throw)', async () => {
    const score = await predictRelevanceScore('query', '');
    expectType(score, 'number', 'score is a number');
    expectGte(score, 0, 'score >= 0');
  });

  console.log('\n── rerankCandidates ───────────────────────────────────────');

  await run('reorders results so the semantically relevant passage ranks first', async () => {
    // Simulate Qdrant returning the irrelevant chunk first (higher cosine score).
    const query = 'what is synaptic plasticity?';
    const candidates = [
      makeResult('1', 'Paris is the capital of France.', 0.80),
      makeResult('2', 'Synaptic plasticity refers to the ability of synapses to strengthen or weaken over time.', 0.75),
    ];
    const reranked = await rerankCandidates(query, candidates);
    expect(reranked[0].chunk_id, '2', 'relevant chunk ranked first');
  });

  await run('returns an empty array unchanged', async () => {
    const result = await rerankCandidates('anything', []);
    expect(result.length, 0, 'empty result has length 0');
  });

  await run('populates rerankScore on each returned result', async () => {
    const candidates = [makeResult('1', 'Neurons communicate via synapses.', 0.7)];
    const reranked = await rerankCandidates('how do neurons communicate?', candidates);
    expectType(reranked[0].rerankScore, 'number', 'rerankScore is a number');
    expectGte(reranked[0].rerankScore as number, 0, 'rerankScore >= 0');
  });

  await run('blended score differs from the original score', async () => {
    // blended = 0.6 * original + 0.4 * rerankScore; differs unless rerankScore === original
    const candidates = [
      makeResult('1', 'Synaptic plasticity refers to the ability of synapses to strengthen or weaken over time.', 0.75),
    ];
    const reranked = await rerankCandidates('what is synaptic plasticity?', candidates);
    const diff = Math.abs(reranked[0].score - 0.75);
    if (diff < 1e-9) throw new Error('FAIL  blended score should differ from original 0.75');
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
