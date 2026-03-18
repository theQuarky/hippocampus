import { Fragment, useCallback, useEffect, useState } from 'react';
import { getSources, getChunks } from '../api';
import type { SourceSummary, Chunk } from '../api';
import { TypeBadge } from '../components/TypeBadge';

type SortKey = 'source' | 'chunk_count' | 'connection_count' | 'last_ingested';
type FilterType = 'all' | 'pdf' | 'md' | 'audio' | 'image' | 'video' | 'url';

function relTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function getType(source: string): string {
  const ext = source.split('.').pop()?.toLowerCase() ?? '';
  if (['mp3','wav','flac','m4a','ogg','opus'].includes(ext)) return 'audio';
  if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) return 'image';
  if (['mp4','mkv','avi','mov','m4v'].includes(ext)) return 'video';
  if (source.startsWith('http')) return 'url';
  return ext || 'txt';
}

function matchesFilter(source: string, filter: FilterType): boolean {
  if (filter === 'all') return true;
  return getType(source) === filter;
}

export function Library() {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('last_ingested');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [expandedChunks, setExpandedChunks] = useState<Chunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSources();
      setSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sorted = [...sources]
    .filter(s => matchesFilter(s.source, filter))
    .sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'source') cmp = a.source.localeCompare(b.source);
      else if (sortKey === 'chunk_count') cmp = a.chunk_count - b.chunk_count;
      else if (sortKey === 'connection_count') cmp = a.connection_count - b.connection_count;
      else cmp = new Date(a.last_ingested).getTime() - new Date(b.last_ingested).getTime();
      return sortAsc ? cmp : -cmp;
    });

  const handleRowClick = async (source: string) => {
    if (expandedSource === source) { setExpandedSource(null); setExpandedChunks([]); return; }
    setExpandedSource(source);
    setLoadingChunks(true);
    try {
      const chunks = await getChunks({ source, limit: 3 });
      setExpandedChunks(chunks);
    } catch { setExpandedChunks([]); }
    finally { setLoadingChunks(false); }
  };

  const sortArrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  const filterTypes: FilterType[] = ['all', 'pdf', 'md', 'audio', 'image', 'video', 'url'];

  const totals = sources.reduce((acc, s) => ({
    chunks: acc.chunks + s.chunk_count,
    connections: acc.connections + s.connection_count,
  }), { chunks: 0, connections: 0 });

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Library</h2>
        <a href="/ingest" style={{ color: 'var(--accent)', fontSize: '0.8rem', textDecoration: 'none' }}>+ Ingest file</a>
      </div>

      <div className="toolbar" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {filterTypes.map(t => (
          <button key={t} type="button"
            className={`nav-item${filter === t ? ' active' : ''}`}
            onClick={() => setFilter(t)}
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', minWidth: 'unset' }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('source')} style={{ cursor: 'pointer' }}>SOURCE{sortArrow('source')}</th>
                  <th style={{ width: 70 }}>TYPE</th>
                  <th onClick={() => toggleSort('chunk_count')} style={{ cursor: 'pointer', width: 80 }}>CHUNKS{sortArrow('chunk_count')}</th>
                  <th onClick={() => toggleSort('connection_count')} style={{ cursor: 'pointer', width: 100 }}>CONNECTIONS{sortArrow('connection_count')}</th>
                  <th onClick={() => toggleSort('last_ingested')} style={{ cursor: 'pointer', width: 100 }}>INGESTED{sortArrow('last_ingested')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => (
                  <Fragment key={row.source}>
                    <tr
                      onClick={() => void handleRowClick(row.source)}
                      style={{ cursor: 'pointer', background: expandedSource === row.source ? 'rgba(255,255,255,0.04)' : undefined }}
                    >
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{row.source}</td>
                      <td><TypeBadge type={row.source} isSource /></td>
                      <td style={{ fontFamily: 'monospace', textAlign: 'right' }}>{row.chunk_count}</td>
                      <td style={{ fontFamily: 'monospace', textAlign: 'right' }}>{row.connection_count}</td>
                      <td style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{relTime(row.last_ingested)}</td>
                    </tr>
                    {expandedSource === row.source && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)' }}>
                          {loadingChunks ? (
                            <p className="muted" style={{ fontSize: '0.8rem' }}>Loading chunks…</p>
                          ) : expandedChunks.length === 0 ? (
                            <p className="muted" style={{ fontSize: '0.8rem' }}>No chunks found</p>
                          ) : (
                            expandedChunks.map(chunk => (
                              <div key={chunk.chunk_id} style={{ marginBottom: '0.5rem', padding: '0.4rem', border: '1px solid var(--border)', borderRadius: '0.4rem', fontSize: '0.82rem' }}>
                                <span className="muted" style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{chunk.chunk_id.slice(0,12)}… </span>
                                {chunk.text.slice(0, 180)}{chunk.text.length > 180 ? '…' : ''}
                              </div>
                            ))
                          )}
                          <button type="button" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger-border)', cursor: 'pointer', borderRadius: '0.4rem', padding: '0.25rem 0.6rem', fontSize: '0.75rem', marginTop: '0.4rem' }}>
                            Delete source (not yet implemented)
                          </button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
            {sorted.length} sources · {totals.chunks} chunks · {totals.connections} connections
          </p>
        </>
      )}
      {!loading && !error && sorted.length === 0 && (
        <p className="empty-state">No sources ingested yet. <a href="/ingest" style={{ color: 'var(--accent)' }}>Ingest a file.</a></p>
      )}
    </section>
  );
}
