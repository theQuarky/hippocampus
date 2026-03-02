import ollama from 'ollama';
import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

type Relationship = 'supports' | 'contradicts' | 'example_of' | 'caused_by' | 'related_to';

type ChunkRow = {
  chunk_id: string;
  text: string;
  source: string;
};

type ConnectionRow = {
  edge_id: string;
  source_chunk: string;
  target_chunk: string;
};

type WeightedConnectionRow = {
  edge_id: string;
  weight: number | null;
};

type StrongEdgeRow = {
  source_chunk: string;
  target_chunk: string;
  weight: number | null;
};

type ConceptRow = {
  concept_id: string;
  member_chunks: string;
};

const MODEL = 'phi3:mini';
const VALID_RELATIONSHIPS: Relationship[] = ['supports', 'contradicts', 'example_of', 'caused_by', 'related_to'];

const RELATIONSHIP_WEIGHTS: Record<Relationship, number> = {
  supports: 0.8,
  contradicts: 0.7,
  example_of: 0.75,
  caused_by: 0.75,
  related_to: 0.3,
};

const REINFORCE_ACCESS_THRESHOLD = 3;
const REINFORCE_INCREMENT = 0.05;
const MAX_CONNECTION_WEIGHT = 1.0;
const DECAY_FACTOR = 0.95;
const MIN_CONNECTION_WEIGHT = 0.05;
const CONCEPT_CLUSTER_MIN_SIZE = 3;
const CONCEPT_EDGE_MIN_WEIGHT = 0.6;

type ConsolidationStatements = {
  getChunkByIdStmt: any;
  getRelatedConnectionsStmt: any;
  updateConnectionStmt: any;
  flagContradictionStmt: any;
  selectUntypedSourcesStmt: any;
  selectAllUntypedSourcesStmt: any;
  selectHighlyAccessedChunksStmt: any;
  selectOutgoingConnectionsStmt: any;
  updateConnectionReinforcementStmt: any;
  selectConnectionsToDecayStmt: any;
  updateConnectionWeightStmt: any;
  selectStrongConnectionsStmt: any;
  selectConceptsStmt: any;
  insertConceptStmt: any;
  updateConceptStmt: any;
};

let statements: ConsolidationStatements | null = null;

