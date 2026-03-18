import { Ollama } from 'ollama';
import { OLLAMA_MODEL, OLLAMA_URL } from '../config';

const ollama = new Ollama({ host: OLLAMA_URL });

export type OverviewFormat = 'monologue' | 'dialogue' | 'interview';

export interface ScriptSegment {
  speaker: string;   // 'NARRATOR' | 'ALEX' | 'SAM' | 'HOST' | 'EXPERT'
  text: string;
}

export interface GeneratedScript {
  format: OverviewFormat;
  title: string;
  segments: ScriptSegment[];
  wordCount: number;
  estimatedDurationSeconds: number;
}

const WORDS_PER_MINUTE = 150;

function monologuePrompt(query: string, evidence: string): string {
  return `You are creating a spoken audio summary. Your audience is listening, not reading. Write naturally for speech — no bullet points, no markdown, no section headers. Use short sentences.

TOPIC: ${query}

SOURCE MATERIAL:
${evidence}

Write a 200-250 word spoken monologue that explains this topic clearly, based ONLY on the source material above. Do not add information not in the sources.

Format your response as plain speech text only. No labels, no markup. Start speaking immediately.`;
}

function dialoguePrompt(query: string, evidence: string): string {
  return `You are writing a podcast script for two hosts: ALEX and SAM. Alex tends to explain things clearly. Sam asks good questions and occasionally pushes back.

TOPIC: ${query}

SOURCE MATERIAL:
${evidence}

Write a natural 300-350 word conversation about this topic based ONLY on the source material.

Format EXACTLY like this (one line per turn):
ALEX: [what Alex says]
SAM: [what Sam says]
ALEX: [what Alex says]
...

Start with Alex introducing the topic.`;
}

function interviewPrompt(query: string, evidence: string): string {
  return `You are writing an interview script. HOST asks clear questions. EXPERT gives detailed, grounded answers.

TOPIC: ${query}

SOURCE MATERIAL:
${evidence}

Write a 300-350 word interview based ONLY on the source material.

Format EXACTLY like this:
HOST: [question]
EXPERT: [answer]
HOST: [follow-up question]
EXPERT: [answer]
...

Start with the host introducing the topic briefly, then asking the first question.`;
}

function parseMonologue(raw: string): ScriptSegment[] {
  const sentences = raw.match(/[^.!?]+[.!?]+/g) ?? [raw];
  const segments: ScriptSegment[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const text = sentences.slice(i, i + 2).join(' ').trim();
    if (text) segments.push({ speaker: 'NARRATOR', text });
  }
  return segments;
}

function parseDialogue(raw: string): ScriptSegment[] {
  const lines = raw.split('\n').filter(l => l.trim());
  const segments: ScriptSegment[] = [];
  for (const line of lines) {
    const match = line.match(/^(ALEX|SAM):\s*(.+)$/i);
    if (match) segments.push({ speaker: match[1].toUpperCase(), text: match[2].trim() });
  }
  return segments.length > 0 ? segments : parseMonologue(raw);
}

function parseInterview(raw: string): ScriptSegment[] {
  const lines = raw.split('\n').filter(l => l.trim());
  const segments: ScriptSegment[] = [];
  for (const line of lines) {
    const match = line.match(/^(HOST|EXPERT):\s*(.+)$/i);
    if (match) segments.push({ speaker: match[1].toUpperCase(), text: match[2].trim() });
  }
  return segments.length > 0 ? segments : parseMonologue(raw);
}

export async function generateScript(
  query: string,
  evidenceChunks: Array<{ text: string; source: string; score: number }>,
  format: OverviewFormat = 'monologue',
): Promise<GeneratedScript> {
  const evidence = evidenceChunks
    .slice(0, 5)
    .map((c, i) => `[${i + 1}] (from ${c.source})\n${c.text}`)
    .join('\n\n');

  const prompt =
    format === 'monologue' ? monologuePrompt(query, evidence) :
    format === 'dialogue'  ? dialoguePrompt(query, evidence) :
                             interviewPrompt(query, evidence);

  const response = await ollama.generate({
    model: OLLAMA_MODEL,
    prompt,
    options: { temperature: 0.7, num_predict: 600 },
  });

  const raw = response.response.trim();
  const segments =
    format === 'monologue' ? parseMonologue(raw) :
    format === 'dialogue'  ? parseDialogue(raw) :
                             parseInterview(raw);

  const wordCount = segments.reduce((n, s) => n + s.text.split(' ').length, 0);
  const estimatedDurationSeconds = Math.round((wordCount / WORDS_PER_MINUTE) * 60);
  const title = query.split(' ').slice(0, 8).join(' ');

  return { format, title, segments, wordCount, estimatedDurationSeconds };
}
