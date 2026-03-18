import { useEffect, useRef, useState } from 'react';
import type { WizardState } from '../App';
import { createDataDirs, downloadModels } from '../installer';

interface Props {
  state: WizardState;
  onDone: () => void;
}

interface LogLine {
  text: string;
  type: 'info' | 'ok' | 'warn' | 'error';
}

const LOG_COLOR: Record<LogLine['type'], string> = {
  info:  '#94a3b8',
  ok:    '#22c55e',
  warn:  '#f59e0b',
  error: '#ef4444',
};

const LOG_PREFIX: Record<LogLine['type'], string> = {
  info:  '▶',
  ok:    '✓',
  warn:  '⚠',
  error: '✗',
};

export function Installing({ state, onDone }: Props) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = (text: string, type: LogLine['type'] = 'info') =>
    setLogs(prev => [...prev, { text, type }]);

  // Auto-scroll log pane
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    async function run() {
      try {
        addLog('Creating data directories...');
        await createDataDirs(state.dataDir);
        setProgress(15);
        addLog('Directories created', 'ok');

        // Qdrant and Ollama binaries are already bundled — they started in main.ts.
        // We just wait a moment for them to be ready.
        addLog('Starting bundled services (Qdrant, Ollama)...');
        await sleep(2500);
        setProgress(30);
        addLog('Services started', 'ok');

        const modelsToDownload: string[] = [];
        if (state.models.phi3)      modelsToDownload.push('phi3:mini');
        if (state.models.moondream) modelsToDownload.push('moondream');

        if (modelsToDownload.length > 0) {
          for (let i = 0; i < modelsToDownload.length; i++) {
            const model = modelsToDownload[i];
            addLog(`Pulling ${model} (this may take a few minutes)...`);
            await downloadModels([model]);
            setProgress(30 + Math.round(((i + 1) / modelsToDownload.length) * 55));
            addLog(`${model} ready`, 'ok');
          }
        }

        addLog('Finalising installation...');
        await window.hippocampus.installComplete(state.dataDir);
        setProgress(100);
        addLog('Installation complete!', 'ok');

        setTimeout(onDone, 1200);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`Error: ${msg}`, 'error');
        setFailed(true);
      }
    }

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: '40px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#f1f5f9' }}>
        {failed ? 'Installation failed' : progress === 100 ? 'Done!' : 'Installing...'}
      </h2>

      {/* Overall progress bar */}
      <div style={{
        background: '#1a1d24', borderRadius: 6, padding: 2, marginBottom: 24, overflow: 'hidden',
      }}>
        <div style={{
          height: 8, background: failed ? '#ef4444' : '#6366f1',
          borderRadius: 4, width: `${progress}%`, transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Log pane */}
      <div style={{
        background: '#080b10',
        border: '1px solid #1e2330',
        borderRadius: 6,
        padding: '12px 16px',
        fontFamily: 'ui-monospace, "Cascadia Code", monospace',
        fontSize: 12,
        lineHeight: 1.7,
        height: 300,
        overflowY: 'auto',
      }}>
        {logs.map((l, i) => (
          <div key={i} style={{ color: LOG_COLOR[l.type] }}>
            {LOG_PREFIX[l.type]} {l.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {failed && (
        <p style={{ color: '#ef4444', fontSize: 13, marginTop: 16 }}>
          Check the log above. You can close this window and re-open Hippocampus to try again.
        </p>
      )}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
