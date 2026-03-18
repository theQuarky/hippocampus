import React from 'react';

const btnPrimary: React.CSSProperties = {
  background: '#6366f1',
  color: 'white',
  border: 'none',
  borderRadius: 8,
  padding: '12px 32px',
  fontSize: 15,
  cursor: 'pointer',
  fontWeight: 500,
  transition: 'opacity 0.15s',
};

export function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ padding: '48px 40px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16, lineHeight: 1 }}>🧠</div>
      <h1 style={{ fontSize: 28, fontWeight: 600, margin: '0 0 8px', color: '#f1f5f9' }}>
        Hippocampus
      </h1>
      <p style={{ color: '#94a3b8', fontSize: 15, margin: '0 0 8px' }}>
        Local AI Memory System
      </p>
      <p style={{
        color: '#64748b', fontSize: 13, margin: '0 0 40px',
        lineHeight: 1.7, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto',
      }}>
        Like Google NotebookLM, but private, offline, and open source.
        Ingest documents, audio, images, and video — then query your
        personal knowledge base using natural language.
      </p>

      <button onClick={onNext} style={btnPrimary}>
        Get Started →
      </button>

      <p style={{ color: '#475569', fontSize: 12, marginTop: 24, lineHeight: 1.6 }}>
        This installer will download Qdrant, Ollama, and AI models (~4 GB).<br />
        Everything runs locally — nothing leaves your machine.
      </p>
    </div>
  );
}
