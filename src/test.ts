import fs from 'fs';
import { embed } from './embed';
import { QdrantClient } from '@qdrant/js-client-rest';
import Database from 'better-sqlite3';
import { initDB, db, qdrant, COLLECTION } from './db';
import { parseFile } from './parser';
import { chunkText } from './chunk';
import { ingest } from './ingest';
import { retrieve } from './retrieve';

async function run() {
  console.log('\n🧠 Hippocampus Test Suite\n');

  // ── Test 1: Embedding ──────────────────────────────
  console.log('1. Testing embedding...');
  const vec = await embed('hello world');
  console.assert(Array.isArray(vec), 'vector should be array');
  console.assert(vec.length > 0, 'vector should not be empty');
  console.log(`   ✅ Got vector of ${vec.length} dimensions`);

  // ── Test 2: Qdrant connection ──────────────────────
  console.log('2. Testing Qdrant...');
  const collectionsInfo = await qdrant.getCollections();
  console.log(`   ✅ Qdrant connected. Collections: ${collectionsInfo.collections.length}`);

  // ── Test 3: Qdrant store + retrieve ───────────────
  console.log('3. Testing vector store & search...');
  const TEST_COLLECTION = 'hippocampus_test';
  try { await qdrant.deleteCollection(TEST_COLLECTION); } catch {}
  await qdrant.createCollection(TEST_COLLECTION, {
    vectors: { size: vec.length, distance: 'Cosine' }
  });
  await qdrant.upsert(TEST_COLLECTION, {
    points: [{ id: 1, vector: vec, payload: { text: 'hello world', source: 'test' } }]
  });
  const results = await qdrant.search(TEST_COLLECTION, { vector: vec, limit: 1 });
  console.assert(results.length > 0, 'should find at least one result');
  console.log(`   ✅ Stored and retrieved. Score: ${results[0].score.toFixed(4)}`);
  await qdrant.deleteCollection(TEST_COLLECTION);

  // ── Test 4: SQLite ─────────────────────────────────
  console.log('4. Testing SQLite...');
  const testDb = new Database(':memory:');
  testDb.exec(`CREATE TABLE test (id TEXT, text TEXT)`);
  testDb.prepare(`INSERT INTO test VALUES (?, ?)`).run('1', 'hello');
  const row = testDb.prepare(`SELECT * FROM test WHERE id = ?`).get('1') as any;
  console.assert(row.text === 'hello', 'should retrieve correct row');
  testDb.close();
  console.log(`   ✅ SQLite working`);

  // ── Test 5: DB init ────────────────────────────────
  console.log('5. Testing DB init...');
  await initDB();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[];
  const tableNames = tables.map(t => t.name);
  console.assert(tableNames.includes('chunks'), 'chunks table should exist');
  console.assert(tableNames.includes('connections'), 'connections table should exist');
  console.log(`   ✅ Tables created: ${tableNames.join(', ')}`);

  // ── Test 6: Parser ─────────────────────────────────
  console.log('6. Testing parser...');
  fs.writeFileSync('/tmp/test.txt', 'The hippocampus stores memories.\n\nIt is part of the brain.');
  const text = await parseFile('/tmp/test.txt');
  console.assert(text.includes('hippocampus'), 'should parse text');
  console.log(`   ✅ Parser working. Got ${text.length} chars`);

  // ── Test 7: Chunking ───────────────────────────────
  console.log('7. Testing chunker...');
  const chunks = chunkText(text);
  console.assert(chunks.length > 0, 'should produce chunks');
  console.log(`   ✅ Chunker working. Got ${chunks.length} chunks`);

  // ── Test 8: Full ingest ────────────────────────────
  console.log('8. Testing ingest pipeline...');
  const testDoc = '/tmp/hippocampus_test.txt';
  fs.writeFileSync(testDoc, `
The hippocampus is a critical brain structure.
It plays a major role in learning and memory.

Neurons in the hippocampus form new connections every day.
This process is called neuroplasticity.

The hippocampus is located in the medial temporal lobe.
It was named after the Greek word for seahorse.
  `);
  await ingest(testDoc, ['test', 'neuroscience']);
  console.log('   ✅ Ingest pipeline working');

  // ── Test 9: Retrieval ──────────────────────────────
  console.log('9. Testing retrieval...');
  const queryResults = await retrieve('what is the hippocampus?');
  console.assert(queryResults.length > 0, 'should return results');
  console.log(`   ✅ Retrieved ${queryResults.length} results`);
  console.log(`   Top result (score: ${queryResults[0].score.toFixed(4)}):`);
  console.log(`   "${queryResults[0].text.slice(0, 80)}..."`);

  // ── Summary ────────────────────────────────────────
  console.log('\n✅ All systems go. Start building.\n');
}

run().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});