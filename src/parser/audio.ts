import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

export interface AudioParseResult {
  text: string;
  segments: Segment[];
  duration: number;
  language: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus', '.webm'];

export async function parseAudio(filePath: string): Promise<AudioParseResult> {
  const whisperModel = process.env.WHISPER_MODEL ?? 'small';
  const pythonExec = resolveWhisperPython();
  return runWhisper(filePath, whisperModel, pythonExec);
}

function resolveWhisperPython(): string {
  if (process.env.WHISPER_PYTHON?.trim()) {
    return process.env.WHISPER_PYTHON.trim();
  }

  const localVenv = path.join(process.cwd(), '.venv-whisper', 'bin', 'python');
  if (existsSync(localVenv)) {
    return localVenv;
  }

  return 'python3';
}

async function runWhisper(filePath: string, model: string, pythonExec: string): Promise<AudioParseResult> {
  return new Promise((resolve, reject) => {
    const escapedModel = JSON.stringify(model);
    const escapedPath = JSON.stringify(filePath.replace(/\\/g, '/'));
    const pythonScript = `
import sys, json
try:
  from faster_whisper import WhisperModel
  model = WhisperModel(${escapedModel}, device="auto", compute_type="auto")
  segments, info = model.transcribe(${escapedPath}, beam_size=5)
  result = {"language": info.language, "duration": info.duration, "segments": [], "text": ""}
  texts = []
  for seg in segments:
    text = seg.text.strip()
    result["segments"].append({"start": seg.start, "end": seg.end, "text": text})
    texts.append(text)
  result["text"] = " ".join(texts)
  print(json.dumps(result))
except ImportError:
  print(json.dumps({"error": "faster_whisper not installed"}))
  sys.exit(1)
`;

    const proc = spawn(pythonExec, ['-c', pythonScript]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        if (stdout.includes('faster_whisper not installed') || stderr.toLowerCase().includes('faster_whisper')) {
          reject(new Error(
            'Audio ingestion requires faster-whisper. Install with:\n' +
            'pip install faster-whisper\n' +
            'Or use Docker where it is pre-installed.'
          ));
          return;
        }

        reject(new Error(`Whisper failed: ${stderr || stdout}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as AudioParseResult;
        resolve(parsed);
      } catch {
        reject(new Error(`Whisper output parse failed: ${stdout}`));
      }
    });
    proc.on('error', (error) => {
      reject(new Error(`Failed to launch Python for Whisper (${pythonExec}): ${error.message}`));
    });
  });
}

export function formatTranscriptWithTimestamps(result: AudioParseResult): string {
  return result.segments
    .map((seg) => `[${formatTime(seg.start)}] ${seg.text}`)
    .join('\n');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
