#!/usr/bin/env node

/**
 * LeafMind JavaScript Client Example
 * 
 * This example demonstrates how to use LeafMind as a database from JavaScript/Node.js.
 */

import { LeafMindClient, RecallQuery, quickLearnAndAssociate, buildKnowledgeGraph } from './leafmind-client.js';

async function basicExample() {
    console.log('🧠 LeafMind JavaScript Client Demo');
    console.log('='.repeat(40));
    
    const client = new LeafMindClient('http://localhost:8080');
    
    try {
        // Check server health
        const health = await client.healthCheck();
        console.log(`✅ Server status: ${health.status}`);
        console.log(`📊 Memory stats: ${health.memory_stats.total_concepts} concepts`);
    } catch (error) {
        console.log(`❌ Failed to connect to server: ${error.message}`);
        console.log('Make sure the LeafMind server is running on localhost:8080');
        return;
    }
    
    console.log('\n1. Learning new concepts...');
    
    // Learn some concepts about web development
    const jsId = await client.learn('JavaScript is a dynamic programming language for web development');
    const reactId = await client.learn('React is a JavaScript library for building user interfaces');
    const webId = await client.learn('Web development involves creating websites and web applications');
    const apiId = await client.learn('APIs enable communication between different software systems');
    
    console.log(`   Learned JavaScript concept: ${jsId}`);
    console.log(`   Learned React concept: ${reactId}`);
    
    console.log('\n2. Creating associations...');
    
    // Create associations between concepts
    await client.associate(jsId, reactId, true);        // JavaScript <-> React
    await client.associate(jsId, webId, true);          // JavaScript <-> Web Development  
    await client.associate(reactId, webId, false);      // React -> Web Development
    await client.associate(webId, apiId, true);         // Web Development <-> APIs
    
    console.log('   ✅ Created associations between related concepts');
    
    console.log('\n3. Recalling memories from JavaScript concept...');
    
    // Recall memories starting from JavaScript
    const results = await client.recallFromConcept(jsId);
    for (let i = 0; i < Math.min(results.length, 3); i++) {
        const result = results[i];
        console.log(`   ${i + 1}. ${result.concept.content}`);
        console.log(`      Relevance: ${result.relevanceScore.toFixed(3)}, Strength: ${result.connectionStrength.toFixed(3)}`);
    }
    
    console.log('\n4. Content-based recall...');
    
    // Search by content
    const searchResults = await client.recallByContent('web');
    console.log(`   Found ${searchResults.length} results for 'web':`);
    for (let i = 0; i < Math.min(searchResults.length, 2); i++) {
        const result = searchResults[i];
        console.log(`   - ${result.concept.content} (score: ${result.relevanceScore.toFixed(3)})`);
    }
    
    console.log('\n5. Spreading activation recall...');
    
    // Spreading activation from React
    const spreadResults = await client.spreadingActivationRecall(reactId);
    console.log(`   Found ${spreadResults.length} concepts through spreading activation:`);
    for (let i = 0; i < Math.min(spreadResults.length, 3); i++) {
        const result = spreadResults[i];
        console.log(`   - ${result.concept.content} (activation: ${result.relevanceScore.toFixed(3)})`);
    }
    
    console.log('\n6. Memory management...');
    
    // Consolidate and optimize memory
    const consolidationResult = await client.consolidateMemory();
    console.log(`   ✅ Consolidated ${consolidationResult.consolidated_connections || 0} connections`);
    
    const optimizeResult = await client.optimizeMemory();
    console.log(`   ✅ Memory optimization completed`);
    
    console.log('\n7. Saving to persistent storage...');
    
    // Save to disk
    const saveResult = await client.saveToDisk();
    if (saveResult.success) {
        console.log('   ✅ Memory saved to disk successfully');
    }
    
    // Get final stats
    const stats = await client.getStats();
    console.log('\n📈 Final Stats:');
    console.log(`   Total concepts: ${stats.total_concepts}`);
    console.log(`   Short-term connections: ${stats.short_term_connections}`); 
    console.log(`   Long-term connections: ${stats.long_term_connections}`);
}

async function knowledgeGraphExample() {
    console.log('\n' + '='.repeat(40));
    console.log('🕸️  Knowledge Graph Example');
    console.log('='.repeat(40));
    
    const client = new LeafMindClient('http://localhost:8080');
    
    // Define knowledge as concept pairs
    const knowledgePairs = [
        ['Frontend Development', 'Web Development'],
        ['Backend Development', 'Web Development'],
        ['JavaScript', 'Frontend Development'],
        ['Node.js', 'Backend Development'],
        ['React', 'JavaScript'],
        ['Express.js', 'Node.js'],
        ['Database', 'Backend Development'],
        ['REST API', 'Backend Development'],
        ['HTML', 'Frontend Development'],
        ['CSS', 'Frontend Development'],
    ];
    
    console.log('Building knowledge graph...');
    const conceptMap = await buildKnowledgeGraph(client, knowledgePairs);
    
    console.log(`✅ Created knowledge graph with ${Object.keys(conceptMap).length} concepts`);
    
    // Explore connections starting from "Web Development"
    const webDevId = conceptMap['Web Development'];
    console.log(`\n🔍 Exploring from 'Web Development' (ID: ${webDevId})...`);
    
    // Use spreading activation to find related concepts
    const related = await client.spreadingActivationRecall(webDevId);
    console.log(`Found ${related.length} related concepts:`);
    
    for (let i = 0; i < Math.min(related.length, 5); i++) {
        const result = related[i];
        console.log(`   ${i + 1}. ${result.concept.content}`);
        console.log(`      Connection strength: ${result.connectionStrength.toFixed(3)}`);
    }
}

