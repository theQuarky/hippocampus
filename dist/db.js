"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.COLLECTION = exports.qdrant = void 0;
exports.initQdrant = initQdrant;
exports.initSQLite = initSQLite;
exports.initDB = initDB;
// src/db.ts
const js_client_rest_1 = require("@qdrant/js-client-rest");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const COLLECTION = 'hippocampus';
exports.COLLECTION = COLLECTION;
const VECTOR_SIZE = 384; // nomic-embed-text dimensions
// ── Qdrant ─────────────────────────────────────────
exports.qdrant = new js_client_rest_1.QdrantClient({ url: 'http://localhost:6333' });
async function initQdrant() {
    const existing = await exports.qdrant.getCollections();
    const exists = existing.collections.some(c => c.name === COLLECTION);
    if (!exists) {
        await exports.qdrant.createCollection(COLLECTION, {
            vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
        });
        console.log('✅ Qdrant collection created');
    }
}
// ── SQLite ─────────────────────────────────────────
const DB_PATH = path_1.default.join(process.cwd(), 'hippocampus.db');
exports.db = new better_sqlite3_1.default(DB_PATH);
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('synchronous = NORMAL');
function addColumnIfMissing(table, definition) {
    try {
        exports.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (!message.includes('duplicate column name')) {
            throw error;
        }
    }
}
function initSQLite() {
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id    TEXT PRIMARY KEY,
      text        TEXT NOT NULL,
      source      TEXT NOT NULL,
      page        INTEGER DEFAULT 0,
      timestamp   TEXT NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,
      tags        TEXT DEFAULT '[]',
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_unique_triplet
    ON connections (source_chunk, target_chunk, relationship);
  `);
    addColumnIfMissing('chunks', 'is_duplicate INTEGER DEFAULT 0');
    addColumnIfMissing('chunks', 'contradiction_flag INTEGER DEFAULT 0');
    addColumnIfMissing('connections', 'last_reinforced TEXT');
    console.log('✅ SQLite schema ready');
}
async function initDB() {
    await initQdrant();
    initSQLite();
}
