// src/consolidate.ts — 3-cycle consolidation with learning weights
// Cycle 1 (Immediate): duplicate detection + seed edges (no LLM) — called from ingest
// Cycle 2 (Background): classify untyped edges with LLM, update stats
// Cycle 3 (Deep/scheduled): decay/reinforce, build/refresh concepts, validate/split/merge

import ollama from 'ollama';
import { db } from './db';
import { embed } from './embed';
import { v4 as uuidv4 } from 'uuid';
import { syncConceptEmbeddings } from './conceptSync';
import {
  OLLAMA_MODEL,
  ENABLE_LEARNING_WEIGHTS,
  ENABLE_CONCEPT_VALIDATION,
  CONSOLIDATION_BATCH_SIZE,
  CONSOLIDATION_INTERVAL_MS,
} from './config';

// ── Types ──────────────────────────────────────────────────────────────────

type Relationship = 'supports' | 'contradicts' | 'example_of' | 'caused_by' | 'related_to';

type ChunkRow = {
  chunk_id: string;
  text: string;
  source: string;
  access_count?: number;
};

type ConnectionRow = {
  edge_id: string;
  source_chunk: string;
  target_chunk: string;
  relationship: string;
  weight: number | null;
  confidence: number | null;
  avg_sim: number | null;
  support_count: number | null;
  contradict_count: number | null;
  seen_count: number | null;
  last_seen: string | null;
  last_reinforced: string | null;
  created_at: string;
};

type StrongEdgeRow = {
  source_chunk: string;
  target_chunk: string;
  weight: number | null;
};

