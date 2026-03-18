import path from 'path';
import { retrieve } from '../retrieve';
import { generateScript, type OverviewFormat, type GeneratedScript } from './scriptWriter';
import { synthesizeScript, type SynthesisResult } from './tts';
import { OVERVIEWS_DIR } from '../config';

export type { OverviewFormat };

export interface AudioOverviewResult {
  query: string;
  format: OverviewFormat;
  script: GeneratedScript;
  audio: SynthesisResult;
  audioUrl: string;
}

export async function generateAudioOverview(
  query: string,
  format: OverviewFormat = 'monologue',
  database = 'default',
): Promise<AudioOverviewResult> {
  console.log(`\nGenerating ${format} overview for: "${query}"`);

  console.log('   Retrieving evidence...');
  const results = await retrieve(query, { topK: 8, maxHops: 2, database });

  if (results.length === 0) {
    throw new Error('No relevant chunks found for this query. Ingest some documents first.');
  }

  console.log(`   Writing ${format} script...`);
  const script = await generateScript(query, results, format);
  console.log(`   Script: ${script.wordCount} words, ~${script.estimatedDurationSeconds}s`);

  const safeQuery = query.replace(/[^a-z0-9]+/gi, '_').slice(0, 40).toLowerCase();
  const filename = `${format}_${safeQuery}_${Date.now()}`;

  const audio = await synthesizeScript(script.segments, OVERVIEWS_DIR, filename);
  const audioUrl = `/api/overviews/${path.basename(audio.audioPath)}`;

  return { query, format, script, audio, audioUrl };
}
