use leafmind::{
    PersistentMemoryGraph, MemoryGraphFactory, MemoryConfig, PersistenceConfig, RecallQuery
};
use std::path::PathBuf;
use tracing::{info, warn};
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    info!("🧠 LeafMind Persistent Database Demo");
    
    // Create a persistent memory graph
    let persistence_config = PersistenceConfig {
        db_path: PathBuf::from("demo_brain.db"),
        auto_save_interval_seconds: 10, // Save every 10 seconds
        batch_size: 1000,
        enable_compression: true,
        max_cache_size: 10000,
        enable_wal: true,
    };

    info!("📀 Creating persistent memory graph...");
    let memory = PersistentMemoryGraph::new(
        MemoryConfig::default(),
        persistence_config
    ).await?;

    // Check if we have existing data
    let initial_stats = memory.get_stats();
    if initial_stats.total_concepts > 0 {
        info!("📚 Found existing database with {} concepts!", initial_stats.total_concepts);
        
        // Show some existing concepts
        let concept_ids = memory.get_all_concept_ids();
        info!("🔍 First few concepts:");
        for (i, id) in concept_ids.iter().take(3).enumerate() {
            if let Some(concept) = memory.get_concept(id) {
                info!("  {}. {}", i + 1, concept.content);
            }
        }
    } else {
        info!("🆕 Creating new knowledge base...");
        
        // Create a knowledge base about AI and neuroscience
        let ai_concepts = vec![
            "Artificial Intelligence: Computer systems that can perform tasks requiring human intelligence",
            "Machine Learning: AI subset that enables computers to learn without explicit programming",
            "Neural Networks: Computing systems inspired by biological neural networks",
            "Deep Learning: Machine learning using neural networks with multiple layers",
            "Natural Language Processing: AI field focused on human-computer language interaction",
            "Computer Vision: AI field that enables computers to interpret visual information",
            "Reinforcement Learning: ML technique where agents learn through rewards and penalties",
        ];

        let neuroscience_concepts = vec![
            "Neuron: Basic unit of the nervous system that transmits information",
            "Synapse: Connection point between neurons for signal transmission",
            "Hippocampus: Brain region crucial for memory formation and learning",
            "Cortex: Outer layer of the brain responsible for complex cognitive functions",
            "Plasticity: Brain's ability to reorganize and form new neural connections",
            "Long-term Potentiation: Persistent strengthening of synapses based on activity",
            "Memory Consolidation: Process of stabilizing memory traces after initial acquisition",
        ];

        info!("📖 Learning AI concepts...");
        let mut ai_concept_ids = Vec::new();
        for concept_text in ai_concepts {
            let id = memory.learn(concept_text.to_string()).await?;
            ai_concept_ids.push(id);
        }

        info!("🧠 Learning neuroscience concepts...");
        let mut neuro_concept_ids = Vec::new();
        for concept_text in neuroscience_concepts {
            let id = memory.learn(concept_text.to_string()).await?;
            neuro_concept_ids.push(id);
        }

        info!("🔗 Creating associations within domains...");
        // Create associations within AI concepts
        for i in 0..ai_concept_ids.len() {
            for j in (i + 1)..ai_concept_ids.len() {
                memory.associate(ai_concept_ids[i].clone(), ai_concept_ids[j].clone()).await?;
            }
        }

        // Create associations within neuroscience concepts
        for i in 0..neuro_concept_ids.len() {
            for j in (i + 1)..neuro_concept_ids.len() {
                memory.associate(neuro_concept_ids[i].clone(), neuro_concept_ids[j].clone()).await?;
            }
        }

        info!("🌉 Creating cross-domain associations...");
        // Create some cross-domain associations
        let cross_associations = vec![
            (0, 2), // AI -> Neural Networks
            (2, 0), // Neural Networks -> Neuron
            (4, 1), // Plasticity -> Machine Learning  
            (5, 2), // LTP -> Neural Networks
            (6, 4), // Memory Consolidation -> Plasticity
        ];

        for (ai_idx, neuro_idx) in cross_associations {
            if ai_idx < ai_concept_ids.len() && neuro_idx < neuro_concept_ids.len() {
                memory.associate(
                    ai_concept_ids[ai_idx].clone(), 
                    neuro_concept_ids[neuro_idx].clone()
                ).await?;
            }
        }
    }

    // Force save to ensure everything is persisted
    info!("💾 Saving to database...");
    memory.force_save().await?;

    // Demonstrate recall functionality
    info!("🔍 Testing memory recall...");
    let all_concept_ids = memory.get_all_concept_ids();
    
    if let Some(first_concept_id) = all_concept_ids.first() {
        if let Some(concept) = memory.get_concept(first_concept_id) {
            info!("🎯 Starting recall from: '{}'", concept.content);
            
            let recall_results = memory.memory_graph().recall(first_concept_id, RecallQuery {
                max_results: Some(5),
                min_relevance: 0.1,
                max_path_length: 2,
                boost_recent_memories: true,
                ..RecallQuery::default()
            });

            info!("💡 Related concepts found:");
            for (i, result) in recall_results.iter().enumerate() {
                info!("  {}. {} (relevance: {:.3})", 
                     i + 1, 
                     result.concept.content, 
                     result.relevance_score);
            }
        }
    }

    // Show memory access patterns
    info!("🧮 Simulating memory access and strengthening...");
    for _ in 0..5 {
        if let Some(concept_id) = all_concept_ids.get(rand::random::<usize>() % all_concept_ids.len()) {
            memory.access_concept(concept_id).await?;
        }
    }

    // Get comprehensive statistics
    let (memory_stats, persistence_stats) = memory.get_combined_stats().await;
    
    info!("📊 Memory Statistics:");
    info!("  📚 Total concepts: {}", memory_stats.total_concepts);
    info!("  🔗 Short-term connections: {}", memory_stats.short_term_connections);
    info!("  🏛️ Long-term connections: {}", memory_stats.long_term_connections);
    info!("  🧠 Working memory size: {}", memory_stats.working_memory_size);
    
    info!("💽 Persistence Statistics:");
    info!("  📁 Database size: {} bytes", persistence_stats.database_size_bytes);
    info!("  💾 Concepts stored: {}", persistence_stats.total_concepts_stored);
    info!("  🔗 Edges stored: {}", persistence_stats.total_edges_stored);
    info!("  📈 Cache hit rate: {:.1}%", persistence_stats.cache_hit_rate * 100.0);
    info!("  🔄 Save operations: {}", persistence_stats.save_count);

    // Demonstrate backup functionality
    info!("🔄 Creating database backup...");
    memory.backup("demo_brain_backup.db").await?;
    info!("✅ Backup created successfully!");

    // Show that data persists across sessions
    info!("🔄 Demonstrating persistence across sessions...");
    drop(memory); // Close first instance

    // Create new instance - should load existing data
    info!("🔌 Reconnecting to database...");
    let memory2 = PersistentMemoryGraph::new(
        MemoryConfig::default(),
        PersistenceConfig {
            db_path: PathBuf::from("demo_brain.db"),
            auto_save_interval_seconds: 0, // Disable auto-save for demo
            batch_size: 1000,
            enable_compression: true,
            max_cache_size: 10000,
            enable_wal: true,
        }
    ).await?;

    let reloaded_stats = memory2.get_stats();
    info!("✅ Successfully reloaded {} concepts from database!", reloaded_stats.total_concepts);

    // Demonstrate different memory graph types
    info!("🏭 Demonstrating factory patterns...");
    
    info!("⚡ Creating high-performance memory graph...");
    let _hp_memory = MemoryGraphFactory::create_high_performance().await?;
    info!("✅ High-performance memory graph created");
    
    info!("🔬 Creating research-optimized memory graph...");
    let _research_memory = MemoryGraphFactory::create_research_optimized().await?;
    info!("✅ Research-optimized memory graph created");

    // Clean up demo
    info!("🧹 Demo completed! Database files:");
    info!("  📁 Main database: demo_brain.db");
    info!("  💾 Backup: demo_brain_backup.db");
    info!("  ⚡ High-performance: leafmind_hp.db");
    info!("  🔬 Research: leafmind_research.db");

    info!("🎉 LeafMind persistent database demo completed successfully!");
    info!("💡 Your knowledge base is now permanently stored and will persist across application restarts.");

    Ok(())
}