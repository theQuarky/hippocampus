// src/index.ts
import { initDB, db } from './db';
import { ingest, ingestText } from './ingest';
import { retrieve, retrieveConcepts, retrieveByVector, expandWithConcepts, mergeChunks, rankChunks } from './retrieve';
import type { Result } from './retrieve';
import { consolidateAll, abstractConcepts } from './consolidate';
import { syncConceptEmbeddings } from './concepts/sync';
import { parseUrl } from './ingest/parser';
import { runBenchmark } from './benchmark';
import { embed } from './embed';
import { buildContext } from './answer/context';
import { generateGroundedAnswer } from './answer';
import { ENABLE_GROUNDED_ANSWERS, CONTEXT_TOP_K, INCLUDE_CONCEPTS, DEBUG_PERF } from './config';
import type { EvidenceBundle, EvidenceChunk } from './types/evidence';
import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx', '.html']);

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isHiddenPath(targetPath: string): boolean {
  return targetPath.split(path.sep).some(part => part.startsWith('.'));
}

function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

function isAlreadyIngested(filePath: string): boolean {
  const source = path.basename(filePath);
  const row = db.prepare('SELECT chunk_id FROM chunks WHERE source = ? LIMIT 1').get(source) as { chunk_id: string } | undefined;
  return Boolean(row);
}

async function collectSupportedFiles(folder: string): Promise<string[]> {
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

async function ingestDirectory(folder: string): Promise<void> {
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
    await ingest(filePath);
    ingested++;
  }

  console.log(`✅ Done. Ingested ${ingested} files, skipped ${skipped} (already in memory)`);
}

