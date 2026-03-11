// src/cli/cli.ts — CLI entry point for Hippocampus
import { initDB, ensureDefaultMemoryDatabase } from '../db';
import {
  cmdIngest,
  cmdIngestDir,
  cmdWatch,
  cmdQuery,
  cmdQueryAnswer,
  cmdConsolidate,
  cmdConcepts,
  cmdBenchmark,
  cmdSyncConcepts,
} from './commands';

async function main() {
  await initDB();
  ensureDefaultMemoryDatabase();

  const command = process.argv[2];
  const args = process.argv.slice(3);

  // Simple flag parser for --db <name>
  let database: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--db') {
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        database = value;
        i++;
      }
      continue;
    }
    positional.push(arg);
  }

  const argument = positional[0];

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
      if (!argument) { console.error('Usage: ingest <file|url> [--db <name>]'); process.exit(1); }
      await cmdIngest(argument, database);
      break;
    }

    case 'ingest-dir': {
      if (!argument) { console.error('Usage: ingest-dir <folder> [--db <name>]'); process.exit(1); }
      await cmdIngestDir(argument, database);
      break;
    }

    case 'watch': {
      if (!argument) { console.error('Usage: watch <folder>'); process.exit(1); }
      cmdWatch(argument);
      // Keep process alive for watcher
      await new Promise<void>(() => {});
      break;
    }

    case 'query': {
      if (!argument) { console.error('Usage: query <question> [--db <name>]'); process.exit(1); }
      await cmdQuery(argument, database);
      break;
    }

    case 'query-answer': {
      if (!argument) { console.error('Usage: query-answer <question> [--db <name>]'); process.exit(1); }
      await cmdQueryAnswer(argument, database);
      break;
    }

    case 'consolidate': {
      await cmdConsolidate();
      break;
    }

    case 'concepts': {
      await cmdConcepts();
      break;
    }

    case 'benchmark': {
      await cmdBenchmark();
      break;
    }

    case 'sync-concepts': {
      await cmdSyncConcepts();
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

// Ensure process exits cleanly after CLI commands complete (except watch)
main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
