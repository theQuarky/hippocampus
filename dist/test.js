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
const consolidate_1 = require("./consolidate");
const ollama_1 = __importDefault(require("ollama"));
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
function getConnectionWeight(edgeId) {
    const row = db_1.db.prepare(`SELECT weight FROM connections WHERE edge_id = ?`).get(edgeId);
    return row?.weight ?? 0;
}
function normalizeMembers(memberChunks) {
    return [...new Set(memberChunks)].sort((a, b) => a.localeCompare(b));
}
function parseMemberChunks(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return normalizeMembers(parsed.filter((value) => typeof value === 'string' && value.length > 0));
    }
    catch {
        return [];
    }
}
function findConceptByMembers(memberChunks) {
    const normalizedTarget = normalizeMembers(memberChunks);
    const rows = db_1.db.prepare(`
    SELECT concept_id, member_chunks, summary
    FROM concepts
  `).all();
    return rows.find(row => {
        const normalized = parseMemberChunks(row.member_chunks);
        return normalized.length === normalizedTarget.length && normalized.every((value, index) => value === normalizedTarget[index]);
    });
}
async function run() {
    console.log('\n🧠 Hippocampus Test Suite\n');
    const testRunId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
    console.log('8. Testing deterministic concept abstraction (cluster create/skip/refresh)...');
    const nowIso = new Date().toISOString();
    const conceptChunkA = `test_concept_a_${testRunId}`;
    const conceptChunkB = `test_concept_b_${testRunId}`;
    const conceptChunkC = `test_concept_c_${testRunId}`;
    const conceptChunkD = `test_concept_d_${testRunId}`;
    const conceptEdgeAB = `test_concept_edge_ab_${testRunId}`;
    const conceptEdgeBC = `test_concept_edge_bc_${testRunId}`;
    const conceptEdgeCD = `test_concept_edge_cd_${testRunId}`;
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkA, 'Chunk A: hippocampal indexing links related memory traces.', `concept_test_${testRunId}`, nowIso, 0, nowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkB, 'Chunk B: connected traces improve retrieval over repeated use.', `concept_test_${testRunId}`, nowIso, 0, nowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkC, 'Chunk C: graph reinforcement preserves pathways among related memories.', `concept_test_${testRunId}`, nowIso, 0, nowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkD, 'Chunk D: additional evidence extends the same memory abstraction cluster.', `concept_test_${testRunId}`, nowIso, 0, nowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conceptEdgeAB, conceptChunkA, conceptChunkB, 'supports', 0.8, 0.9, nowIso, nowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conceptEdgeBC, conceptChunkB, conceptChunkC, 'supports', 0.78, 0.9, nowIso, nowIso);
    const originalGenerate = ollama_1.default.generate;
    let abstractionCallCount = 0;
    ollama_1.default.generate = async () => {
        abstractionCallCount += 1;
        return {
            response: `Concept summary call ${abstractionCallCount}: reinforced graph memory links preserve coherent recall behavior.`,
        };
    };
    let firstConceptId = '';
    try {
        await (0, consolidate_1.abstractConcepts)();
        const firstConcept = findConceptByMembers([conceptChunkA, conceptChunkB, conceptChunkC]);
        expect(!!firstConcept, 'abstractConcepts should create a concept for first 3-node cluster');
        expect(abstractionCallCount === 1, `expected one synthesis call after first abstraction, got ${abstractionCallCount}`);
        expect((firstConcept?.summary ?? '').includes('call 1'), 'first abstraction should store mocked summary output');
        firstConceptId = firstConcept?.concept_id ?? '';
        await (0, consolidate_1.abstractConcepts)();
        expect(abstractionCallCount === 1, `unchanged cluster should be skipped without new synthesis call; got ${abstractionCallCount}`);
        db_1.db.prepare(`
      INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(conceptEdgeCD, conceptChunkC, conceptChunkD, 'supports', 0.81, 0.9, nowIso, nowIso);
        await (0, consolidate_1.abstractConcepts)();
        expect(abstractionCallCount === 2, `changed cluster should trigger one refresh synthesis call; got ${abstractionCallCount}`);
        const refreshedConcept = findConceptByMembers([conceptChunkA, conceptChunkB, conceptChunkC, conceptChunkD]);
        expect(!!refreshedConcept, 'abstractConcepts should refresh concept members after cluster expansion');
        expect((refreshedConcept?.summary ?? '').includes('call 2'), 'refreshed concept should store second mocked summary output');
        expect((refreshedConcept?.concept_id ?? '') === firstConceptId, 'cluster expansion should refresh existing concept instead of creating a new one');
    }
    finally {
        ollama_1.default.generate = originalGenerate;
        db_1.db.prepare(`DELETE FROM connections WHERE edge_id IN (?, ?, ?)`)
            .run(conceptEdgeAB, conceptEdgeBC, conceptEdgeCD);
        db_1.db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?, ?, ?)`)
            .run(conceptChunkA, conceptChunkB, conceptChunkC, conceptChunkD);
        if (firstConceptId) {
            db_1.db.prepare(`DELETE FROM concepts WHERE concept_id = ?`).run(firstConceptId);
        }
    }
    console.log('   ✅ Deterministic concept abstraction working');
    console.log('9. Testing ingest pipeline...');
    const ingestFile = uniqueTmpFile('hippocampus_ingest_test');
    fs_1.default.writeFileSync(ingestFile, `
Run marker: ${testRunId}

The hippocampus is a critical brain structure involved in learning and memory consolidation.
It helps convert short-term experiences into stable long-term memory traces over repeated sleep cycles.

Neurons in the hippocampus form new pathways during learning and this process is called neuroplasticity.
Neuroplastic adaptation allows people to update mental models and improve recall after repeated practice.

The hippocampus is located in the medial temporal lobe and has been studied in both animals and humans.
Its structure and function were named using the Greek term for seahorse because of its curved shape.
  `);
    await (0, ingest_1.ingest)(ingestFile, ['test', 'neuroscience']);
    console.log('   ✅ Ingest pipeline working');
    console.log('10. Testing retrieval...');
    const queryResults = await (0, retrieve_1.retrieve)('what is the hippocampus?');
    expect(queryResults.length > 0, 'should return results');
    console.log(`   ✅ Retrieved ${queryResults.length} results`);
    console.log(`   Top result (score: ${(queryResults[0].score ?? 0).toFixed(4)}):`);
    console.log(`   "${queryResults[0].text.slice(0, 80)}..."`);
    console.log('11. Testing duplicate detection...');
    const duplicateFile = uniqueTmpFile('hippocampus_duplicate_test');
    const duplicateNonce = `This run-specific memory token is ${testRunId} and should make this passage unique across test executions.`;
    fs_1.default.writeFileSync(duplicateFile, `
The dentate gyrus is one of the few brain regions where adult neurogenesis continues throughout life. ${duplicateNonce}
Fresh neurons are integrated into existing circuits and may improve pattern separation for similar memories while encoding new episodic traces tied to this run marker ${testRunId}.
Repeated exposure to enriched environments changes synaptic plasticity and affects downstream recall behavior in a run-specific protocol ${testRunId}.
  `);
    const duplicateSource = path_1.default.basename(duplicateFile);
    const beforeDuplicate = countChunksBySource(duplicateSource);
    await (0, ingest_1.ingest)(duplicateFile, ['test', 'duplicate']);
    const afterFirstIngest = countChunksBySource(duplicateSource);
    await (0, ingest_1.ingest)(duplicateFile, ['test', 'duplicate']);
    const afterSecondIngest = countChunksBySource(duplicateSource);
    expect(afterFirstIngest >= beforeDuplicate, 'first ingest should not reduce stored chunks');
    expect(afterSecondIngest === afterFirstIngest, 'second ingest of same document should not add duplicate chunks');
    console.log('   ✅ Duplicate detection working');
    console.log('12. Testing connection seeding...');
    let connectionSeedingVerified = false;
    let seedingAttempts = 0;
    let addedEdges = 0;
    while (seedingAttempts < 4 && !connectionSeedingVerified) {
        seedingAttempts += 1;
        const connectionFile = uniqueTmpFile(`hippocampus_connection_test_attempt_${seedingAttempts}`);
        fs_1.default.writeFileSync(connectionFile, `
Unique attempt marker ${testRunId}_${seedingAttempts}_${Math.random().toString(36).slice(2)}.
This synthetic memory passage intentionally combines uncommon terminology like zeptograph lattices and chrono-indexed recall traces.
The chunk should still be linkable to nearby memories through related_to edges when semantically relevant neighbors are found.
Graph traversal over evidence supports retrieval even when exact wording differs across passages in this run.
    `);
        const connectionSource = path_1.default.basename(connectionFile);
        const beforeSourceChunks = countChunksBySource(connectionSource);
        const beforeConnections = countConnectionsFromSource(connectionSource);
        await (0, ingest_1.ingest)(connectionFile, ['test', 'connections', `attempt-${seedingAttempts}`]);
        const afterSourceChunks = countChunksBySource(connectionSource);
        const afterConnections = countConnectionsFromSource(connectionSource);
        const storedNewChunk = afterSourceChunks > beforeSourceChunks;
        if (!storedNewChunk) {
            continue;
        }
        addedEdges = afterConnections - beforeConnections;
        connectionSeedingVerified = addedEdges > 0;
    }
    expect(connectionSeedingVerified, `ingest should seed related_to connections for at least one newly stored chunk (attempts=${seedingAttempts}, added_edges=${addedEdges})`);
    console.log(`   ✅ Connection seeding working. Added ${addedEdges} edges`);
    console.log('13. Testing connection reinforcement + decay...');
    const now = Date.now();
    const reinforceNowIso = new Date(now).toISOString();
    const oldIso = new Date(now - (9 * 24 * 60 * 60 * 1000)).toISOString();
    const reinforceChunkId = `test_reinforce_chunk_${testRunId}`;
    const neutralChunkId = `test_neutral_chunk_${testRunId}`;
    const targetChunkId = `test_target_chunk_${testRunId}`;
    const reinforceEdgeId = `test_reinforce_edge_${testRunId}`;
    const staleEdgeId = `test_stale_edge_${testRunId}`;
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(reinforceChunkId, 'reinforced source chunk', `reinforce_test_${testRunId}`, reinforceNowIso, 5, reinforceNowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(neutralChunkId, 'neutral source chunk', `decay_test_${testRunId}`, reinforceNowIso, 1, reinforceNowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(targetChunkId, 'target chunk', `target_test_${testRunId}`, reinforceNowIso, 0, reinforceNowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(reinforceEdgeId, reinforceChunkId, targetChunkId, 'related_to', 0.96, 0.5, reinforceNowIso, reinforceNowIso);
    db_1.db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(staleEdgeId, neutralChunkId, targetChunkId, 'related_to', 0.10, 0.5, oldIso, null);
    (0, consolidate_1.reinforceConnections)();
    const reinforcedWeight = getConnectionWeight(reinforceEdgeId);
    expect(Math.abs(reinforcedWeight - 1.0) < 0.000001, `reinforcement should cap at 1.0, got ${reinforcedWeight}`);
    (0, consolidate_1.decayConnections)(7);
    const decayedWeight = getConnectionWeight(staleEdgeId);
    expect(Math.abs(decayedWeight - 0.095) < 0.000001, `decay should reduce stale edge to 0.095, got ${decayedWeight}`);
    db_1.db.prepare(`DELETE FROM connections WHERE edge_id IN (?, ?)`).run(reinforceEdgeId, staleEdgeId);
    db_1.db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?, ?)`).run(reinforceChunkId, neutralChunkId, targetChunkId);
    console.log('   ✅ Reinforcement and decay working');
    console.log('\n✅ All tests passed.\n');
}
run().catch(err => {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
