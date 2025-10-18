# 🚀 LeafMind Quick Start Guide

Get up and running with LeafMind in just a few minutes! This guide will walk you through creating your first brain-inspired memory system.

## 📦 Installation

### Option 1: Add to Existing Project

Add LeafMind to your `Cargo.toml`:

```toml
[dependencies]
leafmind = "0.1.0"
tokio = { version = "1.0", features = ["full"] }  # Required for persistent storage
tracing = "0.1"                                   # For logging (optional)
tracing-subscriber = "0.3"                        # For logging (optional)
```

### Option 2: Clone and Build

```bash
git clone https://github.com/your-org/leafmind.git
cd leafmind
cargo build --release
cargo run  # Run the demo
```

## 🎯 Your First Memory System

Let's create a simple animal knowledge network:

```rust
use leafmind::{MemoryGraph, RecallQuery};

fn main() {
    // 1. Create a memory system
    let memory = MemoryGraph::new_with_defaults();
    
    // 2. Learn some concepts
    let cat_id = memory.learn("A small furry animal that meows and purrs".to_string());
    let dog_id = memory.learn("A loyal furry animal that barks and wags tail".to_string());
    let pet_id = memory.learn("A domesticated animal kept for companionship".to_string());
    
    // 3. Create associations (like synaptic connections)
    memory.associate_bidirectional(cat_id.clone(), pet_id.clone()).unwrap();
    memory.associate_bidirectional(dog_id.clone(), pet_id.clone()).unwrap();
    
    // 4. Simulate brain activity by accessing concepts
    memory.access_concept(&cat_id).unwrap();
    memory.access_concept(&pet_id).unwrap();
    
    // 5. Recall related concepts (like memory retrieval)
    let results = memory.recall(&pet_id, RecallQuery::default());
    
    println!("🧠 When I think of 'pet', I also remember:");
    for result in results {
        println!("  • {} (relevance: {:.2})", 
                 result.concept.content.chars().take(50).collect::<String>(),
                 result.relevance_score);
    }
    
    // 6. Apply brain-like memory consolidation
    let stats = memory.consolidate_memory();
    println!("\n💾 Memory consolidation: {} connections moved to long-term storage", 
             stats.promoted_to_long_term);
    
    // 7. Check memory statistics
    let memory_stats = memory.get_stats();
    println!("\n📊 Memory system stats:");
    println!("  Concepts: {}", memory_stats.total_concepts);
    println!("  Short-term connections: {}", memory_stats.short_term_connections);
    println!("  Long-term connections: {}", memory_stats.long_term_connections);
}
```

**Expected Output:**
```
🧠 When I think of 'pet', I also remember:
  • A small furry animal that meows and purrs (relevance: 0.85)
  • A loyal furry animal that barks and wags tail (relevance: 0.85)

💾 Memory consolidation: 2 connections moved to long-term storage

📊 Memory system stats:
  Concepts: 3
  Short-term connections: 0
  Long-term connections: 4
```

## 🧠 Understanding the Brain-Like Behavior

### 1. **Learning (Neurogenesis)**
```rust
let concept_id = memory.learn("New information".to_string());
// Creates a new "neuron" (concept) in the memory network
```

### 2. **Association (Synaptogenesis)**
```rust
memory.associate(concept_a, concept_b).unwrap();
// Creates a "synapse" (connection) between concepts
```

### 3. **Strengthening (Long-Term Potentiation)**
```rust
memory.access_concept(&concept_id).unwrap();
// Strengthens connections involving this concept (like repeated neural firing)
```

### 4. **Consolidation (Sleep-like Processing)**
```rust
let stats = memory.consolidate_memory();
// Moves important memories from hippocampus to cortex (like during sleep)
```

### 5. **Forgetting (Synaptic Pruning)**
```rust
memory.sleep_cycle(); // Includes natural forgetting of weak connections
```

## 🔍 Exploring Different Recall Types

### Associative Recall (Following Neural Pathways)

```rust
// Find concepts connected through associative pathways
let results = memory.recall(&starting_concept, RecallQuery {
    max_results: Some(5),
    min_relevance: 0.1,
    max_path_length: 3,  // How many "hops" through connections
    boost_recent_memories: true,
    ..RecallQuery::default()
});
```

