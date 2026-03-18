import React from 'react';

export function Done() {
  return (
    <div style={{ padding: '48px 40px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16, lineHeight: 1 }}>🎉</div>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8, color: '#f1f5f9' }}>
        You're all set!
      </h2>
      <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
        Hippocampus is running. The dashboard is opening in your browser.
      </p>

      <button
        onClick={() => window.hippocampus.openDashboard()}
        style={{
          background: '#6366f1',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '12px 32px',
          fontSize: 15,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Open Dashboard
      </button>

      <div style={{
        marginTop: 40,
        color: '#475569',
        fontSize: 12,
        lineHeight: 2,
        borderTop: '1px solid #1a1d24',
        paddingTop: 24,
      }}>
        <div>Hippocampus runs in your system tray</div>
        <div>
          CLI:{' '}
          <code style={{ color: '#94a3b8', background: '#1a1d24', padding: '2px 6px', borderRadius: 4 }}>
            hippocampus ingest /path/to/file.pdf
          </code>
        </div>
        <div>
          Dashboard:{' '}
          <code style={{ color: '#94a3b8', background: '#1a1d24', padding: '2px 6px', borderRadius: 4 }}>
            http://localhost:3001
          </code>
        </div>
      </div>
    </div>
  );
}
