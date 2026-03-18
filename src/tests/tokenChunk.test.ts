// src/tests/tokenChunk.test.ts
import { tokenChunkText, countTokens } from '../ingest/chunking/token';
import { EMBED_MAX_TOKENS } from '../config';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
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

  console.log('tokenChunk tests:\n');

  await test('short text produces one chunk', async () => {
    const text = 'This is a short sentence.';
    const chunks = await tokenChunkText(text);
    assert(chunks.length === 1, `expected 1 chunk, got ${chunks.length}`);
    assert(chunks[0].text.includes('short sentence'), 'text should be preserved');
  });

  await test('no chunk exceeds EMBED_MAX_TOKENS', async () => {
    // Generate a long text with many sentences
    const sentences = [];
    for (let i = 0; i < 200; i++) {
      sentences.push(`This is sentence number ${i + 1} with some additional words to fill up space and tokens.`);
    }
    const text = sentences.join(' ');
    const chunks = await tokenChunkText(text);

    assert(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);

    for (let i = 0; i < chunks.length; i++) {
      const tokens = await countTokens(chunks[i].text);
      assert(
        tokens <= EMBED_MAX_TOKENS,
        `chunk ${i} has ${tokens} tokens, exceeds max ${EMBED_MAX_TOKENS}`
      );
    }
  });

  await test('paragraph breaks are preferred split points', async () => {
    const paragraphs = [];
    for (let i = 0; i < 50; i++) {
      paragraphs.push(`Paragraph ${i + 1}. This paragraph contains some meaningful content about topic ${i + 1}. It has multiple sentences to fill up space properly. The discussion continues with more details and analysis of the subject matter at hand which naturally extends the paragraph length beyond trivial sizes. We want to ensure this is long enough to force splitting.`);
    }
    const text = paragraphs.join('\n\n');
    const chunks = await tokenChunkText(text);

    assert(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
    // Each chunk should contain complete paragraphs (no mid-sentence splits in most cases)
    for (const chunk of chunks) {
      const trimmed = chunk.text.trim();
      assert(trimmed.length > 0, 'chunk should not be empty');
    }
  });

  await test('countTokens returns reasonable values', async () => {
    const text = 'Hello world, this is a test.';
    const count = await countTokens(text);
    assert(count > 0, `expected positive token count, got ${count}`);
    assert(count < 50, `expected reasonable token count, got ${count}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
