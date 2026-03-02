import { useMemo, useState } from 'react';
import { Overview } from './components/Overview';
import { Graph } from './components/Graph';
import { MemoryBrowser } from './components/MemoryBrowser';
import { Concepts } from './components/Concepts';
import { QueryTester } from './components/QueryTester';
import { Ingest } from './components/Ingest';

type PanelKey = 'overview' | 'graph' | 'memory' | 'concepts' | 'query' | 'ingest';

type NavItem = {
  key: PanelKey;
  label: string;
};

function App() {
  const [activePanel, setActivePanel] = useState<PanelKey>('overview');

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
