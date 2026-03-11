// src/server/routes/queryRoute.ts — Query and query-answer routes
import { IncomingMessage, ServerResponse } from 'http';
import { retrieve, Result } from '../../retrieve';
import { queryAnswer } from '../../answer/query';
import { sendJson, parseBody } from '../helpers';

export async function handleQueryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/query-answer') {
    try {
      const body = await parseBody(req) as { question?: string; database?: string };
      const question = body.question?.trim() ?? '';
      const database = body.database && typeof body.database === 'string'
        ? body.database.trim()
        : undefined;

      if (!question) {
        sendJson(res, 400, { error: 'question is required' });
        return true;
      }

      const result = await queryAnswer(question, database);
      sendJson(res, 200, result);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'POST' && url.pathname === '/api/query') {
    try {
      const body = await parseBody(req) as { query?: string; top_k?: number; database?: string };
      const query = body.query?.trim() ?? '';
      const database = body.database && typeof body.database === 'string'
        ? body.database.trim()
        : undefined;
      const topK = typeof body.top_k === 'number' && Number.isFinite(body.top_k) && body.top_k > 0
        ? Math.floor(body.top_k)
        : 5;

      const results: Result[] = await retrieve(query, topK, database);
      sendJson(res, 200, results);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown API error';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  return false;
}