type ConceptRow = {
  concept_id: string;
  member_chunks: string;
  confidence: number | null;
  summary: string;
  version: number | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const MODEL = OLLAMA_MODEL;
const VALID_RELATIONSHIPS: Relationship[] = ['supports', 'contradicts', 'example_of', 'caused_by', 'related_to'];

const BASE_WEIGHTS: Record<Relationship, number> = {
  supports: 0.8,
  contradicts: 0.7,
  example_of: 0.75,
  caused_by: 0.75,
  related_to: 0.3,
};

const REINFORCE_ACCESS_THRESHOLD = 3;
const MAX_CONNECTION_WEIGHT = 1.0;
const MIN_CONNECTION_WEIGHT = 0.05;
const DECAY_FACTOR = 0.95;
const CONCEPT_CLUSTER_MIN_SIZE = 3;
const CONCEPT_EDGE_MIN_WEIGHT = 0.6;
const CONCEPT_MERGE_JACCARD = 0.7;
const CONCEPT_MERGE_COSINE = 0.85;

// ── Prepared statements (lazy singleton) ───────────────────────────────────

type Stmts = Record<string, any>;
let _stmts: Stmts | null = null;

function S(): Stmts {
  if (_stmts) return _stmts;

  _stmts = {
    getChunk: db.prepare('SELECT chunk_id, text, source, access_count FROM chunks WHERE chunk_id = ? LIMIT 1'),

    // Cycle 2: batch of untyped edges
    selectUntypedEdges: db.prepare(
      'SELECT edge_id, source_chunk, target_chunk, avg_sim, support_count, contradict_count, seen_count FROM connections WHERE relationship = \'related_to\' LIMIT ?'
    ),
    selectAllUntypedSources: db.prepare(
      'SELECT DISTINCT source_chunk FROM connections WHERE relationship = \'related_to\''
    ),
    selectUntypedBySource: db.prepare(
      'SELECT edge_id, source_chunk, target_chunk, avg_sim, support_count, contradict_count, seen_count FROM connections WHERE source_chunk = ? AND relationship = \'related_to\' ORDER BY weight DESC, confidence DESC, created_at DESC'
    ),

    // Update after classification
    updateEdgeClassified: db.prepare(
      'UPDATE connections SET relationship = ?, weight = ?, confidence = ?, support_count = ?, contradict_count = ?, seen_count = ?, last_seen = ?, evidence_score = ?, weight_version = weight_version + 1, last_reinforced = ? WHERE edge_id = ?'
    ),

    flagContradiction: db.prepare('UPDATE chunks SET contradiction_flag = 1 WHERE chunk_id = ?'),

    // Cycle 3: reinforce/decay
    selectHighlyAccessedChunks: db.prepare('SELECT chunk_id, access_count FROM chunks WHERE access_count > ?'),
    selectOutgoingEdges: db.prepare(
      'SELECT edge_id, weight, confidence, avg_sim, source_chunk FROM connections WHERE source_chunk = ?'
    ),
    updateEdgeReinforce: db.prepare('UPDATE connections SET weight = ?, last_reinforced = ? WHERE edge_id = ?'),
    selectEdgesToDecay: db.prepare(
      'SELECT edge_id, weight, last_seen FROM connections WHERE (last_seen IS NULL AND last_reinforced IS NULL AND created_at < ?) OR (last_seen IS NOT NULL AND last_seen < ?) OR (last_seen IS NULL AND last_reinforced IS NOT NULL AND last_reinforced < ?)'
    ),
    updateEdgeWeight: db.prepare('UPDATE connections SET weight = ? WHERE edge_id = ?'),
    deleteEdge: db.prepare('DELETE FROM connections WHERE edge_id = ?'),

    // Concepts
    selectStrongEdges: db.prepare(
      'SELECT source_chunk, target_chunk, weight FROM connections WHERE weight >= ? ORDER BY weight DESC'
    ),
    selectConcepts: db.prepare('SELECT concept_id, member_chunks, confidence, summary, version FROM concepts'),
    insertConcept: db.prepare(
      'INSERT INTO concepts (concept_id, label, summary, member_chunks, created_at, last_updated, confidence, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    updateConcept: db.prepare(
      'UPDATE concepts SET label = ?, summary = ?, member_chunks = ?, last_updated = ?, confidence = ?, version = ? WHERE concept_id = ?'
    ),
    deleteConcept: db.prepare('DELETE FROM concepts WHERE concept_id = ?'),
  };

  return _stmts;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isRelationship(value: string): value is Relationship {
  return VALID_RELATIONSHIPS.includes(value as Relationship);
}

function parseRelationship(raw: string): Relationship {
  const normalized = raw.trim().toLowerCase();
  if (isRelationship(normalized)) return normalized;
  return 'related_to';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute dynamic weight for a connection using learning-weight formula.
 * weight = clamp( base * avg_sim * (0.5 + 0.5 * confidence) * recency_factor, MIN..MAX )
 */
function computeWeight(
  relationship: Relationship,
  avgSim: number,
  supportCount: number,
  contradictCount: number,
  lastSeen: string | null,
): { weight: number; confidence: number; evidenceScore: number } {
  const base = BASE_WEIGHTS[relationship];
  // Smoothed confidence
  const confidence = (supportCount + 1) / (supportCount + contradictCount + 2);
  // Recency factor: 1.0 for recent, decays toward 0.5 for old
  let recencyFactor = 1.0;
  if (lastSeen) {
    const daysSince = (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60 * 24);
    recencyFactor = 0.5 + 0.5 * Math.exp(-daysSince / 30);
  }

  const simFactor = avgSim > 0 ? avgSim : 0.5; // fallback if no sim stored
  const weight = clamp(base * simFactor * (0.5 + 0.5 * confidence) * recencyFactor, MIN_CONNECTION_WEIGHT, MAX_CONNECTION_WEIGHT);
  const evidenceScore = base * confidence * simFactor;

  return { weight, confidence, evidenceScore };
}

function normalizeMemberChunks(memberChunks: string[]): string[] {
  return [...new Set(memberChunks)].sort((a, b) => a.localeCompare(b));
}

function safeParseMemberChunks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeMemberChunks(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0));
  } catch {
    return [];
  }
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const v of leftSet) if (rightSet.has(v)) intersection++;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function buildConceptLabel(summary: string, maxLength: number = 60): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength).trim();
  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxLength / 2)) return candidate.slice(0, lastSpace).trim();
  return candidate;
}

// ── LLM helpers ────────────────────────────────────────────────────────────

