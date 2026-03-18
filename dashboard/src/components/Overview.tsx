import { useCallback, useEffect, useState } from 'react';
import { getStats } from '../api';
import type { StatsResponse } from '../api';

const RELATIONSHIP_COLORS: Record<keyof StatsResponse['relationship_counts'], string> = {
  supports: '#22c55e',
  contradicts: '#ef4444',
  example_of: '#3b82f6',
  caused_by: '#f59e0b',
  related_to: '#6b7280',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function LoadingSkeleton() {
  return (
    <div className="panel">
      <div className="skeleton skeleton-title" />
      <div className="skeleton-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton skeleton-card" />
        ))}
      </div>
      <div className="skeleton skeleton-lg" />
      <div className="skeleton skeleton-lg" />
    </div>
  );
}

export function Overview() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setError(null);
      const data = await getStats();
      setStats(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load overview data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();

    const timer = window.setInterval(() => {
      void loadStats();
    }, 30000);

    return () => window.clearInterval(timer);
  }, [loadStats]);

  if (loading && !stats) {
    return <LoadingSkeleton />;
  }

  if (error && !stats) {
    return (
      <section className="panel">
        <h2>Overview</h2>
        <p className="error">API error: {error}</p>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="panel">
        <h2>Overview</h2>
        <p className="error">No overview data available.</p>
      </section>
    );
  }

  const relationshipEntries = Object.entries(stats.relationship_counts) as Array<[
    keyof StatsResponse['relationship_counts'],
    number,
  ]>;
  const maxRelationshipCount = Math.max(1, ...relationshipEntries.map(([, value]) => value));

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Overview</h2>
        {error && <span className="warning">Refresh issue: {error}</span>}
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <h3>Total Chunks</h3>
          <p>{stats.total_chunks}</p>
        </article>
        <article className="stat-card">
          <h3>Connections</h3>
          <p>{stats.total_connections}</p>
        </article>
        <article className="stat-card">
          <h3>Concepts</h3>
          <p>{stats.total_concepts}</p>
        </article>
        <article className="stat-card">
          <h3>Sources</h3>
          <p>{stats.top_sources.length}</p>
        </article>
      </div>

      <section className="subpanel">
        <h3>Relationship Breakdown</h3>
        <div className="bars">
          {relationshipEntries.map(([relationship, count]) => {
            const width = `${(count / maxRelationshipCount) * 100}%`;
            return (
              <div key={relationship} className="bar-row">
                <span className="bar-label">{relationship}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width, backgroundColor: RELATIONSHIP_COLORS[relationship] }}
                  />
                </div>
                <span className="bar-value">{count}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="subpanel">
        <h3>Recent Activity</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Chunk ID</th>
                <th>Source</th>
                <th>Timestamp</th>
                <th>Access Count</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_chunks.map((chunk) => (
                <tr key={chunk.chunk_id}>
                  <td className="truncate">{chunk.chunk_id}</td>
                  <td>{chunk.source}</td>
                  <td>{formatDate(chunk.timestamp)}</td>
                  <td>{chunk.access_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}