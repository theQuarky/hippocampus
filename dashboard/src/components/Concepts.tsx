import { useCallback, useEffect, useState } from 'react';
import { getConcepts } from '../api';
import type { Concept } from '../api';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function Concepts() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Concept | null>(null);

  const loadConcepts = useCallback(async () => {
    try {
      setError(null);
      const data = await getConcepts();
      setConcepts(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load concepts');
      setConcepts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConcepts();
  }, [loadConcepts]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Concepts</h2>
      </div>

      {error && <p className="error">API error: {error}</p>}

      {loading ? (
        <div className="skeleton skeleton-lg" />
      ) : (
        <div className="concept-grid">
          {concepts.map((concept) => (
            <article key={concept.concept_id} className="concept-card" onClick={() => setSelected(concept)}>
              <h3>{concept.label}</h3>
              <p>{concept.summary}</p>
              <div className="concept-meta">Built from {concept.member_chunks.length} chunks</div>
              <div className="concept-meta">Created: {formatDate(concept.created_at)}</div>
            </article>
          ))}
          {concepts.length === 0 && <div className="empty-state">No concepts available.</div>}
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h3>{selected.label}</h3>
              <button type="button" className="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <p>{selected.summary}</p>
            <h4>Member Chunk IDs</h4>
            <ul className="member-list">
              {selected.member_chunks.map((chunkId) => (
                <li key={chunkId}>{chunkId}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}