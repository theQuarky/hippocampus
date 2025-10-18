use leafmind::{
    ForgettingConfig, MemoryConfig, MemoryGraph, RecallQuery,
    LeafMindGrpcServer, GrpcServerConfig, HybridServer, HybridConfig
};
use std::collections::HashMap;
use std::env;
use tracing::{info, Level};
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    // Check command line arguments for server mode
    let args: Vec<String> = env::args().collect();
    
    match args.get(1).map(|s| s.as_str()) {
        Some("grpc") => {
            info!("🧠 Starting LeafMind gRPC Server");
            start_grpc_server().await?;
        },
        Some("hybrid") => {
            info!("🧠 Starting LeafMind Hybrid Server (gRPC + WebSocket)");
            start_hybrid_server().await?;
        },
        Some("demo") | None => {
            println!("🧠 LeafMind - Hippocampus-Inspired Memory System Demo");
            println!("==================================================\n");
            run_memory_demo().await?;
        },
        Some("help") | Some("--help") | Some("-h") => {
            print_help();
        },
        Some(cmd) => {
            println!("❌ Unknown command: {}", cmd);
            print_help();
        }
    }
    
    Ok(())
}

fn print_help() {
    println!("🧠 LeafMind - Hippocampus-Inspired Memory System");
    println!("==============================================\n");
    println!("Usage: leafmind [COMMAND]\n");
    println!("Commands:");
    println!("  demo     Run interactive memory system demonstration (default)");
    println!("  grpc     Start gRPC API server on port 50051");
    println!("  hybrid   Start hybrid server (gRPC + WebSocket) on ports 50051 & 8080");
    println!("  help     Show this help message\n");
    println!("Examples:");
    println!("  cargo run                # Run demo");
    println!("  cargo run -- grpc        # Start gRPC server");
    println!("  cargo run -- hybrid      # Start hybrid server");
}

async fn start_grpc_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = GrpcServerConfig {
        host: "127.0.0.1".to_string(),
        port: 50051,
        max_concurrent_streams: 1000,
        max_message_size: 4 * 1024 * 1024,
        keepalive_time: std::time::Duration::from_secs(30),
        keepalive_timeout: std::time::Duration::from_secs(5),
        enable_reflection: true,
    };
    
    // Create dummy memory for server (server creates its own)
    let dummy_memory = std::sync::Arc::new(42u32) as std::sync::Arc<dyn std::any::Any + Send + Sync>;
    let server = LeafMindGrpcServer::new(dummy_memory, config).await?;
    info!("🚀 gRPC Server starting on {}:{}", server.config().host, server.config().port);
    server.start().await?;
    Ok(())
}

async fn start_hybrid_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let config = HybridConfig {
        grpc_host: "127.0.0.1".to_string(),
        grpc_port: 50051,
        websocket_host: "127.0.0.1".to_string(),
        websocket_port: 8080,
        max_connections: 10000,
        ping_interval: std::time::Duration::from_secs(30),
        pong_timeout: std::time::Duration::from_secs(10),
        max_message_size: 1024 * 1024,
        enable_compression: true,
    };
    
    // Create dummy memory for server (server creates its own)
    let dummy_memory = std::sync::Arc::new(42u32) as std::sync::Arc<dyn std::any::Any + Send + Sync>;
    let server = HybridServer::new(dummy_memory, config).await?;
    info!("🚀 Hybrid Server starting:");
    info!("  📡 gRPC: {}:{}", server.config().grpc_host, server.config().grpc_port);
    info!("  🌐 WebSocket: {}:{}", server.config().websocket_host, server.config().websocket_port);
    server.start().await?;
    Ok(())
}

async fn run_memory_demo() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create memory system with custom configuration
    let config = MemoryConfig {
        learning_rate: 0.15,
        decay_rate: 0.02,
        consolidation_threshold: 0.4,
        max_short_term_connections: 1000,
        consolidation_interval_hours: 1, // Fast consolidation for demo
        max_recall_results: 10,
    };

    let memory = MemoryGraph::new(config);

    // Demonstrate learning and association
    demo_learning_and_association(&memory);
    
    // Demonstrate recall mechanisms
    demo_recall_mechanisms(&memory);
    
    // Demonstrate consolidation
    demo_consolidation(&memory);
    
    // Demonstrate plasticity
    demo_plasticity(&memory);
    
    // Demonstrate forgetting
    demo_forgetting(&memory);
    
    // Show final statistics
    show_final_stats(&memory);
    
    Ok(())
}

