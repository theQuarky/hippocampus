"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
const db_1 = require("./db");
const ingest_1 = require("./ingest");
const retrieve_1 = require("./retrieve");
const consolidate_1 = require("./consolidate");
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
    consolidate          Type weak connections once
    concepts             Build concept abstractions and print all concepts
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
        case 'consolidate': {
            await (0, consolidate_1.consolidateAll)();
            break;
        }
        case 'concepts': {
            await (0, consolidate_1.abstractConcepts)();
            const concepts = db_1.db.prepare(`
        SELECT concept_id, label, summary, member_chunks, last_updated
        FROM concepts
        ORDER BY last_updated DESC
      `).all();
            if (concepts.length === 0) {
                console.log('ℹ️  No concepts stored.');
                break;
            }
            console.log(`\n💡 Concepts (${concepts.length})\n`);
            concepts.forEach((concept, index) => {
                let memberCount = 0;
                try {
                    const parsed = JSON.parse(concept.member_chunks);
                    if (Array.isArray(parsed))
                        memberCount = parsed.length;
                }
                catch {
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
        default:
            console.error(`Unknown command: ${command}`);
            process.exit(1);
    }
}
main().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
});
