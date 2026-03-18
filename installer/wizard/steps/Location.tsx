import React, { useEffect } from 'react';
import type { WizardState } from '../App';

const btnPrimary: React.CSSProperties = {
  background: '#6366f1', color: 'white', border: 'none',
  borderRadius: 8, padding: '10px 24px', fontSize: 14,
  cursor: 'pointer', fontWeight: 500,
};

const btnSecondary: React.CSSProperties = {
  background: 'transparent', color: '#94a3b8',
  border: '1px solid #2a2d36', borderRadius: 8,
  padding: '10px 20px', fontSize: 14, cursor: 'pointer',
};

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onNext: () => void;
  onBack: () => void;
}

export function Location({ state, setState, onNext, onBack }: Props) {
  useEffect(() => {
    if (!state.dataDir) {
      window.hippocampus.getDefaultDir().then((dir: string) => {
        setState(s => ({ ...s, dataDir: dir }));
      });
    }
  }, []);

  async function browse() {
    const dir = await window.hippocampus.pickDirectory();
    if (dir) setState(s => ({ ...s, dataDir: dir }));
  }

  return (
    <div style={{ padding: '40px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#f1f5f9' }}>
        Install Location
      </h2>
      <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
        Choose where Hippocampus will store its data (documents, models, database).
        You'll need at least 10 GB of free space.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={state.dataDir}
          onChange={e => setState(s => ({ ...s, dataDir: e.target.value }))}
          placeholder="/home/you/hippocampus"
          style={{
            flex: 1, background: '#1a1d24', border: '1px solid #2a2d36',
            borderRadius: 6, padding: '9px 12px', color: '#e2e8f0',
            fontSize: 13, fontFamily: 'ui-monospace, monospace', outline: 'none',
          }}
        />
        <button onClick={browse} style={btnSecondary}>
          Browse
        </button>
      </div>

      <p style={{ color: '#475569', fontSize: 12, marginBottom: 40 }}>
        The folder will be created if it doesn't exist.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
        <button
          onClick={onNext}
          style={{ ...btnPrimary, opacity: state.dataDir ? 1 : 0.5 }}
          disabled={!state.dataDir}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
