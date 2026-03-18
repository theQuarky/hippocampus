// src/server/httpServer.ts — HTTP server setup and route dispatch
import http from 'http';
import { setCorsHeaders, sendJson, HOST, DEFAULT_HTTP_PORT } from './helpers';
import { handleHealthRoutes } from './routes/healthRoute';
import { handleQueryRoutes } from './routes/queryRoute';
import { handleIngestRoutes } from './routes/ingestRoute';
import { handleDbRoutes } from './routes/dbRoute';
import { handleOverviewRoutes } from './routes/overviewRoute';

export function startHttpServer(): void {
  const httpPort = process.env.HTTP_PORT || DEFAULT_HTTP_PORT;

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        console.log(`${method} ${url.pathname}`);

        if (method === 'OPTIONS') {
          setCorsHeaders(res);
          res.statusCode = 204;
          res.end();
          return;
        }

        // Dispatch to route handlers — first match wins
        const handled =
          await handleDbRoutes(req, res, url, method) ||
          await handleHealthRoutes(req, res, url, method) ||
          await handleQueryRoutes(req, res, url, method) ||
          await handleIngestRoutes(req, res, url, method) ||
          await handleOverviewRoutes(req, res, url, method);

        if (!handled) {
          sendJson(res, 404, { error: 'Not Found' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown API error';
        sendJson(res, 500, { error: message });
      }
    })();
  });

  httpServer.listen(Number(httpPort), HOST, () => {
    console.log(`🌐 HTTP API listening on http://${HOST}:${httpPort}`);
  });
}
