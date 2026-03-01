"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const embed_1 = require("./embed");
const db_1 = require("./db");
const parser_1 = require("./parser");
const semanticChunk_1 = require("./semanticChunk");
const ingest_1 = require("./ingest");
const retrieve_1 = require("./retrieve");
function expect(condition, message) {
    if (!condition)
        throw new Error(message);
}
function uniqueTmpFile(prefix) {
    return path_1.default.join(os_1.default.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
}
function countChunksBySource(source) {
    const row = db_1.db.prepare(`SELECT COUNT(*) as count FROM chunks WHERE source = ?`).get(source);
    return row?.count ?? 0;
}
function countConnectionsFromSource(source) {
    const row = db_1.db.prepare(`
    SELECT COUNT(*) as count
    FROM connections c
    JOIN chunks s ON c.source_chunk = s.chunk_id
    WHERE s.source = ?
  `).get(source);
    return row?.count ?? 0;
}
async function run() {
    console.log('\n🧠 Hippocampus Test Suite\n');
    console.log('1. Testing embedding...');
    const vec = await (0, embed_1.embed)('hello world');
    expect(Array.isArray(vec), 'vector should be array');
    expect(vec.length > 0, 'vector should not be empty');
    console.log(`   ✅ Got vector of ${vec.length} dimensions`);
    console.log('2. Testing Qdrant...');
    const collectionsInfo = await db_1.qdrant.getCollections();
    console.log(`   ✅ Qdrant connected. Collections: ${collectionsInfo.collections.length}`);
    console.log('3. Testing vector store & search...');
    const TEST_COLLECTION = 'hippocampus_test';
    try {
        await db_1.qdrant.deleteCollection(TEST_COLLECTION);
    }
    catch { }
    await db_1.qdrant.createCollection(TEST_COLLECTION, {
        vectors: { size: vec.length, distance: 'Cosine' }
    });
    await db_1.qdrant.upsert(TEST_COLLECTION, {
        points: [{ id: 1, vector: vec, payload: { text: 'hello world', source: 'test' } }]
    });
    const vectorResults = await db_1.qdrant.search(TEST_COLLECTION, { vector: vec, limit: 1 });
    expect(vectorResults.length > 0, 'should find at least one result');
    console.log(`   ✅ Stored and retrieved. Score: ${(vectorResults[0].score ?? 0).toFixed(4)}`);
    await db_1.qdrant.deleteCollection(TEST_COLLECTION);
    console.log('4. Testing SQLite...');
    const testDb = new better_sqlite3_1.default(':memory:');
    testDb.exec(`CREATE TABLE test (id TEXT, text TEXT)`);
    testDb.prepare(`INSERT INTO test VALUES (?, ?)`).run('1', 'hello');
    const row = testDb.prepare(`SELECT * FROM test WHERE id = ?`).get('1');
    expect(row.text === 'hello', 'should retrieve correct row');
    testDb.close();
    console.log('   ✅ SQLite working');
    console.log('5. Testing DB init...');
    await (0, db_1.initDB)();
    const tables = db_1.db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    const tableNames = tables.map(t => t.name);
    expect(tableNames.includes('chunks'), 'chunks table should exist');
    expect(tableNames.includes('connections'), 'connections table should exist');
    expect(tableNames.includes('concepts'), 'concepts table should exist');
    console.log(`   ✅ Tables created: ${tableNames.join(', ')}`);
    console.log('6. Testing parser...');
    const parserFile = uniqueTmpFile('hippocampus_parser_test');
    fs_1.default.writeFileSync(parserFile, 'The hippocampus stores memories.\n\nIt is part of the brain.');
    const parsedText = await (0, parser_1.parseFile)(parserFile);
    expect(parsedText.includes('hippocampus'), 'should parse text');
    console.log(`   ✅ Parser working. Got ${parsedText.length} chars`);
    console.log('7. Testing semantic chunker...');
    const semanticChunks = await (0, semanticChunk_1.semanticChunkText)(parsedText);
    expect(semanticChunks.length > 0, 'should produce chunks');
    console.log(`   ✅ Semantic chunker working. Got ${semanticChunks.length} chunks`);
    console.log('8. Testing ingest pipeline...');
    const ingestFile = uniqueTmpFile('hippocampus_ingest_test');
    fs_1.default.writeFileSync(ingestFile, `
The hippocampus is a critical brain structure involved in learning and memory consolidation.
It helps convert short-term experiences into stable long-term memory traces over repeated sleep cycles.

Neurons in the hippocampus form new pathways during learning and this process is called neuroplasticity.
Neuroplastic adaptation allows people to update mental models and improve recall after repeated practice.

The hippocampus is located in the medial temporal lobe and has been studied in both animals and humans.
Its structure and function were named using the Greek term for seahorse because of its curved shape.
  `);
    await (0, ingest_1.ingest)(ingestFile, ['test', 'neuroscience']);
    console.log('   ✅ Ingest pipeline working');
    console.log('9. Testing retrieval...');
    const queryResults = await (0, retrieve_1.retrieve)('what is the hippocampus?');
    expect(queryResults.length > 0, 'should return results');
    console.log(`   ✅ Retrieved ${queryResults.length} results`);
    console.log(`   Top result (score: ${(queryResults[0].score ?? 0).toFixed(4)}):`);
    console.log(`   "${queryResults[0].text.slice(0, 80)}..."`);
    console.log('10. Testing duplicate detection...');
    const duplicateFile = uniqueTmpFile('hippocampus_duplicate_test');
    fs_1.default.writeFileSync(duplicateFile, `
The dentate gyrus is one of the few brain regions where adult neurogenesis continues throughout life.
Fresh neurons are integrated into existing circuits and may improve pattern separation for similar memories.
Repeated exposure to enriched environments changes synaptic plasticity and affects downstream recall behavior.
  `);
    const duplicateSource = path_1.default.basename(duplicateFile);
    const beforeDuplicate = countChunksBySource(duplicateSource);
    await (0, ingest_1.ingest)(duplicateFile, ['test', 'duplicate']);
    const afterFirstIngest = countChunksBySource(duplicateSource);
    await (0, ingest_1.ingest)(duplicateFile, ['test', 'duplicate']);
    const afterSecondIngest = countChunksBySource(duplicateSource);
    expect(afterFirstIngest > beforeDuplicate, 'first ingest should store new chunks');
    expect(afterSecondIngest === afterFirstIngest, 'second ingest of same document should not add duplicate chunks');
    console.log('   ✅ Duplicate detection working');
    console.log('11. Testing connection seeding...');
    const connectionFile = uniqueTmpFile('hippocampus_connection_test');
    fs_1.default.writeFileSync(connectionFile, `
Memory indexing systems maintain representations that summarize repeated observations from diverse sessions and contexts.
These representations are useful when an agent must recover details quickly while still preserving stable semantics over time.
When related observations appear, the memory index should connect nearby records so future retrieval can traverse linked evidence.

In graph-based memory architectures, weak weighted links are often created between semantically adjacent records by default.
Those links become more useful as they are reinforced by later observations, retrieval events, and contradiction resolution updates.
A good baseline still starts with lightweight edges that allow exploration before strong confidence has accumulated.
  `);
    const connectionSource = path_1.default.basename(connectionFile);
    const beforeConnections = countConnectionsFromSource(connectionSource);
    await (0, ingest_1.ingest)(connectionFile, ['test', 'connections']);
    const afterConnections = countConnectionsFromSource(connectionSource);
    expect(afterConnections > beforeConnections, 'ingest should seed related_to connections for new chunks');
    console.log(`   ✅ Connection seeding working. Added ${afterConnections - beforeConnections} edges`);
    console.log('\n✅ All tests passed.\n');
}
run().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