function startWatch(folder: string): void {
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

// ── Exported query-answer pipeline ──────────────────────────────────────────

export interface QueryAnswerResult {
  answer: string;
  evidence: EvidenceChunk[];
  concepts_used: string[];
  sources: string[];
}

/**
 * Full Hippocampus query-answer pipeline:
 *
 *  1. Embed the question
 *  2. Retrieve top-k chunks from Qdrant via vector search
 *  3. Retrieve related concepts
 *  4. Expand retrieval using concept graph (member chunks)
 *  5. Merge and deduplicate chunks (by chunk_id, keep highest score)
 *  6. Rank chunks by similarity (concept-layer boost applied)
 *  7. Build structured context (token-budgeted)
 *  8. Generate final answer using LLM
 */
export async function queryAnswer(question: string): Promise<QueryAnswerResult> {
  const t0 = DEBUG_PERF ? Date.now() : 0;

  // Step 1: Embed the question (single embedding call, reused everywhere)
  const embedding = await embed(question);
  if (DEBUG_PERF) console.log(`[PERF] embed: ${Date.now() - t0}ms`);

  // Step 2: Retrieve top-k chunks from Qdrant via vector search
  const tRetrieve = Date.now();
  const retrieved = await retrieveByVector(embedding, CONTEXT_TOP_K);
  if (DEBUG_PERF) console.log(`[PERF] retrieveByVector: ${Date.now() - tRetrieve}ms (${retrieved.length} chunks)`);

  // Step 3 & 4: Retrieve concepts and expand retrieval with concept neighbours
  let expandedChunks: Result[] = [];
  let concepts: Awaited<ReturnType<typeof retrieveConcepts>> = [];

  if (INCLUDE_CONCEPTS) {
    const tConcepts = Date.now();
    concepts = await retrieveConcepts(question);
    expandedChunks = await expandWithConcepts(embedding, 20);
    if (DEBUG_PERF) console.log(`[PERF] concept expansion: ${Date.now() - tConcepts}ms (${concepts.length} concepts, ${expandedChunks.length} expanded chunks)`);
  }

  // Step 5: Merge and deduplicate chunks
  const merged = mergeChunks(retrieved, expandedChunks);

  // Step 6: Rank by similarity (with concept boost)
  const ranked = rankChunks(merged);

  // Step 7: Build evidence bundle
  const evidenceChunks: EvidenceChunk[] = ranked.map(c => ({
    chunk_id: c.chunk_id,
    text: typeof c.text === 'string' ? c.text : '',
    source: typeof c.source === 'string' ? c.source : '',
    score: typeof c.score === 'number' ? c.score : 0,
    retrieval_layer: c.retrieval_layer ?? 'vector',
  }));

  const evidenceBundle: EvidenceBundle = {
    chunks: evidenceChunks,
    concepts: concepts.map(c => ({
      concept_id: typeof c.concept_id === 'string' ? c.concept_id : '',
      label: typeof c.label === 'string' ? c.label : '',
      confidence: typeof c.confidence === 'number' ? c.confidence : 0,
    })),
  };

  // Step 8: Build structured context
  const tContext = Date.now();
  const contextPackage = buildContext(
    question,
    ranked.map(c => ({
      chunk_id: c.chunk_id,
      text: typeof c.text === 'string' ? c.text : '',
      source: typeof c.source === 'string' ? c.source : '',
      score: typeof c.score === 'number' ? c.score : 0,
    })),
    concepts.length > 0 ? concepts : undefined,
  );
  if (DEBUG_PERF) console.log(`[PERF] context_build: ${Date.now() - tContext}ms`);

  // Step 9: Generate final answer using LLM
  const tAnswer = Date.now();
  const result = await generateGroundedAnswer(question, contextPackage, evidenceBundle);
  if (DEBUG_PERF) console.log(`[PERF] answer_generation: ${Date.now() - tAnswer}ms`);

  if (DEBUG_PERF) console.log(`[PERF] queryAnswer total: ${Date.now() - t0}ms`);

  return {
    answer: result.answer,
    evidence: evidenceChunks.slice(0, 5),
    concepts_used: result.concepts_used,
    sources: result.sources,
  };
}

async function main() {
  await initDB();

  const command = process.argv[2];
  const argument = process.argv[3];

  if (!command) {
    console.log(`
🧠 Hippocampus

  Chunking strategy (env):
    CHUNK_STRATEGY=token  (default, tokenizer-based — best quality)
    CHUNK_STRATEGY=fast   (heuristic chunker, no tokenizer)
    CHUNK_STRATEGY=llm    (Ollama-based semantic chunker)

  Environment toggles:
    EMBED_MODEL         Embedding model (default: nomic-ai/nomic-embed-text-v1)
    EMBED_DIMS          Embedding dimensions (default: 768)
    EMBED_MAX_TOKENS    Max tokens per chunk (default: 512)
    QDRANT_COLLECTION   Qdrant collection name (default: hippocampus)
    OLLAMA_MODEL        LLM model for consolidation (default: phi3:mini)
    ENABLE_LEARNING_WEIGHTS  Dynamic weights (default: true)
    ENABLE_CONCEPT_VALIDATION  Concept self-validation (default: true)
    INCLUDE_CONCEPTS    Include concepts in retrieval (default: false)
    DEBUG_PERF          Performance timing logs (default: false)
    DEBUG_CHUNKS        Chunk debug logs (default: false)

  Commands:
    ingest <file|url>    Feed a document or webpage into memory
    ingest-dir <folder>  Recursively ingest supported files from a folder
    watch <folder>       Watch folder for new/changed files and ingest
    query  <question>    Retrieve relevant knowledge
    query-answer <question> Retrieve + generate grounded answer
    consolidate          Type weak connections once
    concepts             Build concept abstractions and print all concepts
    sync-concepts        Sync concept embeddings to Qdrant (run after concepts)
    benchmark            Run benchmark on fixed queries
    `);
    process.exit(0);
  }

  switch (command) {
    case 'ingest': {
      if (!argument) { console.error('Usage: ingest <file|url>'); process.exit(1); }
      if (isUrl(argument)) {
        const text = await parseUrl(argument);
        await ingestText(argument, text);
      } else {
        await ingest(argument);
      }
      break;
    }

    case 'ingest-dir': {
      if (!argument) { console.error('Usage: ingest-dir <folder>'); process.exit(1); }
      await ingestDirectory(argument);
      break;
    }

    case 'watch': {
      if (!argument) { console.error('Usage: watch <folder>'); process.exit(1); }
      startWatch(argument);
      await new Promise<void>(() => {});
      break;
    }

    case 'query': {
      if (!argument) { console.error('Usage: query <question>'); process.exit(1); }
      const results = await retrieve(argument);
      console.log(`\n🔍 Query: "${argument}"\n`);
      results.forEach((r, i) => {
        console.log(`── Result ${i + 1} (score: ${r.score.toFixed(4)}) [${r.source}]`);
        console.log(`${r.text}\n`);
      });
      break;
    }

    case 'query-answer': {
      if (!argument) { console.error('Usage: query-answer <question>'); process.exit(1); }

      if (!ENABLE_GROUNDED_ANSWERS) {
        console.log('ℹ️  Grounded answers disabled (ENABLE_GROUNDED_ANSWERS=false). Running plain retrieval.\n');
        const results = await retrieve(argument);
        console.log(`\n🔍 Query: "${argument}"\n`);
        results.forEach((r, i) => {
          console.log(`── Result ${i + 1} (score: ${r.score.toFixed(4)}) [${r.source}]`);
          console.log(`${r.text}\n`);
        });
        break;
      }

      try {
        const result = await queryAnswer(argument);

        // Print answer
        console.log(`\nAnswer:\n${result.answer}\n`);

        // Print concepts used
        if (result.concepts_used.length > 0) {
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
            console.log(`  [${i + 1}] ${ev.source} (score ${ev.score.toFixed(2)}) [${ev.retrieval_layer}]`);
            console.log(`      ${preview}`);
            console.log();
          });
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

      break;
    }

    case 'consolidate': {
      await consolidateAll();
      break;
    }

    case 'concepts': {
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
        break;
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
      break;
    }

    case 'benchmark': {
      await runBenchmark();
      break;
    }

    case 'sync-concepts': {
      const result = await syncConceptEmbeddings();
      console.log(`✅ Concept sync complete: ${result.synced} synced, ${result.skipped} skipped`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

// Only run CLI when index.ts is the direct entry point
const isDirectEntry = require.main === module ||
  (process.argv[1] && (
    process.argv[1].endsWith('/index.ts') ||
    process.argv[1].endsWith('/index.js') ||
    process.argv[1].endsWith('\\index.ts') ||
    process.argv[1].endsWith('\\index.js')
  ));

if (isDirectEntry) {
  main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}