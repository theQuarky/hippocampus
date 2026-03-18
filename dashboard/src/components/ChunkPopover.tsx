import { useEffect, useRef } from 'react';

type ChunkPopoverProps = {
  chunkId: string;
  text: string;
  source: string;
  score?: number;
  onClose: () => void;
};

export function ChunkPopover({ chunkId, text, source, score, onClose }: ChunkPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  return (
    <div className="modal-overlay" style={{ zIndex: 50 }}>
      <div ref={ref} className="modal" style={{ maxWidth: 520 }}>
        <div className="panel-header">
          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--muted)' }}>{chunkId.slice(0, 16)}…</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.6rem' }}>
          {source} {score !== undefined && <span style={{ marginLeft: '0.5rem' }}>· score {score.toFixed(3)}</span>}
        </p>
        <p style={{ lineHeight: 1.6, fontSize: '0.9rem' }}>{text}</p>
      </div>
    </div>
  );
}
