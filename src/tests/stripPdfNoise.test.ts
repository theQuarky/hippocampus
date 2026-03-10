// src/tests/stripPdfNoise.test.ts
import { stripPdfNoise } from '../ingest/parser';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function runTests(): void {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ❌ ${name}: ${message}`);
      failed++;
    }
  };

  console.log('stripPdfNoise tests:\n');

  // Test 1: removes standalone page numbers
  test('removes standalone page numbers', () => {
    const input = 'Some text\n42\nMore text\n123\nEnd';
    const result = stripPdfNoise(input);
    assert(!result.includes('\n42\n'), 'should remove single page number 42');
    assert(!result.includes('\n123\n'), 'should remove single page number 123');
    assert(result.includes('Some text'), 'should preserve content');
    assert(result.includes('More text'), 'should preserve content');
  });

  // Test 2: removes "Page X of Y"
  test('removes "Page X of Y" lines', () => {
    const input = 'Content here\nPage 3 of 10\nMore content';
    const result = stripPdfNoise(input);
    assert(!result.includes('Page 3 of 10'), 'should remove page line');
    assert(result.includes('Content here'), 'should preserve content');
  });

  // Test 3: removes CHAPTER lines
  test('removes CHAPTER lines', () => {
    const input = 'Previous text\nCHAPTER 5\nChapter content starts here.';
    const result = stripPdfNoise(input);
    assert(!result.includes('CHAPTER 5'), 'should remove chapter line');
    assert(result.includes('Chapter content starts here'), 'should preserve content');
  });

  // Test 4: frequency-based header removal (multi-page)
  test('removes repeated headers across pages', () => {
    const pages = [];
    for (let i = 0; i < 10; i++) {
      pages.push(`My Book Title\nContent on page ${i + 1}\nFooter Corp Inc`);
    }
    const input = pages.join('\f');
    const result = stripPdfNoise(input);
    assert(!result.includes('My Book Title'), 'should remove repeated header');
    assert(!result.includes('Footer Corp Inc'), 'should remove repeated footer');
    assert(result.includes('Content on page 1'), 'should preserve unique content');
    assert(result.includes('Content on page 10'), 'should preserve unique content');
  });

  // Test 5: preserves paragraph breaks
  test('preserves paragraph breaks', () => {
    const input = 'First paragraph.\n\nSecond paragraph.';
    const result = stripPdfNoise(input);
    assert(result.includes('First paragraph.\n\nSecond paragraph.'), 'should preserve double newline');
  });

  // Test 6: normalizes excessive whitespace
  test('normalizes excessive whitespace', () => {
    const input = 'First paragraph.\n\n\n\n\nSecond paragraph.';
    const result = stripPdfNoise(input);
    assert(result.includes('First paragraph.\n\nSecond paragraph.'), 'should collapse excessive newlines');
  });

  // Test 7: single-page text is preserved
  test('preserves single-page text', () => {
    const input = 'Short document with no page breaks.';
    const result = stripPdfNoise(input);
    assert(result === 'Short document with no page breaks.', 'should be unchanged');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
