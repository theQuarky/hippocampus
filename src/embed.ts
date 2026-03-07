import { EMBED_MODEL, EMBED_MAX_TOKENS } from './config';

let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    try {
      const transformers = await import('@huggingface/transformers' as any);
      embeddingPipeline = await transformers.pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { device: 'cuda', dtype: 'fp16' }
      );
      console.log('🔥 Embedding model loaded on GPU');
    } catch {
      // Fallback to CPU with @xenova/transformers
      const { pipeline } = await import('@xenova/transformers');
      embeddingPipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
      console.log('💻 Embedding model loaded on CPU');
    }
  }
  return embeddingPipeline;
}

// Rough char limit derived from token limit (avg 4 chars/token, conservative)
const MAX_CHARS = EMBED_MAX_TOKENS * 12;

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const truncated = text.slice(0, MAX_CHARS);
  const result = await pipe(truncated, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const pipe = await getEmbeddingPipeline();
  const truncated = texts.map(t => t.slice(0, MAX_CHARS));
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