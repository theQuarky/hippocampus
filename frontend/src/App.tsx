import React, { useState, useEffect } from 'react';
import { leafMindWS } from './services/websocket';
import { DarkModeProvider } from './contexts/DarkModeContext';
import DarkModeToggle from './components/DarkModeToggle';
import NoteManager from './components/NoteManager';
import RecallSearch from './components/RecallSearch';
import ConceptGraph from './components/ConceptGraph';
import DocumentAnnotation from './components/DocumentAnnotation';
import { 
  DocumentTextIcon, 
  MagnifyingGlassIcon, 
  CircleStackIcon,
  PencilSquareIcon,
  WifiIcon 
} from '@heroicons/react/24/outline';

type ActiveTab = 'notes' | 'search' | 'graph' | 'annotate';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Set up event handlers first
    leafMindWS.onConnect(() => {
      setIsConnected(true);
      console.log('Connected to LeafMind backend');
    });
    
    leafMindWS.onDisconnect(() => {
      setIsConnected(false);
      console.log('Disconnected from LeafMind backend');
    });

    // Then initialize WebSocket connection
    leafMindWS.connect().catch(error => {
      console.error('Failed to connect to LeafMind backend:', error);
      setIsConnected(false);
    });

    return () => {
      leafMindWS.disconnect();
    };
  }, []);

  const tabs = [
    { id: 'notes' as const, label: 'Notes', icon: DocumentTextIcon },
    { id: 'search' as const, label: 'Memory Recall', icon: MagnifyingGlassIcon },
    { id: 'graph' as const, label: 'Concept Graph', icon: CircleStackIcon },
    { id: 'annotate' as const, label: 'Annotate', icon: PencilSquareIcon },
  ];

  return (
    <DarkModeProvider>
      <AppContent 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isConnected={isConnected}
        tabs={tabs}
      />
    </DarkModeProvider>
  );
}

interface AppContentProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isConnected: boolean;
  tabs: Array<{ id: ActiveTab; label: string; icon: React.ComponentType<any> }>;
}

function AppContent({ activeTab, setActiveTab, isConnected, tabs }: AppContentProps) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
      {/* Header */}
      <header className="neural-bg dark:bg-gradient-to-r dark:from-gray-800 dark:to-gray-900 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-white">
                🧠 LeafMind
              </h1>
              <span className="ml-2 text-sm text-white/80">
                Hippocampus-Inspired Memory System
              </span>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className={`flex items-center text-sm ${isConnected ? 'text-green-100' : 'text-red-100'}`}>
                <WifiIcon className={`w-4 h-4 mr-1 ${isConnected ? 'text-green-300' : 'text-red-300'}`} />
                {isConnected ? 'Connected' : 'Disconnected'}
              </div>
              <DarkModeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center px-3 py-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-brain-500 text-brain-600 dark:text-brain-400'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <Icon className="w-5 h-5 mr-2" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'notes' && <NoteManager />}
        {activeTab === 'search' && <RecallSearch />}
        {activeTab === 'graph' && <ConceptGraph width={1000} height={700} />}
        {activeTab === 'annotate' && <DocumentAnnotation />}
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-16 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            <p>
              LeafMind - A neuromorphic memory system inspired by the hippocampus
            </p>
            <p className="mt-1">
              Built with React, TypeScript, D3.js, and Rust
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
