import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { Library } from './views/Library';
import { Chat } from './views/Chat';
import { GraphView } from './views/GraphView';
import { IngestView } from './views/IngestView';
import { Timeline } from './views/Timeline';
import { ConceptsView } from './views/ConceptsView';
import { getStats, getDatabases, createDatabase, getActiveDatabase, setActiveDatabase } from './api';
import type { StatsResponse } from './api';

const NAV_ITEMS = [
  { path: '/library',  label: 'Library',   key: 'l' },
  { path: '/chat',     label: 'Chat',       key: 'c' },
  { path: '/graph',    label: 'Graph',      key: 'g' },
  { path: '/timeline', label: 'Timeline',   key: 't' },
  { path: '/concepts', label: 'Concepts',   key: 'k' },
  { path: '/ingest',   label: 'Ingest',     key: 'i' },
] as const;

function SidebarIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactElement> = {
    Library: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.75A.75.75 0 016.75 6h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 6.75zM6 12a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 12zm0 5.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75a.75.75 0 01-.75-.75z" />
      </svg>
    ),
    Chat: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
    Graph: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
      </svg>
    ),
    Timeline: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    Concepts: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
    Ingest: (
      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  };
  return icons[name] ?? null;
}

export default function App() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState<string>('default');
  const [newDbName, setNewDbName] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const gPressedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load databases on mount
  useEffect(() => {
    void (async () => {
      try {
        const list = await getDatabases();
        const dbs = list.length > 0 ? list : ['default'];
        setDatabases(dbs);
        const initial = getActiveDatabase() || dbs[0];
        setDatabase(initial);
        setActiveDatabase(initial);
      } catch {
        setDatabases(['default']);
        setDatabase('default');
        setActiveDatabase('default');
      }
    })();
  }, []);

  // Poll stats every 30s for sidebar status
  const loadStats = useCallback(async () => {
    try {
      const s = await getStats();
      setStats(s);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    const timer = setInterval(() => void loadStats(), 30_000);
    return () => clearInterval(timer);
  }, [loadStats]);

  // Keyboard shortcuts: g+l, g+c, g+g, g+t, g+k, g+i
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'g') {
        gPressedRef.current = true;
        gTimerRef.current = setTimeout(() => { gPressedRef.current = false; }, 1000);
        return;
      }

      if (gPressedRef.current) {
        gPressedRef.current = false;
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        const map: Record<string, string> = { l: '/library', c: '/chat', g: '/graph', t: '/timeline', k: '/concepts', i: '/ingest' };
        if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const handleChangeDatabase = (name: string) => {
    const next = name.trim() || 'default';
    setDatabase(next);
    setActiveDatabase(next);
  };

  const handleCreateDatabase = async () => {
    const name = newDbName.trim();
    if (!name) return;
    try {
      setDbError(null);
      await createDatabase(name);
      const list = await getDatabases();
      setDatabases(list);
      handleChangeDatabase(name);
      setNewDbName('');
    } catch (error) {
      setDbError(error instanceof Error ? error.message : 'Failed to create database');
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="brand">
          <span style={{ fontSize: '1.3rem' }}>🧠</span>
          <div>
            <h1 style={{ fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Hippocampus</h1>
            <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.1rem' }}>semantic memory</p>
          </div>
        </div>

        <nav className="nav-list" style={{ flex: 1 }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none' }}
            >
              <SidebarIcon name={item.label} />
              <span>{item.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.7rem', opacity: 0.35, fontFamily: 'monospace' }}>g+{item.key}</span>
            </NavLink>
          ))}
        </nav>

        {/* Database selector */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <select
              className="select"
              value={database}
              onChange={(e) => handleChangeDatabase(e.target.value)}
              style={{ width: '100%', fontSize: '0.8rem' }}
            >
              {databases.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <input
              type="text"
              className="input"
              placeholder="new db…"
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              style={{ fontSize: '0.78rem', flex: 1 }}
            />
            <button type="button" className="button" onClick={() => void handleCreateDatabase()} disabled={!newDbName.trim()} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>+</button>
          </div>
          {dbError && <p className="error" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }}>{dbError}</p>}
        </div>

        {/* Status bar */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.6rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected === true ? '#22c55e' : connected === false ? '#ef4444' : '#6b7280', display: 'inline-block', flexShrink: 0 }} />
            <span>{connected === true ? 'connected' : connected === false ? 'offline' : '…'}</span>
          </div>
          {stats && (
            <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span>{stats.total_chunks}↑</span>
              <span>{stats.total_connections} edges</span>
              <span>384d</span>
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/library"  element={<Library />} />
          <Route path="/chat"     element={<Chat />} />
          <Route path="/graph"    element={<GraphView />} />
          <Route path="/ingest"   element={<IngestView />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/concepts" element={<ConceptsView />} />
        </Routes>
      </main>
    </div>
  );
}