function buildClassifyPrompt(textA: string, textB: string): string {
  return `You are a knowledge graph assistant. Classify the relationship between 
these two pieces of text. Respond with EXACTLY one word from this list:
supports, contradicts, example_of, caused_by, related_to

Text A: ${textA}

Text B: ${textB}

Relationship (one word only):`;
}

async function classifyRelationship(textA: string, textB: string): Promise<Relationship> {
  const response = await ollama.generate({
    model: MODEL,
    prompt: buildClassifyPrompt(textA, textB),
    options: { temperature: 0.1 },
  });
  return parseRelationship(response.response || '');
}

async function synthesizeConceptSummary(chunkTexts: string[]): Promise<string> {
  const prompt = `You are a knowledge synthesis assistant.
Below are several related pieces of knowledge.
Write a single concise paragraph (2-4 sentences) that captures
the core concept shared by all of them.
Do not list the pieces — synthesize them into one unified idea.

Pieces:
${chunkTexts.join('\n\n')}

Core concept:`;

  const response = await ollama.generate({
    model: MODEL,
    prompt,
    options: { temperature: 0.3 },
  });
  return (response.response || '').trim();
}

// ── PHASE 5: Concept validation ────────────────────────────────────────────

async function validateConcept(
  summary: string,
  memberTexts: string[],
  nonMemberTexts: string[],
): Promise<number> {
  if (!ENABLE_CONCEPT_VALIDATION) return 0.5;
  if (memberTexts.length === 0 || nonMemberTexts.length === 0) return 0.5;

  const members = memberTexts.slice(0, 3);
  const nonMembers = nonMemberTexts.slice(0, 3);

  const prompt = `You are a concept quality evaluator. Given a concept summary and two sets of text chunks (members and non-members), rate how well the summary explains the member chunks compared to non-member chunks.

Concept summary: ${summary}

Member chunks (should be explained by the concept):
${members.map((t, i) => `M${i + 1}: ${t.slice(0, 300)}`).join('\n')}

Non-member chunks (should NOT be explained by the concept):
${nonMembers.map((t, i) => `N${i + 1}: ${t.slice(0, 300)}`).join('\n')}

Respond with ONLY a JSON object: {"score": <number between 0 and 1>}
A score of 1.0 means the summary perfectly explains members and not non-members.
A score of 0.0 means the summary does not distinguish members from non-members at all.

JSON:`;

  try {
    const response = await ollama.generate({
      model: MODEL,
      prompt,
      options: { temperature: 0.1 },
      format: 'json',
    });

    const raw = (response.response || '').trim();
    const parsed = JSON.parse(raw);
    const score = Number(parsed.score);
    if (Number.isFinite(score)) return clamp(score, 0, 1);
    return 0.5;
  } catch {
    return 0.5;
  }
}

// ── Cycle 2: Background classification ─────────────────────────────────────

/**
 * Classify a batch of untyped (related_to) edges using LLM.
 * Updates relationship, confidence, stats.
 */
