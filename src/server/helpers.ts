// src/server/helpers.ts — Shared types, constants, and utility functions for server
import path from 'path';
import os from 'os';
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import { v4 as uuidv4 } from 'uuid';
import Busboy from 'busboy';

// ── Types ──────────────────────────────────────────────────────────────────

export type SimilarChunkHit = {
  score?: number;
  payload?: {
    chunk_id?: string;
  };
};

export type IngestRequest = {
  source?: string;
  text?: string;
  tags?: string[];
};

export type IngestResponse = {
  success: boolean;
  chunks_stored: number;
  chunks_skipped: number;
  connections_seeded: number;
  error: string;
};

export type IngestJobResponse = {
  jobId: string;
};

export type MultipartUpload = {
  tempFilePath: string;
  originalFileName: string;
  tags: string[];
};

export type QueryRequest = {
  query?: string;
  top_k?: number;
  max_hops?: number;
  relationship_filter?: string[];
  include_conflicts?: boolean;
};

export type QueryResponse = {
  results: Array<{
    text: string;
    source: string;
    score: number;
    chunk_id: string;
    graph_boosted: boolean;
    path: string[];
    conflicts: string[];
  }>;
};

export type HealthResponse = {
  status: string;
  total_chunks: number;
  total_connections: number;
  collections: number;
  service_version: string;
};

export type RelationshipCounts = {
  supports: number;
  contradicts: number;
  example_of: number;
  caused_by: number;
  related_to: number;
};

// ── Constants ──────────────────────────────────────────────────────────────

export const HOST = '0.0.0.0';
export const DEFAULT_PORT = '50051';
export const DEFAULT_HTTP_PORT = '3001';
export const DUPLICATE_THRESHOLD = 0.97;

export const BASE_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Utility functions ──────────────────────────────────────────────────────

export function setCorsHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(BASE_CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString();
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

export function parseTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  if (typeof rawTags === 'string') {
    return rawTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

export async function parseMultipartUpload(req: IncomingMessage): Promise<MultipartUpload> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      reject(new Error('Expected multipart/form-data request.'));
      return;
    }

    const busboy = Busboy({ headers: req.headers });
    let tempFilePath = '';
    let originalFileName = '';
    let tags: string[] = [];
    let fileWritePromise: Promise<void> | null = null;

    busboy.on('field', (fieldName, value) => {
      if (fieldName !== 'tags') return;
      tags = parseTags(value);
    });

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'file') {
        file.resume();
        return;
      }

      originalFileName = info.filename?.trim() || 'upload';
      const extension = path.extname(originalFileName) || '.tmp';
      tempFilePath = path.join(os.tmpdir(), `hippocampus-upload-${Date.now()}-${uuidv4()}${extension}`);

      const output = fs.createWriteStream(tempFilePath);
      file.pipe(output);

      fileWritePromise = new Promise((writeResolve, writeReject) => {
        output.on('finish', () => writeResolve());
        output.on('error', writeReject);
        file.on('error', writeReject);
      });
    });

    busboy.on('error', reject);

    busboy.on('finish', async () => {
      if (!tempFilePath || !fileWritePromise) {
        reject(new Error('No file uploaded.'));
        return;
      }

      try {
        await fileWritePromise;
        resolve({ tempFilePath, originalFileName, tags });
      } catch (error) {
        reject(error);
      }
    });

    req.pipe(busboy);
  });
}
