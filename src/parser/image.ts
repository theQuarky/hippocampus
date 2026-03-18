import fs from 'fs';
import { spawn } from 'child_process';

export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

export interface ImageParseResult {
  description: string;
  model_used: string;
  ocr_text?: string;
}

const VISION_MODELS = ['moondream', 'llava'];
let hasWarnedTesseractMissing = false;

export async function parseImage(filePath: string): Promise<ImageParseResult> {
  const imageData = fs.readFileSync(filePath);
  const base64 = imageData.toString('base64');
  const ocrTextPromise = extractTextWithTesseract(filePath);

  for (const model of VISION_MODELS) {
    try {
      const description = await describeWithOllama(base64, model);
      const ocrText = await ocrTextPromise;
      return {
        description: combineImageText(description, ocrText),
        model_used: model,
        ocr_text: ocrText || undefined,
      };
    } catch {
      console.warn(`⚠️  Vision model ${model} unavailable, trying next...`);
    }
  }

  const ocrText = await ocrTextPromise;
  if (ocrText) {
    return {
      description: combineImageText('', ocrText),
      model_used: 'tesseract-only',
      ocr_text: ocrText,
    };
  }

  throw new Error(
    'No vision model available. Pull one with:\n' +
    '  ollama pull moondream\n' +
    '  ollama pull llava'
  );
}

function combineImageText(description: string, ocrText: string): string {
  const cleanDescription = description.trim();
  const cleanOcr = ocrText.trim();

  if (cleanDescription && cleanOcr) {
    return `${cleanDescription}\n\nExtracted text:\n${cleanOcr}`;
  }

  if (cleanDescription) return cleanDescription;
  if (cleanOcr) return `Extracted text:\n${cleanOcr}`;
  return '';
}

async function extractTextWithTesseract(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const language = process.env.OCR_LANGUAGE ?? 'eng';
    const proc = spawn('tesseract', [filePath, 'stdout', '-l', language, '--psm', '6']);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', () => {
      if (!hasWarnedTesseractMissing) {
        hasWarnedTesseractMissing = true;
        console.warn(
          '⚠️  Tesseract OCR not found. Install with:\n' +
          '   sudo apt-get install tesseract-ocr\n' +
          '   Or use Docker where it is installed.'
        );
      }
      resolve('');
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        if (stderr.trim() && !hasWarnedTesseractMissing) {
          console.warn(`⚠️  OCR failed for ${filePath}: ${stderr.trim()}`);
        }
        resolve('');
        return;
      }

      const cleaned = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      resolve(cleaned);
    });
  });
}

async function describeWithOllama(base64: string, model: string): Promise<string> {
  const ollamaBase = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const response = await fetch(`${ollamaBase}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'Describe this image in detail. Include: main subjects, objects, any visible text, colors, spatial layout, and anything that would help someone understand the content without seeing it.',
      images: [base64],
      stream: false,
      options: { temperature: 0.1 },
    }),
  });

  if (!response.ok) throw new Error(`Ollama ${model} returned ${response.status}`);
  const data = await response.json() as { response: string };
  return data.response;
}
