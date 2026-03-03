// src/embedMany.ts
import { embedBatch } from './embed';

export async function embedMany(texts: string[], batchSize = 64): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vs = await embedBatch(batch);
    vectors.push(...vs);
  }
  return vectors;
}