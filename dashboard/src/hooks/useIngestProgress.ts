import { useEffect, useMemo, useState } from 'react';
import type { IngestProgressEvent } from '../api';

type IngestProgressStatus = 'idle' | 'running' | 'done' | 'error';

export type IngestProgressSnapshot = {
  source: string;
  totalChunks: number;
  processed: number;
  stored: number;
  skipped: number;
  connections: number;
  chunksPerSec: number;
  etaSeconds: number;
};

type HookState = {
  status: IngestProgressStatus;
  progress: IngestProgressSnapshot | null;
  result: Extract<IngestProgressEvent, { type: 'done' }> | null;
  error: string | null;
};

const initialState: HookState = {
  status: 'idle',
  progress: null,
  result: null,
  error: null,
};

export function useIngestProgress(jobId: string | null) {
  const [state, setState] = useState<HookState>(initialState);

  useEffect(() => {
    if (!jobId) {
      setState(initialState);
      return;
    }

    setState({
      status: 'running',
      progress: null,
      result: null,
      error: null,
    });

    const eventSource = new EventSource(`/api/ingest/progress/${encodeURIComponent(jobId)}`);

    eventSource.onmessage = (message) => {
      let event: IngestProgressEvent | null = null;
      try {
        event = JSON.parse(message.data) as IngestProgressEvent;
      } catch {
        return;
      }

      if (!event || event.jobId !== jobId) return;

      if (event.type === 'start') {
        setState((prev) => ({
          ...prev,
          status: 'running',
          progress: {
            source: event.source,
            totalChunks: event.totalChunks,
            processed: 0,
            stored: 0,
            skipped: 0,
            connections: 0,
            chunksPerSec: 0,
            etaSeconds: 0,
          },
        }));
        return;
      }

      if (event.type === 'chunk') {
        setState((prev) => ({
          ...prev,
          status: 'running',
          progress: {
            source: prev.progress?.source ?? '',
            totalChunks: event.total,
            processed: event.processed,
            stored: event.stored,
            skipped: event.skipped,
            connections: event.connections,
            chunksPerSec: event.chunksPerSec,
            etaSeconds: event.etaSeconds,
          },
        }));
        return;
      }

      if (event.type === 'done') {
        setState((prev) => ({
          ...prev,
          status: 'done',
          result: event,
          progress: prev.progress
            ? {
              ...prev.progress,
              processed: prev.progress.totalChunks,
              stored: event.stored,
              skipped: event.skipped,
              connections: event.connections,
              chunksPerSec: prev.progress.chunksPerSec,
              etaSeconds: 0,
            }
            : prev.progress,
        }));
        eventSource.close();
        return;
      }

      if (event.type === 'error') {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: event.message,
        }));
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setState((prev) => (prev.status === 'running'
          ? { ...prev, status: 'error', error: prev.error ?? 'Connection closed before job completion.' }
          : prev));
      }
    };

    return () => {
      eventSource.close();
    };
  }, [jobId]);

  return useMemo(() => ({
    status: state.status,
    progress: state.progress,
    result: state.result,
    error: state.error,
  }), [state.error, state.progress, state.result, state.status]);
}
