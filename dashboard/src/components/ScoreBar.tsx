type ScoreBarProps = {
  score: number;
  max?: number;
  width?: number;
};

export function ScoreBar({ score, max = 1, width = 80 }: ScoreBarProps) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const color = score >= 0.7 ? '#22c55e' : score >= 0.5 ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ display: 'inline-block', width, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 999, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--muted)' }}>{score.toFixed(3)}</span>
    </span>
  );
}
