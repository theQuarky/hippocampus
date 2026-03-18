import { useCallback, useEffect, useRef, useState } from 'react';
import { postQueryAnswer, getActiveDatabase } from '../api';
import type { QueryAnswerResult, QueryResult } from '../api';
import { ScoreBar } from '../components/ScoreBar';
import { ChunkPopover } from '../components/ChunkPopover';
import { AudioOverviewPanel } from '../components/AudioOverviewPanel';

type Message =
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: QueryAnswerResult; ms: number };

type ChatSettings = {
  maxHops: number;
  topK: number;
  includeConflicts: boolean;
  rawMode: boolean;
};

function storageKey() {
  return `hippocampus-chat-${getActiveDatabase()}`;
}

function loadHistory(): Message[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

function saveHistory(msgs: Message[]) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(msgs.slice(-40)));
  } catch { /* storage full */ }
}

function scoreClass(s: number): string {
  if (s >= 0.7) return 'score-good';
  if (s >= 0.5) return 'score-mid';
  return 'score-low';
}

function ConflictBanner({ results }: { results: QueryResult[] }) {
  const conflicts = results.filter(r => r.conflicts?.length > 0);
  if (conflicts.length === 0) return null;
  return (
    <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', marginBottom: '0.6rem', fontSize: '0.83rem', color: '#fcd34d' }}>
      conflict detected — {conflicts.length} chunk{conflicts.length > 1 ? 's' : ''} have contradicting evidence
    </div>
  );
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>(() => loadHistory());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>({ maxHops: 2, topK: 5, includeConflicts: true, rawMode: false });
  const [popover, setPopover] = useState<QueryResult | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveHistory(messages); }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const submit = useCallback(async (query: string) => {
    if (!query.trim() || loading) return;
    const q = query.trim();
    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setLoading(true);
    const t0 = performance.now();
    try {
      const result = await postQueryAnswer({ query: q, maxHops: settings.maxHops, topK: settings.topK, includeConflicts: settings.includeConflicts });
      setMessages(prev => [...prev, { role: 'assistant', result, ms: Math.round(performance.now() - t0) }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [loading, settings]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(input); }
  };

  return (
    <section className="panel" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 2rem)', padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div className="panel-header" style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Chat</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="button" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}
            onClick={() => setMessages([])}>clear</button>
          <button type="button" className="button" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', background: showSettings ? 'rgba(99,102,241,0.2)' : 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}
            onClick={() => setShowSettings(s => !s)}>settings</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>
        {messages.length === 0 && (
          <p className="empty-state" style={{ marginTop: '4rem' }}>Ask anything about your knowledge base</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: '1rem' }}>
            {msg.role === 'user' ? (
              <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                <span style={{ color: 'var(--accent)', marginRight: '0.5rem' }}>You</span>{msg.text}
              </div>
            ) : (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                {msg.result.evidence && <ConflictBanner results={msg.result.evidence} />}
                {settings.rawMode ? (
                  <pre style={{ fontSize: '0.75rem', overflow: 'auto', color: 'var(--muted)' }}>{JSON.stringify(msg.result, null, 2)}</pre>
                ) : (
                  <>
                    {msg.result.answer.startsWith('LLM generation failed') ? (
                      <p style={{ color: 'rgba(245,158,11,0.9)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        LLM unavailable — evidence retrieved but no answer generated. Check Ollama is running with <code style={{ fontSize: '0.8em' }}>ollama serve</code>.
                      </p>
                    ) : (
                      <p style={{ lineHeight: 1.7, marginBottom: '0.75rem' }}>{msg.result.answer}</p>
                    )}
                    <AudioOverviewPanel query={messages[i - 1]?.role === 'user' ? (messages[i - 1] as { role: 'user'; text: string }).text : ''} />
                    {msg.result.evidence && msg.result.evidence.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
                        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sources</p>
                        {msg.result.evidence.map((ev, j) => (
                          <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                            <span style={{ color: 'var(--muted)' }}>[{j+1}]</span>
                            <span style={{ color: '#c4b5fd' }}>{ev.source}</span>
                            <ScoreBar score={ev.score} width={60} />
                            <span className={`badge ${scoreClass(ev.score)}`} style={{ fontSize: '0.7rem' }}>{ev.score.toFixed(3)}</span>
                            <button type="button" onClick={() => setPopover(ev)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', padding: '0' }}>view</button>
                          </div>
                        ))}
                        {/* Path breadcrumb */}
                        {msg.result.evidence.some(e => e.path?.length > 1) && (
                          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
                            PATH: {msg.result.evidence.find(e => e.path?.length > 1)?.path.join(' → ')}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--muted)', display: 'flex', gap: '0.75rem' }}>
                  <span>{msg.ms}ms</span>
                  {msg.result.concepts_used?.length > 0 && <span>concepts: {msg.result.concepts_used.join(', ')}</span>}
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(msg.result.answer); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: '0.72rem' }}>copy</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            <div className="spinner" style={{ width: 18, height: 18, marginBottom: 0 }} /> Thinking…
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* Settings row */}
      {showSettings && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.5rem 1rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--muted)', flexShrink: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            maxHops: <input type="range" min={0} max={3} value={settings.maxHops} onChange={e => setSettings(s => ({ ...s, maxHops: Number(e.target.value) }))} style={{ width: 70 }} /> {settings.maxHops}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            topK: <input type="range" min={1} max={10} value={settings.topK} onChange={e => setSettings(s => ({ ...s, topK: Number(e.target.value) }))} style={{ width: 70 }} /> {settings.topK}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={settings.includeConflicts} onChange={e => setSettings(s => ({ ...s, includeConflicts: e.target.checked })) } />
            conflicts
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input type="checkbox" checked={settings.rawMode} onChange={e => setSettings(s => ({ ...s, rawMode: e.target.checked })) } />
            raw mode
          </label>
        </div>
      )}

      {/* Input */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
        <input
          ref={inputRef}
          type="text"
          className="input"
          placeholder="Ask anything about your knowledge base…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
          style={{ flex: 1 }}
        />
        <button type="button" className="button" onClick={() => void submit(input)} disabled={loading || !input.trim()}>Send</button>
      </div>

      {popover && (
        <ChunkPopover
          chunkId={popover.chunk_id}
          text={popover.text}
          source={popover.source}
          score={popover.score}
          onClose={() => setPopover(null)}
        />
      )}
    </section>
  );
}