export async function cycle2ClassifyBatch(batchSize: number = CONSOLIDATION_BATCH_SIZE): Promise<number> {
  const s = S();
  const edges = s.selectUntypedEdges.all(batchSize) as ConnectionRow[];
  if (edges.length === 0) return 0;

  let classified = 0;

  for (const edge of edges) {
    const sourceChunk = s.getChunk.get(edge.source_chunk) as ChunkRow | undefined;
    const targetChunk = s.getChunk.get(edge.target_chunk) as ChunkRow | undefined;
    if (!sourceChunk || !targetChunk) continue;

    let relationship: Relationship = 'related_to';
    try {
      relationship = await classifyRelationship(sourceChunk.text, targetChunk.text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.warn(`⚠️  LLM classification failed for edge ${edge.edge_id}: ${msg}`);
      relationship = 'related_to';
    }

    const now = new Date().toISOString();
    const seenCount = (edge.seen_count ?? 0) + 1;
    let supportCount = edge.support_count ?? 0;
    let contradictCount = edge.contradict_count ?? 0;

    if (relationship === 'supports' || relationship === 'example_of' || relationship === 'caused_by') {
      supportCount++;
    } else if (relationship === 'contradicts') {
      contradictCount++;
    }

    const avgSim = edge.avg_sim ?? 0;

    if (ENABLE_LEARNING_WEIGHTS) {
      const { weight, confidence, evidenceScore } = computeWeight(
        relationship, avgSim, supportCount, contradictCount, now,
      );
      s.updateEdgeClassified.run(
        relationship, weight, confidence, supportCount, contradictCount,
        seenCount, now, evidenceScore, now, edge.edge_id,
      );
    } else {
      const weight = BASE_WEIGHTS[relationship];
      s.updateEdgeClassified.run(
        relationship, weight, 0.5, supportCount, contradictCount,
        seenCount, now, 0, now, edge.edge_id,
      );
    }

    // Flag contradictions
    if (relationship === 'contradicts') {
      s.flagContradiction.run(sourceChunk.chunk_id);
      s.flagContradiction.run(targetChunk.chunk_id);
      console.warn(`⚠️  Contradiction: ${sourceChunk.chunk_id} ↔ ${targetChunk.chunk_id}`);
    }

    classified++;
  }

  if (classified > 0) {
    console.log(`🧠 Cycle 2: classified ${classified} edges`);
  }

  return classified;
}

/**
 * Classify all untyped edges for a specific chunk (used by consolidateChunk).
 */
export async function consolidateChunk(chunk_id: string): Promise<void> {
  const s = S();
  const sourceChunk = s.getChunk.get(chunk_id) as ChunkRow | undefined;
  if (!sourceChunk) {
    console.warn(`⚠️  consolidateChunk: source chunk not found (${chunk_id})`);
    return;
  }

  const connections = s.selectUntypedBySource.all(chunk_id) as ConnectionRow[];
  if (connections.length === 0) {
    console.log(`ℹ️  No untyped connections for chunk ${chunk_id}`);
    return;
  }

  console.log(`🧠 Consolidating chunk ${chunk_id} (${connections.length} connections)`);

  for (const conn of connections) {
    const targetChunk = s.getChunk.get(conn.target_chunk) as ChunkRow | undefined;
    if (!targetChunk) continue;

    let relationship: Relationship = 'related_to';
    try {
      relationship = await classifyRelationship(sourceChunk.text, targetChunk.text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.warn(`⚠️  LLM classification failed for edge ${conn.edge_id}: ${msg}`);
    }

    const now = new Date().toISOString();
    const seenCount = (conn.seen_count ?? 0) + 1;
    let supportCount = conn.support_count ?? 0;
    let contradictCount = conn.contradict_count ?? 0;

    if (relationship === 'supports' || relationship === 'example_of' || relationship === 'caused_by') {
      supportCount++;
    } else if (relationship === 'contradicts') {
      contradictCount++;
    }

    const avgSim = conn.avg_sim ?? 0;

    if (ENABLE_LEARNING_WEIGHTS) {
      const { weight, confidence, evidenceScore } = computeWeight(
        relationship, avgSim, supportCount, contradictCount, now,
      );
      s.updateEdgeClassified.run(
        relationship, weight, confidence, supportCount, contradictCount,
        seenCount, now, evidenceScore, now, conn.edge_id,
      );
    } else {
      const weight = BASE_WEIGHTS[relationship];
      s.updateEdgeClassified.run(
        relationship, weight, 0.5, supportCount, contradictCount,
        seenCount, now, 0, now, conn.edge_id,
      );
    }

    if (relationship === 'contradicts') {
      s.flagContradiction.run(sourceChunk.chunk_id);
      s.flagContradiction.run(targetChunk.chunk_id);
      console.warn(`⚠️  Contradiction: ${sourceChunk.chunk_id} ↔ ${targetChunk.chunk_id}`);
    }
  }

  console.log(`✅ Consolidated chunk ${chunk_id}`);
}

// ── Cycle 3: Deep consolidation ────────────────────────────────────────────

/**
 * Reinforce connections for highly-accessed chunks.
 * With learning weights: uses access_count, confidence, avg_sim.
 * Without: flat +0.05 increment.
 */
export function reinforceConnections(): void {
  const s = S();
  const now = new Date().toISOString();
  const chunks = s.selectHighlyAccessedChunks.all(REINFORCE_ACCESS_THRESHOLD) as ChunkRow[];
  let count = 0;

  for (const chunk of chunks) {
    const edges = s.selectOutgoingEdges.all(chunk.chunk_id) as ConnectionRow[];

    for (const edge of edges) {
      const current = edge.weight ?? MIN_CONNECTION_WEIGHT;
      let next: number;

      if (ENABLE_LEARNING_WEIGHTS) {
        const accessFactor = Math.min(1.0, (chunk.access_count ?? 1) / 20);
        const confidence = edge.confidence ?? 0.5;
        const avgSim = edge.avg_sim ?? 0.5;
        const increment = 0.02 + 0.08 * accessFactor * confidence * avgSim;
        next = clamp(current + increment, MIN_CONNECTION_WEIGHT, MAX_CONNECTION_WEIGHT);
      } else {
        next = Math.min(MAX_CONNECTION_WEIGHT, current + 0.05);
      }

      s.updateEdgeReinforce.run(next, now, edge.edge_id);
      count++;
    }
  }

  console.log(`🔗 Reinforced ${count} connections across ${chunks.length} chunks`);
}

/**
 * Decay connections not seen/reinforced recently.
 * With learning weights: only decays when last_seen is old.
 */
export function decayConnections(daysOld: number = 7): void {
  const s = S();
  const threshold = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  const edges = s.selectEdgesToDecay.all(threshold, threshold, threshold) as ConnectionRow[];
  let decayed = 0;

  for (const edge of edges) {
    const current = edge.weight ?? MIN_CONNECTION_WEIGHT;
    const next = Math.max(MIN_CONNECTION_WEIGHT, current * DECAY_FACTOR);
    s.updateEdgeWeight.run(next, edge.edge_id);
    decayed++;
  }

  console.log(`📉 Decayed ${decayed} connections`);
}

// ── Concept abstraction (Cycle 3) ──────────────────────────────────────────

function buildClusters(minWeight: number): string[][] {
  const s = S();
  const edges = s.selectStrongEdges.all(minWeight) as StrongEdgeRow[];
  if (edges.length === 0) return [];

  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.source_chunk || !edge.target_chunk) continue;
    if (!adjacency.has(edge.source_chunk)) adjacency.set(edge.source_chunk, new Set());
    if (!adjacency.has(edge.target_chunk)) adjacency.set(edge.target_chunk, new Set());
    adjacency.get(edge.source_chunk)!.add(edge.target_chunk);
    adjacency.get(edge.target_chunk)!.add(edge.source_chunk);
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    const queue = [node];
    const component: string[] = [];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const normalized = normalizeMemberChunks(component);
    if (normalized.length >= CONCEPT_CLUSTER_MIN_SIZE) {
      clusters.push(normalized);
    }
  }

  return clusters;
}