async function batchOperationsExample() {
    console.log('\n' + '='.repeat(40));
    console.log('⚡ Batch Operations Example');
    console.log('='.repeat(40));
    
    const client = new LeafMindClient('http://localhost:8080');
    
    // Prepare batch data for programming languages
    const languageConcepts = [
        { content: 'Python: High-level, interpreted programming language', metadata: { type: 'language', paradigm: 'multi' } },
        { content: 'JavaScript: Dynamic, prototype-based programming language', metadata: { type: 'language', paradigm: 'multi' } },
        { content: 'Rust: Systems programming language focusing on safety', metadata: { type: 'language', paradigm: 'multi' } },
        { content: 'Go: Statically typed, compiled programming language', metadata: { type: 'language', paradigm: 'concurrent' } },
        { content: 'TypeScript: Typed superset of JavaScript', metadata: { type: 'language', paradigm: 'typed' } },
    ];
    
    console.log(`Learning ${languageConcepts.length} programming languages in batch...`);
    
    // Batch learn
    const learnResults = await client.batchLearn(languageConcepts);
    const languageIds = learnResults
        .filter(result => result.concept_id)
        .map(result => result.concept_id);
    
    console.log(`✅ Learned ${languageIds.length} languages successfully`);
    
    // Create associations between all languages
    const associations = [];
    for (let i = 0; i < languageIds.length; i++) {
        for (let j = i + 1; j < languageIds.length; j++) {
            associations.push({
                from_concept_id: languageIds[i],
                to_concept_id: languageIds[j],
                bidirectional: true
            });
        }
    }
    
    console.log(`Creating ${associations.length} associations in batch...`);
    const associationResults = await client.batchAssociate(associations);
    const successfulAssociations = associationResults.filter(result => result.edge_created).length;
    
    console.log(`✅ Created ${successfulAssociations} associations`);
    
    // Test recall from one of the languages
    if (languageIds.length > 0) {
        console.log('\n🔍 Recalling from first language...');
        const recallResults = await client.recallFromConcept(languageIds[0]);
        for (let i = 0; i < Math.min(recallResults.length, 3); i++) {
            const result = recallResults[i];
            console.log(`   - ${result.concept.content}`);
        }
    }
}

async function performanceExample() {
    console.log('\n' + '='.repeat(40));
    console.log('🚀 Performance Example');
    console.log('='.repeat(40));
    
    const client = new LeafMindClient('http://localhost:8080');
    
    console.log('Testing rapid concept creation and recall...');
    
    const startTime = Date.now();
    const conceptIds = [];
    
    // Create 50 concepts rapidly
    for (let i = 0; i < 50; i++) {
        const conceptId = await client.learn(`Concept number ${i}: This is test data for performance testing`);
        conceptIds.push(conceptId);
        
        if (i > 0) {
            // Create association with previous concept
            await client.associate(conceptIds[i-1], conceptId);
        }
    }
    
    const createTime = Date.now() - startTime;
    console.log(`✅ Created 50 concepts and 49 associations in ${createTime}ms`);
    
    // Test recall performance
    const recallStartTime = Date.now();
    const recallResults = await client.recallFromConcept(conceptIds[0]);
    const recallTime = Date.now() - recallStartTime;
    
    console.log(`✅ Recalled ${recallResults.length} related concepts in ${recallTime}ms`);
    
    // Consolidate and save
    console.log('Consolidating and saving...');
    await client.consolidateMemory();
    await client.saveToDisk();
    console.log('✅ Memory consolidated and saved');
}

async function main() {
    try {
        await basicExample();
        await knowledgeGraphExample();
        await batchOperationsExample();
        await performanceExample();
        
        console.log('\n' + '='.repeat(40));
        console.log('🎉 All examples completed successfully!');
        console.log('LeafMind is working as a neuromorphic database! 🧠💾');
        
    } catch (error) {
        if (error.name === 'LeafMindError') {
            console.log(`\n❌ LeafMind API Error: ${error.message}`);
        } else {
            console.log(`\n❌ Error running examples: ${error.message}`);
        }
        console.log('Make sure the LeafMind server is running: cargo run --bin leafmind-server');
        process.exit(1);
    }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
    console.log('\n⏹️  Examples interrupted by user');
    process.exit(0);
});

main();