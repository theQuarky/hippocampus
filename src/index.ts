// src/index.ts — Barrel file: re-exports public API for external consumers
export { initDB, db } from './db';
export { ingest, ingestText } from './ingest';
export { retrieve, retrieveConcepts, retrieveByVector, expandWithConcepts, mergeChunks, rankChunks } from './retrieve';
export type { Result, ConceptResult } from './retrieve';
export { consolidateAll, abstractConcepts } from './consolidate';
export { syncConceptEmbeddings } from './concepts/sync';
export { embed } from './embed';
export { buildContext } from './answer/context';
export { generateGroundedAnswer } from './answer/generator';
export { queryAnswer } from './answer/query';
export type { QueryAnswerResult, GraphEdge, ConceptDetail } from './answer/query';
export type { EvidenceBundle, EvidenceChunk, RetrievalLayer } from './types/evidence';
export {
	buildModel,
	loadOrInitAssociativeMemory,
	predictAssociativeScores,
	trainAssociativeMemory,
	getAssociativeStatus,
} from './associative';