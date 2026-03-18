// src/consolidate/index.ts — Public API for consolidation
import { cycle2ClassifyBatch, consolidateChunk } from './classify';
import { reinforceConnections, decayConnections, hebbianStrengthen } from './weights';
import { abstractConcepts } from './concepts';
import { clusterIntoConcepts } from './cluster';
import { syncConceptEmbeddings } from '../concepts/sync';
import { CONSOLIDATION_BATCH_SIZE, CONSOLIDATION_INTERVAL_MS } from '../config';
import { trainAssociativeMemory } from '../associative';
import { db, DEFAULT_MEMORY_DB } from '../db';
import { S } from './helpers';

const HEBBIAN_INTERVAL_MS = 5 * 60 * 1000;
const ASSOCIATIVE_TRAIN_INTERVAL_MS = 10 * 60 * 1000;
const CONCEPT_CLUSTER_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Re-export for external consumers
export { cycle2ClassifyBatch, consolidateChunk } from './classify';
export { reinforceConnections, decayConnections, hebbianStrengthen } from './weights';
export { abstractConcepts } from './concepts';
export { clusterIntoConcepts } from './cluster';

function isConceptTableEmpty(database: string = DEFAULT_MEMORY_DB): boolean {
  const row = db.prepare('SELECT COUNT(*) AS total FROM concepts WHERE database_id = ?').get(database) as { total: number };
  return (row?.total ?? 0) === 0;
}

/**
 * The background consolidation worker runs 3 cycles on a timer.
 * Cycle 1 is handled at ingest time (in ingest.ts).
 */
export function runConsolidationWorker(intervalMs: number = CONSOLIDATION_INTERVAL_MS): void {
  const intervalSeconds = Math.round(intervalMs / 1000);
  console.log(`🔄 Consolidation worker running every ${intervalSeconds}s`);

  let isRunning = false;
  let lastHebbianRun = 0;
  let lastAssociativeTrainRun = 0;
  let lastConceptClusterRun = 0;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      // Cycle 2: classify batch of untyped edges
      await cycle2ClassifyBatch(CONSOLIDATION_BATCH_SIZE);

      // Cycle 3: reinforce, decay, abstract
      reinforceConnections();
      decayConnections();

      const now = Date.now();
      if ((now - lastHebbianRun) >= HEBBIAN_INTERVAL_MS) {
        await hebbianStrengthen(lastHebbianRun);
        lastHebbianRun = now;
      }

      if (isConceptTableEmpty() || (now - lastConceptClusterRun) >= CONCEPT_CLUSTER_INTERVAL_MS) {
        await clusterIntoConcepts();
        lastConceptClusterRun = now;
      }

      if ((now - lastAssociativeTrainRun) >= ASSOCIATIVE_TRAIN_INTERVAL_MS) {
        await trainAssociativeMemory(lastAssociativeTrainRun);
        lastAssociativeTrainRun = now;
      }

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
  await hebbianStrengthen(0);
  if (isConceptTableEmpty()) {
    await clusterIntoConcepts();
  }
  await trainAssociativeMemory(0);
  await abstractConcepts();
  await syncConceptEmbeddings();
}
