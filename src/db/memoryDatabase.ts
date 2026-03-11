// src/db/memoryDatabase.ts — Memory database catalog helpers
import { v4 as uuidv4 } from 'uuid';
import { db, DEFAULT_MEMORY_DB } from './index';

export interface MemoryDatabase {
  id: string;
  name: string;
  created_at: number | null;
  description: string | null;
  config_json: string | null;
}

export function normalizeDatabaseName(name: string | undefined | null): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return DEFAULT_MEMORY_DB;
  return trimmed;
}

export function getDatabaseByName(name: string): MemoryDatabase | null {
  const row = db.prepare<unknown[], MemoryDatabase>(
    'SELECT id, name, created_at, description, config_json FROM memory_databases WHERE name = ? LIMIT 1'
  ).get(name);
  return row ?? null;
}

export function listDatabases(): string[] {
  const rows = db.prepare('SELECT name FROM memory_databases ORDER BY name ASC').all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

export function createDatabase(name: string, description?: string): MemoryDatabase {
  const normalized = normalizeDatabaseName(name);
  if (!normalized) {
    throw new Error('Database name is required');
  }

  const existing = getDatabaseByName(normalized);
  if (existing) {
    throw new Error(`Database already exists: ${normalized}`);
  }

  const id = `db_${normalized}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const desc = description?.trim() || null;
  const configJson = '{}';

  db.prepare(
    'INSERT INTO memory_databases (id, name, created_at, description, config_json) VALUES (?, ?, ?, ?, ?)' 
  ).run(id, normalized, createdAt, desc, configJson);

  return { id, name: normalized, created_at: createdAt, description: desc, config_json: configJson };
}

export function deleteDatabase(name: string): void {
  const normalized = normalizeDatabaseName(name);
  if (!normalized) {
    throw new Error('Database name is required');
  }

  if (normalized === DEFAULT_MEMORY_DB) {
    throw new Error('Cannot delete the default database');
  }

  const existing = getDatabaseByName(normalized);
  if (!existing) {
    throw new Error(`Database not found: ${normalized}`);
  }

  const dbName = normalized;

  // Cascade delete rows for this database
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM connections WHERE database_id = ?').run(dbName);
    db.prepare('DELETE FROM concepts WHERE database_id = ?').run(dbName);
    db.prepare('DELETE FROM chunks WHERE database_id = ?').run(dbName);
    db.prepare('DELETE FROM ingest_events WHERE database_id = ?').run(dbName);
    db.prepare('DELETE FROM memory_databases WHERE name = ?').run(dbName);
  });

  tx();
}
