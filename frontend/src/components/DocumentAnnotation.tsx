import React, { useState, useCallback, useRef, useMemo } from 'react';
import Highlighter from 'react-highlight-words';
import { v4 as uuidv4 } from 'uuid';
import { leafMindWS } from '../services/websocket';
import { 
  DocumentTextIcon, 
  PencilSquareIcon, 
  PlusIcon,
  TrashIcon
} from '@heroicons/react/24/outline';

interface DocumentAnnotationProps {
  document?: {
    id: string;
    title: string;
    content: string;
  };
}

interface HighlightedText {
  id: string;
  text: string;
  start: number;
  end: number;
  conceptId?: string;
  note: string;
  color: string;
}

const DocumentAnnotation: React.FC<DocumentAnnotationProps> = ({ document }) => {
  const [currentDocument, setCurrentDocument] = useState(document || {
    id: uuidv4(),
    title: 'Sample Document',
    content: `Artificial Intelligence (AI) is a rapidly evolving field that encompasses machine learning, neural networks, and deep learning. These technologies are transforming industries by enabling pattern recognition and automated decision-making.

Machine learning algorithms can identify complex patterns in data that would be impossible for humans to detect manually. Deep learning, a subset of machine learning, uses artificial neural networks with multiple layers to model and understand complex patterns.

Natural language processing (NLP) is another crucial area of AI that focuses on the interaction between computers and human language. NLP enables machines to read, understand, and generate human language in a valuable way.

Computer vision allows machines to interpret and make decisions based on visual data. This technology is widely used in autonomous vehicles, medical imaging, and security systems.

The future of AI holds immense potential for solving complex global challenges, from climate change to healthcare optimization. However, it also raises important questions about ethics, privacy, and the future of work.`
  });

  const [highlights, setHighlights] = useState<HighlightedText[]>([]);
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [annotationNote, setAnnotationNote] = useState('');
  const [conceptConnections, setConceptConnections] = useState<string[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  const colors = useMemo(() => [
    '#FEF3C7', // yellow
    '#DBEAFE', // blue
    '#D1FAE5', // green
    '#FECACA', // red
    '#E0E7FF', // indigo
    '#FAE8FF', // purple
    '#FED7D7', // pink
  ], []);

  const getNextColor = useCallback(() => {
    return colors[highlights.length % colors.length];
  }, [highlights.length, colors]);

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();
      
      // Calculate position within the document content
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(contentRef.current!);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      const start = preCaretRange.toString().length;
      const end = start + selectedText.length;

      setSelectedText(selectedText);
      setSelectionRange({ start, end });
      setShowAnnotationModal(true);
    }
  }, []);

  const createHighlight = useCallback(() => {
    if (selectedText && selectionRange) {
      const newHighlight: HighlightedText = {
        id: uuidv4(),
        text: selectedText,
        start: selectionRange.start,
        end: selectionRange.end,
        note: annotationNote,
        color: getNextColor()
      };

      setHighlights(prev => [...prev, newHighlight]);

      // Send to LeafMind backend
      if (leafMindWS.isConnected()) {
        leafMindWS.learnConcept(selectedText, {
          annotation: annotationNote,
          source: 'document_highlight',
          document_title: currentDocument.title,
          document_id: currentDocument.id
        });

        // Create connections to other concepts if specified
        conceptConnections.forEach(conceptId => {
          if (newHighlight.conceptId) {
            leafMindWS.createAssociation(newHighlight.conceptId, conceptId, 0.7, true);
          }
        });
      }

      // Reset state
      setShowAnnotationModal(false);
      setSelectedText('');
      setSelectionRange(null);
      setAnnotationNote('');
      setConceptConnections([]);
      
      // Clear selection
      window.getSelection()?.removeAllRanges();
    }
  }, [selectedText, selectionRange, annotationNote, conceptConnections, currentDocument, getNextColor]);

  const removeHighlight = useCallback((highlightId: string) => {
    setHighlights(prev => prev.filter(h => h.id !== highlightId));
  }, []);

  const exportAnnotations = useCallback(() => {
    const annotationData = {
      document: currentDocument,
      highlights: highlights,
      exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(annotationData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = `annotations-${currentDocument.title.replace(/\s+/g, '-')}.json`;
    globalThis.document.body.appendChild(a);
    a.click();
    globalThis.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [currentDocument, highlights]);

  // Create search words for Highlighter component
  const searchWords = highlights.map(h => ({
    text: h.text,
    className: 'annotation-highlight',
    style: { backgroundColor: h.color }
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📄 Document Annotation</h2>
        <div className="flex space-x-2">
          <button
            onClick={exportAnnotations}
            className="inline-flex items-center px-3 py-2 text-sm bg-brain-600 dark:bg-brain-700 text-white rounded-md hover:bg-brain-700 dark:hover:bg-brain-800 transition-colors duration-300"
          >
            <DocumentTextIcon className="w-4 h-4 mr-1" />
            Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Document Content */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 transition-colors duration-300">
            <div className="mb-4">
              <input
                type="text"
                value={currentDocument.title}
                onChange={(e) => setCurrentDocument(prev => ({ ...prev, title: e.target.value }))}
                className="text-xl font-bold w-full border-none outline-none focus:bg-gray-50 dark:focus:bg-gray-700 bg-transparent text-gray-900 dark:text-gray-100 p-2 rounded transition-colors duration-300"
              />
            </div>
            
            <div
              ref={contentRef}
              className="prose max-w-none text-gray-900 leading-relaxed select-text"
              onMouseUp={handleTextSelection}
              style={{ userSelect: 'text' }}
            >
              <Highlighter
                searchWords={searchWords.map(sw => sw.text)}
                textToHighlight={currentDocument.content}
                highlightClassName="annotation-highlight"
                highlightStyle={{
                  backgroundColor: 'rgba(234, 179, 8, 0.3)',
                  borderRadius: '2px',
                  padding: '1px 2px',
                  cursor: 'pointer'
                }}
              />
            </div>
            
            <p className="text-sm text-gray-500 mt-4">
              💡 Select text to create concept annotations and build connections
            </p>
          </div>
        </div>

        {/* Annotations Panel */}
        <div className="space-y-4">
          {/* Stats */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Annotation Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total Highlights:</span>
                <span className="text-sm font-medium">{highlights.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Document Length:</span>
                <span className="text-sm font-medium">{currentDocument.content.length} chars</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Coverage:</span>
                <span className="text-sm font-medium">
                  {((highlights.reduce((sum, h) => sum + h.text.length, 0) / currentDocument.content.length) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Annotations List */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Annotations</h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {highlights.map((highlight) => (
                <div
                  key={highlight.id}
                  className="p-3 border border-gray-200 rounded-lg hover:shadow-sm transition-shadow"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div
                      className="text-sm font-medium px-2 py-1 rounded"
                      style={{ backgroundColor: highlight.color }}
                    >
                      "{highlight.text.substring(0, 30)}{highlight.text.length > 30 ? '...' : ''}"
                    </div>
                    <button
                      onClick={() => removeHighlight(highlight.id)}
                      className="text-red-400 hover:text-red-600 ml-2"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {highlight.note && (
                    <p className="text-xs text-gray-600 mb-2">
                      {highlight.note}
                    </p>
                  )}
                  
                  <div className="flex items-center text-xs text-gray-400">
                    <span>Position: {highlight.start}-{highlight.end}</span>
                  </div>
                </div>
              ))}
              
              {highlights.length === 0 && (
                <div className="text-center py-8">
                  <PencilSquareIcon className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No annotations yet</p>
                  <p className="text-xs text-gray-400">Select text to get started</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Annotation Modal */}
      {showAnnotationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Create Concept Annotation</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Selected Text
                </label>
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <span className="font-medium text-yellow-800">"{selectedText}"</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Concept Note
                </label>
                <textarea
                  value={annotationNote}
                  onChange={(e) => setAnnotationNote(e.target.value)}
                  className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent resize-none"
                  placeholder="Add a note about this concept..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Connect to Concepts (Optional)
                </label>
                <div className="space-y-2">
                  {conceptConnections.map((connection, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={connection}
                        onChange={(e) => {
                          const newConnections = [...conceptConnections];
                          newConnections[index] = e.target.value;
                          setConceptConnections(newConnections);
                        }}
                        className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                        placeholder="Concept ID or name"
                      />
                      <button
                        onClick={() => {
                          setConceptConnections(prev => prev.filter((_, i) => i !== index));
                        }}
                        className="text-red-400 hover:text-red-600"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setConceptConnections(prev => [...prev, ''])}
                    className="inline-flex items-center text-sm text-brain-600 hover:text-brain-700"
                  >
                    <PlusIcon className="w-4 h-4 mr-1" />
                    Add Connection
                  </button>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowAnnotationModal(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createHighlight}
                  className="px-4 py-2 bg-synapse-600 text-white rounded-md hover:bg-synapse-700"
                >
                  Create Annotation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentAnnotation;