// src/consolidate/helpers.ts — Shared types, constants, and utility functions for consolidation
import { db } from '../db';
import {
  OLLAMA_MODEL,
  ENABLE_LEARNING_WEIGHTS,
} from '../config';

// ── Types ──────────────────────────────────────────────────────────────────

export type Relationship = 'supports' | 'contradicts' | 'example_of' | 'caused_by' | 'related_to';

export type ChunkRow = {
  chunk_id: string;
  text: string;
  source: string;
  access_count?: number;
};

export type ConnectionRow = {
  edge_id: string;
  source_chunk: string;
  target_chunk: string;
  relationship: string;
  weight: number | null;
  confidence: number | null;
  avg_sim: number | null;
  support_count: number | null;
  contradict_count: number | null;
  seen_count: number | null;
  last_seen: string | null;
  last_reinforced: string | null;
  created_at: string;
};

export type StrongEdgeRow = {
  source_chunk: string;
  target_chunk: string;
  weight: number | null;
};

export type ConceptRow = {
  concept_id: string;
  member_chunks: string;
  confidence: number | null;
  summary: string;
  version: number | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

export const MODEL = OLLAMA_MODEL;
export const VALID_RELATIONSHIPS: Relationship[] = ['supports', 'contradicts', 'example_of', 'caused_by', 'related_to'];

export const BASE_WEIGHTS: Record<Relationship, number> = {
  supports: 0.8,
  contradicts: 0.7,
  example_of: 0.75,
  caused_by: 0.75,
  related_to: 0.3,
};

export const REINFORCE_ACCESS_THRESHOLD = 3;
export const MAX_CONNECTION_WEIGHT = 1.0;
export const MIN_CONNECTION_WEIGHT = 0.05;
export const DECAY_FACTOR = 0.95;
export const CONCEPT_CLUSTER_MIN_SIZE = 3;
export const CONCEPT_EDGE_MIN_WEIGHT = 0.6;
export const CONCEPT_MERGE_JACCARD = 0.7;
export const CONCEPT_MERGE_COSINE = 0.85;

// ── Prepared statements (lazy singleton) ───────────────────────────────────

type Stmts = Record<string, any>;
let _stmts: Stmts | null = null;

export function S(): Stmts {
  if (_stmts) return _stmts;

  _stmts = {
    getChunk: db.prepare('SELECT chunk_id, text, source, access_count FROM chunks WHERE chunk_id = ? LIMIT 1'),

    // Cycle 2: batch of untyped edges
    selectUntypedEdges: db.prepare(
      'SELECT edge_id, source_chunk, target_chunk, avg_sim, support_count, contradict_count, seen_count FROM connections WHERE relationship = \'related_to\' LIMIT ?'
    ),
    selectAllUntypedSources: db.prepare(
      'SELECT DISTINCT source_chunk FROM connections WHERE relationship = \'related_to\''
    ),
    selectUntypedBySource: db.prepare(
      'SELECT edge_id, source_chunk, target_chunk, avg_sim, support_count, contradict_count, seen_count FROM connections WHERE source_chunk = ? AND relationship = \'related_to\' ORDER BY weight DESC, confidence DESC, created_at DESC'
    ),

    // Update after classification
    updateEdgeClassified: db.prepare(
      'UPDATE connections SET relationship = ?, weight = ?, confidence = ?, support_count = ?, contradict_count = ?, seen_count = ?, last_seen = ?, evidence_score = ?, weight_version = weight_version + 1, last_reinforced = ? WHERE edge_id = ?'
    ),

    flagContradiction: db.prepare('UPDATE chunks SET contradiction_flag = 1 WHERE chunk_id = ?'),

    // Cycle 3: reinforce/decay
    selectHighlyAccessedChunks: db.prepare('SELECT chunk_id, access_count FROM chunks WHERE access_count > ?'),
    selectOutgoingEdges: db.prepare(
      'SELECT edge_id, weight, confidence, avg_sim, source_chunk FROM connections WHERE source_chunk = ?'
    ),
    updateEdgeReinforce: db.prepare('UPDATE connections SET weight = ?, last_reinforced = ? WHERE edge_id = ?'),
    selectEdgesToDecay: db.prepare(
      'SELECT edge_id, weight, last_seen FROM connections WHERE (last_seen IS NULL AND last_reinforced IS NULL AND created_at < ?) OR (last_seen IS NOT NULL AND last_seen < ?) OR (last_seen IS NULL AND last_reinforced IS NOT NULL AND last_reinforced < ?)'
    ),
    updateEdgeWeight: db.prepare('UPDATE connections SET weight = ? WHERE edge_id = ?'),
    deleteEdge: db.prepare('DELETE FROM connections WHERE edge_id = ?'),

    // Concepts
    selectStrongEdges: db.prepare(
      'SELECT source_chunk, target_chunk, weight FROM connections WHERE weight >= ? ORDER BY weight DESC'
    ),
    selectConcepts: db.prepare('SELECT concept_id, member_chunks, confidence, summary, version FROM concepts'),
    insertConcept: db.prepare(
      'INSERT INTO concepts (concept_id, label, summary, member_chunks, created_at, last_updated, confidence, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    updateConcept: db.prepare(
      'UPDATE concepts SET label = ?, summary = ?, member_chunks = ?, last_updated = ?, confidence = ?, version = ? WHERE concept_id = ?'
    ),
    deleteConcept: db.prepare('DELETE FROM concepts WHERE concept_id = ?'),
  };

  return _stmts;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function isRelationship(value: string): value is Relationship {
  return VALID_RELATIONSHIPS.includes(value as Relationship);
}

export function parseRelationship(raw: string): Relationship {
  const normalized = raw.trim().toLowerCase();
  if (isRelationship(normalized)) return normalized;
  return 'related_to';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute dynamic weight for a connection using learning-weight formula.
 * weight = clamp( base * avg_sim * (0.5 + 0.5 * confidence) * recency_factor, MIN..MAX )
 */
export function computeWeight(
  relationship: Relationship,
  avgSim: number,
  supportCount: number,
  contradictCount: number,
  lastSeen: string | null,
): { weight: number; confidence: number; evidenceScore: number } {
  const base = BASE_WEIGHTS[relationship];
  // Smoothed confidence
  const confidence = (supportCount + 1) / (supportCount + contradictCount + 2);
  // Recency factor: 1.0 for recent, decays toward 0.5 for old
  let recencyFactor = 1.0;
  if (lastSeen) {
    const daysSince = (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60 * 24);
    recencyFactor = 0.5 + 0.5 * Math.exp(-daysSince / 30);
  }

  const simFactor = avgSim > 0 ? avgSim : 0.5; // fallback if no sim stored
  const weight = clamp(base * simFactor * (0.5 + 0.5 * confidence) * recencyFactor, MIN_CONNECTION_WEIGHT, MAX_CONNECTION_WEIGHT);
  const evidenceScore = base * confidence * simFactor;

  return { weight, confidence, evidenceScore };
}

export function normalizeMemberChunks(memberChunks: string[]): string[] {
  return [...new Set(memberChunks)].sort((a, b) => a.localeCompare(b));
}

export function safeParseMemberChunks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeMemberChunks(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0));
  } catch {
    return [];
  }
}

export function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const v of leftSet) if (rightSet.has(v)) intersection++;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function buildConceptLabel(summary: string, maxLength: number = 60): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength).trim();
  const lastSpace = candidate.lastIndexOf(' ');
  if (lastSpace >= Math.floor(maxLength / 2)) return candidate.slice(0, lastSpace).trim();
  return candidate;
}

export { ENABLE_LEARNING_WEIGHTS };
