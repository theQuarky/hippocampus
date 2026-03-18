// src/server/routes/dbRoute.ts — Memory database management routes
import { IncomingMessage, ServerResponse } from 'http';
import { sendJson, parseBody } from '../helpers';
import { ensureDefaultMemoryDatabase } from '../../db';
import { createDatabase, deleteDatabase, listDatabases, normalizeDatabaseName } from '../../db/memoryDatabase';

export async function handleDbRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/db/list') {
    try {
      ensureDefaultMemoryDatabase();
      const databases = listDatabases();
      sendJson(res, 200, { databases });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'POST' && url.pathname === '/api/db/create') {
    try {
      const body = await parseBody(req) as { name?: string; description?: string };
      const rawName = typeof body.name === 'string' ? body.name : '';
      const name = normalizeDatabaseName(rawName);

      if (!name) {
        sendJson(res, 400, { error: 'name is required' });
        return true;
      }

      const db = createDatabase(name, body.description);
      sendJson(res, 200, { name: db.name });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 400, { error: message });
      return true;
    }
  }

  if (method === 'POST' && url.pathname === '/api/db/delete') {
    try {
      const body = await parseBody(req) as { name?: string };
      const rawName = typeof body.name === 'string' ? body.name : '';
      const name = normalizeDatabaseName(rawName);

      if (!name) {
        sendJson(res, 400, { error: 'name is required' });
        return true;
      }

      deleteDatabase(name);
      sendJson(res, 200, { deleted: true });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 400, { error: message });
      return true;
    }
  }

  return false;
}
