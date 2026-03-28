// src/db/index.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EMBED_DIMS, QDRANT_URL, QDRANT_COLLECTION } from '../config';

const COLLECTION = QDRANT_COLLECTION;
const CONCEPT_COLLECTION = `${QDRANT_COLLECTION}_concepts`;
const IMAGE_COLLECTION = `${QDRANT_COLLECTION}_images`;
const VECTOR_SIZE = EMBED_DIMS;

// ── Qdrant ─────────────────────────────────────────
export const qdrant = new QdrantClient({ url: QDRANT_URL });

export async function initQdrant() {
  await ensureCollection(COLLECTION, VECTOR_SIZE, 'main');
}

async function ensureCollection(name: string, vectorSize: number, label: string) {
  const existing = await qdrant.getCollections();
  const exists = existing.collections.some(c => c.name === name);

  if (!exists) {
    await qdrant.createCollection(name, {
      vectors: { size: vectorSize, distance: 'Cosine' }
    });
    console.log(`✅ Qdrant ${label} collection "${name}" created (dims=${vectorSize})`);
  } else {
    const info = await qdrant.getCollection(name);
    const collectionSize = (info.config?.params?.vectors as any)?.size;
    if (typeof collectionSize === 'number' && collectionSize !== vectorSize) {
      console.error(
        `\n❌ Qdrant ${label} collection "${name}" has vector size ${collectionSize}, ` +
        `but expected ${vectorSize}.\n` +
        `   Either:\n` +
        `   1) Delete and recreate the collection: curl -X DELETE ${QDRANT_URL}/collections/${name}\n` +
        `   2) Use a different collection name: QDRANT_COLLECTION=my_new_collection\n`
      );
      process.exit(1);
    }
  }
}

export { COLLECTION, CONCEPT_COLLECTION, IMAGE_COLLECTION };

// ── SQLite ─────────────────────────────────────────
const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'hippocampus.db');

// When running as a pkg binary, `bindings` resolves paths into the virtual
// snapshot (/snapshot/…) and can't dlopen the .node file. Instead, pass an
// explicit path relative to the binary so the OS can load it directly.
const _betterSqliteAddon: string | undefined = (process as any).pkg
  ? path.join(path.dirname(process.execPath), 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  : undefined;

export const db = new Database(DB_PATH, _betterSqliteAddon ? { nativeBinding: _betterSqliteAddon } : undefined);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

export function addColumnIfMissing(table: string, definition: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (!message.includes('duplicate column name')) {
      throw error;
    }
  }
}

