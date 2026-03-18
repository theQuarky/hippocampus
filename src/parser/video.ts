import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { parseAudio, formatTranscriptWithTimestamps } from './audio';
import { parseImage } from './image';

export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'];

export interface VideoParseResult {
  transcript: string;
  frameDescriptions: FrameDesc[];
  duration: number;
  merged: string;
}

interface FrameDesc {
  timestamp: number;
  description: string;
  ocrText?: string;
}

const KEYFRAME_INTERVAL = Number.parseInt(process.env.KEYFRAME_INTERVAL ?? '60', 10);

export async function parseVideo(filePath: string): Promise<VideoParseResult> {
  // Check ffmpeg availability before doing any work.
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'ffmpeg not found. Install with:\n' +
      '  sudo apt-get install ffmpeg\n' +
      '  Or use Docker where it is pre-installed.'
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippocampus-video-'));

  try {
    const audioPath = path.join(tmpDir, 'audio.wav');
    execSync(
      `ffmpeg -i "${filePath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath}" -y`,
      { stdio: 'pipe' },
    );

    const audioResult = await parseAudio(audioPath);
    const transcript = formatTranscriptWithTimestamps(audioResult);

    const framesDir = path.join(tmpDir, 'frames');
    fs.mkdirSync(framesDir);
    const interval = Number.isFinite(KEYFRAME_INTERVAL) && KEYFRAME_INTERVAL > 0 ? KEYFRAME_INTERVAL : 60;

    execSync(
      `ffmpeg -i "${filePath}" -vf "fps=1/${interval},scale=640:-1" "${framesDir}/frame_%04d.jpg" -y`,
      { stdio: 'pipe' },
    );

    const frameFiles = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
    const frameDescriptions: FrameDesc[] = [];

    for (let i = 0; i < frameFiles.length; i++) {
      const framePath = path.join(framesDir, frameFiles[i]);
      const timestamp = i * interval;
      try {
        const result = await parseImage(framePath);
        frameDescriptions.push({
          timestamp,
          description: result.description,
          ocrText: result.ocr_text,
        });
      } catch {
        console.warn(`⚠️  Frame at ${formatTime(timestamp)} skipped`);
      }
    }

    const merged = mergeTranscriptAndFrames(transcript, frameDescriptions);

    return {
      transcript,
      frameDescriptions,
      duration: audioResult.duration,
      merged,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mergeTranscriptAndFrames(transcript: string, frames: FrameDesc[]): string {
  const lines = transcript.split('\n');
  const result: string[] = [];
  let frameIdx = 0;

  for (const line of lines) {
    const match = line.match(/^\[(\d+):(\d+)\]/);
    if (match) {
      const seconds = Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
      while (frameIdx < frames.length && frames[frameIdx].timestamp <= seconds) {
        result.push(`\n[VISUAL at ${formatTime(frames[frameIdx].timestamp)}] ${frames[frameIdx].description}\n`);
        frameIdx++;
      }
    }
    result.push(line);
  }

  return result.join('\n');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
