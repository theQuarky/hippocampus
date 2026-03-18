// src/server/index.ts — Server startup orchestration
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { initDB, ensureDefaultMemoryDatabase, db, DEFAULT_MEMORY_DB } from '../db';
import { runConsolidationWorker } from '../consolidate';
import { getAssociativeStatus } from '../associative';
import { startHttpServer } from './httpServer';
import { ingestHandler, queryHandler, healthHandler } from './grpc';
import { HOST, DEFAULT_PORT } from './helpers';

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'hippocampus.proto');

async function startServer() {
  await initDB();
  ensureDefaultMemoryDatabase();

  const coAccessRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM co_access_events
    WHERE database_id = ?
  `).get(DEFAULT_MEMORY_DB) as { total: number };
  const associative = await getAssociativeStatus(DEFAULT_MEMORY_DB);

  console.log('🧠 Hippocampus online');
  console.log('   Vector search:     ✅ (384d, all-MiniLM-L6-v2)');
  console.log('   Graph traversal:   ✅ (max 2 hops, typed edges)');
  console.log(`   Hebbian memory:    ✅ (${coAccessRow?.total ?? 0} co-access events recorded)`);
  console.log(`   Associative MLP:   ✅ (trained on ${associative.trainedSamples} samples, influence: ${(associative.influence * 100).toFixed(1)}%)`);

  runConsolidationWorker(30000);
  startHttpServer();

  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDef) as any;
  const hippocampusService = proto.hippocampus.Hippocampus.service;

  const grpcServer = new grpc.Server();
  grpcServer.addService(hippocampusService, {
    Ingest: ingestHandler,
    Query: queryHandler,
    Health: healthHandler,
  } as any);

  const port = process.env.GRPC_PORT || DEFAULT_PORT;
  const bindAddress = `${HOST}:${port}`;

  grpcServer.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) {
      console.error('❌ Failed to bind gRPC server:', error);
      return;
    }

    grpcServer.start();
    console.log(`🧠 Hippocampus gRPC server listening on ${bindAddress}`);
  });
}

startServer().catch((error) => {
  console.error('❌ Failed to start gRPC server:', error);
});
