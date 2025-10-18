import React, { useState, useCallback, useEffect } from 'react';
import { RecallQuery, RecallResult } from '../types';
import { leafMindWS } from '../services/websocket';
import { 
  MagnifyingGlassIcon, 
  AdjustmentsHorizontalIcon,
  ClockIcon,
  LinkIcon,
  StarIcon 
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';

interface RecallSearchProps {}

const RecallSearch: React.FC<RecallSearchProps> = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecallResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchParams, setSearchParams] = useState<RecallQuery>({
    query: '',
    max_results: 10,
    min_relevance: 0.1,
    max_path_length: 3,
    include_semantic_similarity: true,
    use_recency_boost: true,
    exploration_breadth: 2
  });

  // Listen for recall results from WebSocket
  useEffect(() => {
    leafMindWS.onRecallResults((recallResults: RecallResult[]) => {
      setResults(recallResults);
      setIsLoading(false);
    });
  }, []);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;

    setIsLoading(true);
    setSearchParams(prev => ({ ...prev, query: query.trim() }));
    
    if (leafMindWS.isConnected()) {
      leafMindWS.recallMemory(query.trim(), searchParams.max_results, searchParams.min_relevance);
    } else {
      // Simulate results for demo purposes
      setTimeout(() => {
        const mockResults: RecallResult[] = [
          {
            concept: {
              id: '1',
              content: 'Machine learning algorithms for pattern recognition',
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              access_count: 15,
              strength: 0.95
            },
            relevance_score: 0.92,
            path_length: 1,
            associations: ['artificial intelligence', 'neural networks', 'data science']
          },
          {
            concept: {
              id: '2',
              content: 'Neural network architectures and deep learning',
              created_at: new Date().toISOString(),
              last_accessed: new Date().toISOString(),
              access_count: 8,
              strength: 0.87
            },
            relevance_score: 0.85,
            path_length: 2,
            associations: ['machine learning', 'artificial intelligence']
          }
        ];
        setResults(mockResults);
        setIsLoading(false);
      }, 1000);
    }
  }, [query, searchParams]);

  const handleParameterChange = useCallback((key: keyof RecallQuery, value: any) => {
    setSearchParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const getRelevanceColor = (score: number): string => {
    if (score >= 0.8) return 'text-green-600';
    if (score >= 0.6) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getRelevanceStars = (score: number): number => {
    return Math.round(score * 5);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🧠 Memory Recall</h2>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="inline-flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors duration-300"
        >
          <AdjustmentsHorizontalIcon className="w-4 h-4 mr-1" />
          Advanced
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <div className="flex">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 px-4 py-3 text-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-300"
            placeholder="Search your memory graph..."
          />
          <button
            onClick={handleSearch}
            disabled={isLoading || !query.trim()}
            className="px-6 py-3 bg-brain-600 dark:bg-brain-700 text-white rounded-r-lg hover:bg-brain-700 dark:hover:bg-brain-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-300"
          >
            {isLoading ? (
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <MagnifyingGlassIcon className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Advanced Parameters */}
      {showAdvanced && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-4">
          <h3 className="font-semibold text-gray-900">Search Parameters</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Results
              </label>
              <input
                type="number"
                value={searchParams.max_results}
                onChange={(e) => handleParameterChange('max_results', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent"
                min="1"
                max="50"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Relevance
              </label>
              <input
                type="range"
                value={searchParams.min_relevance}
                onChange={(e) => handleParameterChange('min_relevance', parseFloat(e.target.value))}
                className="w-full"
                min="0"
                max="1"
                step="0.1"
              />
              <span className="text-xs text-gray-500">{searchParams.min_relevance}</span>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Path Length
              </label>
              <input
                type="number"
                value={searchParams.max_path_length}
                onChange={(e) => handleParameterChange('max_path_length', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent"
                min="1"
                max="10"
              />
            </div>
          </div>
          
          <div className="flex space-x-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={searchParams.include_semantic_similarity}
                onChange={(e) => handleParameterChange('include_semantic_similarity', e.target.checked)}
                className="mr-2"
              />
              Semantic Similarity
            </label>
            
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={searchParams.use_recency_boost}
                onChange={(e) => handleParameterChange('use_recency_boost', e.target.checked)}
                className="mr-2"
              />
              Recency Boost
            </label>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="space-y-4">
        {results.length > 0 && (
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">
              Search Results ({results.length})
            </h3>
            <div className="text-sm text-gray-500">
              Query: "{searchParams.query}"
            </div>
          </div>
        )}

        {results.map((result, index) => (
          <div
            key={result.concept.id}
            className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center justify-center w-8 h-8 bg-brain-100 text-brain-800 text-sm font-semibold rounded-full">
                  {index + 1}
                </span>
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    i < getRelevanceStars(result.relevance_score) ? (
                      <StarIconSolid key={i} className="w-4 h-4 text-yellow-400" />
                    ) : (
                      <StarIcon key={i} className="w-4 h-4 text-gray-300" />
                    )
                  ))}
                  <span className={`ml-2 text-sm font-medium ${getRelevanceColor(result.relevance_score)}`}>
                    {(result.relevance_score * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              
              <div className="flex items-center space-x-4 text-sm text-gray-500">
                <div className="flex items-center">
                  <LinkIcon className="w-4 h-4 mr-1" />
                  Path: {result.path_length}
                </div>
                <div className="flex items-center">
                  <ClockIcon className="w-4 h-4 mr-1" />
                  {result.concept.access_count} views
                </div>
              </div>
            </div>

            <div className="mb-3">
              <p className="text-gray-900 leading-relaxed">
                {result.concept.content}
              </p>
            </div>

            {result.associations.length > 0 && (
              <div className="mb-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Associated Concepts:</h4>
                <div className="flex flex-wrap gap-2">
                  {result.associations.map((association, idx) => (
                    <span
                      key={idx}
                      className="inline-block px-2 py-1 text-xs bg-synapse-100 text-synapse-800 rounded-full"
                    >
                      {association}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center text-xs text-gray-400">
              <span>
                Created: {new Date(result.concept.created_at).toLocaleDateString()}
              </span>
              <span>
                Last accessed: {new Date(result.concept.last_accessed).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}

        {query && !isLoading && results.length === 0 && (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No results found</h3>
            <p className="text-gray-500">
              Try adjusting your search terms or lowering the minimum relevance threshold
            </p>
          </div>
        )}

        {!query && results.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Search Your Memory</h3>
            <p className="text-gray-500">
              Enter a query to search through your connected concepts and discover relationships
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecallSearch;