// src/types/evidence.ts — Evidence & Explanation Layer types

export type RetrievalLayer = 'vector' | 'graph' | 'concept';

export type EvidenceChunk = {
  chunk_id: string;
  text: string;
  source: string;
  score: number;
  retrieval_layer: RetrievalLayer;
};

export type EvidenceConcept = {
  concept_id: string;
  label: string;
  confidence: number;
};

export type EvidenceBundle = {
  chunks: EvidenceChunk[];
  concepts: EvidenceConcept[];
};

export type GroundedAnswerResult = {
  answer: string;
  evidence_used: EvidenceChunk[];
  concepts_used: string[];
};
