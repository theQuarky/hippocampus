// src/consolidate/concepts.ts — Cycle 3: concept abstraction, validation, and merging
import { Ollama } from 'ollama';
import { db } from '../db';
import { embed } from '../embed';
import { v4 as uuidv4 } from 'uuid';
import { ENABLE_CONCEPT_VALIDATION, OLLAMA_URL } from '../config';

const ollama = new Ollama({ host: OLLAMA_URL });
import {
  S, MODEL,
  CONCEPT_CLUSTER_MIN_SIZE,
  CONCEPT_EDGE_MIN_WEIGHT,
  CONCEPT_MERGE_JACCARD,
  CONCEPT_MERGE_COSINE,
  normalizeMemberChunks,
  safeParseMemberChunks,
  jaccardSimilarity,
  cosineSimilarity,
  buildConceptLabel,
  clamp,
  type ChunkRow, type StrongEdgeRow, type ConceptRow,
} from './helpers';

// ── LLM helpers ────────────────────────────────────────────────────────────

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

// ── Cluster building ───────────────────────────────────────────────────────

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

// ── Concept abstraction ────────────────────────────────────────────────────

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
