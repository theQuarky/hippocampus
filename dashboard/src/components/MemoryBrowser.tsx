import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getChunks, getStats } from '../api';
import type { Chunk } from '../api';

const PAGE_SIZE = 50;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

export function MemoryBrowser() {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const stats = await getStats();
      setSourceOptions(stats.top_sources.map((item) => item.source));
    } catch {
      setSourceOptions([]);
    }
  }, []);

  const loadChunks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getChunks({
        source: sourceFilter || undefined,
        search: searchText || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setChunks(data);

      setSourceOptions((previous) => {
        const discovered = new Set(previous);
        for (const chunk of data) {
          discovered.add(chunk.source);
        }
        return Array.from(discovered).sort((a, b) => a.localeCompare(b));
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load chunks');
      setChunks([]);
    } finally {
      setLoading(false);
    }
  }, [page, searchText, sourceFilter]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    void loadChunks();
  }, [loadChunks]);

  const tagsByChunk = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const chunk of chunks) {
      map.set(chunk.chunk_id, parseTags(chunk.tags));
    }
    return map;
  }, [chunks]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Memory Browser</h2>
      </div>

      <div className="toolbar">
        <input
          type="text"
          className="input"
          value={searchText}
          onChange={(event) => {
            setPage(0);
            setSearchText(event.target.value);
          }}
          placeholder="Search chunk text"
        />

        <select
          className="select"
          value={sourceFilter}
          onChange={(event) => {
            setPage(0);
            setSourceFilter(event.target.value);
          }}
        >
          <option value="">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="error">API error: {error}</p>}

      {loading ? (
        <div className="skeleton skeleton-lg" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Text Preview</th>
                <th>Timestamp</th>
                <th>Access Count</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {chunks.map((chunk) => {
                const isExpanded = expandedRow === chunk.chunk_id;
                const tags = tagsByChunk.get(chunk.chunk_id) ?? [];

                return (
                  <Fragment key={chunk.chunk_id}>
                    <tr
                      className={`clickable ${chunk.contradiction_flag === 1 ? 'row-danger' : ''}`}
                      onClick={() => {
                        setExpandedRow((current) => (current === chunk.chunk_id ? null : chunk.chunk_id));
                      }}
                    >
                      <td>{chunk.source}</td>
                      <td>{chunk.text.slice(0, 100)}</td>
                      <td>{formatDate(chunk.timestamp)}</td>
                      <td>{chunk.access_count}</td>
                      <td>{tags.join(', ') || '—'}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan={5}>{chunk.text}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {chunks.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No chunks found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button
          type="button"
          className="button"
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          disabled={page === 0 || loading}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          type="button"
          className="button"
          onClick={() => setPage((current) => current + 1)}
          disabled={loading || chunks.length < PAGE_SIZE}
        >
          Next
        </button>
      </div>
    </section>
  );
}