fn demo_learning_and_association(memory: &MemoryGraph) {
    println!("📚 LEARNING AND ASSOCIATION DEMO");
    println!("--------------------------------");

    // Create a knowledge network about animals
    let mut animal_concepts = HashMap::new();
    
    // Learn basic concepts
    animal_concepts.insert("cat", memory.learn("A small domesticated feline that meows and purrs".to_string()));
    animal_concepts.insert("dog", memory.learn("A loyal domesticated canine that barks and wags tail".to_string()));
    animal_concepts.insert("bird", memory.learn("A flying animal with feathers and wings".to_string()));
    animal_concepts.insert("fish", memory.learn("An aquatic animal that swims with fins".to_string()));
    animal_concepts.insert("pet", memory.learn("A domesticated animal kept for companionship".to_string()));
    animal_concepts.insert("mammal", memory.learn("A warm-blooded vertebrate animal with hair or fur".to_string()));
    animal_concepts.insert("vertebrate", memory.learn("An animal having a backbone or spinal column".to_string()));

    // Create hierarchical associations
    memory.associate_bidirectional(
        animal_concepts["cat"].clone(), 
        animal_concepts["pet"].clone()
    ).unwrap();
    
    memory.associate_bidirectional(
        animal_concepts["dog"].clone(), 
        animal_concepts["pet"].clone()
    ).unwrap();
    
    memory.associate_bidirectional(
        animal_concepts["cat"].clone(), 
        animal_concepts["mammal"].clone()
    ).unwrap();
    
    memory.associate_bidirectional(
        animal_concepts["dog"].clone(), 
        animal_concepts["mammal"].clone()
    ).unwrap();
    
    memory.associate_bidirectional(
        animal_concepts["mammal"].clone(), 
        animal_concepts["vertebrate"].clone()
    ).unwrap();

    // Create some cross-associations (like the brain does)
    memory.associate(animal_concepts["cat"].clone(), animal_concepts["dog"].clone()).unwrap();
    memory.associate(animal_concepts["bird"].clone(), animal_concepts["vertebrate"].clone()).unwrap();

    println!("✅ Created {} concepts with hierarchical associations", animal_concepts.len());
    
    let stats = memory.get_stats();
    println!("📊 Current stats: {}", stats);
    println!();
}

fn demo_recall_mechanisms(memory: &MemoryGraph) {
    println!("🔍 RECALL MECHANISMS DEMO");
    println!("-------------------------");

    // Get a pet concept for recall testing
    let pet_concepts: Vec<_> = memory.get_all_concept_ids();
    if let Some(pet_id) = pet_concepts.first() {
        // Test associative recall
        println!("🔗 Associative Recall:");
        let recall_query = RecallQuery {
            max_results: 5,
            min_relevance: 0.1,
            max_path_length: 2,
            include_semantic_similarity: false,
            use_recency_boost: true,
            exploration_breadth: 3,
        };
        
        let results = memory.recall(pet_id, recall_query);
        println!("Found {} related concepts:", results.len());
        for (i, result) in results.iter().enumerate() {
            println!("  {}. {} (score: {:.3}, path length: {})", 
                i + 1, 
                result.concept.content.chars().take(50).collect::<String>(),
                result.relevance_score,
                result.association_path.len()
            );
        }
        
        // Test content-based recall
        println!("\n🔤 Content-Based Recall for 'furry animal':");
        let content_results = memory.recall_by_content("furry animal", RecallQuery::default());
        for (i, result) in content_results.iter().take(3).enumerate() {
            println!("  {}. {} (similarity: {:.3})", 
                i + 1, 
                result.concept.content.chars().take(50).collect::<String>(),
                result.relevance_score
            );
        }
        
        // Test spreading activation
        println!("\n⚡ Spreading Activation Recall:");
        let activation_results = memory.spreading_activation_recall(
            &pet_concepts[..2.min(pet_concepts.len())], 
            0.2, 
            3
        );
        println!("Activation spread to {} concepts", activation_results.len());
    }
    
    println!();
}

