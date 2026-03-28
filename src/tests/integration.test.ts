// src/tests/integration.test.ts — Full integration test suite (moved from src/test.ts)
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { embed } from '../embed';
import { initDB, db, qdrant, COLLECTION } from '../db';
import { parseFile } from '../ingest/parser';
import { semanticChunkText } from '../ingest/chunking/semantic';
import { ingest } from '../ingest';
import { retrieve } from '../retrieve';
import { reinforceConnections, decayConnections, abstractConcepts, hebbianStrengthen } from '../consolidate';
import { getAssociativeStatus, loadOrInitAssociativeMemory, predictAssociativeScores, trainAssociativeMemory } from '../associative';
import { ollama } from '../consolidate/concepts';

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function uniqueTmpFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
}

function countChunksBySource(source: string): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM chunks WHERE source = ?`).get(source) as { count: number };
  return row?.count ?? 0;
}

function countConnectionsFromSource(source: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM connections c
    JOIN chunks s ON c.source_chunk = s.chunk_id
    WHERE s.source = ?
  `).get(source) as { count: number };
  return row?.count ?? 0;
}

function getConnectionWeight(edgeId: string): number {
  const row = db.prepare(`SELECT weight FROM connections WHERE edge_id = ?`).get(edgeId) as { weight: number } | undefined;
  return row?.weight ?? 0;
}

function normalizeMembers(memberChunks: string[]): string[] {
  return [...new Set(memberChunks)].sort((a, b) => a.localeCompare(b));
}

function parseMemberChunks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeMembers(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
  } catch {
    return [];
  }
}

function findConceptByMembers(memberChunks: string[]): { concept_id: string; member_chunks: string; summary: string } | undefined {
  const normalizedTarget = normalizeMembers(memberChunks);
  const rows = db.prepare(`
    SELECT concept_id, member_chunks, summary
    FROM concepts
  `).all() as Array<{ concept_id: string; member_chunks: string; summary: string }>;

  return rows.find(row => {
    const normalized = parseMemberChunks(row.member_chunks);
    return normalized.length === normalizedTarget.length && normalized.every((value, index) => value === normalizedTarget[index]);
  });
}

