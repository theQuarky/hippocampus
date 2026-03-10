// src/consolidate/weights.ts — Cycle 3: reinforce & decay connections
import {
  S,
  REINFORCE_ACCESS_THRESHOLD,
  MAX_CONNECTION_WEIGHT,
  MIN_CONNECTION_WEIGHT,
  DECAY_FACTOR,
  ENABLE_LEARNING_WEIGHTS,
  clamp,
  type ChunkRow, type ConnectionRow,
} from './helpers';

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