fn demo_consolidation(memory: &MemoryGraph) {
    println!("🏛️ MEMORY CONSOLIDATION DEMO");
    println!("----------------------------");

    // Access some concepts multiple times to strengthen them
    let concept_ids = memory.get_all_concept_ids();
    for concept_id in concept_ids.iter().take(3) {
        for _ in 0..5 {
            let _ = memory.access_concept(concept_id);
        }
    }

    // Apply Hebbian strengthening
    if concept_ids.len() >= 3 {
        memory.hebbian_strengthening(&concept_ids[..3]);
        println!("✅ Applied Hebbian strengthening to co-activated concepts");
    }

    // Force consolidation (normally this would happen automatically)
    println!("🔄 Running memory consolidation...");
    let consolidation_stats = memory.force_consolidation();
    
    println!("📈 Consolidation Results:");
    println!("  • Promoted to long-term: {}", consolidation_stats.promoted_to_long_term);
    println!("  • Pruned weak connections: {}", consolidation_stats.pruned_weak_connections);
    println!("  • Reactivated connections: {}", consolidation_stats.reactivated_connections);
    println!("  • Total long-term after: {}", consolidation_stats.total_long_term_after);
    
    println!();
}

fn demo_plasticity(memory: &MemoryGraph) {
    println!("🧬 SYNAPTIC PLASTICITY DEMO");
    println!("--------------------------");

    // Apply LTP strengthening
    memory.apply_ltp_strengthening();
    println!("⬆️ Applied Long-Term Potentiation (LTP) strengthening");

    // Apply LTD decay
    memory.apply_ltd_decay();
    println!("⬇️ Applied Long-Term Depression (LTD) decay");

    // Simulate a sleep cycle (combines plasticity mechanisms)
    memory.sleep_cycle();
    println!("😴 Completed sleep cycle (memory consolidation and cleanup)");

    let stats = memory.get_stats();
    println!("📊 Stats after plasticity: {} connections total", 
        stats.short_term_connections + stats.long_term_connections);
    
    println!();
}

fn demo_forgetting(memory: &MemoryGraph) {
    println!("🗑️ FORGETTING MECHANISM DEMO");
    println!("-----------------------------");

    let forgetting_config = ForgettingConfig {
        concept_isolation_threshold: 1,
        unused_concept_days: 1, // Very short for demo
        weak_connection_threshold: 0.1,
        aggressive_forgetting: false,
    };

    // Show forgetting candidates
    let candidates = memory.get_forgetting_candidates(&forgetting_config);
    println!("🎯 Found {} candidates for forgetting", candidates.len());

    // Apply forgetting
    let forgetting_stats = memory.forget(forgetting_config);
    
    println!("📉 Forgetting Results:");
    println!("  • Concepts forgotten: {}", forgetting_stats.concepts_forgotten);
    println!("  • Connections pruned: {}", forgetting_stats.connections_pruned);
    println!("  • Weak connections decayed: {}", forgetting_stats.weak_connections_decayed);
    println!("  • Isolated concepts removed: {}", forgetting_stats.isolated_concepts_removed);
    
    println!();
}

fn show_final_stats(memory: &MemoryGraph) {
    println!("📈 FINAL MEMORY SYSTEM STATISTICS");
    println!("==================================");
    
    let stats = memory.get_stats();
    println!("{}", stats);
    
    println!("\n🎯 Key Features Demonstrated:");
    println!("  ✅ Neuromorphic memory graph with concepts and synaptic connections");
    println!("  ✅ Long-Term Potentiation (LTP) and Long-Term Depression (LTD)");
    println!("  ✅ Hippocampus-style memory consolidation");
    println!("  ✅ Associative recall with spreading activation");
    println!("  ✅ Content-based semantic similarity recall");
    println!("  ✅ Natural forgetting and memory interference");
    println!("  ✅ Working memory and sleep-like consolidation cycles");
    
    println!("\n🧠 This demonstrates a brain-inspired memory system that:");
    println!("  • Learns through experience and strengthens frequently used connections");
    println!("  • Consolidates important memories from short-term to long-term storage");
    println!("  • Recalls information through associative pathways");
    println!("  • Naturally forgets unused information to prevent interference");
    println!("  • Adapts and reorganizes itself like biological neural networks");
    
    println!("\n🚀 Ready for integration into larger AI systems!");
}