### Content-Based Recall (Semantic Similarity)

```rust
// Find concepts similar to a text query
let results = memory.recall_by_content("furry pet animal", RecallQuery::default());

for result in results {
    println!("Similar concept: {} (similarity: {:.2})", 
             result.concept.content, result.relevance_score);
}
```

### Spreading Activation Recall (Neural Network Style)

```rust
// Start with multiple concepts and let activation spread
let seed_concepts = vec![cat_id, dog_id];
let results = memory.spreading_activation_recall(&seed_concepts, 0.2, 5);

println!("Neural activation spread to {} concepts", results.len());
```

## 💾 **NEW: Persistent Memory (Database Storage)**

### Your First Persistent Memory System

LeafMind can now permanently store memories to disk! Here's how to create a persistent version:

```rust
use leafmind::{PersistentMemoryGraph, MemoryConfig, PersistenceConfig};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 1. Create a persistent memory system (automatically saves to disk)
    let memory = PersistentMemoryGraph::new_with_defaults().await?;
    
    // 2. Learn concepts (automatically persisted)
    let ai_id = memory.learn("Artificial Intelligence: Computer systems that mimic human thinking".to_string()).await?;
    let ml_id = memory.learn("Machine Learning: AI systems that improve through experience".to_string()).await?;
    let dl_id = memory.learn("Deep Learning: ML using neural networks with many layers".to_string()).await?;
    
    // 3. Create associations (automatically saved)
    memory.associate(ai_id.clone(), ml_id.clone()).await?;
    memory.associate(ml_id.clone(), dl_id.clone()).await?;
    
    // 4. Access concepts (updates database)
    memory.access_concept(&ai_id).await?;
    
    // 5. Get statistics
    let (memory_stats, persistence_stats) = memory.get_combined_stats().await;
    println!("📊 Persistent Memory Stats:");
    println!("  Concepts: {}", memory_stats.total_concepts);
    println!("  Database size: {} bytes", persistence_stats.database_size_bytes);
    println!("  Cache hit rate: {:.1}%", persistence_stats.cache_hit_rate * 100.0);
    
    // 6. Force save (optional - auto-saves every 5 minutes by default)
    memory.force_save().await?;
    
    // 7. Create backup
    memory.backup("my_ai_knowledge_backup.db").await?;
    println!("✅ Knowledge permanently stored and backed up!");
    
    Ok(())
    // Memory is automatically saved when program ends
}
```

### Quick Persistent Setup Options

```rust
use leafmind::MemoryGraphFactory;

#[tokio::main] 
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Option 1: Default persistent memory
    let memory1 = PersistentMemoryGraph::new_with_defaults().await?;
    
    // Option 2: High-performance setup (frequent saves, large cache)
    let memory2 = MemoryGraphFactory::create_high_performance().await?;
    
    // Option 3: Research-optimized (balanced accuracy/speed)
    let memory3 = MemoryGraphFactory::create_research_optimized().await?;
    
    // Option 4: Custom configuration
    let memory4 = MemoryGraphFactory::create_persistent(
        MemoryConfig::default(),
        PersistenceConfig {
            db_path: PathBuf::from("my_brain.db"),
            auto_save_interval_seconds: 30,  // Save every 30 seconds
            enable_compression: true,        // Compress data
            max_cache_size: 50000,          // 50k items in memory
            ..PersistenceConfig::default()
        }
    ).await?;
    
    Ok(())
}
```

### Key Persistent Features

#### 🔄 **Auto-Save** 
Your memories are automatically saved every 5 minutes (configurable).

#### 🛡️ **Crash Recovery**
Write-Ahead Logging ensures no data loss during unexpected shutdowns.

#### 💾 **Backup & Restore**
```rust
// Create backup
memory.backup("backup.db").await?;

// Restore from backup (creates new instance)
let mut restored_memory = PersistentMemoryGraph::new_with_defaults().await?;
restored_memory.restore("backup.db").await?;
```

#### ⚡ **Performance**
- Intelligent caching for fast access
- Batch operations for efficiency  
- Compression for storage savings
- Concurrent read/write support

