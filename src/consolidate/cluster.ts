import { randomUUID } from 'crypto';
import { Ollama } from 'ollama';
import { db, DEFAULT_MEMORY_DB } from '../db';
import { embed } from '../embed';
import { OLLAMA_MODEL, OLLAMA_URL } from '../config';

const ollama = new Ollama({ host: OLLAMA_URL });
import { cosineSimilarity } from './helpers';

type ChunkEmbeddingRow = {
  chunk_id: string;
  text: string;
  database_id: string;
};

type Cluster = {
  members: string[];
  texts: string[];
  centroid: number[];
};

const COSINE_DISTANCE_THRESHOLD = 0.15;
const COSINE_SIMILARITY_THRESHOLD = 1 - COSINE_DISTANCE_THRESHOLD;

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const sum = new Array(dims).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dims; i++) {
      sum[i] += vector[i] ?? 0;
    }
  }

  return sum.map(value => value / vectors.length);
}

async function labelConcept(texts: string[]): Promise<string> {
  const prompt = `Given these chunk excerpts, return one topic label in 2-3 words.\n` +
    `Only return the label, no punctuation or explanation.\n\n` +
    texts.slice(0, 4).map((text, i) => `Chunk ${i + 1}: ${text.slice(0, 220)}`).join('\n\n') +
    `\n\nLabel:`;

  const response = await ollama.generate({
    model: OLLAMA_MODEL || 'phi3:mini',
    prompt,
    options: { temperature: 0.2 },
  });

  const label = (response.response || '').trim().replace(/\s+/g, ' ');
  if (!label) return 'Unlabeled Concept';
  return label.length <= 60 ? label : label.slice(0, 60).trim();
}

async function clusterDatabase(database: string): Promise<number> {
  const rows = db.prepare(`
    SELECT chunk_id, text, database_id
    FROM chunks
    WHERE database_id = ?
    ORDER BY timestamp ASC
  `).all(database) as ChunkEmbeddingRow[];

  if (rows.length === 0) return 0;

  const clusters: Cluster[] = [];

  for (const row of rows) {
    const vector = await embed(row.text);
    let bestIndex = -1;
    let bestSimilarity = -1;

    for (let i = 0; i < clusters.length; i++) {
      const similarity = cosineSimilarity(vector, clusters[i].centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestSimilarity >= COSINE_SIMILARITY_THRESHOLD) {
      const cluster = clusters[bestIndex];
      cluster.members.push(row.chunk_id);
      cluster.texts.push(row.text);

      const memberVectors = await Promise.all(cluster.texts.map(text => embed(text)));
      cluster.centroid = averageVectors(memberVectors);
      continue;
    }

    clusters.push({
      members: [row.chunk_id],
      texts: [row.text],
      centroid: vector,
    });
  }

  const now = new Date().toISOString();
  db.prepare('DELETE FROM concepts WHERE database_id = ?').run(database);

  let created = 0;
  for (const cluster of clusters) {
    if (cluster.members.length === 0) continue;

    let label = 'Unlabeled Concept';
    try {
      label = await labelConcept(cluster.texts);
    } catch {
      label = 'Unlabeled Concept';
    }

    db.prepare(`
      INSERT INTO concepts (concept_id, label, summary, member_chunks, created_at, last_updated, confidence, version, database_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      label,
      label,
      JSON.stringify(cluster.members),
      now,
      now,
      0.5,
      1,
      database,
    );
    created++;
  }

  return created;
}

export async function clusterIntoConcepts(): Promise<number> {
  const databases = db.prepare('SELECT name FROM memory_databases ORDER BY name ASC').all() as Array<{ name: string }>;
  const targets = databases.length > 0
    ? databases.map(row => row.name)
    : [DEFAULT_MEMORY_DB];

  let total = 0;
  for (const database of targets) {
    total += await clusterDatabase(database);
  }

  if (total > 0) {
    console.log(`🧩 Concept clustering created ${total} concepts`);
  }

  return total;
}
