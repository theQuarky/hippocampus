import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = path.join(__dirname, 'proto', 'hippocampus.proto');

async function run() {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDef) as any;
  const HippocampusClient = proto.hippocampus.Hippocampus;

  const client = new HippocampusClient('localhost:50051', grpc.credentials.createInsecure());

  const health = await new Promise<any>((resolve, reject) => {
    client.Health({}, (err: grpc.ServiceError | null, res: any) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
  console.log('Health:', health);

  const ingest = await new Promise<any>((resolve, reject) => {
    client.Ingest(
      {
        source: 'client-test.txt',
        text: 'Hippocampus stores semantic chunks and connects related ideas for retrieval.',
        tags: ['manual-test', 'grpc'],
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(err);
        resolve(res);
      },
    );
  });
  console.log('Ingest:', ingest);

  const query = await new Promise<any>((resolve, reject) => {
    client.Query(
      {
        query: 'what did we just ingest?',
        top_k: 5,
      },
      (err: grpc.ServiceError | null, res: any) => {
        if (err) return reject(err);
        resolve(res);
      },
    );
  });
  console.log('Query:', JSON.stringify(query, null, 2));
}

run().catch((error) => {
  console.error('Client test failed:', error);
  process.exit(1);
});
