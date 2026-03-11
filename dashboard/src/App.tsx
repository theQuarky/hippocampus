import { useEffect, useMemo, useState } from 'react';
import { Overview } from './components/Overview';
import { Graph } from './components/Graph';
import { MemoryBrowser } from './components/MemoryBrowser';
import { Concepts } from './components/Concepts';
import { QueryTester } from './components/QueryTester';
import { Ingest } from './components/Ingest';
import { createDatabase, getActiveDatabase, getDatabases, setActiveDatabase } from './api';

type PanelKey = 'overview' | 'graph' | 'memory' | 'concepts' | 'query' | 'ingest';

type NavItem = {
  key: PanelKey;
  label: string;
};

function App() {
  const [activePanel, setActivePanel] = useState<PanelKey>('overview');
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState<string>('default');
  const [dbError, setDbError] = useState<string | null>(null);
  const [newDbName, setNewDbName] = useState('');

  const navItems = useMemo<NavItem[]>(
    () => [
      { key: 'overview', label: 'Overview' },
      { key: 'ingest', label: 'Ingest' },
      { key: 'graph', label: 'Connection Graph' },
      { key: 'memory', label: 'Memory Browser' },
      { key: 'concepts', label: 'Concepts' },
      { key: 'query', label: 'Query Tester' },
    ],
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        setDbError(null);
        const list = await getDatabases();
        if (list.length === 0) {
          setDatabases(['default']);
          setDatabase('default');
          setActiveDatabase('default');
          return;
        }
        setDatabases(list);
        const initial = getActiveDatabase() || list[0];
        setDatabase(initial);
        setActiveDatabase(initial);
      } catch (error) {
        setDbError(error instanceof Error ? error.message : 'Failed to load databases');
        setDatabases(['default']);
        setDatabase('default');
        setActiveDatabase('default');
      }
    })();
  }, []);

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
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">🧠</div>
          <div>
            <h1>Hippocampus</h1>
            <p>Semantic Memory Dashboard</p>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${activePanel === item.key ? 'active' : ''}`}
              onClick={() => setActivePanel(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <div className="toolbar" style={{ marginBottom: '1rem' }}>
          <label className="db-select-label">
            <span style={{ marginRight: '0.5rem' }}>Database</span>
            <select
              className="select"
              value={database}
              onChange={(event) => handleChangeDatabase(event.target.value)}
            >
              {databases.map((dbName) => (
                <option key={dbName} value={dbName}>
                  {dbName}
                </option>
              ))}
            </select>
          </label>
          <div className="db-create" style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem' }}>
            <input
              type="text"
              className="input"
              placeholder="New database name"
              value={newDbName}
              onChange={(event) => setNewDbName(event.target.value)}
            />
            <button
              type="button"
              className="button"
              onClick={() => void handleCreateDatabase()}
              disabled={!newDbName.trim()}
            >
              Create
            </button>
          </div>
          {dbError && <span className="warning" style={{ marginLeft: '1rem' }}>{dbError}</span>}
        </div>

        {activePanel === 'overview' && <Overview />}
        {activePanel === 'ingest' && <Ingest />}
        {activePanel === 'graph' && <Graph />}
        {activePanel === 'memory' && <MemoryBrowser />}
        {activePanel === 'concepts' && <Concepts />}
        {activePanel === 'query' && <QueryTester />}
      </main>
    </div>
  );
}

export default App;