/**
 * Try splitting a cluster by raising the weight threshold.
 */
function splitCluster(cluster: string[], minWeight: number): string[][] {
  const s = S();
  const higherThreshold = minWeight + 0.1;
  const memberSet = new Set(cluster);

  const edges = s.selectStrongEdges.all(higherThreshold) as StrongEdgeRow[];
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!memberSet.has(edge.source_chunk) || !memberSet.has(edge.target_chunk)) continue;
    if (!adjacency.has(edge.source_chunk)) adjacency.set(edge.source_chunk, new Set());
    if (!adjacency.has(edge.target_chunk)) adjacency.set(edge.target_chunk, new Set());
    adjacency.get(edge.source_chunk)!.add(edge.target_chunk);
    adjacency.get(edge.target_chunk)!.add(edge.source_chunk);
  }

  const visited = new Set<string>();
  const subclusters: string[][] = [];

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    const queue = [node];
    const component: string[] = [];
    visited.add(node);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (component.length >= CONCEPT_CLUSTER_MIN_SIZE) {
      subclusters.push(normalizeMemberChunks(component));
    }
  }

  return subclusters.length > 1 ? subclusters : [];
}

export async function abstractConcepts(): Promise<void> {
  const s = S();
  const clusters = buildClusters(CONCEPT_EDGE_MIN_WEIGHT);

  if (clusters.length === 0) {
    console.log('💡 No clusters found for abstraction');
    return;
  }

  const conceptRows = s.selectConcepts.all() as ConceptRow[];
  const existingConcepts = conceptRows.map(row => ({
    concept_id: row.concept_id,
    members: safeParseMemberChunks(row.member_chunks),
    confidence: row.confidence ?? 0.5,
    summary: row.summary,
    version: row.version ?? 1,
  }));

  const usedConceptIds = new Set<string>();
  let created = 0, refreshed = 0, skipped = 0;

  // Get some non-member chunks for validation
  const allChunkIds = db.prepare('SELECT chunk_id FROM chunks ORDER BY RANDOM() LIMIT 50').all() as Array<{ chunk_id: string }>;
  const nonMemberPool = allChunkIds.map(r => r.chunk_id);

  for (const cluster of clusters) {
    let bestMatch: { concept_id: string; members: string[]; similarity: number; version: number } | null = null;

    for (const concept of existingConcepts) {
      if (usedConceptIds.has(concept.concept_id)) continue;
      const similarity = jaccardSimilarity(cluster, concept.members);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { concept_id: concept.concept_id, members: concept.members, similarity, version: concept.version };
      }
    }

    if (bestMatch && bestMatch.similarity === 1) {
      skipped++;
      usedConceptIds.add(bestMatch.concept_id);
      continue;
    }

    // Collect chunk texts
    const chunkTexts: string[] = [];
    for (const chunkId of cluster) {
      const chunk = s.getChunk.get(chunkId) as ChunkRow | undefined;
      if (chunk?.text) chunkTexts.push(chunk.text);
    }

    if (chunkTexts.length < CONCEPT_CLUSTER_MIN_SIZE) {
      skipped++;
      continue;
    }

    let summary = '';
    try {
      summary = await synthesizeConceptSummary(chunkTexts);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.warn(`⚠️  Concept abstraction failed: ${msg}`);
      continue;
    }
    if (!summary) continue;

    // PHASE 5: Validate concept
    const clusterSet = new Set(cluster);
    const nonMemberChunkIds = nonMemberPool.filter(id => !clusterSet.has(id)).slice(0, 3);
    const nonMemberTexts: string[] = [];
    for (const id of nonMemberChunkIds) {
      const c = s.getChunk.get(id) as ChunkRow | undefined;
      if (c?.text) nonMemberTexts.push(c.text);
    }

    let conceptConfidence = 0.5;
    try {
      conceptConfidence = await validateConcept(summary, chunkTexts.slice(0, 3), nonMemberTexts);
    } catch {
      conceptConfidence = 0.5;
    }

    // If validation is low, try splitting
    if (conceptConfidence < 0.3 && ENABLE_CONCEPT_VALIDATION) {
      const subclusters = splitCluster(cluster, CONCEPT_EDGE_MIN_WEIGHT);
      if (subclusters.length > 1) {
        console.log(`🔀 Splitting low-confidence cluster into ${subclusters.length} subclusters`);
        continue;
      }
    }

    const now = new Date().toISOString();
    const label = buildConceptLabel(summary);
    const memberChunksJson = JSON.stringify(cluster);

    if (bestMatch && bestMatch.similarity > 0) {
      const newVersion = (bestMatch.version ?? 1) + 1;
      s.updateConcept.run(label, summary, memberChunksJson, now, conceptConfidence, newVersion, bestMatch.concept_id);
      refreshed++;
      usedConceptIds.add(bestMatch.concept_id);
    } else {
      const conceptId = uuidv4();
      s.insertConcept.run(conceptId, label, summary, memberChunksJson, now, now, conceptConfidence, 1);
      created++;
      usedConceptIds.add(conceptId);
    }
  }

  // PHASE 5: Merge concepts with high overlap and similar summaries
  if (ENABLE_CONCEPT_VALIDATION) {
    await mergeOverlappingConcepts();
  }

  const total = created + refreshed;
  console.log(`💡 Abstracted ${total} concepts (${created} new, ${refreshed} refreshed, ${skipped} skipped)`);
}

