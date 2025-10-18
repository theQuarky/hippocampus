/**
 * LeafMind gRPC Client for JavaScript/Node.js
 * High-performance neuromorphic memory access with streaming support
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

class LeafMindGrpcClient {
    constructor(serverAddress = 'localhost:50051') {
        this.serverAddress = serverAddress;
        this.client = null;
        this.packageDefinition = null;
        this.proto = null;
    }

    async connect() {
        try {
            // Load protobuf definition
            this.packageDefinition = protoLoader.loadSync(
                path.join(__dirname, '../../proto/leafmind.proto'),
                {
                    keepCase: true,
                    longs: String,
                    enums: String,
                    defaults: true,
                    oneofs: true,
                }
            );

            this.proto = grpc.loadPackageDefinition(this.packageDefinition).leafmind.v1;

            // Create gRPC client
            this.client = new this.proto.LeafMindService(
                this.serverAddress,
                grpc.credentials.createInsecure()
            );

            // Test connection
            const health = await this.healthCheck();
            console.log(`Connected to LeafMind gRPC server v${health.version}`);
            return true;
        } catch (error) {
            console.error('Connection failed:', error);
            return false;
        }
    }

    close() {
        if (this.client) {
            this.client.close();
        }
    }

    // Promisify gRPC calls
    _promisify(method, request) {
        return new Promise((resolve, reject) => {
            this.client[method](request, (error, response) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
            });
        });
    }

    async learnConcept(content, metadata = {}, tags = []) {
        const request = {
            content,
            metadata,
            tags,
        };

        const response = await this._promisify('LearnConcept', request);
        if (response.success) {
            return response.concept_id.uuid;
        } else {
            throw new Error(`Failed to learn concept: ${response.message}`);
        }
    }

    async getConcept(conceptId, includeAssociations = false) {
        const request = {
            concept_id: { uuid: conceptId },
            include_associations: includeAssociations,
        };

        const response = await this._promisify('GetConcept', request);
        if (response.found) {
            return {
                id: response.concept.id.uuid,
                content: response.concept.content,
                created_at: response.concept.created_at,
                last_accessed: response.concept.last_accessed,
                access_count: response.concept.access_count,
                metadata: response.concept.metadata,
                associations: response.associations.map(this._associationToObject.bind(this)),
            };
        }
        return null;
    }

    async listConcepts(page = 1, pageSize = 50, filter = '') {
        const request = {
            page,
            page_size: pageSize,
            filter,
            include_metadata: true,
        };

        const response = await this._promisify('ListConcepts', request);
        return {
            concepts: response.concepts.map(this._conceptToObject.bind(this)),
            total_count: response.total_count,
            page: response.page,
            page_size: response.page_size,
            has_more: response.has_more,
        };
    }

    async accessConcept(conceptId) {
        const request = {
            concept_id: { uuid: conceptId },
        };

        const response = await this._promisify('AccessConcept', request);
        if (response.success) {
            return this._conceptToObject(response.updated_concept);
        } else {
            throw new Error('Failed to access concept');
        }
    }

    async createAssociation(fromConceptId, toConceptId, strength = 1.0, associationType = 'related', bidirectional = false) {
        const request = {
            from_concept: { uuid: fromConceptId },
            to_concept: { uuid: toConceptId },
            strength,
            association_type: associationType,
            bidirectional,
        };

        const response = await this._promisify('CreateAssociation', request);
        if (response.success) {
            return this._associationToObject(response.created_association);
        } else {
            throw new Error(`Failed to create association: ${response.message}`);
        }
    }

    async recallMemory(options = {}) {
        const {
            sourceConceptId,
            contentQuery,
            maxResults = 10,
            minRelevance = 0.1,
            maxPathLength = 3,
            includeSemanticSimilarity = true,
            useRecencyBoost = true,
            explorationBreadth = 2,
        } = options;

        const request = {
            max_results: maxResults,
            min_relevance: minRelevance,
            max_path_length: maxPathLength,
            include_semantic_similarity: includeSemanticSimilarity,
            use_recency_boost: useRecencyBoost,
            exploration_breadth: explorationBreadth,
        };

        if (sourceConceptId) {
            request.source_concept_id = { uuid: sourceConceptId };
        } else if (contentQuery) {
            request.content_query = contentQuery;
        } else {
            throw new Error('Either sourceConceptId or contentQuery must be provided');
        }

        const response = await this._promisify('RecallMemory', request);
        return {
            results: response.results.map(this._recallResultToObject.bind(this)),
            total_found: response.total_found,
            query_time_ms: response.query_time_ms,
            source_concept_id: response.source_concept_id?.uuid,
        };
    }

    streamingRecall(options = {}) {
        const {
            sourceConceptId,
            contentQuery,
            maxResults = 10,
        } = options;

        const request = { max_results: maxResults };

        if (sourceConceptId) {
            request.source_concept_id = { uuid: sourceConceptId };
        } else if (contentQuery) {
            request.content_query = contentQuery;
        }

        const stream = this.client.StreamingRecall(request);
        
        return {
            on: (event, callback) => {
                if (event === 'data') {
                    stream.on('data', (result) => {
                        callback(this._recallResultToObject(result));
                    });
                } else {
                    stream.on(event, callback);
                }
            },
            cancel: () => stream.cancel(),
        };
    }

    async getMemoryStats(includePersistence = true) {
        const request = {
            include_persistence_stats: includePersistence,
        };

        const response = await this._promisify('GetMemoryStats', request);
        
        const stats = {
            total_concepts: response.total_concepts,
            short_term_concepts: response.short_term_concepts,
            long_term_concepts: response.long_term_concepts,
            total_associations: response.total_associations,
            short_term_associations: response.short_term_associations,
            long_term_associations: response.long_term_associations,
            memory_usage_bytes: response.memory_usage_bytes,
            consolidation_ratio: response.consolidation_ratio,
        };

        if (response.persistence_stats) {
            stats.persistence = {
                database_size_bytes: response.persistence_stats.database_size_bytes,
                concepts_persisted: response.persistence_stats.concepts_persisted,
                associations_persisted: response.persistence_stats.associations_persisted,
                last_save_timestamp: response.persistence_stats.last_save_timestamp,
                pending_operations: response.persistence_stats.pending_operations,
            };
        }

        return stats;
    }

    async consolidateMemory(force = false, minStrength = 0.1) {
        const request = {
            force_consolidation: force,
            min_strength_threshold: minStrength,
        };

        const response = await this._promisify('ConsolidateMemory', request);
        return {
            success: response.success,
            concepts_consolidated: response.concepts_consolidated,
            associations_strengthened: response.associations_strengthened,
            consolidation_time_ms: response.consolidation_time_ms,
        };
    }

    watchConcept(conceptId) {
        const request = {
            concept_id: { uuid: conceptId },
            include_associations: true,
        };

        const stream = this.client.WatchConcept(request);
        
        return {
            on: (event, callback) => {
                if (event === 'data') {
                    stream.on('data', (event) => {
                        callback({
                            update_type: event.update_type,
                            concept_id: event.concept_id.uuid,
                            updated_concept: event.updated_concept ? this._conceptToObject(event.updated_concept) : null,
                            updated_association: event.updated_association ? this._associationToObject(event.updated_association) : null,
                            timestamp: event.timestamp,
                        });
                    });
                } else {
                    stream.on(event, callback);
                }
            },
            cancel: () => stream.cancel(),
        };
    }

    async healthCheck() {
        const request = { service: 'leafmind' };
        const response = await this._promisify('HealthCheck', request);
        
        return {
            status: response.status,
            version: response.version,
            uptime_seconds: response.uptime_seconds,
            memory_stats: response.memory_stats ? this._memoryStatsToObject(response.memory_stats) : null,
        };
    }

    // Helper methods to convert protobuf objects to JavaScript objects
    _conceptToObject(concept) {
        return {
            id: concept.id.uuid,
            content: concept.content,
            created_at: concept.created_at,
            last_accessed: concept.last_accessed,
            access_count: concept.access_count,
            metadata: concept.metadata,
        };
    }

    _associationToObject(association) {
        return {
            from_concept: association.from_concept.uuid,
            to_concept: association.to_concept.uuid,
            strength: association.strength,
            association_type: association.association_type,
            created_at: association.created_at,
            is_bidirectional: association.is_bidirectional,
        };
    }

    _recallResultToObject(result) {
        return {
            concept: this._conceptToObject(result.concept),
            relevance_score: result.relevance_score,
            path_length: result.path_length,
            connection_strength: result.connection_strength,
            path: result.path,
        };
    }

    _memoryStatsToObject(stats) {
        return {
            total_concepts: stats.total_concepts,
            short_term_concepts: stats.short_term_concepts,
            long_term_concepts: stats.long_term_concepts,
            total_associations: stats.total_associations,
            memory_usage_bytes: stats.memory_usage_bytes,
            consolidation_ratio: stats.consolidation_ratio,
        };
    }
}

// Example usage
async function main() {
    const client = new LeafMindGrpcClient('localhost:50051');
    
    if (await client.connect()) {
        try {
            // Learn some concepts
            const catId = await client.learnConcept('A small furry animal that meows', { type: 'animal' });
            const dogId = await client.learnConcept('A loyal animal that barks', { type: 'animal' });
            const petId = await client.learnConcept('A domesticated companion animal', { category: 'relationship' });
            
            console.log(`Learned concepts: cat=${catId}, dog=${dogId}, pet=${petId}`);
            
            // Create associations
            await client.createAssociation(catId, petId, 0.9, 'related', true);
            await client.createAssociation(dogId, petId, 0.8, 'related', true);
            
            // Recall related concepts
            const recallResults = await client.recallMemory({ sourceConceptId: petId, maxResults: 5 });
            console.log(`Recalled ${recallResults.results.length} related concepts`);
            
            // Stream recall results
            console.log('Streaming recall results...');
            const stream = client.streamingRecall({ sourceConceptId: petId });
            stream.on('data', (result) => {
                console.log(`Streamed result: ${result.concept.content} (relevance: ${result.relevance_score})`);
            });
            stream.on('end', () => {
                console.log('Streaming recall completed');
            });
            
            // Watch concept updates
            console.log('Watching concept updates...');
            const watcher = client.watchConcept(petId);
            watcher.on('data', (update) => {
                console.log(`Concept update: ${update.update_type}`);
                watcher.cancel(); // Stop watching after first update for demo
            });
            
            // Get memory statistics
            const stats = await client.getMemoryStats();
            console.log(`Memory stats: ${stats.total_concepts} concepts, ${stats.total_associations} associations`);
            
        } finally {
            client.close();
        }
    }
}

module.exports = LeafMindGrpcClient;

// Run example if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}