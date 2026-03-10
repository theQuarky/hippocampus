// src/consolidate/index.ts — Public API for consolidation
import { cycle2ClassifyBatch, consolidateChunk } from './classify';
import { reinforceConnections, decayConnections } from './weights';
import { abstractConcepts } from './concepts';
import { syncConceptEmbeddings } from '../concepts/sync';
import { CONSOLIDATION_BATCH_SIZE, CONSOLIDATION_INTERVAL_MS } from '../config';
import { S } from './helpers';

// Re-export for external consumers
export { cycle2ClassifyBatch, consolidateChunk } from './classify';
export { reinforceConnections, decayConnections } from './weights';
export { abstractConcepts } from './concepts';

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