/**
 * Merge concepts with Jaccard > 0.7 and cosine similarity > 0.85 on summaries.
 */
async function mergeOverlappingConcepts(): Promise<void> {
  const s = S();
  const rows = s.selectConcepts.all() as ConceptRow[];
  if (rows.length < 2) return;

  const concepts = rows.map(r => ({
    concept_id: r.concept_id,
    members: safeParseMemberChunks(r.member_chunks),
    summary: r.summary,
    confidence: r.confidence ?? 0.5,
    version: r.version ?? 1,
  }));

  const merged = new Set<string>();

  for (let i = 0; i < concepts.length; i++) {
    if (merged.has(concepts[i].concept_id)) continue;

    for (let j = i + 1; j < concepts.length; j++) {
      if (merged.has(concepts[j].concept_id)) continue;

      const jaccard = jaccardSimilarity(concepts[i].members, concepts[j].members);
      if (jaccard < CONCEPT_MERGE_JACCARD) continue;

      // Check cosine similarity of summary embeddings
      let cosine = 0;
      try {
        const [vecA, vecB] = await Promise.all([embed(concepts[i].summary), embed(concepts[j].summary)]);
        cosine = cosineSimilarity(vecA, vecB);
      } catch {
        continue;
      }

      if (cosine < CONCEPT_MERGE_COSINE) continue;

      // Merge j into i
      const unionMembers = normalizeMemberChunks([...concepts[i].members, ...concepts[j].members]);

      const chunkTexts: string[] = [];
      for (const id of unionMembers.slice(0, 10)) {
        const chunk = s.getChunk.get(id) as ChunkRow | undefined;
        if (chunk?.text) chunkTexts.push(chunk.text);
      }

      let newSummary = concepts[i].summary;
      if (chunkTexts.length >= CONCEPT_CLUSTER_MIN_SIZE) {
        try {
          newSummary = await synthesizeConceptSummary(chunkTexts);
        } catch {
          // keep existing summary
        }
      }

      const now = new Date().toISOString();
      const label = buildConceptLabel(newSummary);
      const newVersion = Math.max(concepts[i].version, concepts[j].version) + 1;

      s.updateConcept.run(label, newSummary, JSON.stringify(unionMembers), now, concepts[i].confidence, newVersion, concepts[i].concept_id);
      s.deleteConcept.run(concepts[j].concept_id);
      merged.add(concepts[j].concept_id);

      console.log(`🔀 Merged concept ${concepts[j].concept_id} into ${concepts[i].concept_id}`);
    }
  }
}

