import { useState } from 'react';
import { postQuery } from '../api';
import type { FormEvent } from 'react';
import type { QueryResult } from '../api';

function scoreClass(score: number): string {
  if (score > 0.7) return 'score-good';
  if (score >= 0.5) return 'score-mid';
  return 'score-low';
}

export function QueryTester() {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryMs, setQueryMs] = useState<number | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const started = performance.now();
    try {
      const data = await postQuery({ query, top_k: topK });
      setResults(data);
      setQueryMs(Math.round(performance.now() - started));
    } catch (submitError) {
      setResults([]);
      setQueryMs(null);
      setError(submitError instanceof Error ? submitError.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Query Tester</h2>
        {queryMs !== null && <span className="muted">Query time: {queryMs}ms</span>}
      </div>

      <form className="query-form" onSubmit={onSubmit}>
        <input
          type="text"
          className="input"
          placeholder="Enter semantic query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
        />

        <label className="slider-wrap">
          <span>top_k: {topK}</span>
          <input
            type="range"
            min={1}
            max={20}
            value={topK}
            onChange={(event) => setTopK(Number(event.target.value))}
          />
        </label>

        <button type="submit" className="button" disabled={loading || !query.trim()}>
          {loading ? 'Running...' : 'Submit'}
        </button>
      </form>

      {loading && <div className="spinner" aria-label="loading" />}
      {error && <p className="error">API error: {error}</p>}

      <div className="query-results">
        {results.map((result) => {
          const displayScore = result.rerank_score ?? result.score;
          return (
            <article key={result.chunk_id} className="result-card">
              <div className="result-meta">
                <span className={`badge ${scoreClass(displayScore)}`}>score: {displayScore.toFixed(3)}</span>
                <span className="badge badge-source">{result.source}</span>
                {result.graph_boosted && <span className="badge badge-graph">graph_boosted</span>}
                {typeof result.rerank_score === 'number' && (
                  <span className="badge badge-rerank">rerank: {result.rerank_score.toFixed(3)}</span>
                )}
              </div>
              <p>{result.text}</p>
              <small>{result.chunk_id}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}