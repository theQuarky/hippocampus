import { useState } from 'react';

type Format = 'monologue' | 'dialogue' | 'interview';

interface Segment { speaker: string; text: string; }

interface OverviewResult {
  audioUrl: string;
  format: Format;
  duration: number;
  script: Segment[];
  engine: string;
  title: string;
  wordCount: number;
}

export function AudioOverviewPanel({ query }: { query: string }) {
  const [format, setFormat] = useState<Format>('monologue');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showScript, setShowScript] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, format }),
      });
      const data = await res.json() as OverviewResult | { error: string };
      if (!res.ok) throw new Error((data as { error: string }).error);
      setResult(data as OverviewResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate overview');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: '0.75rem', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Audio Overview</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['monologue', 'dialogue', 'interview'] as Format[]).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={`nav-item${format === f ? ' active' : ''}`}
              style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', minWidth: 'unset' }}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button"
          onClick={() => void generate()}
          disabled={loading}
          style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
        >
          {loading ? 'Generating…' : '▶ Generate'}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: '0.8rem', color: 'rgba(239,68,68,0.9)', margin: '0.4rem 0' }}>{error}</p>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <audio
            controls
            src={result.audioUrl}
            style={{ width: '100%', height: '36px', accentColor: 'var(--accent)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
            <span>{Math.round(result.duration)}s</span>
            <span>{result.engine}</span>
            <span>{result.wordCount} words</span>
            <button
              type="button"
              onClick={() => setShowScript(s => !s)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.72rem', padding: 0 }}
            >
              {showScript ? 'hide transcript' : 'show transcript'}
            </button>
          </div>
          {showScript && (
            <div style={{ maxHeight: '12rem', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '0.4rem', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {result.script.map((seg, i) => (
                <div key={i} style={{ fontSize: '0.78rem' }}>
                  <span style={{ color: 'var(--accent)', fontFamily: 'monospace', marginRight: '0.4rem' }}>{seg.speaker}:</span>
                  <span style={{ color: 'var(--text)' }}>{seg.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
