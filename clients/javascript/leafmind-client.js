/**
 * LeafMind JavaScript/Node.js Client SDK
 * 
 * A neuromorphic memory database client for JavaScript and TypeScript applications.
 */

import fetch from 'node-fetch';

/**
 * Configuration for memory recall operations
 */
export class RecallQuery {
    constructor({
        maxResults = 10,
        minRelevance = 0.1,
        useRecencyBoost = true,
        explorationBreadth = 5,
        maxPathLength = 3
    } = {}) {
        this.maxResults = maxResults;
        this.minRelevance = minRelevance;
        this.useRecencyBoost = useRecencyBoost;
        this.explorationBreadth = explorationBreadth;
        this.maxPathLength = maxPathLength;
    }
}

/**
 * Represents a concept in the LeafMind memory system
 */
export class Concept {
    constructor(data) {
        this.id = data.id;
        this.content = data.content;
        this.metadata = data.metadata || {};
        this.createdAt = data.created_at;
        this.lastAccessed = data.last_accessed;
        this.accessCount = data.access_count;
    }
}

/**
 * Represents a recall result with relevance score
 */
export class RecallResult {
    constructor(data) {
        this.concept = new Concept(data.concept);
        this.relevanceScore = data.relevance_score;
        this.pathLength = data.path_length;
        this.connectionStrength = data.connection_strength;
    }
}

/**
 * Custom error class for LeafMind API errors
 */
export class LeafMindError extends Error {
    constructor(message, status = null) {
        super(message);
        this.name = 'LeafMindError';
        this.status = status;
    }
}

/**
 * LeafMind Client for JavaScript/Node.js
 * 
 * This client provides a JavaScript interface to interact with a LeafMind API server,
 * allowing you to use LeafMind as a database from your JavaScript/Node.js applications.
 * 
 * @example
 * ```javascript
 * const client = new LeafMindClient('http://localhost:8080');
 * 
 * // Learn new concepts
 * const conceptId = await client.learn('JavaScript is a programming language');
 * 
 * // Create associations
 * const otherId = await client.learn('Programming requires logical thinking');
 * await client.associate(conceptId, otherId);
 * 
 * // Recall related memories
 * const results = await client.recallFromConcept(conceptId);
 * results.forEach(result => {
 *     console.log(`Recalled: ${result.concept.content} (score: ${result.relevanceScore})`);
 * });
 * ```
 */
export class LeafMindClient {
    /**
     * Initialize the LeafMind client
     * 
     * @param {string} baseUrl - The base URL of the LeafMind API server
     * @param {string} [apiKey] - Optional API key for authentication
     */
    constructor(baseUrl = 'http://localhost:8080', apiKey = null) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.apiKey = apiKey;
        this.headers = {
            'Content-Type': 'application/json',
        };
        
        if (this.apiKey) {
            this.headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
    }

    /**
     * Make an HTTP request to the API
     * @private
     */
    async _request(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            headers: this.headers,
        };

