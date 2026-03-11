export type RelationshipCounts = {
  supports: number;
  contradicts: number;
  example_of: number;
  caused_by: number;
  related_to: number;
};

export type StatsResponse = {
  total_chunks: number;
  total_connections: number;
  total_concepts: number;
  relationship_counts: RelationshipCounts;
  top_sources: Array<{ source: string; count: number }>;
  recent_chunks: Array<{
    chunk_id: string;
    source: string;
    timestamp: string;
    access_count: number;
  }>;
};

export type Chunk = {
  chunk_id: string;
  text: string;
  source: string;
  page: number;
  timestamp: string;
  access_count: number;
  last_accessed: string | null;
  tags: string;
  is_duplicate: number;
  contradiction_flag: number;
};

export type GraphNode = {
  id: string;
  text: string;
  source: string;
  access_count: number;
  contradiction_flag: number;
};

export type GraphLink = {
  source: string;
  target: string;
  relationship: keyof RelationshipCounts;
  weight: number;
};

export type GraphResponse = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export type Concept = {
  concept_id: string;
  label: string;
  summary: string;
  member_chunks: string[];
  created_at: string;
  last_updated: string;
};

export type QueryResult = {
  text: string;
  source: string;
  score: number;
  chunk_id: string;
  graph_boosted: boolean;
  rerank_score?: number;
};

export type IngestJobResponse = {
  jobId: string;
};

export type IngestProgressEvent =
  | {
    type: 'start';
    jobId: string;
    source: string;
    totalChunks: number;
  }
  | {
    type: 'chunk';
    jobId: string;
    processed: number;
    total: number;
    stored: number;
    skipped: number;
    connections: number;
    chunksPerSec: number;
    etaSeconds: number;
  }
  | {
    type: 'done';
    jobId: string;
    stored: number;
    skipped: number;
    connections: number;
    elapsedSeconds: number;
  }
  | {
    type: 'error';
    jobId: string;
    message: string;
  };

export type RecentIngest = {
  source: string;
  chunks_stored: number;
  chunks_skipped: number;
  connections_seeded: number;
  timestamp: string;
};

export type DatabaseListResponse = {
  databases: string[];
};

let activeDatabase = 'default';

export function getActiveDatabase(): string {
  return activeDatabase;
}

export function setActiveDatabase(name: string): void {
  const trimmed = name.trim();
  activeDatabase = trimmed || 'default';
}

type ApiError = {
  error?: string;
};

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const data = (await response.json()) as ApiError;
      if (data.error) {
        message = data.error;
      }
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function getStats(): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (activeDatabase) params.set('database', activeDatabase);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<StatsResponse>(`/api/stats${suffix}`);
}

export type GetChunksParams = {
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function getChunks(params: GetChunksParams = {}): Promise<Chunk[]> {
  const query = new URLSearchParams();
  if (activeDatabase) query.set('database', activeDatabase);
  if (params.source) query.set('source', params.source);
  if (params.search) query.set('search', params.search);
  if (typeof params.limit === 'number') query.set('limit', String(params.limit));
  if (typeof params.offset === 'number') query.set('offset', String(params.offset));

  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<Chunk[]>(`/api/chunks${suffix}`);
}

export async function getGraph(): Promise<GraphResponse> {
  const params = new URLSearchParams();
  if (activeDatabase) params.set('database', activeDatabase);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<GraphResponse>(`/api/graph${suffix}`);
}

export async function getConcepts(): Promise<Concept[]> {
  const params = new URLSearchParams();
  if (activeDatabase) params.set('database', activeDatabase);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<Concept[]>(`/api/concepts${suffix}`);
}

export async function postQuery(payload: { query: string; top_k?: number }): Promise<QueryResult[]> {
  const body = {
    ...payload,
    ...(activeDatabase ? { database: activeDatabase } : {}),
  };

  return request<QueryResult[]>('/api/query', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function parseIngestResponse(response: Response): Promise<IngestJobResponse> {
  let payload: IngestJobResponse | ApiError | null = null;

  try {
    payload = await response.json() as IngestJobResponse | ApiError;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload && 'error' in payload && payload.error
      ? payload.error
      : response.statusText || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as IngestJobResponse;
}

export async function ingestFile(file: File, tags: string[]): Promise<IngestJobResponse> {
  const form = new FormData();
  form.append('file', file);
  if (tags.length > 0) {
    form.append('tags', tags.join(','));
  }
  const params = new URLSearchParams();
  if (activeDatabase) params.set('database', activeDatabase);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const response = await fetch(`/api/ingest/file${suffix}`, {
    method: 'POST',
    body: form,
  });

  return parseIngestResponse(response);
}

export async function ingestUrl(url: string, tags: string[]): Promise<IngestJobResponse> {
  const body: { url: string; tags: string[]; database?: string } = { url, tags };
  if (activeDatabase) body.database = activeDatabase;

  const response = await fetch('/api/ingest/url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return parseIngestResponse(response);
}

export async function getRecentIngests(limit: number = 5): Promise<RecentIngest[]> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (activeDatabase) query.set('database', activeDatabase);
  return request<RecentIngest[]>(`/api/ingests/recent?${query.toString()}`);
}

export async function getDatabases(): Promise<string[]> {
  const response = await request<DatabaseListResponse>('/api/db/list');
  return response.databases;
}

export async function createDatabase(name: string, description?: string): Promise<void> {
  await request<unknown>('/api/db/create', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteDatabase(name: string): Promise<void> {
  await request<unknown>('/api/db/delete', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}