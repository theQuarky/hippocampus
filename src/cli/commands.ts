// src/cli/commands.ts — CLI command implementations and helpers
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { db } from '../db';
import { ingest, ingestText } from '../ingest';
import { retrieve } from '../retrieve';
import { consolidateAll, abstractConcepts } from '../consolidate';
import { syncConceptEmbeddings } from '../concepts/sync';
import { queryAnswer } from '../answer/query';
import { parseUrl } from '../ingest/parser';
import { runBenchmark } from '../tools/benchmark';
import { ENABLE_GROUNDED_ANSWERS } from '../config';
import { generateAudioOverview, type OverviewFormat } from '../audio/overview';

// ── Constants ──────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx', '.html']);

// ── Helpers ────────────────────────────────────────────────────────────────

export function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isHiddenPath(targetPath: string): boolean {
  return targetPath.split(path.sep).some(part => part.startsWith('.'));
}

export function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function isAlreadyIngested(filePath: string): boolean {
  const source = path.basename(filePath);
  const row = db.prepare('SELECT chunk_id FROM chunks WHERE source = ? LIMIT 1').get(source) as { chunk_id: string } | undefined;
  return Boolean(row);
}

export async function collectSupportedFiles(folder: string): Promise<string[]> {
  const entries = await fs.promises.readdir(folder, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      const nested = await collectSupportedFiles(fullPath);
      results.push(...nested);
      continue;
    }

    if (entry.isFile() && isSupportedFile(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

// ── Commands ───────────────────────────────────────────────────────────────

export async function cmdIngest(argument: string, database?: string): Promise<void> {
  if (isUrl(argument)) {
    const text = await parseUrl(argument);
    await ingestText(argument, text, [], {}, database);
  } else {
    await ingest(argument, [], undefined, undefined, database);
  }
}

export async function cmdIngestDir(folder: string, database?: string): Promise<void> {
  const resolvedFolder = path.resolve(folder);
  const files = await collectSupportedFiles(resolvedFolder);

  if (files.length === 0) {
    console.log('ℹ️  No supported files found.');
    return;
  }

  let ingested = 0;
  let skipped = 0;

  for (let index = 0; index < files.length; index++) {
    const filePath = files[index];
    const fileName = path.basename(filePath);

    if (isAlreadyIngested(filePath)) {
      skipped++;
      continue;
    }

    console.log(`📄 [${index + 1}/${files.length}] ingesting ${fileName}...`);
    await ingest(filePath, [], undefined, undefined, database);
    ingested++;
  }

  console.log(`✅ Done. Ingested ${ingested} files, skipped ${skipped} (already in memory)`);
}

export function cmdWatch(folder: string): void {
  const resolvedFolder = path.resolve(folder);
  let ingestionQueue: Promise<void> = Promise.resolve();

  const enqueueIngestion = (task: () => Promise<void>) => {
    ingestionQueue = ingestionQueue
      .then(task)
      .catch((error: Error) => {
        console.error(`❌ ${error.message}`);
      });
  };

  const watcher = chokidar.watch(resolvedFolder, {
    ignored: (targetPath: string) => {
      const normalized = targetPath.split(path.sep).join('/');
      if (normalized.includes('/node_modules/') || normalized.includes('/.git/')) return true;
      return isHiddenPath(targetPath);
    },
    ignoreInitial: true,
    persistent: true,
  });

  console.log(`👁  Watching ${resolvedFolder} for new files...`);

  watcher.on('add', (filePath: string) => {
    if (!isSupportedFile(filePath)) return;

    const fileName = path.basename(filePath);
    console.log(`📄 New file detected: ${fileName} — ingesting...`);

    enqueueIngestion(async () => {
      await ingest(filePath);
    });
  });

  watcher.on('change', (filePath: string) => {
    if (!isSupportedFile(filePath)) return;

    const fileName = path.basename(filePath);
    console.log(`📄 File changed: ${fileName} — re-ingesting...`);

    enqueueIngestion(async () => {
      await ingest(filePath);
    });
  });

  watcher.on('error', (error: unknown) => {
    if (error instanceof Error) {
      console.error(`❌ Watcher error: ${error.message}`);
      return;
    }
    console.error('❌ Watcher error');
  });
}

export async function cmdQuery(question: string, database?: string): Promise<void> {
  const results = await retrieve(question, undefined, database);
  console.log(`\n🔍 Query: "${question}"\n`);
  results.forEach((r, i) => {
    console.log(`── Result ${i + 1} (score: ${r.score.toFixed(4)}) [${r.source}]`);
    console.log(`${r.text}\n`);
  });
}

export async function cmdQueryAnswer(argument: string, database?: string): Promise<void> {
  if (!ENABLE_GROUNDED_ANSWERS) {
    console.log('ℹ️  Grounded answers disabled (ENABLE_GROUNDED_ANSWERS=false). Running plain retrieval.\n');
    await cmdQuery(argument);
    return;
  }

  try {
    const result = await queryAnswer(argument, database);

    // Print answer
    console.log(`\nAnswer:\n${result.answer}\n`);

    // Print concepts used (enriched with concept_id and confidence)
    if (result.concepts_detail.length > 0) {
      console.log('Concepts Used:');
      result.concepts_detail.forEach(c => {
        console.log(`  * ${c.label}  (id: ${c.concept_id}, confidence: ${c.confidence.toFixed(2)})`);
      });
      console.log();
    } else if (result.concepts_used.length > 0) {
      console.log('Concepts Used:');
      result.concepts_used.forEach(c => console.log(`  * ${c}`));
      console.log();
    }

    // Print evidence chunks (top 5)
    const topEvidence = result.evidence.slice(0, 5);
    if (topEvidence.length > 0) {
      console.log('Evidence Chunks:');
      topEvidence.forEach((ev, i) => {
        const preview = (ev.text || '').slice(0, 200);
        const dbLabel = result.database;
        console.log(`  [${i + 1}] [${dbLabel}] ${ev.source} (score ${ev.score.toFixed(2)}) [${ev.retrieval_layer}]`);
        console.log(`      ${preview}`);
        console.log();
      });
    }

    // Print graph connections
    if (result.graph_edges.length > 0) {
      console.log('Graph Connections:');
      for (const edge of result.graph_edges) {
        console.log(`  ${edge.source_chunk} -> ${edge.target_chunk}  [${edge.relationship}] (w: ${edge.weight.toFixed(2)})`);
      }
      console.log();
    } else {
      console.log('Graph Connections:\n  None\n');
    }

    // Contradiction detection (Phase 5)
    if (topEvidence.length >= 2) {
      try {
        const usedIds = topEvidence.map(e => e.chunk_id);
        const placeholders = usedIds.map(() => '?').join(', ');
        const contradictions = db.prepare(`
          SELECT source_chunk, target_chunk
          FROM connections
          WHERE relationship = 'contradicts'
            AND source_chunk IN (${placeholders})
            AND target_chunk IN (${placeholders})
        `).all(...usedIds, ...usedIds) as Array<{ source_chunk: string; target_chunk: string }>;

        if (contradictions.length > 0) {
          console.log('⚠ Contradictory evidence detected between chunks:');
          for (const c of contradictions) {
            console.log(`  ${c.source_chunk} ↔ ${c.target_chunk}`);
          }
          console.log();
        }
      } catch {
        // Contradiction check is best-effort; never crash
      }
    }
  } catch (error) {
    // Safety — never crash query-answer
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`❌ query-answer failed: ${msg}`);
    console.log('\nAnswer:\nAnswer generation failed — please check that Ollama and Qdrant are running.\n');
  }
}

export async function cmdConsolidate(): Promise<void> {
  await consolidateAll();
}

export async function cmdConcepts(): Promise<void> {
  await abstractConcepts();

  const concepts = db.prepare(`
    SELECT concept_id, label, summary, member_chunks, last_updated
    FROM concepts
    ORDER BY last_updated DESC
  `).all() as Array<{
    concept_id: string;
    label: string;
    summary: string;
    member_chunks: string;
    last_updated: string;
  }>;

  if (concepts.length === 0) {
    console.log('ℹ️  No concepts stored.');
    return;
  }

  console.log(`\n💡 Concepts (${concepts.length})\n`);
  concepts.forEach((concept, index) => {
    let memberCount = 0;
    try {
      const parsed = JSON.parse(concept.member_chunks);
      if (Array.isArray(parsed)) memberCount = parsed.length;
    } catch {
      memberCount = 0;
    }

    console.log(`── Concept ${index + 1}: ${concept.label}`);
    console.log(`   id: ${concept.concept_id}`);
    console.log(`   members: ${memberCount}`);
    console.log(`   updated: ${concept.last_updated}`);
    console.log(`   ${concept.summary}\n`);
  });
}

export async function cmdBenchmark(): Promise<void> {
  await runBenchmark();
}

export async function cmdSyncConcepts(): Promise<void> {
  const result = await syncConceptEmbeddings();
  console.log(`✅ Concept sync complete: ${result.synced} synced, ${result.skipped} skipped`);
}

export async function cmdOverview(question: string, format: OverviewFormat = 'monologue', database?: string): Promise<void> {
  const result = await generateAudioOverview(question, format, database ?? 'default');
  console.log(`\nAudio overview generated:`);
  console.log(`  File:     ${result.audio.audioPath}`);
  console.log(`  Format:   ${result.format}`);
  console.log(`  Duration: ${Math.round(result.audio.duration)}s`);
  console.log(`  Words:    ${result.script.wordCount}`);
  console.log(`  Engine:   ${result.audio.engine}`);
  console.log(`  URL:      ${result.audioUrl}`);
}