#### 📊 **Monitoring**
```rust
let (memory_stats, persistence_stats) = memory.get_combined_stats().await;
println!("Cache hit rate: {:.1}%", persistence_stats.cache_hit_rate * 100.0);
println!("Database size: {} bytes", persistence_stats.database_size_bytes);
```

### 🔄 **Session Persistence Demo**

The real power of persistent memory is that your knowledge survives program restarts:

```rust
// Session 1: Create and save knowledge
async fn session_1() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let memory = PersistentMemoryGraph::new_with_defaults().await?;
    
    let rust_id = memory.learn("Rust: Systems programming language focused on safety".to_string()).await?;
    let memory_id = memory.learn("Memory management: Controlling how programs use RAM".to_string()).await?;
    memory.associate(rust_id, memory_id).await?;
    
    memory.force_save().await?;
    println!("💾 Knowledge saved to database");
    Ok(())
}

// Session 2: Load and use existing knowledge  
async fn session_2() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let memory = PersistentMemoryGraph::new_with_defaults().await?;
    
    let stats = memory.get_stats();
    println!("🔄 Loaded {} concepts from previous session!", stats.total_concepts);
    
    // Your memories are still there!
    let concept_ids = memory.get_all_concept_ids();
    for id in concept_ids.iter().take(2) {
        if let Some(concept) = memory.get_concept(id) {
            println!("📚 Remembered: {}", concept.content);
        }
    }
    
    Ok(())
}
```

## 🧬 Advanced Brain-Like Features

### Hebbian Learning ("Neurons that fire together, wire together")

```rust
// Strengthen connections between simultaneously active concepts
let active_concepts = vec![cat_id, pet_id, mammal_id];
memory.hebbian_strengthening(&active_concepts);
```

### Synaptic Plasticity (LTP/LTD)

```rust
// Manually apply brain-like plasticity
memory.apply_ltp_strengthening(); // Strengthen frequently used connections
memory.apply_ltd_decay();         // Weaken unused connections
```

### Sleep-Like Memory Processing

```rust
// Simulate sleep cycle: consolidation + cleanup + reorganization
memory.sleep_cycle();
```

### Natural Forgetting

```rust
use leafmind::ForgettingConfig;

let forgetting_config = ForgettingConfig {
    unused_concept_days: 30,        // Forget concepts unused for 30 days
    weak_connection_threshold: 0.1, // Remove very weak connections
    aggressive_forgetting: false,   // Conservative forgetting
    ..ForgettingConfig::default()
};

let stats = memory.forget(forgetting_config);
println!("Forgot {} concepts naturally", stats.concepts_forgotten);
```

## 📈 Building Larger Knowledge Networks

### Hierarchical Knowledge

```rust
fn build_animal_hierarchy() -> MemoryGraph {
    let memory = MemoryGraph::new_with_defaults();
    
    // Create hierarchy: Animal -> Mammal -> Pet -> Cat/Dog
    let animal_id = memory.learn("Animal: Living organism".to_string());
    let mammal_id = memory.learn("Mammal: Warm-blooded vertebrate".to_string());
    let pet_id = memory.learn("Pet: Domesticated companion".to_string());
    let cat_id = memory.learn("Cat: Small feline that meows".to_string());
    let dog_id = memory.learn("Dog: Canine that barks".to_string());
    
    // Build hierarchical connections
    memory.associate(mammal_id.clone(), animal_id).unwrap();
    memory.associate(pet_id.clone(), mammal_id).unwrap();
    memory.associate(cat_id.clone(), pet_id.clone()).unwrap();
    memory.associate(dog_id.clone(), pet_id).unwrap();
    
    // Cross-connections (cats and dogs are both mammals)
    memory.associate(cat_id.clone(), mammal_id).unwrap();
    memory.associate(dog_id.clone(), mammal_id).unwrap();
    
    memory
}
```

### Learning from Experience

