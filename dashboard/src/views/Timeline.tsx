import { useCallback, useEffect, useState } from 'react';
import { getIngestEvents } from '../api';
import type { IngestEvent } from '../api';
import { MiniSparkline } from '../components/MiniSparkline';
import { TypeBadge } from '../components/TypeBadge';

type TimeRange = '24h' | '7d' | '30d' | 'all';

function sinceMs(range: TimeRange): number {
  const now = Date.now();
  if (range === '24h') return now - 24 * 60 * 60 * 1000;
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000;
  if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function groupByDate(events: IngestEvent[]): Array<{ dateLabel: string; events: IngestEvent[] }> {
  const groups = new Map<string, IngestEvent[]>();
  for (const ev of events) {
    const d = new Date(ev.timestamp);
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(ev);
  }
  return Array.from(groups.entries()).map(([dateLabel, evs]) => ({ dateLabel, events: evs }));
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function Timeline() {
  const [events, setEvents] = useState<IngestEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>('7d');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = sinceMs(range);
      const data = await getIngestEvents({ limit: 200, since: since || undefined });
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const grouped = groupByDate(events);

  // Sparkline data: chunks per event (last 20)
  const sparkChunks = events.slice(0, 20).reverse().map(e => e.chunks_stored);
  const sparkConns = events.slice(0, 20).reverse().map(e => e.connections_seeded);
  const totalChunks = events.reduce((s, e) => s + e.chunks_stored, 0);
  const totalConns = events.reduce((s, e) => s + e.connections_seeded, 0);

  const handleExport = () => {
    const rows = ['timestamp,source,chunks_stored,chunks_skipped,connections_seeded',
      ...events.map(e => `${e.timestamp},${JSON.stringify(e.source)},${e.chunks_stored},${e.chunks_skipped},${e.connections_seeded}`)
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'timeline.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const ranges: TimeRange[] = ['24h', '7d', '30d', 'all'];

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Timeline</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {ranges.map(r => (
            <button key={r} type="button"
              className={`nav-item${range === r ? ' active' : ''}`}
              onClick={() => setRange(r)}
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.75rem', minWidth: 'unset' }}
            >
              {r}
            </button>
          ))}
          <button type="button" className="button" onClick={handleExport} style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}>export</button>
        </div>
      </div>

      {/* Mini charts */}
      {sparkChunks.length > 1 && (
        <div style={{ display: 'flex', gap: '2rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <MiniSparkline data={sparkChunks} width={80} height={24} color="#6366f1" />
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700 }}>{totalChunks}</p>
              <p className="muted" style={{ fontSize: '0.72rem' }}>total chunks</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <MiniSparkline data={sparkConns} width={80} height={24} color="#22c55e" />
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700 }}>{totalConns}</p>
              <p className="muted" style={{ fontSize: '0.72rem' }}>total connections</p>
            </div>
          </div>
        </div>
      )}

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && events.length === 0 && (
        <p className="empty-state">no ingest events in this time range</p>
      )}

      {grouped.map(({ dateLabel, events: dayEvents }) => (
        <div key={dateLabel} style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.35rem' }}>
            {dateLabel}
          </p>
          {dayEvents.map(ev => (
            <div key={ev.event_id} style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto auto', gap: '0.6rem', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.83rem' }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--muted)', fontSize: '0.75rem' }}>{formatTime(ev.timestamp)}</span>
              <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ev.source}>
                <TypeBadge type={ev.source} isSource />
                {' '}{ev.source}
              </span>
              <span style={{ fontFamily: 'monospace', color: '#6366f1' }}>{ev.chunks_stored} chunks</span>
              <span style={{ fontFamily: 'monospace', color: '#22c55e' }}>{ev.connections_seeded} conns</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
