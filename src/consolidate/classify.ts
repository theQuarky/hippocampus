// src/consolidate/classify.ts — Cycle 2: LLM-based edge classification
import { Ollama } from 'ollama';
import {
  S, MODEL, BASE_WEIGHTS, ENABLE_LEARNING_WEIGHTS,
  parseRelationship, computeWeight,
  type Relationship, type ChunkRow, type ConnectionRow,
} from './helpers';
import { CONSOLIDATION_BATCH_SIZE, OLLAMA_URL } from '../config';

const ollama = new Ollama({ host: OLLAMA_URL });

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