```rust
fn simulate_learning_experience(memory: &MemoryGraph) {
    let concepts = memory.get_all_concept_ids();
    
    // Simulate 10 learning sessions
    for session in 0..10 {
        println!("Learning session {}", session + 1);
        
        // Each session, randomly access some concepts (like real experience)
        let session_concepts: Vec<_> = concepts.iter().take(3).collect();
        
        for concept_id in session_concepts {
            memory.access_concept(concept_id).unwrap();
        }
        
        // Apply Hebbian learning for co-activated concepts
        memory.hebbian_strengthening(&concepts[0..3]);
        
        // Periodic consolidation (like nightly sleep)
        if session % 3 == 0 {
            let stats = memory.consolidate_memory();
            println!("  Consolidated {} connections", stats.promoted_to_long_term);
        }
    }
}
```

## 🔧 Customizing Your Memory System

### High-Performance Configuration

```rust
use leafmind::MemoryConfig;

let fast_config = MemoryConfig {
    learning_rate: 0.2,              // Fast learning
    decay_rate: 0.005,               // Slow forgetting
    consolidation_threshold: 0.3,     // Easy promotion to long-term
    max_short_term_connections: 50000, // Large capacity
    consolidation_interval_hours: 6,   // Frequent consolidation
    max_recall_results: 100,
};

let memory = MemoryGraph::new(fast_config);
```

### Conservative Memory Configuration

```rust
let conservative_config = MemoryConfig {
    learning_rate: 0.05,             // Slow, careful learning
    decay_rate: 0.02,                // Faster forgetting
    consolidation_threshold: 0.8,     // Hard to get to long-term
    max_short_term_connections: 1000,  // Limited capacity
    consolidation_interval_hours: 72,  // Infrequent consolidation
    max_recall_results: 10,
};

let memory = MemoryGraph::new(conservative_config);
```

## 🐛 Debugging and Monitoring

### Enable Logging

```rust
use tracing::{info, Level};
use tracing_subscriber;

fn main() {
    // Initialize logging to see internal operations
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();
    
    let memory = MemoryGraph::new_with_defaults();
    
    // Now you'll see detailed logs of memory operations
    let cat_id = memory.learn("Cat".to_string());
    memory.consolidate_memory(); // Will log consolidation details
}
```

### Monitor Memory Health

```rust
fn monitor_memory_health(memory: &MemoryGraph) {
    let stats = memory.get_stats();
    
    println!("🏥 Memory Health Check:");
    println!("  Total concepts: {}", stats.total_concepts);
    println!("  Active connections: {}", 
             stats.short_term_connections + stats.long_term_connections);
    println!("  Working memory load: {}", stats.working_memory_size);
    println!("  Last consolidation: {}", stats.last_consolidation);
    
    // Health indicators
    let total_connections = stats.short_term_connections + stats.long_term_connections;
    let avg_connections_per_concept = if stats.total_concepts > 0 {
        total_connections as f64 / stats.total_concepts as f64
    } else {
        0.0
    };
    
    println!("  Average connections per concept: {:.2}", avg_connections_per_concept);
    
    if avg_connections_per_concept < 1.0 {
        println!("  ⚠️  Warning: Low connectivity - concepts may be isolated");
    } else if avg_connections_per_concept > 10.0 {
        println!("  ⚠️  Warning: High connectivity - may need cleanup");
    } else {
        println!("  ✅ Connectivity looks healthy");
    }
}
```

## 🎯 Next Steps

Now that you've got the basics, explore these advanced topics:

1. **[API Reference](API_REFERENCE.md)** - Complete function documentation
2. **[Architecture Guide](ARCHITECTURE.md)** - Deep dive into the system design
3. **[Developer Guide](DEVELOPER_GUIDE.md)** - Learn to extend LeafMind with new features

### Try the Interactive Demo

```bash
cd leafmind
cargo run
```

This runs a comprehensive demonstration showing all brain-like memory features in action.

### Common Use Cases

- **AI Agent Memory**: Give AI systems human-like long-term memory
- **Knowledge Graphs**: Build self-organizing, adaptive knowledge networks  
- **Chatbot Memory**: Remember conversations and learn from interactions
- **Recommendation Systems**: Learn user preferences through association
- **Research**: Study computational models of biological memory

Happy coding with your new brain-inspired memory system! 🧠✨