function getStatements(): ConsolidationStatements {
  if (statements) {
    return statements;
  }

  statements = {
    getChunkByIdStmt: db.prepare(`
      SELECT chunk_id, text, source
      FROM chunks
      WHERE chunk_id = ?
      LIMIT 1
    `),
    getRelatedConnectionsStmt: db.prepare(`
      SELECT edge_id, source_chunk, target_chunk
      FROM connections
      WHERE source_chunk = ?
        AND relationship = 'related_to'
      ORDER BY weight DESC, confidence DESC, created_at DESC
    `),
    updateConnectionStmt: db.prepare(`
      UPDATE connections
      SET relationship = ?,
          weight = ?,
          last_reinforced = ?
      WHERE edge_id = ?
    `),
    flagContradictionStmt: db.prepare(`
      UPDATE chunks
      SET contradiction_flag = 1
      WHERE chunk_id = ?
    `),
    selectUntypedSourcesStmt: db.prepare(`
      SELECT DISTINCT source_chunk
      FROM connections
      WHERE relationship = 'related_to'
      LIMIT 10
    `),
    selectAllUntypedSourcesStmt: db.prepare(`
      SELECT DISTINCT source_chunk
      FROM connections
      WHERE relationship = 'related_to'
    `),
    selectHighlyAccessedChunksStmt: db.prepare(`
      SELECT chunk_id
      FROM chunks
      WHERE access_count > ?
    `),
    selectOutgoingConnectionsStmt: db.prepare(`
      SELECT edge_id, weight
      FROM connections
      WHERE source_chunk = ?
    `),
    updateConnectionReinforcementStmt: db.prepare(`
      UPDATE connections
      SET weight = ?,
          last_reinforced = ?
      WHERE edge_id = ?
    `),
    selectConnectionsToDecayStmt: db.prepare(`
      SELECT edge_id, weight
      FROM connections
      WHERE (last_reinforced IS NULL AND created_at < ?)
         OR (last_reinforced < ?)
    `),
    updateConnectionWeightStmt: db.prepare(`
      UPDATE connections
      SET weight = ?
      WHERE edge_id = ?
    `),
    selectStrongConnectionsStmt: db.prepare(`
      SELECT source_chunk, target_chunk, weight
      FROM connections
      WHERE weight >= ?
      ORDER BY weight DESC
    `),
    selectConceptsStmt: db.prepare(`
      SELECT concept_id, member_chunks
      FROM concepts
    `),
    insertConceptStmt: db.prepare(`
      INSERT INTO concepts (concept_id, label, summary, member_chunks, created_at, last_updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateConceptStmt: db.prepare(`
      UPDATE concepts
      SET label = ?,
          summary = ?,
          member_chunks = ?,
          last_updated = ?
      WHERE concept_id = ?
    `),
  };

  return statements;
}

function isRelationship(value: string): value is Relationship {
  return VALID_RELATIONSHIPS.includes(value as Relationship);
}

function parseRelationship(raw: string): Relationship {
  const normalized = raw.trim().toLowerCase();
  if (isRelationship(normalized)) return normalized;
  return 'related_to';
}

function buildPrompt(textA: string, textB: string): string {
  return `You are a knowledge graph assistant. Classify the relationship between 
these two pieces of text. Respond with EXACTLY one word from this list:
supports, contradicts, example_of, caused_by, related_to

Text A: ${textA}

Text B: ${textB}

Relationship (one word only):`;
}

async function classifyRelationship(textA: string, textB: string): Promise<Relationship> {
  const prompt = buildPrompt(textA, textB);
  const response = await ollama.generate({
    model: MODEL,
    prompt,
    options: {
      temperature: 0.1,
    },
  });

  return parseRelationship(response.response || '');
}

export function reinforceConnections(): void {
  const {
    selectHighlyAccessedChunksStmt,
    selectOutgoingConnectionsStmt,
    updateConnectionReinforcementStmt,
  } = getStatements();

  const now = new Date().toISOString();
  const chunks = selectHighlyAccessedChunksStmt.all(REINFORCE_ACCESS_THRESHOLD) as Array<{ chunk_id: string }>;

  let reinforcedCount = 0;

  for (const chunk of chunks) {
    const edges = selectOutgoingConnectionsStmt.all(chunk.chunk_id) as WeightedConnectionRow[];

    for (const edge of edges) {
      const currentWeight = edge.weight ?? MIN_CONNECTION_WEIGHT;
      const nextWeight = Math.min(MAX_CONNECTION_WEIGHT, currentWeight + REINFORCE_INCREMENT);
      updateConnectionReinforcementStmt.run(nextWeight, now, edge.edge_id);
      reinforcedCount += 1;
    }
  }

  console.log(`🔗 Reinforced ${reinforcedCount} connections across ${chunks.length} chunks`);
}

export function decayConnections(daysOld: number = 7): void {
  const {
    selectConnectionsToDecayStmt,
    updateConnectionWeightStmt,
  } = getStatements();

  const threshold = new Date(Date.now() - (daysOld * 24 * 60 * 60 * 1000)).toISOString();
  const edges = selectConnectionsToDecayStmt.all(threshold, threshold) as WeightedConnectionRow[];

  let decayedCount = 0;

  for (const edge of edges) {
    const currentWeight = edge.weight ?? MIN_CONNECTION_WEIGHT;
    const nextWeight = Math.max(MIN_CONNECTION_WEIGHT, currentWeight * DECAY_FACTOR);
    updateConnectionWeightStmt.run(nextWeight, edge.edge_id);
    decayedCount += 1;
  }

  console.log(`📉 Decayed ${decayedCount} connections`);
}

function normalizeMemberChunks(memberChunks: string[]): string[] {
  return [...new Set(memberChunks)].sort((a, b) => a.localeCompare(b));
}

function safeParseMemberChunks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeMemberChunks(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0));
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
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function buildConceptPrompt(chunkTexts: string[]): string {
  return `You are a knowledge synthesis assistant.
Below are several related pieces of knowledge.
Write a single concise paragraph (2-4 sentences) that captures
the core concept shared by all of them.
Do not list the pieces — synthesize them into one unified idea.

Pieces:
${chunkTexts.join('\n\n')}

Core concept:`;
}

async function synthesizeConceptSummary(chunkTexts: string[]): Promise<string> {
  const prompt = buildConceptPrompt(chunkTexts);
  const response = await ollama.generate({
    model: MODEL,
    prompt,
    options: {
      temperature: 0.3,
    },
  });

  return (response.response || '').trim();
}

function buildConceptLabel(summary: string, maxLength: number = 60): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const candidate = normalized.slice(0, maxLength).trim();
  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxLength / 2)) {
    return candidate.slice(0, lastSpace).trim();
  }

  return candidate;
}

export async function abstractConcepts(): Promise<void> {
  const {
    selectStrongConnectionsStmt,
    selectConceptsStmt,
    getChunkByIdStmt,
    updateConceptStmt,
    insertConceptStmt,
  } = getStatements();

  const edges = selectStrongConnectionsStmt.all(CONCEPT_EDGE_MIN_WEIGHT) as StrongEdgeRow[];

  if (edges.length === 0) {
    console.log('💡 No clusters found for abstraction');
    return;
  }

  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!edge.source_chunk || !edge.target_chunk) continue;

    if (!adjacency.has(edge.source_chunk)) adjacency.set(edge.source_chunk, new Set<string>());
    if (!adjacency.has(edge.target_chunk)) adjacency.set(edge.target_chunk, new Set<string>());

    adjacency.get(edge.source_chunk)?.add(edge.target_chunk);
    adjacency.get(edge.target_chunk)?.add(edge.source_chunk);
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;

    const queue = [node];
    const component: string[] = [];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      component.push(current);
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    const normalized = normalizeMemberChunks(component);
    if (normalized.length >= CONCEPT_CLUSTER_MIN_SIZE) {
      clusters.push(normalized);
    }
  }

  if (clusters.length === 0) {
    console.log('💡 No clusters found for abstraction');
    return;
  }

  const conceptRows = selectConceptsStmt.all() as ConceptRow[];
  const existingConcepts = conceptRows.map(row => ({
    concept_id: row.concept_id,
    members: safeParseMemberChunks(row.member_chunks),
  }));

  const usedConceptIds = new Set<string>();
  let createdCount = 0;
  let refreshedCount = 0;
  let skippedCount = 0;

  for (const cluster of clusters) {
    let bestMatch: { concept_id: string; members: string[]; similarity: number } | null = null;

    for (const concept of existingConcepts) {
      if (usedConceptIds.has(concept.concept_id)) continue;

      const similarity = jaccardSimilarity(cluster, concept.members);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {
          concept_id: concept.concept_id,
          members: concept.members,
          similarity,
        };
      }
    }

    if (bestMatch && bestMatch.similarity === 1) {
      skippedCount += 1;
      usedConceptIds.add(bestMatch.concept_id);
      continue;
    }

    const chunkTexts: string[] = [];
    for (const chunkId of cluster) {
      const chunk = getChunkByIdStmt.get(chunkId) as ChunkRow | undefined;
      if (!chunk?.text) continue;
      chunkTexts.push(chunk.text);
    }

    if (chunkTexts.length < CONCEPT_CLUSTER_MIN_SIZE) {
      skippedCount += 1;
      continue;
    }

    let summary = '';
    try {
      summary = await synthesizeConceptSummary(chunkTexts);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LLM error';
      console.warn(`⚠️  Concept abstraction failed for cluster [${cluster.join(', ')}]: ${message}`);
      continue;
    }

    if (!summary) {
      console.warn(`⚠️  Concept abstraction returned empty summary for cluster [${cluster.join(', ')}]`);
      continue;
    }

    const now = new Date().toISOString();
    const label = buildConceptLabel(summary);
    const memberChunksJson = JSON.stringify(cluster);

    if (bestMatch && bestMatch.similarity > 0) {
      updateConceptStmt.run(label, summary, memberChunksJson, now, bestMatch.concept_id);
      refreshedCount += 1;
      usedConceptIds.add(bestMatch.concept_id);
    } else {
      const conceptId = uuidv4();
      insertConceptStmt.run(conceptId, label, summary, memberChunksJson, now, now);
      createdCount += 1;
      usedConceptIds.add(conceptId);
    }
  }

  const abstractedCount = createdCount + refreshedCount;
  console.log(`💡 Abstracted ${abstractedCount} concepts (${createdCount} new, ${refreshedCount} refreshed, ${skippedCount} skipped)`);
}

export async function consolidateChunk(chunk_id: string): Promise<void> {
  const {
    getChunkByIdStmt,
    getRelatedConnectionsStmt,
    updateConnectionStmt,
    flagContradictionStmt,
  } = getStatements();

  const sourceChunk = getChunkByIdStmt.get(chunk_id) as ChunkRow | undefined;
  if (!sourceChunk) {
    console.warn(`⚠️  consolidateChunk: source chunk not found (${chunk_id})`);
    return;
  }

  const connections = getRelatedConnectionsStmt.all(chunk_id) as ConnectionRow[];
  if (connections.length === 0) {
    console.log(`ℹ️  No untyped connections for chunk ${chunk_id}`);
    return;
  }

  console.log(`🧠 Consolidating chunk ${chunk_id} (${connections.length} connections)`);

  for (const connection of connections) {
    const targetChunk = getChunkByIdStmt.get(connection.target_chunk) as ChunkRow | undefined;
    if (!targetChunk) {
      console.warn(`⚠️  Target chunk not found (${connection.target_chunk}) for edge ${connection.edge_id}`);
      continue;
    }

    let relationship: Relationship = 'related_to';
    try {
      relationship = await classifyRelationship(sourceChunk.text, targetChunk.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LLM error';
      console.warn(`⚠️  LLM classification failed for edge ${connection.edge_id}: ${message}. Falling back to related_to.`);
      relationship = 'related_to';
    }

    const weight = RELATIONSHIP_WEIGHTS[relationship];
    const now = new Date().toISOString();

    updateConnectionStmt.run(relationship, weight, now, connection.edge_id);

    if (relationship === 'contradicts') {
      flagContradictionStmt.run(sourceChunk.chunk_id);
      flagContradictionStmt.run(targetChunk.chunk_id);

      console.warn(
        `⚠️  Contradiction detected: ${sourceChunk.chunk_id} [${sourceChunk.source}] ↔ ${targetChunk.chunk_id} [${targetChunk.source}]`
      );
    }
  }

  console.log(`✅ Consolidated chunk ${chunk_id}`);
}

export function runConsolidationWorker(intervalMs: number = 30000): void {
  const { selectUntypedSourcesStmt } = getStatements();

  const intervalSeconds = Math.round(intervalMs / 1000);
  console.log(`🔄 Consolidation worker running every ${intervalSeconds}s`);

  let isRunning = false;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      reinforceConnections();
      decayConnections();

      const rows = selectUntypedSourcesStmt.all() as Array<{ source_chunk: string }>;
      for (const row of rows) {
        try {
          await consolidateChunk(row.source_chunk);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown consolidation error';
          console.warn(`⚠️  Failed consolidating chunk ${row.source_chunk}: ${message}`);
        }
      }

      await abstractConcepts();
    } finally {
      isRunning = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs);
}

export async function consolidateAll(): Promise<void> {
  const { selectAllUntypedSourcesStmt } = getStatements();

  const rows = selectAllUntypedSourcesStmt.all() as Array<{ source_chunk: string }>;

  if (rows.length === 0) {
    console.log('ℹ️  No untyped connections to consolidate.');
  } else {
    for (let index = 0; index < rows.length; index++) {
      const current = index + 1;
      const total = rows.length;
      const chunkId = rows[index].source_chunk;
      console.log(`Consolidating chunk ${current} of ${total}`);

      try {
        await consolidateChunk(chunkId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown consolidation error';
        console.warn(`⚠️  Failed consolidating chunk ${chunkId}: ${message}`);
      }
    }
  }

  reinforceConnections();
  decayConnections();
  await abstractConcepts();
}
