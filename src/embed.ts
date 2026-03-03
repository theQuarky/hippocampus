// embed.ts — working CPU version, keep this
import { pipeline } from '@xenova/transformers';

let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'nomic-ai/nomic-embed-text-v1',
      {
        quantized: true // speeds up inference
      }
    );
  }
  return embeddingPipeline;
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  // nomic max context is 2048 tokens (~8000 chars) — truncate to be safe
  const truncated = text.slice(0, 6000);
  const result = await pipe(truncated, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const pipe = await getEmbeddingPipeline();
  // truncate each text and use small batches
  const truncated = texts.map(t => t.slice(0, 6000));
  const result = await pipe(truncated, { pooling: 'mean', normalize: true });
  
  if (Array.isArray(result)) {
    return result.map((row: any) => Array.from(row.data ?? row));
  }

  const tensorData = result?.data;
  const dims = result?.dims;
  if (!tensorData || !Array.isArray(dims) || dims.length < 2) {
    return texts.map(() => []);
  }

  const rows = Number(dims[0]);
  const cols = Number(dims[1]);
  const vectors: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const start = row * cols;
    const end = start + cols;
    vectors.push(Array.from(tensorData.slice(start, end)));
  }

  return vectors;
}