// src/embedMany.ts
import { embed } from './embed';

export async function embedMany(texts: string[], batchSize = 16): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // naive parallel; later control concurrency with p-queue
    const vs = await Promise.all(batch.map(t => embed(t)));
    vectors.push(...vs);
  }
  return vectors;
}