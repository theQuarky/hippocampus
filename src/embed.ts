// src/embed.ts
import { pipeline } from '@xenova/transformers';

let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  }
  return embeddingPipeline;
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}