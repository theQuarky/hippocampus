import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ScriptSegment } from './scriptWriter';

export interface SynthesisResult {
  audioPath: string;
  duration: number;
  engine: 'piper' | 'coqui';
  voicesUsed: string[];
}

const PIPER_VOICES: Record<string, string> = {
  NARRATOR: 'en_US-lessac-medium',
  ALEX:     'en_US-lessac-medium',
  SAM:      'en_US-ryan-medium',
  HOST:     'en_US-lessac-medium',
  EXPERT:   'en_US-ryan-medium',
};

const COQUI_VOICES: Record<string, string> = {
  NARRATOR: 'tts_models/en/ljspeech/tacotron2-DDC',
  ALEX:     'tts_models/en/ljspeech/tacotron2-DDC',
  SAM:      'tts_models/en/vctk/vits',
  HOST:     'tts_models/en/ljspeech/tacotron2-DDC',
  EXPERT:   'tts_models/en/vctk/vits',
};

const PIPER_BIN = process.env.PIPER_BIN ?? 'piper';
const PIPER_VOICES_DIR = process.env.PIPER_VOICES_DIR ?? path.join(os.homedir(), '.local/share/piper-voices');

function piperModelPath(voice: string): string {
  return path.join(PIPER_VOICES_DIR, `${voice}.onnx`);
}

function isPiperAvailable(): boolean {
  try { execSync(`"${PIPER_BIN}" --version`, { stdio: 'pipe' }); return true; } catch { return false; }
}

function isCoquiAvailable(): boolean {
  try { execSync('python3 -c "import TTS"', { stdio: 'pipe' }); return true; } catch { return false; }
}

function isFfmpegAvailable(): boolean {
  try { execSync('ffmpeg -version', { stdio: 'pipe' }); return true; } catch { return false; }
}

async function synthesizeWithPiper(text: string, speaker: string, outputPath: string): Promise<void> {
  const voice = PIPER_VOICES[speaker] ?? PIPER_VOICES.NARRATOR;
  return new Promise((resolve, reject) => {
    const proc = spawn(PIPER_BIN, ['--model', piperModelPath(voice), '--output_file', outputPath]);
    proc.stdin.write(text);
    proc.stdin.end();
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d; });
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(`piper failed: ${stderr}`));
      else resolve();
    });
  });
}

async function synthesizeWithCoqui(text: string, speaker: string, outputPath: string): Promise<void> {
  const model = COQUI_VOICES[speaker] ?? COQUI_VOICES.NARRATOR;
  const speakerArg = (speaker === 'SAM' || speaker === 'EXPERT') ? ', speaker="p225"' : '';
  const script = `
from TTS.api import TTS
tts = TTS('${model}')
tts.tts_to_file(text=${JSON.stringify(text)}, file_path='${outputPath}'${speakerArg})
`;
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-c', script]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d; });
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(`Coqui failed: ${stderr.slice(0, 200)}`));
      else resolve();
    });
  });
}

async function concatenateWavFiles(wavFiles: string[], outputMp3: string): Promise<void> {
  if (wavFiles.length === 0) throw new Error('No WAV files to concatenate');
  if (wavFiles.length === 1) {
    execSync(`ffmpeg -i "${wavFiles[0]}" -codec:a libmp3lame -qscale:a 4 "${outputMp3}" -y`, { stdio: 'pipe' });
    return;
  }
  const tmpDir = path.dirname(wavFiles[0]);
  const listFile = path.join(tmpDir, 'concat.txt');
  fs.writeFileSync(listFile, wavFiles.map(f => `file '${f}'`).join('\n'));
  execSync(`ffmpeg -f concat -safe 0 -i "${listFile}" -codec:a libmp3lame -qscale:a 4 "${outputMp3}" -y`, { stdio: 'pipe' });
}

function getAudioDuration(mp3Path: string): number {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3Path}"`, { encoding: 'utf8' });
    return parseFloat(out.trim()) || 0;
  } catch { return 0; }
}

export async function synthesizeScript(
  segments: ScriptSegment[],
  outputDir: string,
  filename: string,
): Promise<SynthesisResult> {
  if (!isFfmpegAvailable()) {
    throw new Error('ffmpeg is required. Install with: sudo pacman -S ffmpeg');
  }
  const usePiper = isPiperAvailable();
  const useCoqui = !usePiper && isCoquiAvailable();
  if (!usePiper && !useCoqui) {
    throw new Error('No TTS engine available.\nInstall piper:  pip install piper-tts\nInstall Coqui:  pip install TTS');
  }

  const engine = usePiper ? 'piper' : 'coqui';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippocampus-tts-'));
  const wavFiles: string[] = [];
  const voicesUsed = new Set<string>();

  try {
    console.log(`Synthesizing ${segments.length} segments with ${engine}...`);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const wavPath = path.join(tmpDir, `seg_${String(i).padStart(4, '0')}.wav`);
      if (usePiper) await synthesizeWithPiper(seg.text, seg.speaker, wavPath);
      else await synthesizeWithCoqui(seg.text, seg.speaker, wavPath);
      wavFiles.push(wavPath);
      voicesUsed.add(seg.speaker);
      process.stdout.write(`\rSynthesizing... ${i + 1}/${segments.length}`);
    }
    console.log('');

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `${filename}.mp3`);
    await concatenateWavFiles(wavFiles, outputPath);
    const duration = getAudioDuration(outputPath);
    console.log(`Audio saved: ${outputPath} (${Math.round(duration)}s)`);

    return { audioPath: outputPath, duration, engine, voicesUsed: Array.from(voicesUsed) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