        if (data !== null) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorMessage;
                } catch {
                    // Use default error message if JSON parsing fails
                }
                
                throw new LeafMindError(errorMessage, response.status);
            }

            // Handle empty responses (like 204 No Content)
            if (response.status === 204) {
                return null;
            }

            return await response.json();
        } catch (error) {
            if (error instanceof LeafMindError) {
                throw error;
            }
            throw new LeafMindError(`Connection error: ${error.message}`);
        }
    }

    // Health and Status
    
    /**
     * Check the health status of the LeafMind server
     * @returns {Promise<Object>} Health status information
     */
    async healthCheck() {
        return await this._request('GET', '/health');
    }

    /**
     * Get memory system statistics
     * @returns {Promise<Object>} Memory statistics
     */
    async getStats() {
        return await this._request('GET', '/stats');
    }

    // Core Memory Operations

    /**
     * Learn a new concept
     * 
     * @param {string} content - The content of the concept to learn
     * @param {Object} [metadata] - Optional metadata object
     * @returns {Promise<string>} The UUID of the newly created concept
     */
    async learn(content, metadata = null) {
        const requestData = {
            content: content,
            metadata: metadata
        };
        const response = await this._request('POST', '/concepts', requestData);
        return response.concept_id;
    }

    /**
     * Retrieve a specific concept by ID
     * 
     * @param {string} conceptId - The UUID of the concept to retrieve
     * @returns {Promise<Concept|null>} The concept if found, null otherwise
     */
    async getConcept(conceptId) {
        try {
            const response = await this._request('GET', `/concepts/${conceptId}`);
            if (response?.concept) {
                return new Concept(response.concept);
            }
            return null;
        } catch (error) {
            if (error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * List all concepts with pagination
     * 
     * @param {number} [page=1] - Page number (1-indexed)
     * @param {number} [pageSize=50] - Number of concepts per page
     * @returns {Promise<Object>} Object with concepts list and pagination info
     */
    async listConcepts(page = 1, pageSize = 50) {
        return await this._request('GET', `/concepts?page=${page}&page_size=${pageSize}`);
    }

    /**
     * Delete a concept
     * 
     * @param {string} conceptId - The UUID of the concept to delete
     * @returns {Promise<boolean>} True if deleted successfully
     */
    async deleteConcept(conceptId) {
        try {
            await this._request('DELETE', `/concepts/${conceptId}`);
            return true;
        } catch (error) {
            if (error.status === 404) {
                return false;
            }
            throw error;
        }
    }

    /**
     * Access a concept (update access time and count)
     * 
     * @param {string} conceptId - The UUID of the concept to access
     * @returns {Promise<boolean>} True if accessed successfully
     */
    async accessConcept(conceptId) {
        try {
            await this._request('POST', `/concepts/${conceptId}/access`);
            return true;
        } catch (error) {
            if (error.status === 404) {
                return false;
            }
            throw error;
        }
    }

    // Association Operations

    /**
     * Create an association between two concepts
     * 
     * @param {string} fromConceptId - Source concept UUID
     * @param {string} toConceptId - Target concept UUID
     * @param {boolean} [bidirectional=false] - Whether to create a bidirectional association
     * @returns {Promise<boolean>} True if association created successfully
     */
    async associate(fromConceptId, toConceptId, bidirectional = false) {
        const requestData = {
            from_concept_id: fromConceptId,
            to_concept_id: toConceptId,
            bidirectional: bidirectional
        };
        const response = await this._request('POST', '/associations', requestData);
        return response?.edge_created || false;
    }

    /**
     * Remove an association between two concepts
     * 
     * @param {string} fromConceptId - Source concept UUID
     * @param {string} toConceptId - Target concept UUID
     * @returns {Promise<boolean>} True if association removed successfully
     */
    async removeAssociation(fromConceptId, toConceptId) {
        try {
            await this._request('DELETE', `/associations/${fromConceptId}/${toConceptId}`);
            return true;
        } catch (error) {
            if (error.status === 404) {
                return false;
            }
            throw error;
        }
    }

    // Recall Operations

    /**
     * Recall memories starting from a specific concept
     * 
     * @param {string} conceptId - The UUID of the source concept
     * @param {RecallQuery} [query] - Optional recall query configuration
     * @returns {Promise<RecallResult[]>} Array of recall results
     */
    async recallFromConcept(conceptId, query = null) {
        if (!query) {
            query = new RecallQuery();
        }

        const requestData = {
            source_concept_id: conceptId,
            max_results: query.maxResults,
            min_relevance: query.minRelevance,
            use_recency_boost: query.useRecencyBoost,
            exploration_breadth: query.explorationBreadth,
            max_path_length: query.maxPathLength
        };

        const response = await this._request('POST', '/recall', requestData);
        return response.results.map(result => new RecallResult(result));
    }

    /**
     * Recall memories by content similarity
     * 
     * @param {string} contentQuery - Text to search for
     * @param {RecallQuery} [query] - Optional recall query configuration
     * @returns {Promise<RecallResult[]>} Array of recall results
     */
    async recallByContent(contentQuery, query = null) {
        if (!query) {
            query = new RecallQuery();
        }

        const requestData = {
            content_query: contentQuery,
            max_results: query.maxResults,
            min_relevance: query.minRelevance,
            use_recency_boost: query.useRecencyBoost,
            exploration_breadth: query.explorationBreadth,
            max_path_length: query.maxPathLength
        };

        const response = await this._request('POST', '/recall/content', requestData);
        return response.results.map(result => new RecallResult(result));
    }

    /**
     * Perform spreading activation recall from a concept
     * 
     * @param {string} conceptId - The UUID of the source concept
     * @returns {Promise<RecallResult[]>} Array of recall results
     */
    async spreadingActivationRecall(conceptId) {
        const requestData = { source_concept_id: conceptId };
        const response = await this._request('POST', '/recall/spreading', requestData);
        return response.results.map(result => new RecallResult(result));
    }

    // Memory Management

    /**
     * Consolidate memory (move short-term to long-term)
     * @returns {Promise<Object>} Consolidation result
     */
    async consolidateMemory() {
        return await this._request('POST', '/memory/consolidate');
    }

    /**
     * Forget weak memories (cleanup)
     * @returns {Promise<Object>} Forgetting result
     */
    async forgetMemories() {
        return await this._request('POST', '/memory/forget');
    }

    /**
     * Optimize memory (consolidate + forget)
     * @returns {Promise<Object>} Optimization result
     */
    async optimizeMemory() {
        return await this._request('POST', '/memory/optimize');
    }

    // Persistence Operations

    /**
     * Save current memory state to disk
     * @returns {Promise<Object>} Save result
     */
    async saveToDisk() {
        const requestData = { action: 'Save' };
        return await this._request('POST', '/persistence', requestData);
    }

    /**
     * Load memory state from disk
     * @returns {Promise<Object>} Load result
     */
    async loadFromDisk() {
        const requestData = { action: 'Load' };
        return await this._request('POST', '/persistence', requestData);
    }

    /**
     * Create a backup of the database
     * @param {string} backupPath - Path for the backup
     * @returns {Promise<Object>} Backup result
     */
    async backupDatabase(backupPath) {
        const requestData = { action: { Backup: { path: backupPath } } };
        return await this._request('POST', '/persistence', requestData);
    }

    /**
     * Restore database from a backup
     * @param {string} backupPath - Path to the backup
     * @returns {Promise<Object>} Restore result
     */
    async restoreDatabase(backupPath) {
        const requestData = { action: { Restore: { path: backupPath } } };
        return await this._request('POST', '/persistence', requestData);
    }

    /**
     * Optimize database storage
     * @returns {Promise<Object>} Optimization result
     */
    async optimizeStorage() {
        const requestData = { action: 'Optimize' };
        return await this._request('POST', '/persistence', requestData);
    }

    /**
     * Get persistence statistics
     * @returns {Promise<Object|null>} Persistence statistics
     */
    async getPersistenceStats() {
        return await this._request('GET', '/persistence/stats');
    }

    // Batch Operations

    /**
     * Learn multiple concepts in a batch
     * 
     * @param {Array<Object>} concepts - Array of concept objects with 'content' and optional 'metadata'
     * @returns {Promise<Array<Object>>} Array of responses for each concept
     */
    async batchLearn(concepts) {
        return await this._request('POST', '/batch/learn', concepts);
    }

    /**
     * Create multiple associations in a batch
     * 
     * @param {Array<Object>} associations - Array of association objects
     * @returns {Promise<Array<Object>>} Array of responses for each association
     */
    async batchAssociate(associations) {
        return await this._request('POST', '/batch/associate', associations);
    }
}

// Convenience functions

/**
 * Quickly learn multiple concepts and optionally create associations between them
 * 
 * @param {LeafMindClient} client - LeafMind client instance
 * @param {string[]} concepts - Array of concept contents to learn
 * @param {boolean} [createAssociations=true] - Whether to create bidirectional associations between all concepts
 * @returns {Promise<string[]>} Array of concept IDs
 */
export async function quickLearnAndAssociate(client, concepts, createAssociations = true) {
    // Learn all concepts
    const conceptIds = [];
    for (const content of concepts) {
        const conceptId = await client.learn(content);
        conceptIds.push(conceptId);
    }

    // Create associations if requested
    if (createAssociations && conceptIds.length > 1) {
        for (let i = 0; i < conceptIds.length; i++) {
            for (let j = 0; j < conceptIds.length; j++) {
                if (i !== j) {
                    await client.associate(conceptIds[i], conceptIds[j], false);
                }
            }
        }
    }

    return conceptIds;
}

/**
 * Build a knowledge graph from concept pairs
 * 
 * @param {LeafMindClient} client - LeafMind client instance
 * @param {Array<[string, string]>} knowledgePairs - Array of [concept1, concept2] pairs to associate
 * @returns {Promise<Object>} Object mapping concept content to concept IDs
 */
export async function buildKnowledgeGraph(client, knowledgePairs) {
    const conceptMap = new Map();

    // Learn all unique concepts
    const allConcepts = new Set();
    for (const [concept1, concept2] of knowledgePairs) {
        allConcepts.add(concept1);
        allConcepts.add(concept2);
    }

    for (const concept of allConcepts) {
        const conceptId = await client.learn(concept);
        conceptMap.set(concept, conceptId);
    }

    // Create associations
    for (const [concept1, concept2] of knowledgePairs) {
        await client.associate(
            conceptMap.get(concept1),
            conceptMap.get(concept2),
            true // bidirectional
        );
    }

    return Object.fromEntries(conceptMap);
}