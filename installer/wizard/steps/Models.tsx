import React from 'react';
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

interface ModelDef {
  key: 'phi3' | 'moondream';
  name: string;
  size: string;
  sizeGb: number;
  required: boolean;
  desc: string;
}

const MODELS: ModelDef[] = [
  {
    key: 'phi3',
    name: 'phi3:mini',
    size: '2.3 GB',
    sizeGb: 2.3,
    required: true,
    desc: 'Core language model for Q&A, consolidation, and audio overview generation',
  },
  {
    key: 'moondream',
    name: 'moondream',
    size: '1.7 GB',
    sizeGb: 1.7,
    required: false,
    desc: 'Vision model for describing images and video keyframes',
  },
];

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  onNext: () => void;
  onBack: () => void;
}

export function Models({ state, setState, onNext, onBack }: Props) {
  const toggle = (key: 'phi3' | 'moondream') => {
    if (key === 'phi3') return; // required
    setState(s => ({ ...s, models: { ...s.models, [key]: !s.models[key] } }));
  };

  const totalGb = MODELS
    .filter(m => state.models[m.key])
    .reduce((sum, m) => sum + m.sizeGb, 0)
    .toFixed(1);

  return (
    <div style={{ padding: '40px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#f1f5f9' }}>
        AI Models
      </h2>
      <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
        Select which models to download. These run entirely on your machine — no internet
        required after setup.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {MODELS.map(model => (
          <div
            key={model.key}
            onClick={() => toggle(model.key)}
            style={{
              background: '#1a1d24',
              border: `1px solid ${state.models[model.key] ? '#6366f1' : '#2a2d36'}`,
              borderRadius: 8,
              padding: '16px',
              cursor: model.required ? 'default' : 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 4,
                  background: state.models[model.key] ? '#6366f1' : '#2a2d36',
                  border: `1px solid ${state.models[model.key] ? '#6366f1' : '#475569'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: 'white', flexShrink: 0,
                }}>
                  {state.models[model.key] ? '✓' : ''}
                </div>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{model.name}</span>
              </div>
              <span style={{ color: '#64748b', fontSize: 13 }}>{model.size}</span>
            </div>
            <div style={{ color: '#64748b', fontSize: 12, paddingLeft: 24 }}>{model.desc}</div>
            {model.required && (
              <div style={{ color: '#6366f1', fontSize: 11, marginTop: 4, paddingLeft: 24 }}>
                Required
              </div>
            )}
          </div>
        ))}
      </div>

      <p style={{ color: '#475569', fontSize: 13, marginBottom: 32 }}>
        Total download: ~{totalGb} GB
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <button onClick={onBack} style={btnSecondary}>← Back</button>
        <button onClick={onNext} style={btnPrimary}>Install →</button>
      </div>
    </div>
  );
}
