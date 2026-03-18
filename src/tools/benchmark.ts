// src/tools/benchmark.ts — Fixed-query benchmark for regression detection
import { retrieve, Result } from '../retrieve';
import { db } from '../db';
import fs from 'fs';
import path from 'path';

const BENCHMARK_QUERIES = [
  'What is the main topic of this document?',
  'How does memory consolidation work?',
  'What are the key concepts discussed?',
  'Explain the relationship between learning and memory.',
  'What methods are used for knowledge representation?',
];

const RESULTS_FILE = path.join(process.cwd(), 'benchmark_results.json');

type BenchmarkResult = {
  query: string;
  topK: number;
  results: Array<{
    chunk_id: string;
    score: number;
    source: string;
    graph_boosted: boolean;
  }>;
  durationMs: number;
};

type BenchmarkRun = {
  timestamp: string;
  totalChunks: number;
  totalConnections: number;
  queries: BenchmarkResult[];
};

function loadPreviousRun(): BenchmarkRun | null {
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        return data[data.length - 1];
      }
      return data;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveRun(run: BenchmarkRun): void {
  let history: BenchmarkRun[] = [];
  try {
    if (fs.existsSync(RESULTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
      history = Array.isArray(data) ? data : [data];
    }
  } catch {
    // ignore
  }
  history.push(run);
  // Keep last 10 runs
  if (history.length > 10) history = history.slice(-10);
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(history, null, 2));
}

export async function runBenchmark(): Promise<void> {
  const totalChunks = (db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
  const totalConnections = (db.prepare('SELECT COUNT(*) as c FROM connections').get() as any).c;

  console.log(`\n📊 Benchmark — ${totalChunks} chunks, ${totalConnections} connections\n`);

  if (totalChunks === 0) {
    console.log('ℹ️  No chunks in database. Ingest some documents first.');
    return;
  }

  const previousRun = loadPreviousRun();
  const queryResults: BenchmarkResult[] = [];

  for (const query of BENCHMARK_QUERIES) {
    const start = Date.now();
    let results: Result[] = [];
    try {
      results = await retrieve(query, 5);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Query failed: "${query}" — ${msg}`);
    }
    const durationMs = Date.now() - start;

    const benchResult: BenchmarkResult = {
      query,
      topK: 5,
      results: results.map(r => ({
        chunk_id: r.chunk_id,
        score: r.score,
        source: r.source,
        graph_boosted: r.graph_boosted,
      })),
      durationMs,
    };

    queryResults.push(benchResult);

    // Print results
    const scores = results.map(r => r.score.toFixed(4));
    console.log(`  🔍 "${query}"`);
    console.log(`     ${results.length} results in ${durationMs}ms — scores: [${scores.join(', ')}]`);

    // Compare with previous run
    if (previousRun) {
      const prevQuery = previousRun.queries.find(q => q.query === query);
      if (prevQuery) {
        const currentIds = new Set(results.map(r => r.chunk_id));
        const prevIds = new Set(prevQuery.results.map(r => r.chunk_id));
        let overlap = 0;
        for (const id of currentIds) {
          if (prevIds.has(id)) overlap++;
        }
        const overlapPct = prevIds.size > 0 ? Math.round((overlap / prevIds.size) * 100) : 0;
        console.log(`     top-5 overlap vs previous: ${overlap}/${prevIds.size} (${overlapPct}%)`);
      }
    }

    console.log();
  }

  // Score distribution
  const allScores = queryResults.flatMap(q => q.results.map(r => r.score));
  if (allScores.length > 0) {
    allScores.sort((a, b) => a - b);
    const min = allScores[0];
    const max = allScores[allScores.length - 1];
    const median = allScores[Math.floor(allScores.length / 2)];
    const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;

    console.log('📈 Score distribution:');
    console.log(`   min=${min.toFixed(4)} median=${median.toFixed(4)} mean=${mean.toFixed(4)} max=${max.toFixed(4)}`);
    console.log(`   total results: ${allScores.length}`);
  }

  // Save results
  const run: BenchmarkRun = {
    timestamp: new Date().toISOString(),
    totalChunks,
    totalConnections,
    queries: queryResults,
  };

  saveRun(run);
  console.log(`\n💾 Results saved to ${RESULTS_FILE}`);
}
