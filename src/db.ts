// src/db.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import Database from 'better-sqlite3';
import path from 'path';

const COLLECTION = 'hippocampus';
const VECTOR_SIZE = 768; // nomic-embed-text dimensions

// ── Qdrant ─────────────────────────────────────────
export const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

export async function initQdrant() {
  const existing = await qdrant.getCollections();
  const exists = existing.collections.some(c => c.name === COLLECTION);
  
  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
    });
    console.log('✅ Qdrant collection created');
  }
}

export { COLLECTION };

// ── SQLite ─────────────────────────────────────────
const DB_PATH = path.join(process.cwd(), 'hippocampus.db');
export const db = new Database(DB_PATH);

export function initSQLite() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id    TEXT PRIMARY KEY,
      text        TEXT NOT NULL,
      source      TEXT NOT NULL,
      page        INTEGER DEFAULT 0,
      timestamp   TEXT NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,
      tags        TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS connections (
      edge_id       TEXT PRIMARY KEY,
      source_chunk  TEXT NOT NULL,
      target_chunk  TEXT NOT NULL,
      relationship  TEXT NOT NULL,
      weight        REAL DEFAULT 0.3,
      confidence    REAL DEFAULT 0.5,
      created_at    TEXT NOT NULL
    );
  `);
  console.log('✅ SQLite schema ready');
}

export async function initDB() {
  await initQdrant();
  initSQLite();
}