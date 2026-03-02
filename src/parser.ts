// src/parser.ts
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';

const HTML_PRUNE_SELECTORS = ['script', 'style', 'nav', 'footer', 'header'];
const URL_PRUNE_SELECTORS = ['script', 'style', 'nav', 'footer', 'header', 'aside'];
const CONTENT_BLOCK_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre';

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function removeBoilerplateByClassOrId($: any): void {
  const boilerplatePattern = /(^|[\s_-])(ad|ads|banner|cookie)([\s_-]|$)/i;

  $('*').each((_: any, element: any) => {
    const className = ($(element).attr('class') || '').toLowerCase();
    const id = ($(element).attr('id') || '').toLowerCase();
    const value = `${className} ${id}`.trim();

    if (value && boilerplatePattern.test(value)) {
      $(element).remove();
    }
  });
}

function extractTextWithParagraphBreaks($: any, root: any): string {
  const blocks = root.find(CONTENT_BLOCK_SELECTORS).toArray();

  if (blocks.length === 0) {
    return normalizeText(root.text());
  }

  const paragraphs = blocks
    .map((element: any) => normalizeText($(element).text()))
    .filter(Boolean);

  return paragraphs.join('\n\n').trim();
}

function parseHtmlString(html: string): string {
  const $ = cheerio.load(html);
  HTML_PRUNE_SELECTORS.forEach(selector => $(selector).remove());

  const body = $('body');
  const root = body.length > 0 ? body : $.root();

  return extractTextWithParagraphBreaks($, root);
}
function cleanPdfText(text: string): string {
  return text
    // Join lines that are broken mid-sentence (no punctuation at line end)
    .replace(/([a-z,])\n([a-z])/g, '$1 $2')
    // Normalize multiple newlines to double newline (paragraph break)
    .replace(/\n{3,}/g, '\n\n')
    // Remove hyphenation artifacts: "neuro-\nscience" → "neuroscience"
    .replace(/-\n([a-z])/g, '$1')
    .trim();
}
export async function parseUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Hippocampus/1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL (${response.status} ${response.statusText})`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';

    if (contentType.includes('application/pdf')) {
      const pdfBuffer = Buffer.from(await response.arrayBuffer());
      const data = await pdfParse(pdfBuffer);
      return cleanPdfText(data.text);
    }

    if (contentType.includes('text/html')) {
      const html = await response.text();
      const $ = cheerio.load(html);

      URL_PRUNE_SELECTORS.forEach(selector => $(selector).remove());
      removeBoilerplateByClassOrId($);

      const title = normalizeText($('title').first().text());
      const metaDescription = normalizeText(
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''
      );

      const mainCandidate = $('main, article, [role="main"]').first();
      const contentRoot = mainCandidate.length > 0 ? mainCandidate : ($('body').length > 0 ? $('body') : $.root());
      const mainContent = extractTextWithParagraphBreaks($, contentRoot);

      const parts = [
        title ? `# ${title}` : '',
        metaDescription,
        mainContent,
      ].filter(Boolean);

      return parts.join('\n\n').trim();
    }

    throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after 10 seconds: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function parseFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.txt':
    case '.md':
      return fs.readFileSync(filePath, 'utf-8');

    case '.html': {
      const html = fs.readFileSync(filePath, 'utf-8');
      return parseHtmlString(html);
    }

    case '.pdf': {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return cleanPdfText(data.text);
    }

    case '.docx': {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}