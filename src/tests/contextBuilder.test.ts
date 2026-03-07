// src/tests/contextBuilder.test.ts
import { buildContext, RetrievedChunk, RetrievedConcept } from '../contextBuilder';
import { MAX_CONTEXT_TOKENS } from '../config';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function makeChunk(id: string, score: number, text?: string, source?: string): RetrievedChunk {
  return {
    chunk_id: id,
    text: text ?? `Chunk text for ${id}`,
    source: source ?? `source-${id}.pdf`,
    score,
  };
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ${name}: ${message}`);
      failed++;
    }
  };

  console.log('contextBuilder tests:\n');

  // ── Ordering ────────────────────────────────────────────────────────────

  await test('chunks are ordered by score descending', () => {
    const chunks = [
      makeChunk('a', 0.5),
      makeChunk('b', 0.9),
      makeChunk('c', 0.7),
    ];
    const result = buildContext('test query', chunks);
    assert(result.chunkIds[0] === 'b', `expected first chunk to be 'b', got '${result.chunkIds[0]}'`);
    assert(result.chunkIds[1] === 'c', `expected second chunk to be 'c', got '${result.chunkIds[1]}'`);
    assert(result.chunkIds[2] === 'a', `expected third chunk to be 'a', got '${result.chunkIds[2]}'`);
  });

  // ── Sources ─────────────────────────────────────────────────────────────

  await test('sources are extracted correctly', () => {
    const chunks = [
      makeChunk('a', 0.9, 'text a', 'doc1.pdf'),
      makeChunk('b', 0.8, 'text b', 'doc2.md'),
      makeChunk('c', 0.7, 'text c', 'doc1.pdf'), // duplicate source
    ];
    const result = buildContext('test query', chunks);
    assert(result.sources.includes('doc1.pdf'), 'sources should include doc1.pdf');
    assert(result.sources.includes('doc2.md'), 'sources should include doc2.md');
    // Deduplicated — no duplicates
    const uniqueSources = new Set(result.sources);
    assert(uniqueSources.size === result.sources.length, 'sources should be deduplicated');
  });

  // ── Token limit ─────────────────────────────────────────────────────────

  await test('context respects token limit', () => {
    // Create many large chunks that together exceed the token limit
    const bigText = 'A'.repeat(2000); // ~500 tokens each
    const chunks: RetrievedChunk[] = [];
    for (let i = 0; i < 20; i++) {
      chunks.push(makeChunk(`chunk-${i}`, 1 - i * 0.01, bigText, `file-${i}.pdf`));
    }
    const result = buildContext('test query', chunks);
    const estimatedTokens = Math.ceil(result.contextText.length / 4);
    assert(estimatedTokens <= MAX_CONTEXT_TOKENS + 100, // small buffer for formatting
      `context tokens (~${estimatedTokens}) should not exceed limit (${MAX_CONTEXT_TOKENS})`);
    assert(result.chunkIds.length < 20, `not all 20 chunks should fit, got ${result.chunkIds.length}`);
  });

  // ── Empty input ─────────────────────────────────────────────────────────

  await test('handles empty chunk list', () => {
    const result = buildContext('test query', []);
    assert(result.chunkIds.length === 0, 'should have no chunk ids');
    assert(result.sources.length === 0, 'should have no sources');
    assert(result.conceptLabels.length === 0, 'should have no concept labels');
  });

  // ── Concepts ────────────────────────────────────────────────────────────

  await test('includes concept labels when concepts provided', () => {
    const chunks = [makeChunk('a', 0.9)];
    const concepts: RetrievedConcept[] = [
      { concept_id: 'c1', label: 'SSA Form', summary: 'Static Single Assignment', confidence: 0.8 },
    ];
    const result = buildContext('test query', chunks, concepts);
    assert(result.conceptLabels.includes('SSA Form'), 'concept label should be included');
    assert(result.contextText.includes('=== Relevant Concepts ==='), 'context should have concept header');
    assert(result.contextText.includes('SSA Form'), 'context should contain concept label');
  });

  await test('works without concepts', () => {
    const chunks = [makeChunk('a', 0.9)];
    const result = buildContext('test query', chunks);
    assert(!result.contextText.includes('=== Relevant Concepts ==='), 'should not have concept header');
    assert(result.conceptLabels.length === 0, 'should have no concept labels');
  });

  // ── Malformed text ──────────────────────────────────────────────────────

  await test('handles malformed/undefined text gracefully', () => {
    const chunks: RetrievedChunk[] = [
      { chunk_id: 'bad', text: undefined as any, source: 'test.pdf', score: 0.9 },
      { chunk_id: 'null', text: null as any, source: 'test.pdf', score: 0.8 },
    ];
    // Should not throw
    const result = buildContext('test query', chunks);
    assert(result.chunkIds.length >= 0, 'should handle gracefully');
  });

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests();
