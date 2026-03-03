"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
const db_1 = require("./db");
const ingest_1 = require("./ingest");
const retrieve_1 = require("./retrieve");
const consolidate_1 = require("./consolidate");
const parser_1 = require("./parser");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chokidar_1 = __importDefault(require("chokidar"));
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx', '.html']);
function isUrl(value) {
    return /^https?:\/\//i.test(value);
}
function isHiddenPath(targetPath) {
    return targetPath.split(path_1.default.sep).some(part => part.startsWith('.'));
}
function isSupportedFile(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
}
function isAlreadyIngested(filePath) {
    const source = path_1.default.basename(filePath);
    const row = db_1.db.prepare('SELECT chunk_id FROM chunks WHERE source = ? LIMIT 1').get(source);
    return Boolean(row);
}
async function collectSupportedFiles(folder) {
    const entries = await fs_1.default.promises.readdir(folder, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.'))
            continue;
        const fullPath = path_1.default.join(folder, entry.name);
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
async function ingestDirectory(folder) {
    const resolvedFolder = path_1.default.resolve(folder);
    const files = await collectSupportedFiles(resolvedFolder);
    if (files.length === 0) {
        console.log('ℹ️  No supported files found.');
        return;
    }
    let ingested = 0;
    let skipped = 0;
    for (let index = 0; index < files.length; index++) {
        const filePath = files[index];
        const fileName = path_1.default.basename(filePath);
        if (isAlreadyIngested(filePath)) {
            skipped++;
            continue;
        }
        console.log(`📄 [${index + 1}/${files.length}] ingesting ${fileName}...`);
        await (0, ingest_1.ingest)(filePath);
        ingested++;
    }
    console.log(`✅ Done. Ingested ${ingested} files, skipped ${skipped} (already in memory)`);
}
function startWatch(folder) {
    const resolvedFolder = path_1.default.resolve(folder);
    let ingestionQueue = Promise.resolve();
    const enqueueIngestion = (task) => {
        ingestionQueue = ingestionQueue
            .then(task)
            .catch((error) => {
            console.error(`❌ ${error.message}`);
        });
    };
    const watcher = chokidar_1.default.watch(resolvedFolder, {
        ignored: (targetPath) => {
            const normalized = targetPath.split(path_1.default.sep).join('/');
            if (normalized.includes('/node_modules/') || normalized.includes('/.git/'))
                return true;
            return isHiddenPath(targetPath);
        },
        ignoreInitial: true,
        persistent: true,
    });
    console.log(`👁  Watching ${resolvedFolder} for new files...`);
    watcher.on('add', (filePath) => {
        if (!isSupportedFile(filePath))
            return;
        const fileName = path_1.default.basename(filePath);
        console.log(`📄 New file detected: ${fileName} — ingesting...`);
        enqueueIngestion(async () => {
            await (0, ingest_1.ingest)(filePath);
        });
    });
    watcher.on('change', (filePath) => {
        if (!isSupportedFile(filePath))
            return;
        const fileName = path_1.default.basename(filePath);
        console.log(`📄 File changed: ${fileName} — re-ingesting...`);
        enqueueIngestion(async () => {
            await (0, ingest_1.ingest)(filePath);
        });
    });
    watcher.on('error', (error) => {
        if (error instanceof Error) {
            console.error(`❌ Watcher error: ${error.message}`);
            return;
        }
        console.error('❌ Watcher error');
    });
}
async function main() {
    await (0, db_1.initDB)();
    const command = process.argv[2];
    const argument = process.argv[3];
    if (!command) {
        console.log(`
🧠 Hippocampus

  Chunking strategy (env):
    CHUNK_STRATEGY=fast  (default heuristic chunker)
    CHUNK_STRATEGY=llm   (Ollama-based semantic chunker)

  Commands:
    ingest <file|url>    Feed a document or webpage into memory
    ingest-dir <folder>  Recursively ingest supported files from a folder
    watch <folder>       Watch folder for new/changed files and ingest
    query  <question>    Retrieve relevant knowledge
    consolidate          Type weak connections once
    concepts             Build concept abstractions and print all concepts
    `);
        process.exit(0);
    }
    switch (command) {
        case 'ingest': {
            if (!argument) {
                console.error('Usage: ingest <file|url>');
                process.exit(1);
            }
            if (isUrl(argument)) {
                const text = await (0, parser_1.parseUrl)(argument);
                await (0, ingest_1.ingestText)(argument, text);
            }
            else {
                await (0, ingest_1.ingest)(argument);
            }
            break;
        }
        case 'ingest-dir': {
            if (!argument) {
                console.error('Usage: ingest-dir <folder>');
                process.exit(1);
            }
            await ingestDirectory(argument);
            break;
        }
        case 'watch': {
            if (!argument) {
                console.error('Usage: watch <folder>');
                process.exit(1);
            }
            startWatch(argument);
            await new Promise(() => { });
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
