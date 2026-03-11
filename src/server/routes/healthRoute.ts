// src/server/routes/healthRoute.ts — Health, stats, graph, concepts, and chunks routes
import { IncomingMessage, ServerResponse } from 'http';
import { db, DEFAULT_MEMORY_DB } from '../../db';
import { sendJson, clampNumber, type RelationshipCounts } from '../helpers';

function getRelationshipCounts(database: string): RelationshipCounts {
  const base: RelationshipCounts = {
    supports: 0,
    contradicts: 0,
    example_of: 0,
    caused_by: 0,
    related_to: 0,
  };

  const rows = db.prepare(`
    SELECT relationship, COUNT(*) AS count
    FROM connections
    WHERE database_id = ?
    GROUP BY relationship
  `).all(database) as Array<{ relationship: string; count: number }>;

  for (const row of rows) {
    if (row.relationship in base) {
      base[row.relationship as keyof RelationshipCounts] = row.count;
    }
  }

  return base;
}

export async function handleHealthRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/stats') {
    try {
      const database = url.searchParams.get('database')?.trim() || DEFAULT_MEMORY_DB;

      const totalChunksRow = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE database_id = ?').get(database) as { total: number };
      const totalConnectionsRow = db.prepare('SELECT COUNT(*) AS total FROM connections WHERE database_id = ?').get(database) as { total: number };
      const totalConceptsRow = db.prepare('SELECT COUNT(*) AS total FROM concepts WHERE database_id = ?').get(database) as { total: number };
      const relationshipCounts = getRelationshipCounts(database);
      const topSources = db.prepare(`
        SELECT source, COUNT(*) AS count
        FROM chunks
        WHERE database_id = ?
        GROUP BY source
        ORDER BY count DESC
        LIMIT 10
      `).all(database) as Array<{ source: string; count: number }>;
      const recentChunks = db.prepare(`
        SELECT chunk_id, source, timestamp, access_count
        FROM chunks
        WHERE database_id = ?
        ORDER BY timestamp DESC
        LIMIT 10
      `).all(database) as Array<{
        chunk_id: string;
        source: string;
        timestamp: string;
        access_count: number;
      }>;

      sendJson(res, 200, {
        total_chunks: totalChunksRow.total,
        total_connections: totalConnectionsRow.total,
        total_concepts: totalConceptsRow.total,
        relationship_counts: relationshipCounts,
        top_sources: topSources,
        recent_chunks: recentChunks,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'GET' && url.pathname === '/api/chunks') {
    try {
      const database = url.searchParams.get('database')?.trim() || DEFAULT_MEMORY_DB;
      const source = url.searchParams.get('source')?.trim();
      const search = url.searchParams.get('search')?.trim();
      const rawLimit = Number(url.searchParams.get('limit') ?? 50);
      const rawOffset = Number(url.searchParams.get('offset') ?? 0);
      const limit = clampNumber(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1, 200);
      const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

      const filters: string[] = [];
      const args: Array<string | number> = [];

      filters.push('database_id = ?');
      args.push(database);

      if (source) {
        filters.push('source = ?');
        args.push(source);
      }

      if (search) {
        filters.push('text LIKE ?');
        args.push(`%${search}%`);
      }

      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT chunk_id, text, source, page, timestamp, access_count, last_accessed, tags, is_duplicate, contradiction_flag
        FROM chunks
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `).all(...args, limit, offset);

      sendJson(res, 200, rows);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'GET' && url.pathname === '/api/graph') {
    try {
      const database = url.searchParams.get('database')?.trim() || DEFAULT_MEMORY_DB;
      const links = db.prepare(`
        SELECT source_chunk, target_chunk, relationship, weight
        FROM connections
        WHERE weight >= 0.1
          AND database_id = ?
      `).all(database) as Array<{
        source_chunk: string;
        target_chunk: string;
        relationship: string;
        weight: number;
      }>;

      if (links.length === 0) {
        sendJson(res, 200, { nodes: [], links: [] });
        return true;
      }

      const nodeIds = new Set<string>();
      for (const link of links) {
        nodeIds.add(link.source_chunk);
        nodeIds.add(link.target_chunk);
      }

      const placeholders = Array.from(nodeIds).map(() => '?').join(',');
      const nodeRows = db.prepare(`
        SELECT chunk_id, text, source, access_count, contradiction_flag
        FROM chunks
        WHERE chunk_id IN (${placeholders})
          AND database_id = ?
      `).all(...Array.from(nodeIds), database) as Array<{
        chunk_id: string;
        text: string;
        source: string;
        access_count: number;
        contradiction_flag: number;
      }>;

      const graph = {
        nodes: nodeRows.map((node) => ({
          id: node.chunk_id,
          text: node.text.slice(0, 80),
          source: node.source,
          access_count: node.access_count,
          contradiction_flag: node.contradiction_flag,
        })),
        links: links.map((link) => ({
          source: link.source_chunk,
          target: link.target_chunk,
          relationship: link.relationship,
          weight: link.weight,
        })),
      };

      sendJson(res, 200, graph);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'GET' && url.pathname === '/api/concepts') {
    try {
      const database = url.searchParams.get('database')?.trim() || DEFAULT_MEMORY_DB;
      const concepts = db.prepare(`
        SELECT concept_id, label, summary, member_chunks, created_at, last_updated
        FROM concepts
        WHERE database_id = ?
        ORDER BY last_updated DESC
      `).all(database) as Array<{
        concept_id: string;
        label: string;
        summary: string;
        member_chunks: string;
        created_at: string;
        last_updated: string;
      }>;

      const normalized = concepts.map((concept) => {
        let members: string[] = [];
        try {
          const parsed = JSON.parse(concept.member_chunks);
          if (Array.isArray(parsed)) {
            members = parsed.filter((item): item is string => typeof item === 'string');
          }
        } catch {
          members = [];
        }

        return {
          concept_id: concept.concept_id,
          label: concept.label,
          summary: concept.summary,
          member_chunks: members,
          created_at: concept.created_at,
          last_updated: concept.last_updated,
        };
      });

      sendJson(res, 200, normalized);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'GET' && url.pathname === '/api/ingests/recent') {
    try {
      const database = url.searchParams.get('database')?.trim() || DEFAULT_MEMORY_DB;
      const rawLimit = Number(url.searchParams.get('limit') ?? 5);
      const limit = clampNumber(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5, 1, 50);

      const rows = db.prepare(`
        SELECT source, chunks_stored, chunks_skipped, connections_seeded, timestamp
        FROM ingest_events
        WHERE database_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(database, limit) as Array<{
        source: string;
        chunks_stored: number;
        chunks_skipped: number;
        connections_seeded: number;
        timestamp: string;
      }>;

      sendJson(res, 200, rows);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  return false;
}
