// Types for LeafMind frontend
export interface Concept {
  id: string;
  content: string;
  created_at: string;
  last_accessed: string;
  access_count: number;
  strength: number;
}

export interface ConceptId {
  uuid: string;
}

export interface SynapticEdge {
  from: ConceptId;
  to: ConceptId;
  strength: number;
  created_at: string;
  last_accessed: string;
}

export interface MemoryStats {
  total_concepts: number;
  short_term_connections: number;
  long_term_connections: number;
  working_memory_size: number;
  last_consolidation: string;
}

export interface RecallQuery {
  query: string;
  max_results: number;
  min_relevance: number;
  max_path_length?: number;
  include_semantic_similarity?: boolean;
  use_recency_boost?: boolean;
  exploration_breadth?: number;
}

export interface RecallResult {
  concept: Concept;
  relevance_score: number;
  path_length: number;
  associations: string[];
}

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  annotations: Annotation[];
}

export interface Annotation {
  id: string;
  text: string;
  start: number;
  end: number;
  concept_id?: string;
  note: string;
  created_at: string;
}

export interface ConceptNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  strength: number;
  access_count: number;
}

export interface ConceptLink {
  source: string;
  target: string;
  strength: number;
  type: 'short-term' | 'long-term';
}

export interface GraphData {
  nodes: ConceptNode[];
  links: ConceptLink[];
}

// WebSocket message types
export interface WebSocketMessage {
  message_type: string;
  payload: any;
  timestamp: number;
  client_id?: string;
}

export interface ConceptLearnMessage {
  content: string;
  metadata?: Record<string, string>;
}

export interface AssociationMessage {
  from_concept_id: string;
  to_concept_id: string;
  strength: number;
  bidirectional: boolean;
}

export interface MemoryUpdateEvent {
  concept_id?: ConceptId;
  event_type: string;
  event_data: any;
}