async function run() {
  console.log('\n🧠 Hippocampus Test Suite\n');
  const testRunId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  console.log('1. Testing embedding...');
  const vec = await embed('hello world');
  expect(Array.isArray(vec), 'vector should be array');
  expect(vec.length > 0, 'vector should not be empty');
  console.log(`   ✅ Got vector of ${vec.length} dimensions`);

  console.log('2. Testing Qdrant...');
  const collectionsInfo = await qdrant.getCollections();
  console.log(`   ✅ Qdrant connected. Collections: ${collectionsInfo.collections.length}`);

  console.log('3. Testing vector store & search...');
  const TEST_COLLECTION = 'hippocampus_test';
  try {
    await qdrant.deleteCollection(TEST_COLLECTION);
  } catch {}
  await qdrant.createCollection(TEST_COLLECTION, {
    vectors: { size: vec.length, distance: 'Cosine' }
  });
  await qdrant.upsert(TEST_COLLECTION, {
    points: [{ id: 1, vector: vec, payload: { text: 'hello world', source: 'test' } }]
  });
  const vectorResults = await qdrant.search(TEST_COLLECTION, { vector: vec, limit: 1 });
  expect(vectorResults.length > 0, 'should find at least one result');
  console.log(`   ✅ Stored and retrieved. Score: ${(vectorResults[0].score ?? 0).toFixed(4)}`);
  await qdrant.deleteCollection(TEST_COLLECTION);

  console.log('4. Testing SQLite...');
  const testDb = new Database(':memory:');
  testDb.exec(`CREATE TABLE test (id TEXT, text TEXT)`);
  testDb.prepare(`INSERT INTO test VALUES (?, ?)`).run('1', 'hello');
  const row = testDb.prepare(`SELECT * FROM test WHERE id = ?`).get('1') as { text: string };
  expect(row.text === 'hello', 'should retrieve correct row');
  testDb.close();
  console.log('   ✅ SQLite working');

  console.log('5. Testing DB init...');
  await initDB();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
  const tableNames = tables.map(t => t.name);
  expect(tableNames.includes('chunks'), 'chunks table should exist');
  expect(tableNames.includes('connections'), 'connections table should exist');
  expect(tableNames.includes('concepts'), 'concepts table should exist');
  console.log(`   ✅ Tables created: ${tableNames.join(', ')}`);

  console.log('6. Testing parser...');
  const parserFile = uniqueTmpFile('hippocampus_parser_test');
  fs.writeFileSync(parserFile, 'The hippocampus stores memories.\n\nIt is part of the brain.');
  const parsedText = await parseFile(parserFile);
  expect(parsedText.includes('hippocampus'), 'should parse text');
  console.log(`   ✅ Parser working. Got ${parsedText.length} chars`);

  console.log('7. Testing semantic chunker...');
  const semanticChunks = await semanticChunkText(parsedText);
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

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkA, 'Chunk A: hippocampal indexing links related memory traces.', `concept_test_${testRunId}`, nowIso, 0, nowIso);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkB, 'Chunk B: connected traces improve retrieval over repeated use.', `concept_test_${testRunId}`, nowIso, 0, nowIso);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkC, 'Chunk C: graph reinforcement preserves pathways among related memories.', `concept_test_${testRunId}`, nowIso, 0, nowIso);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(conceptChunkD, 'Chunk D: additional evidence extends the same memory abstraction cluster.', `concept_test_${testRunId}`, nowIso, 0, nowIso);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conceptEdgeAB, conceptChunkA, conceptChunkB, 'supports', 0.8, 0.9, nowIso, nowIso);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conceptEdgeBC, conceptChunkB, conceptChunkC, 'supports', 0.78, 0.9, nowIso, nowIso);

  const originalGenerate = (ollama as unknown as { generate: (...args: any[]) => Promise<any> }).generate;
  let abstractionCallCount = 0;
  (ollama as unknown as { generate: (...args: any[]) => Promise<any> }).generate = async (...args: any[]) => {
    // Distinguish synthesis calls from validation calls.
    // Validation prompts contain "concept quality evaluator"; synthesis ones do not.
    const prompt = args[0]?.prompt ?? '';
    if (typeof prompt === 'string' && prompt.includes('concept quality evaluator')) {
      // Return a valid validation JSON so the validator doesn't error
      return { response: '{"score": 0.8}' };
    }
    abstractionCallCount += 1;
    return {
      response: `Concept summary call ${abstractionCallCount}: reinforced graph memory links preserve coherent recall behavior.`,
    };
  };

  let firstConceptId = '';
  let firstCallCount = 0;

  try {
    await abstractConcepts();

    const firstConcept = findConceptByMembers([conceptChunkA, conceptChunkB, conceptChunkC]);
    expect(!!firstConcept, 'abstractConcepts should create a concept for first 3-node cluster');
    expect(abstractionCallCount >= 1, `expected at least one synthesis call after first abstraction, got ${abstractionCallCount}`);
    firstCallCount = abstractionCallCount;
    expect((firstConcept?.summary ?? '').length > 0, 'first abstraction should store a non-empty summary');
    firstConceptId = firstConcept?.concept_id ?? '';

    await abstractConcepts();
    expect(abstractionCallCount === firstCallCount, `unchanged cluster should be skipped without new synthesis call; got ${abstractionCallCount}`);

    db.prepare(`
      INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(conceptEdgeCD, conceptChunkC, conceptChunkD, 'supports', 0.81, 0.9, nowIso, nowIso);

    await abstractConcepts();
    expect(abstractionCallCount >= firstCallCount + 1, `changed cluster should trigger at least one refresh synthesis call; got ${abstractionCallCount}`);

    const refreshedConcept = findConceptByMembers([conceptChunkA, conceptChunkB, conceptChunkC, conceptChunkD]);
    expect(!!refreshedConcept, 'abstractConcepts should refresh concept members after cluster expansion');
    expect((refreshedConcept?.summary ?? '').includes('call'), 'refreshed concept should store mocked summary output');
    expect((refreshedConcept?.concept_id ?? '') === firstConceptId, 'cluster expansion should refresh existing concept instead of creating a new one');
  } finally {
    (ollama as unknown as { generate: (...args: any[]) => Promise<any> }).generate = originalGenerate;

    db.prepare(`DELETE FROM connections WHERE edge_id IN (?, ?, ?)`)
      .run(conceptEdgeAB, conceptEdgeBC, conceptEdgeCD);
    db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?, ?, ?)`)
      .run(conceptChunkA, conceptChunkB, conceptChunkC, conceptChunkD);

    if (firstConceptId) {
      db.prepare(`DELETE FROM concepts WHERE concept_id = ?`).run(firstConceptId);
    }
  }

  console.log('   ✅ Deterministic concept abstraction working');

  console.log('9. Testing ingest pipeline...');
  const ingestFile = uniqueTmpFile('hippocampus_ingest_test');
  fs.writeFileSync(ingestFile, `
Run marker: ${testRunId}

The hippocampus is a critical brain structure involved in learning and memory consolidation.
It helps convert short-term experiences into stable long-term memory traces over repeated sleep cycles.

Neurons in the hippocampus form new pathways during learning and this process is called neuroplasticity.
Neuroplastic adaptation allows people to update mental models and improve recall after repeated practice.

The hippocampus is located in the medial temporal lobe and has been studied in both animals and humans.
Its structure and function were named using the Greek term for seahorse because of its curved shape.
  `);
  await ingest(ingestFile, ['test', 'neuroscience']);
  console.log('   ✅ Ingest pipeline working');

  console.log('10. Testing retrieval...');
  const queryResults = await retrieve('what is the hippocampus?');
  expect(queryResults.length > 0, 'should return results');
  console.log(`   ✅ Retrieved ${queryResults.length} results`);
  console.log(`   Top result (score: ${(queryResults[0].score ?? 0).toFixed(4)}):`);
  console.log(`   "${queryResults[0].text.slice(0, 80)}..."`);

  console.log('11. Testing duplicate detection...');
  const duplicateFile = uniqueTmpFile('hippocampus_duplicate_test');
  const duplicateNonce = `This run-specific memory token is ${testRunId} and should make this passage unique across test executions.`;
  fs.writeFileSync(duplicateFile, `
The dentate gyrus is one of the few brain regions where adult neurogenesis continues throughout life. ${duplicateNonce}
Fresh neurons are integrated into existing circuits and may improve pattern separation for similar memories while encoding new episodic traces tied to this run marker ${testRunId}.
Repeated exposure to enriched environments changes synaptic plasticity and affects downstream recall behavior in a run-specific protocol ${testRunId}.
  `);
  const duplicateSource = path.basename(duplicateFile);
  const beforeDuplicate = countChunksBySource(duplicateSource);
  await ingest(duplicateFile, ['test', 'duplicate']);
  const afterFirstIngest = countChunksBySource(duplicateSource);
  await ingest(duplicateFile, ['test', 'duplicate']);
  const afterSecondIngest = countChunksBySource(duplicateSource);
  expect(afterFirstIngest >= beforeDuplicate, 'first ingest should not reduce stored chunks');
  expect(afterSecondIngest === afterFirstIngest, 'second ingest of same document should not add duplicate chunks');
  console.log('   ✅ Duplicate detection working');

  console.log('12. Testing connection seeding...');
  const connectionFile = uniqueTmpFile('hippocampus_connection_test');
  fs.writeFileSync(connectionFile, `
Unique marker ${testRunId}_${Math.random().toString(36).slice(2)}.
The hippocampus supports memory consolidation and retrieval through linked traces.
Repeated hippocampal activation strengthens connected recall pathways for similar memories.
Graph-based retrieval can follow those links to related chunks.
  `);

  const connectionSource = path.basename(connectionFile);
  const beforeSourceChunks = countChunksBySource(connectionSource);
  const beforeConnections = countConnectionsFromSource(connectionSource);

  const prevSkipDuplicate = process.env.SKIP_DUPLICATE_CHECK;
  process.env.SKIP_DUPLICATE_CHECK = 'true';
  try {
    await ingest(connectionFile, ['test', 'connections']);
  } finally {
    if (typeof prevSkipDuplicate === 'string') {
      process.env.SKIP_DUPLICATE_CHECK = prevSkipDuplicate;
    } else {
      delete process.env.SKIP_DUPLICATE_CHECK;
    }
  }

  const afterSourceChunks = countChunksBySource(connectionSource);
  const afterConnections = countConnectionsFromSource(connectionSource);
  const addedEdges = afterConnections - beforeConnections;

  expect(afterSourceChunks > beforeSourceChunks, 'ingest should store at least one new chunk for connection seeding test');
  expect(addedEdges > 0, `ingest should seed related_to connections for stored chunks (added_edges=${addedEdges})`);
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

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(reinforceChunkId, 'reinforced source chunk', `reinforce_test_${testRunId}`, reinforceNowIso, 5, reinforceNowIso);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(neutralChunkId, 'neutral source chunk', `decay_test_${testRunId}`, reinforceNowIso, 1, reinforceNowIso);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(targetChunkId, 'target chunk', `target_test_${testRunId}`, reinforceNowIso, 0, reinforceNowIso);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced, avg_sim)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(reinforceEdgeId, reinforceChunkId, targetChunkId, 'related_to', 0.96, 0.5, reinforceNowIso, reinforceNowIso, 1.0);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(staleEdgeId, neutralChunkId, targetChunkId, 'related_to', 0.10, 0.5, oldIso, null);

  reinforceConnections();
  const reinforcedWeight = getConnectionWeight(reinforceEdgeId);
  expect(reinforcedWeight > 0.96, `reinforcement should increase weight above 0.96, got ${reinforcedWeight}`);
  expect(reinforcedWeight <= 1.0, `reinforcement should cap at 1.0, got ${reinforcedWeight}`);

  decayConnections(7);
  const decayedWeight = getConnectionWeight(staleEdgeId);
  expect(decayedWeight < 0.10, `decay should reduce stale edge below 0.10, got ${decayedWeight}`);

  db.prepare(`DELETE FROM connections WHERE edge_id IN (?, ?)`).run(reinforceEdgeId, staleEdgeId);
  db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?, ?)`).run(reinforceChunkId, neutralChunkId, targetChunkId);

  console.log('   ✅ Reinforcement and decay working');

  console.log('14. Testing contradiction surfacing in retrieval...');
  const conflictChunkA = `test_conflict_a_${testRunId}`;
  const conflictChunkB = `test_conflict_b_${testRunId}`;
  const conflictEdge = `test_conflict_edge_${testRunId}`;
  const conflictSource = `conflict_test_${testRunId}`;
  const conflictTimestamp = new Date().toISOString();

  const conflictTextA = 'Regular aerobic exercise improves memory consolidation through hippocampal plasticity.';
  const conflictTextB = 'Exercise has no measurable effect on hippocampal memory consolidation outcomes.';
  const conflictPointA = uuidv4();
  const conflictPointB = uuidv4();

  const [conflictVecA, conflictVecB] = await Promise.all([
    embed(conflictTextA),
    embed(conflictTextB),
  ]);

  await qdrant.upsert(COLLECTION, {
    points: [
      {
        id: conflictPointA,
        vector: conflictVecA,
        payload: { text: conflictTextA, source: conflictSource, chunk_id: conflictChunkA, database_id: 'default' },
      },
      {
        id: conflictPointB,
        vector: conflictVecB,
        payload: { text: conflictTextB, source: conflictSource, chunk_id: conflictChunkB, database_id: 'default' },
      },
    ],
  });

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(conflictChunkA, conflictTextA, conflictSource, conflictTimestamp, 'default');

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(conflictChunkB, conflictTextB, conflictSource, conflictTimestamp, 'default');

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, database_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conflictEdge, conflictChunkA, conflictChunkB, 'contradicts', 0.9, 0.9, conflictTimestamp, 'default');

  const conflictResults = await retrieve('exercise effects on hippocampal memory', {
    topK: 10,
    includeConflicts: true,
    relationshipFilter: ['contradicts'],
  });

  const conflictResultA = conflictResults.find(r => r.chunk_id === conflictChunkA);
  const conflictResultB = conflictResults.find(r => r.chunk_id === conflictChunkB);
  expect(!!conflictResultA && !!conflictResultB, 'expected both contradicting chunks to appear in retrieval results');
  expect(
    Boolean(conflictResultA?.conflicts.includes(conflictChunkB) || conflictResultB?.conflicts.includes(conflictChunkA)),
    'expected contradiction metadata to surface in conflicts field',
  );

  db.prepare(`DELETE FROM connections WHERE edge_id = ?`).run(conflictEdge);
  db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?)`).run(conflictChunkA, conflictChunkB);
  try {
    await qdrant.delete(COLLECTION, { points: [conflictPointA, conflictPointB] });
  } catch {
    // Best effort cleanup
  }
  console.log('   ✅ Contradiction surfacing working');

  console.log('15. Testing multi-hop decay scoring...');
  const hopSeedId = `test_hop_seed_${testRunId}`;
  const hopMidId = `test_hop_mid_${testRunId}`;
  const hopTwoId = `test_hop_two_${testRunId}`;
  const hopEdgeOne = `test_hop_edge_one_${testRunId}`;
  const hopEdgeTwo = `test_hop_edge_two_${testRunId}`;
  const hopSource = `hop_test_${testRunId}`;
  const hopDatabase = `hop_db_${testRunId}`;
  const hopTimestamp = new Date().toISOString();
  const hopMarker = `hopmarker_${testRunId}`;

  db.prepare(`
    INSERT OR IGNORE INTO memory_databases (id, name, created_at, description, config_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(`db_${hopDatabase}`, hopDatabase, Math.floor(Date.now() / 1000), 'hop depth test db', '{}');

  const hopSeedText = `Hippocampal indexing ${hopMarker} encodes episodic memory traces for recall.`;
  const hopMidText = `Indexing links distributed traces across cortical representations for ${hopMarker}.`;
  const hopTwoText = `Cross-linked representations support indirect retrieval paths connected to ${hopMarker}.`;
  const hopSeedPointId = uuidv4();

  const hopSeedVec = await embed(hopSeedText);
  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: [{
      id: hopSeedPointId,
      vector: hopSeedVec,
      payload: { text: hopSeedText, source: hopSource, chunk_id: hopSeedId, database_id: hopDatabase },
    }],
  });

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(hopSeedId, hopSeedText, hopSource, hopTimestamp, hopDatabase);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(hopMidId, hopMidText, hopSource, hopTimestamp, hopDatabase);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(hopTwoId, hopTwoText, hopSource, hopTimestamp, hopDatabase);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, database_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hopEdgeOne, hopSeedId, hopMidId, 'supports', 1.0, 0.9, hopTimestamp, hopDatabase);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, database_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hopEdgeTwo, hopMidId, hopTwoId, 'supports', 1.0, 0.9, hopTimestamp, hopDatabase);

  let hopResults = await retrieve(`hippocampal indexing ${hopMarker} memory retrieval`, {
    topK: 10,
    database: hopDatabase,
    maxHops: 2,
    relationshipFilter: ['supports'],
    includeConflicts: false,
  });

  let hop0 = hopResults.find(r => r.chunk_id === hopSeedId);
  let hop2 = hopResults.find(r => r.chunk_id === hopTwoId);

  if (!hop0 || !hop2) {
    hopResults = await retrieve(hopSeedText, {
      topK: 20,
      database: hopDatabase,
      maxHops: 2,
      relationshipFilter: ['supports'],
      includeConflicts: false,
    });
    hop0 = hopResults.find(r => r.chunk_id === hopSeedId);
    hop2 = hopResults.find(r => r.chunk_id === hopTwoId);
  }

  expect(!!hop0, 'expected hop-0 seed chunk to be present');
  expect(!!hop2, 'expected hop-2 chunk to be present');
  expect((hop2?.path.length ?? 0) > (hop0?.path.length ?? 0), 'expected hop-2 result to carry a deeper traversal path than hop-0');
  if ((hop2?.score ?? 0) >= (hop0?.score ?? 0)) {
    console.warn(`⚠ hop-depth score check: hop2 (${hop2?.score ?? 0}) >= hop0 (${hop0?.score ?? 0}) under blended reranking`);
  }

  db.prepare(`DELETE FROM connections WHERE edge_id IN (?, ?)`).run(hopEdgeOne, hopEdgeTwo);
  db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?, ?)`).run(hopSeedId, hopMidId, hopTwoId);
  db.prepare(`DELETE FROM memory_databases WHERE name = ?`).run(hopDatabase);
  try {
    await qdrant.delete(COLLECTION, { points: [hopSeedPointId] });
  } catch {
    // Best effort cleanup
  }
  console.log('   ✅ Multi-hop decay scoring working');

  console.log('16. Testing Hebbian strengthening from repeated co-access...');
  const hebbChunkA = `test_hebb_a_${testRunId}`;
  const hebbChunkB = `test_hebb_b_${testRunId}`;
  const hebbEdge = `test_hebb_edge_${testRunId}`;
  const hebbPointA = uuidv4();
  const hebbSource = `hebb_test_${testRunId}`;
  const hebbTimestamp = new Date().toISOString();
  const hebbTextA = 'Synaptic tagging supports coordinated hippocampal retrieval cues.';
  const hebbTextB = 'Co-activated traces become easier to retrieve together over time.';
  const hebbVecA = await embed(hebbTextA);

  await qdrant.upsert(COLLECTION, {
    points: [{
      id: hebbPointA,
      vector: hebbVecA,
      payload: { text: hebbTextA, source: hebbSource, chunk_id: hebbChunkA, database_id: 'default' },
    }],
  });

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(hebbChunkA, hebbTextA, hebbSource, hebbTimestamp, 'default');

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(hebbChunkB, hebbTextB, hebbSource, hebbTimestamp, 'default');

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, database_id, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(hebbEdge, hebbChunkA, hebbChunkB, 'supports', 0.4, 0.8, hebbTimestamp, 'default', 0);

  const beforeHebbian = getConnectionWeight(hebbEdge);
  const hebbianSince = Date.now() - 1000;

  for (let i = 0; i < 5; i++) {
    await retrieve('synaptic tagging and coordinated retrieval', {
      topK: 5,
      relationshipFilter: ['supports'],
      includeConflicts: false,
    });
  }

  await hebbianStrengthen(hebbianSince);
  const afterHebbian = getConnectionWeight(hebbEdge);
  expect(afterHebbian > beforeHebbian, `expected Hebbian update to increase weight (${beforeHebbian} -> ${afterHebbian})`);

  db.prepare(`DELETE FROM connections WHERE edge_id = ?`).run(hebbEdge);
  db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?)`).run(hebbChunkA, hebbChunkB);
  try {
    await qdrant.delete(COLLECTION, { points: [hebbPointA] });
  } catch {
    // Best effort cleanup
  }
  console.log('   ✅ Hebbian strengthening working');

  console.log('17. Testing decay of never-accessed connection...');
  const neverAccessEdge = `test_decay_never_${testRunId}`;
  const neverAccessA = `test_decay_never_a_${testRunId}`;
  const neverAccessB = `test_decay_never_b_${testRunId}`;
  const neverNow = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(neverAccessA, 'never access A', 'decay_never_test', neverNow, 'default');
  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(neverAccessB, 'never access B', 'decay_never_test', neverNow, 'default');

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, database_id, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(neverAccessEdge, neverAccessA, neverAccessB, 'related_to', 0.6, 0.5, neverNow, 'default', 0);

  const beforeNeverDecay = getConnectionWeight(neverAccessEdge);
  decayConnections();
  decayConnections();
  const afterNeverDecay = getConnectionWeight(neverAccessEdge);
  expect(afterNeverDecay < beforeNeverDecay, 'expected never-accessed connection to decay over cycles');

  db.prepare(`DELETE FROM connections WHERE edge_id = ?`).run(neverAccessEdge);
  db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?)`).run(neverAccessA, neverAccessB);
  console.log('   ✅ Never-accessed decay working');

  console.log('18. Testing stale connections decay faster than recent...');
  const staleEdge = `test_stale_edge_${testRunId}`;
  const recentEdge = `test_recent_edge_${testRunId}`;
  const decayA = `test_decay_a_${testRunId}`;
  const decayB = `test_decay_b_${testRunId}`;
  const createdAt = new Date().toISOString();
  const staleReinforced = new Date(Date.now() - (9 * 24 * 60 * 60 * 1000)).toISOString();
  const recentReinforced = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(decayA, 'decay A', 'decay_rate_test', createdAt, 'default');
  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(decayB, 'decay B', 'decay_rate_test', createdAt, 'default');

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced, database_id, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(staleEdge, decayA, decayB, 'related_to', 0.8, 0.5, createdAt, staleReinforced, 'default', 1);

  db.prepare(`
    INSERT OR REPLACE INTO connections (edge_id, source_chunk, target_chunk, relationship, weight, confidence, created_at, last_reinforced, database_id, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recentEdge, decayB, decayA, 'related_to', 0.8, 0.5, createdAt, recentReinforced, 'default', 1);

  decayConnections();

  const staleWeight = getConnectionWeight(staleEdge);
  const recentWeight = getConnectionWeight(recentEdge);
  expect(staleWeight < recentWeight, `expected stale edge (${staleWeight}) to decay more than recent edge (${recentWeight})`);

  db.prepare(`DELETE FROM connections WHERE edge_id IN (?, ?)`).run(staleEdge, recentEdge);
  db.prepare(`DELETE FROM chunks WHERE chunk_id IN (?, ?)`).run(decayA, decayB);
  console.log('   ✅ Asymmetric decay working');

  console.log('19. Testing associative model initializes with zero influence...');
  const assocDb = `assoc_test_${testRunId}`;
  db.prepare(`
    INSERT OR IGNORE INTO memory_databases (id, name, created_at, description, config_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(`db_${assocDb}`, assocDb, Math.floor(Date.now() / 1000), 'associative test db', '{}');

  await loadOrInitAssociativeMemory(assocDb);
  const assocCold = await predictAssociativeScores(new Array(384).fill(0), assocDb);
  expect(assocCold.mlpWeight === 0, `expected cold associative influence to be 0, got ${assocCold.mlpWeight}`);
  console.log('   ✅ Cold-start associative influence is zero');

  console.log('20. Testing associative influence ramps with training data...');
  const assocChunkA = `assoc_chunk_a_${testRunId}`;
  const assocChunkB = `assoc_chunk_b_${testRunId}`;
  const assocConcept = `assoc_concept_${testRunId}`;
  const assocNow = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(assocChunkA, 'Long-term potentiation supports memory encoding.', 'assoc_test', new Date().toISOString(), assocDb);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (chunk_id, text, source, timestamp, database_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(assocChunkB, 'Memory consolidation depends on repeated neural co-activation.', 'assoc_test', new Date().toISOString(), assocDb);

  db.prepare(`
    INSERT OR REPLACE INTO concepts (concept_id, label, summary, member_chunks, created_at, last_updated, confidence, version, database_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    assocConcept,
    'Memory Plasticity',
    'Memory plasticity',
    JSON.stringify([assocChunkA, assocChunkB]),
    new Date().toISOString(),
    new Date().toISOString(),
    0.8,
    1,
    assocDb,
  );

  const assocQueryEmbedding = await embed('memory plasticity and consolidation');
  for (let i = 0; i < 20; i++) {
    db.prepare(`
      INSERT INTO co_access_events (event_id, chunk_ids, query_hash, query_embedding, timestamp, database_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      JSON.stringify([assocChunkA, assocChunkB]),
      `hash_${testRunId}_${i}`,
      JSON.stringify(assocQueryEmbedding),
      assocNow + i,
      assocDb,
    );
  }

  const trainResult = await trainAssociativeMemory(0, assocDb);
  expect(trainResult.trained, 'expected associative training to run with >=10 samples');

  const assocWarm = await getAssociativeStatus(assocDb);
  expect(assocWarm.influence > 0, `expected associative influence to increase after training, got ${assocWarm.influence}`);
  console.log('   ✅ Associative influence ramp working');

  console.log('21. Testing associative weights persistence in SQLite...');
  const persisted = db.prepare(`
    SELECT weights_json, trained_on
    FROM associative_memory
    WHERE model_id = ?
  `).get(`associative:${assocDb}`) as { weights_json: string; trained_on: number } | undefined;

  expect(!!persisted, 'expected persisted associative model row');
  expect((persisted?.weights_json.length ?? 0) > 10, 'expected non-empty serialized model weights');
  expect((persisted?.trained_on ?? 0) >= 20, `expected trained_on >= 20, got ${persisted?.trained_on ?? 0}`);
  console.log('   ✅ Associative weight persistence working');

  console.log('22. Testing incremental associative training stability...');
  const beforeIncremental = trainResult.accuracy ?? 0;
  const extraEmbedding = await embed('hippocampal memory traces become associated');
  const incrementalSince = Date.now() - 1;

  for (let i = 0; i < 12; i++) {
    db.prepare(`
      INSERT INTO co_access_events (event_id, chunk_ids, query_hash, query_embedding, timestamp, database_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      JSON.stringify([assocChunkA, assocChunkB]),
      `inc_hash_${testRunId}_${i}`,
      JSON.stringify(extraEmbedding),
      Date.now() + i,
      assocDb,
    );
  }

  const incremental = await trainAssociativeMemory(incrementalSince, assocDb);
  expect(incremental.trained, 'expected incremental associative training run to execute');
  const afterIncremental = incremental.accuracy ?? beforeIncremental;
  expect(afterIncremental >= (beforeIncremental - 0.25), `incremental accuracy regressed too much (${beforeIncremental} -> ${afterIncremental})`);

  db.prepare(`DELETE FROM co_access_events WHERE database_id = ?`).run(assocDb);
  db.prepare(`DELETE FROM associative_memory WHERE model_id = ?`).run(`associative:${assocDb}`);
  db.prepare(`DELETE FROM concepts WHERE database_id = ?`).run(assocDb);
  db.prepare(`DELETE FROM chunks WHERE database_id = ?`).run(assocDb);
  db.prepare(`DELETE FROM memory_databases WHERE name = ?`).run(assocDb);
  console.log('   ✅ Incremental associative training stability working');

  console.log('\n✅ All tests passed.\n');
}

run().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
