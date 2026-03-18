import { useState } from 'react';
import { Concepts } from '../components/Concepts';
import { triggerConceptClustering } from '../api';

export function ConceptsView() {
  const [triggering, setTriggering] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleRecluster = async () => {
    setTriggering(true);
    setMsg(null);
    try {
      await triggerConceptClustering();
      setMsg('Concept clustering triggered. Results appear in ~30s.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Failed to trigger clustering');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem', gap: '0.5rem', alignItems: 'center' }}>
        {msg && <span className="muted" style={{ fontSize: '0.8rem' }}>{msg}</span>}
        <button type="button" className="button" onClick={() => void handleRecluster()} disabled={triggering} style={{ fontSize: '0.8rem' }}>
          {triggering ? 'Triggering…' : 'Re-cluster'}
        </button>
      </div>
      <Concepts />
    </div>
  );
}
