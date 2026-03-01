"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
const db_1 = require("./db");
const ingest_1 = require("./ingest");
const retrieve_1 = require("./retrieve");
async function main() {
    await (0, db_1.initDB)();
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
            if (!argument) {
                console.error('Usage: ingest <file>');
                process.exit(1);
            }
            await (0, ingest_1.ingest)(argument);
            break;
        }
        case 'query': {
            if (!argument) {
                console.error('Usage: query <question>');
                process.exit(1);
            }
            const results = await (0, retrieve_1.retrieve)(argument);
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