export function initSQLite() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_databases (
      id           TEXT PRIMARY KEY,
      name         TEXT UNIQUE NOT NULL,
      created_at   INTEGER,
      description  TEXT,
      config_json  TEXT
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id    TEXT PRIMARY KEY,
      text        TEXT NOT NULL,
      source      TEXT NOT NULL,
      page        INTEGER DEFAULT 0,
      timestamp   TEXT NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,
      tags        TEXT DEFAULT '[]',
      metadata    TEXT DEFAULT '{}',
      is_duplicate INTEGER DEFAULT 0,
      contradiction_flag INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS connections (
      edge_id       TEXT PRIMARY KEY,
      source_chunk  TEXT NOT NULL,
      target_chunk  TEXT NOT NULL,
      relationship  TEXT NOT NULL,
      weight        REAL DEFAULT 0.3,
      confidence    REAL DEFAULT 0.5,
      created_at    TEXT NOT NULL,
      last_reinforced TEXT
    );

    CREATE TABLE IF NOT EXISTS concepts (
      concept_id     TEXT PRIMARY KEY,
      label          TEXT NOT NULL,
      summary        TEXT NOT NULL,
      vector_id      TEXT,
      member_chunks  TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      last_updated   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingest_events (
      event_id             TEXT PRIMARY KEY,
      source               TEXT NOT NULL,
      chunks_stored        INTEGER NOT NULL,
      chunks_skipped       INTEGER NOT NULL,
      connections_seeded   INTEGER NOT NULL,
      tags                 TEXT NOT NULL,
      timestamp            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS co_access_events (
      event_id          TEXT PRIMARY KEY,
      chunk_ids         TEXT NOT NULL,
      query_hash        TEXT NOT NULL,
      query_embedding   TEXT,
      timestamp         INTEGER NOT NULL,
      database_id       TEXT DEFAULT 'default'
    );

    CREATE INDEX IF NOT EXISTS idx_co_access_timestamp
    ON co_access_events(timestamp);

    CREATE TABLE IF NOT EXISTS associative_memory (
      model_id      TEXT PRIMARY KEY,
      weights_json  TEXT NOT NULL,
      num_concepts  INTEGER NOT NULL,
      trained_on    INTEGER NOT NULL,
      last_trained  INTEGER NOT NULL,
      accuracy      REAL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_unique_triplet
    ON connections (source_chunk, target_chunk, relationship);
  `);

  addColumnIfMissing('chunks', 'is_duplicate INTEGER DEFAULT 0');
  addColumnIfMissing('chunks', 'contradiction_flag INTEGER DEFAULT 0');
  addColumnIfMissing('chunks', 'metadata TEXT DEFAULT "{}"');
  // Multi-database support
  addColumnIfMissing('chunks', 'database_id TEXT DEFAULT "default"');
  addColumnIfMissing('connections', 'database_id TEXT DEFAULT "default"');
  addColumnIfMissing('concepts', 'database_id TEXT DEFAULT "default"');
  addColumnIfMissing('ingest_events', 'database_id TEXT DEFAULT "default"');
  addColumnIfMissing('co_access_events', 'database_id TEXT DEFAULT "default"');
  addColumnIfMissing('co_access_events', 'query_embedding TEXT');
  addColumnIfMissing('connections', 'last_reinforced TEXT');
  addColumnIfMissing('connections', 'access_count INTEGER DEFAULT 0');

  // PHASE 4 — learning weight columns on connections
  addColumnIfMissing('connections', 'support_count INTEGER DEFAULT 0');
  addColumnIfMissing('connections', 'contradict_count INTEGER DEFAULT 0');
  addColumnIfMissing('connections', 'seen_count INTEGER DEFAULT 0');
  addColumnIfMissing('connections', 'last_seen TEXT');
  addColumnIfMissing('connections', 'avg_sim REAL DEFAULT 0');
  addColumnIfMissing('connections', 'evidence_score REAL DEFAULT 0');
  addColumnIfMissing('connections', 'weight_version INTEGER DEFAULT 1');

  // PHASE 5 — concept confidence/version
  addColumnIfMissing('concepts', 'confidence REAL DEFAULT 0.5');
  addColumnIfMissing('concepts', 'version INTEGER DEFAULT 1');

  // PHASE 6 — concept embedding sync tracking
  addColumnIfMissing('concepts', 'embedding_version INTEGER DEFAULT 0');
  addColumnIfMissing('concepts', 'embedding_updated_at TEXT');

  console.log('✅ SQLite schema ready');
}

async function initConceptQdrant() {
  await ensureCollection(CONCEPT_COLLECTION, VECTOR_SIZE, 'concept');
}

async function initImageQdrant() {
  await ensureCollection(IMAGE_COLLECTION, 512, 'image');
}

export async function initDB() {
  await initQdrant();
  await initConceptQdrant();
  await initImageQdrant();
  initSQLite();
}

export async function storeImageEmbedding(
  imagePath: string,
  clipEmbedding: number[],
  description: string,
  ocrText?: string,
): Promise<void> {
  if (clipEmbedding.length === 0) return;

  await qdrant.upsert(IMAGE_COLLECTION, {
    wait: true,
    points: [{
      id: uuidv4(),
      vector: clipEmbedding,
      payload: {
        image_path: imagePath,
        description,
        ocr_text: ocrText ?? '',
        ocr_detected: Boolean(ocrText),
        timestamp: Date.now(),
      },
    }],
  });
}

// ── Memory database helpers ───────────────────────────────────────────────

export const DEFAULT_MEMORY_DB = 'default';

export function ensureDefaultMemoryDatabase(): void {
  const row = db.prepare('SELECT id, name FROM memory_databases WHERE name = ? LIMIT 1').get(DEFAULT_MEMORY_DB) as { id: string; name: string } | undefined;
  if (row) return;

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO memory_databases (id, name, created_at, description, config_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(`db_${DEFAULT_MEMORY_DB}`, DEFAULT_MEMORY_DB, now, 'Default memory database', '{}');

  // Backfill any existing rows that do not have a database_id
  db.prepare("UPDATE chunks SET database_id = ? WHERE database_id IS NULL OR database_id = ''").run(DEFAULT_MEMORY_DB);
  db.prepare("UPDATE connections SET database_id = ? WHERE database_id IS NULL OR database_id = ''").run(DEFAULT_MEMORY_DB);
  db.prepare("UPDATE concepts SET database_id = ? WHERE database_id IS NULL OR database_id = ''").run(DEFAULT_MEMORY_DB);
  db.prepare("UPDATE ingest_events SET database_id = ? WHERE database_id IS NULL OR database_id = ''").run(DEFAULT_MEMORY_DB);
  db.prepare("UPDATE co_access_events SET database_id = ? WHERE database_id IS NULL OR database_id = ''").run(DEFAULT_MEMORY_DB);
}
