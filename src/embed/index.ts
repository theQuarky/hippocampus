import { EMBED_MODEL, EMBED_MAX_TOKENS } from '../config';
import { loadXenova } from '../xenova';

let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    const { pipeline } = await loadXenova();
    embeddingPipeline = await pipeline('feature-extraction', EMBED_MODEL);
    console.log(`💻 Embedding model loaded on CPU (${EMBED_MODEL})`);
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

// CLIP image embedding — 512d, stored in a separate Qdrant collection.
export async function embedImage(imagePath: string): Promise<number[]> {
  try {
    const { pipeline } = await loadXenova();
    const clipPipeline = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
    const output = await clipPipeline(imagePath);
    return Array.from(output.data as Float32Array);
  } catch {
    console.warn('⚠️  CLIP embedding failed, skipping image embedding');
    return [];
  }
}