// ── Public API (unchanged external behavior) ───────────────────────────────

/**
 * The background consolidation worker runs 3 cycles on a timer.
 * Cycle 1 is handled at ingest time (in ingest.ts).
 */
export function runConsolidationWorker(intervalMs: number = CONSOLIDATION_INTERVAL_MS): void {
  const intervalSeconds = Math.round(intervalMs / 1000);
  console.log(`🔄 Consolidation worker running every ${intervalSeconds}s`);

  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      // Cycle 2: classify batch of untyped edges
      await cycle2ClassifyBatch(CONSOLIDATION_BATCH_SIZE);

      // Cycle 3: reinforce, decay, abstract
      reinforceConnections();
      decayConnections();
      await abstractConcepts();
      await syncConceptEmbeddings();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.warn(`⚠️  Consolidation worker error: ${msg}`);
    } finally {
      isRunning = false;
    }
  };

  void tick();
  setInterval(() => void tick(), intervalMs);
}

/**
 * One-shot consolidation (CLI command).
 */
export async function consolidateAll(): Promise<void> {
  const s = S();
  const rows = s.selectAllUntypedSources.all() as Array<{ source_chunk: string }>;

  if (rows.length === 0) {
    console.log('ℹ️  No untyped connections to consolidate.');
  } else {
    for (let i = 0; i < rows.length; i++) {
      console.log(`Consolidating chunk ${i + 1} of ${rows.length}`);
      try {
        await consolidateChunk(rows[i].source_chunk);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown';
        console.warn(`⚠️  Failed consolidating chunk ${rows[i].source_chunk}: ${msg}`);
      }
    }
  }

  reinforceConnections();
  decayConnections();
  await abstractConcepts();
  await syncConceptEmbeddings();
}
