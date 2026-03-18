import fs from 'fs';
import path from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { generateAudioOverview, type OverviewFormat } from '../../audio/overview';
import { sendJson, parseBody, setCorsHeaders } from '../helpers';
import { OVERVIEWS_DIR } from '../../config';

const VALID_FORMATS = new Set(['monologue', 'dialogue', 'interview']);

export async function handleOverviewRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/overview') {
    try {
      const body = await parseBody(req) as { query?: string; format?: string; database?: string };
      const query = body.query?.trim() ?? '';
      const format = (body.format ?? 'monologue') as OverviewFormat;
      const database = body.database?.trim() ?? 'default';

      if (!query) {
        sendJson(res, 400, { error: 'query is required' });
        return true;
      }
      if (!VALID_FORMATS.has(format)) {
        sendJson(res, 400, { error: 'format must be monologue | dialogue | interview' });
        return true;
      }

      const result = await generateAudioOverview(query, format, database);
      sendJson(res, 200, {
        audioUrl: result.audioUrl,
        format: result.format,
        duration: result.audio.duration,
        wordCount: result.script.wordCount,
        title: result.script.title,
        script: result.script.segments,
        engine: result.audio.engine,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Overview generation failed';
      sendJson(res, 500, { error: message });
      return true;
    }
  }

  if (method === 'GET' && url.pathname.startsWith('/api/overviews/')) {
    const filename = path.basename(decodeURIComponent(url.pathname.slice('/api/overviews/'.length)));
    if (!filename || !filename.endsWith('.mp3')) {
      sendJson(res, 400, { error: 'Invalid filename' });
      return true;
    }
    const filePath = path.join(OVERVIEWS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'Not found' });
      return true;
    }
    const stat = fs.statSync(filePath);
    setCorsHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return false;
}
