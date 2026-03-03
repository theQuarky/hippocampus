"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUrl = parseUrl;
exports.parseFile = parseFile;
// src/parser.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
const cheerio = __importStar(require("cheerio"));
const HTML_PRUNE_SELECTORS = ['script', 'style', 'nav', 'footer', 'header'];
const URL_PRUNE_SELECTORS = ['script', 'style', 'nav', 'footer', 'header', 'aside'];
const CONTENT_BLOCK_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre';
function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function removeBoilerplateByClassOrId($) {
    const boilerplatePattern = /(^|[\s_-])(ad|ads|banner|cookie)([\s_-]|$)/i;
    $('*').each((_, element) => {
        const className = ($(element).attr('class') || '').toLowerCase();
        const id = ($(element).attr('id') || '').toLowerCase();
        const value = `${className} ${id}`.trim();
        if (value && boilerplatePattern.test(value)) {
            $(element).remove();
        }
    });
}
function extractTextWithParagraphBreaks($, root) {
    const blocks = root.find(CONTENT_BLOCK_SELECTORS).toArray();
    if (blocks.length === 0) {
        return normalizeText(root.text());
    }
    const paragraphs = blocks
        .map((element) => normalizeText($(element).text()))
        .filter(Boolean);
    return paragraphs.join('\n\n').trim();
}
function parseHtmlString(html) {
    const $ = cheerio.load(html);
    HTML_PRUNE_SELECTORS.forEach(selector => $(selector).remove());
    const body = $('body');
    const root = body.length > 0 ? body : $.root();
    return extractTextWithParagraphBreaks($, root);
}
function cleanPdfText(text) {
    return text
        // Join lines that are broken mid-sentence (no punctuation at line end)
        .replace(/([a-z,])\n([a-z])/g, '$1 $2')
        // Normalize multiple newlines to double newline (paragraph break)
        .replace(/\n{3,}/g, '\n\n')
        // Remove hyphenation artifacts: "neuro-\nscience" → "neuroscience"
        .replace(/-\n([a-z])/g, '$1')
        .trim();
}
async function parseUrl(url) {
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
            const data = await (0, pdf_parse_1.default)(pdfBuffer);
            return cleanPdfText(data.text);
        }
        if (contentType.includes('text/html')) {
            const html = await response.text();
            const $ = cheerio.load(html);
            URL_PRUNE_SELECTORS.forEach(selector => $(selector).remove());
            removeBoilerplateByClassOrId($);
            const title = normalizeText($('title').first().text());
            const metaDescription = normalizeText($('meta[name="description"]').attr('content') ||
                $('meta[property="og:description"]').attr('content') ||
                '');
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
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Request timed out after 10 seconds: ${url}`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function parseFile(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    switch (ext) {
        case '.txt':
        case '.md':
            return fs_1.default.readFileSync(filePath, 'utf-8');
        case '.html': {
            const html = fs_1.default.readFileSync(filePath, 'utf-8');
            return parseHtmlString(html);
        }
        case '.pdf': {
            const buffer = fs_1.default.readFileSync(filePath);
            const data = await (0, pdf_parse_1.default)(buffer);
            return cleanPdfText(data.text);
        }
        case '.docx': {
            const result = await mammoth_1.default.extractRawText({ path: filePath });
            return result.value;
        }
        default:
            throw new Error(`Unsupported file type: ${ext}`);
    }
}
