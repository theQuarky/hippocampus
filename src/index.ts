// src/index.ts
import { initDB } from './db';
import { ingest } from './ingest';
import { retrieve } from './retrieve';

async function main() {
  await initDB();

  const command = process.argv[2];
  const argument = process.argv[3];

  if (!command) {
    console.log(`
🧠 Hippocampus

  Commands:
    ingest <file>        Feed a document into memory
    query  <question>    Retrieve relevant knowledge
    `);
    process.exit(0);
  }

  switch (command) {
    case 'ingest': {
      if (!argument) { console.error('Usage: ingest <file>'); process.exit(1); }
      await ingest(argument);
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

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});