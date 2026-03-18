import { useMemo } from 'react';
import { useIngestProgress } from '../hooks/useIngestProgress';

type ProgressCardProps = {
  jobId: string;
  source: string;
  filter: 'all' | 'active' | 'completed';
  onDismiss: (jobId: string) => void;
};

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;

  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0';
  return value.toFixed(1);
}

export function ProgressCard({ jobId, source, filter, onDismiss }: ProgressCardProps) {
  const { status, progress, result, error } = useIngestProgress(jobId);
  const isCompleted = status === 'done' || status === 'error';

  if (filter === 'active' && isCompleted) {
    return null;
  }

  if (filter === 'completed' && !isCompleted) {
    return null;
  }

  const percent = useMemo(() => {
    if (!progress || progress.totalChunks <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((progress.processed / progress.totalChunks) * 100)));
  }, [progress]);

  const cardSource = progress?.source || source;
  const isPreparingChunks = (progress?.totalChunks ?? 0) === 0;

  if (status === 'done' && result) {
    return (
      <article className="progress-card">
        <button
          type="button"
          className="progress-dismiss"
          onClick={() => onDismiss(jobId)}
          aria-label="Dismiss completed ingest"
        >
          ✕
        </button>

        <h3>✅ Ingestion complete</h3>
        <p className="muted">{cardSource} ingested in {formatDuration(result.elapsedSeconds)}</p>
        <p>{result.stored} chunks stored · {result.skipped} duplicates</p>
        <p>{result.connections} connections seeded</p>

        <button type="button" className="button" onClick={() => onDismiss(jobId)}>
          Ingest Another
        </button>
      </article>
    );
  }

  if (status === 'error') {
    return (
      <article className="progress-card progress-card-error">
        <button
          type="button"
          className="progress-dismiss"
          onClick={() => onDismiss(jobId)}
          aria-label="Dismiss failed ingest"
        >
          ✕
        </button>

        <h3>❌ Ingestion failed</h3>
        <p className="muted">{cardSource}</p>
        <p className="error">{error ?? 'Unknown ingest error'}</p>
      </article>
    );
  }

  return (
    <article className="progress-card">
      <button
        type="button"
        className="progress-dismiss"
        onClick={() => onDismiss(jobId)}
        aria-label="Dismiss ingest"
      >
        ✕
      </button>

      <h3>📥 Ingesting: {cardSource}</h3>

      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div
          className="progress-fill"
          style={{ width: `${percent}%`, transition: 'width 0.3s ease', background: '#7c6af7' }}
        />
      </div>

      <p>{percent}%</p>
      <p className="muted">
        {isPreparingChunks
          ? 'Preparing chunks...'
          : `${progress?.processed ?? 0} / ${progress?.totalChunks ?? 0} chunks`}
      </p>

      <p className="muted">
        {isPreparingChunks
          ? 'Waiting for chunk plan...'
          : `${formatRate(progress?.chunksPerSec ?? 0)} chunks/sec  ·  ETA ${formatDuration(progress?.etaSeconds ?? 0)}`}
      </p>

      <p>
        ✓ {progress?.stored ?? 0} stored &nbsp; ⊘ {progress?.skipped ?? 0} dupes &nbsp; ⟳ {progress?.connections ?? 0} conns
      </p>
    </article>
  );
}
