// src/ingest.ts
import { v4 as uuidv4 } from 'uuid';
import { embed } from './embed';
import { parseFile } from './parser';
import { chunkText } from './chunk';
import { db, qdrant, COLLECTION } from './db';

export async function ingest(filePath: string, tags: string[] = []): Promise<void> {
  console.log(`\n📥 Ingesting: ${filePath}`);

  // Step 1: Parse
  const text = await parseFile(filePath);
  console.log(`   Parsed ${text.length} characters`);

  // Step 2: Chunk
  const chunks = chunkText(text);
  console.log(`   Created ${chunks.length} chunks`);

  // Step 3: Embed + Store
  const source = filePath.split('/').pop() || filePath;
  let stored = 0;

  for (const chunk of chunks) {
    const chunk_id = uuidv4();
    const vector = await embed(chunk.text);
    const timestamp = new Date().toISOString();

    // Store in Qdrant
    await qdrant.upsert(COLLECTION, {
      points: [{
        id: chunk_id,
        vector,
        payload: { text: chunk.text, source, chunk_id }
      }]
    });

    // Store in SQLite
    db.prepare(`
      INSERT INTO chunks (chunk_id, text, source, page, timestamp, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(chunk_id, chunk.text, source, chunk.index, timestamp, JSON.stringify(tags));

    stored++;
    process.stdout.write(`\r   Stored ${stored}/${chunks.length} chunks`);
  }

  console.log(`\n✅ Ingested ${stored} chunks from ${source}\n`);
}