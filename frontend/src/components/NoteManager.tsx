import React, { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Note } from '../types';
import { leafMindWS } from '../services/websocket';
import { PlusIcon, DocumentTextIcon, TrashIcon, TagIcon } from '@heroicons/react/24/outline';

interface NoteEditorProps {
  note?: Note;
  onSave: (note: Note) => void;
  onCancel: () => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ note, onSave, onCancel }) => {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [newTag, setNewTag] = useState('');
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedText, setSelectedText] = useState('');
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [annotationNote, setAnnotationNote] = useState('');

  const handleSave = useCallback(() => {
    if (!title.trim() || !content.trim()) {
      alert('Please provide both title and content');
      return;
    }

    const savedNote: Note = {
      id: note?.id || uuidv4(),
      title: title.trim(),
      content: content.trim(),
      created_at: note?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags,
      annotations: note?.annotations || []
    };

    // Send concept to LeafMind backend
    if (leafMindWS.isConnected()) {
      leafMindWS.learnConcept(content, {
        title,
        tags: tags.join(','),
        type: 'note'
      });
    }

    onSave(savedNote);
  }, [title, content, tags, note, onSave]);

  const addTag = useCallback(() => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  }, [newTag, tags]);

  const removeTag = useCallback((tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  }, [tags]);

  const handleTextSelection = useCallback(() => {
    if (textAreaRef.current) {
      const start = textAreaRef.current.selectionStart;
      const end = textAreaRef.current.selectionEnd;
      const selected = content.substring(start, end);
      
      if (selected.length > 0) {
        setSelectedText(selected);
        setShowAnnotationModal(true);
      }
    }
  }, [content]);

  const createAnnotation = useCallback(() => {
    if (selectedText && annotationNote.trim()) {
      // Send annotation as a concept with association
      if (leafMindWS.isConnected()) {
        leafMindWS.learnConcept(selectedText, {
          annotation: annotationNote,
          source: 'text_highlight',
          parent_note: title
        });
      }

      setShowAnnotationModal(false);
      setAnnotationNote('');
      setSelectedText('');
    }
  }, [selectedText, annotationNote, title]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-4xl mx-auto transition-colors duration-300">
      <div className="space-y-4">
        {/* Title Input */}
        <div>
          <label htmlFor="note-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Note Title
          </label>
          <input
            id="note-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter note title..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm focus:outline-none focus:ring-brain-500 focus:border-brain-500 placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-300"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tags
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-brain-100 dark:bg-brain-800 text-brain-800 dark:text-brain-200 transition-colors duration-300"
              >
                <TagIcon className="w-3 h-3 mr-1" />
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="ml-1 text-brain-600 dark:text-brain-400 hover:text-brain-800 dark:hover:text-brain-200 transition-colors duration-300"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addTag()}
              className="flex-1 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-l-md focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-300"
              placeholder="Add tag..."
            />
            <button
              onClick={addTag}
              className="px-3 py-1 bg-brain-500 dark:bg-brain-600 text-white text-sm rounded-r-md hover:bg-brain-600 dark:hover:bg-brain-700 transition-colors duration-300"
            >
              Add
            </button>
          </div>
        </div>

        {/* Content Editor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Content
          </label>
          <textarea
            ref={textAreaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onMouseUp={handleTextSelection}
            onKeyUp={handleTextSelection}
            className="w-full h-64 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent resize-none placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-300"
            placeholder="Write your note content here... Select text to create concept annotations."
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            💡 Tip: Select text to automatically create concept connections
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-brain-600 text-white rounded-md hover:bg-brain-700"
          >
            Save Note
          </button>
        </div>
      </div>

      {/* Annotation Modal */}
      {showAnnotationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Create Concept Annotation</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Selected Text
                </label>
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded-md">
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
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowAnnotationModal(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={createAnnotation}
                  className="px-4 py-2 bg-synapse-600 text-white rounded-md hover:bg-synapse-700"
                >
                  Create Concept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface NoteManagerProps {}

const NoteManager: React.FC<NoteManagerProps> = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | undefined>();
  const [searchTerm, setSearchTerm] = useState('');

  const handleSaveNote = useCallback((note: Note) => {
    setNotes(prevNotes => {
      const existingIndex = prevNotes.findIndex(n => n.id === note.id);
      if (existingIndex >= 0) {
        const updated = [...prevNotes];
        updated[existingIndex] = note;
        return updated;
      } else {
        return [...prevNotes, note];
      }
    });
    setIsEditing(false);
    setEditingNote(undefined);
  }, []);

  const handleEditNote = useCallback((note: Note) => {
    setEditingNote(note);
    setIsEditing(true);
  }, []);

  const handleDeleteNote = useCallback((noteId: string) => {
    if (window.confirm('Are you sure you want to delete this note?')) {
      setNotes(prevNotes => prevNotes.filter(n => n.id !== noteId));
    }
  }, []);

  const filteredNotes = notes.filter(note =>
    note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (isEditing) {
    return (
      <NoteEditor
        note={editingNote}
        onSave={handleSaveNote}
        onCancel={() => {
          setIsEditing(false);
          setEditingNote(undefined);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">📝 Note Manager</h2>
        <button
          onClick={() => setIsEditing(true)}
          className="inline-flex items-center px-4 py-2 bg-brain-600 text-white rounded-md hover:bg-brain-700"
        >
          <PlusIcon className="w-5 h-5 mr-2" />
          New Note
        </button>
      </div>

      {/* Search */}
      <div className="max-w-md">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brain-500 focus:border-transparent"
          placeholder="Search notes..."
        />
      </div>

      {/* Notes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredNotes.map((note) => (
          <div
            key={note.id}
            className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div className="flex justify-between items-start mb-2">
              <h3 
                className="text-lg font-semibold text-gray-900 truncate flex-1"
                onClick={() => handleEditNote(note)}
              >
                {note.title}
              </h3>
              <button
                onClick={() => handleDeleteNote(note.id)}
                className="text-red-400 hover:text-red-600 ml-2"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
            
            <p 
              className="text-gray-600 text-sm mb-3 line-clamp-3"
              onClick={() => handleEditNote(note)}
            >
              {note.content}
            </p>
            
            {note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {note.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="inline-block px-2 py-1 text-xs bg-brain-100 text-brain-800 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
                {note.tags.length > 3 && (
                  <span className="text-xs text-gray-500">+{note.tags.length - 3} more</span>
                )}
              </div>
            )}
            
            <div className="text-xs text-gray-400">
              Updated {new Date(note.updated_at).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>

      {notes.length === 0 && (
        <div className="text-center py-12">
          <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No notes yet</h3>
          <p className="text-gray-500">Create your first note to start building your memory graph</p>
        </div>
      )}
    </div>
  );
};

export default NoteManager;