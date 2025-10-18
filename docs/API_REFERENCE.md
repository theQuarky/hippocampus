# 🧠 LeafMind API Reference

Complete API documentation for all public interfaces in LeafMind.

## 📋 Table of Contents

- [Core Types](#core-types)
- [MemoryGraph](#memorygraph)
- [**NEW: PersistentMemoryGraph**](#persistentmemorygraph)
- [**NEW: Persistence Configuration**](#persistence-configuration)
- [**NEW: Factory Patterns**](#factory-patterns)
- [Configuration](#configuration)
- [Recall System](#recall-system)
- [Statistics](#statistics)
- [Error Handling](#error-handling)
- [Examples](#examples)

## 🏗️ Core Types

### ConceptId

Unique identifier for concepts in the memory graph.

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ConceptId(pub Uuid);
```

#### Methods

##### `ConceptId::new() -> ConceptId`
Creates a new random concept ID.

```rust
let id = ConceptId::new();
```

##### `ConceptId::from_string(s: &str) -> ConceptId`
Creates a deterministic ID from a string (useful for consistent IDs).

```rust
let id = ConceptId::from_string("unique_concept_name");
```

---

### Concept

Represents a single piece of information with metadata and usage tracking.

```rust
pub struct Concept {
    pub id: ConceptId,
    pub content: String,
    pub metadata: HashMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
    pub access_count: u64,
}
```

#### Methods

##### `Concept::new(content: String) -> Concept`
Creates a new concept with the given content.

```rust
let concept = Concept::new("A furry animal that meows".to_string());
```

##### `Concept::with_id(id: ConceptId, content: String) -> Concept`
Creates a concept with a specific ID.

```rust
let id = ConceptId::from_string("cat");
let concept = Concept::with_id(id, "A furry animal that meows".to_string());
```

##### `concept.access()`
Updates the last accessed time and increments access count.

```rust
let mut concept = Concept::new("content".to_string());
concept.access(); // Updates timestamps and count
```

---

### SynapticWeight

Represents the strength of a connection between concepts.

```rust
pub struct SynapticWeight(pub f64);
```

#### Constants

```rust
impl SynapticWeight {
    pub const MIN: f64 = 0.0;      // Minimum weight value
    pub const MAX: f64 = 1.0;      // Maximum weight value  
    pub const INITIAL: f64 = 0.1;  // Default starting weight
    pub const THRESHOLD: f64 = 0.01; // Minimum active threshold
}
```

#### Methods

##### `SynapticWeight::new(weight: f64) -> SynapticWeight`
Creates a new weight, clamping to valid range [0.0, 1.0].

```rust
let weight = SynapticWeight::new(0.5);
```

##### `weight.strengthen(&mut self, learning_rate: f64)`
Applies Long-Term Potentiation (LTP) strengthening.

```rust
let mut weight = SynapticWeight::new(0.3);
weight.strengthen(0.1); // Asymptotic strengthening
```

##### `weight.weaken(&mut self, decay_rate: f64)`
Applies Long-Term Depression (LTD) weakening.

```rust
let mut weight = SynapticWeight::new(0.3);
weight.weaken(0.02); // Exponential decay
```

##### `weight.is_active(&self) -> bool`
Returns true if weight is above the active threshold.

```rust
if weight.is_active() {
    // Connection is strong enough to be considered active
}
```

##### `weight.value(&self) -> f64`
Returns the raw weight value.

```rust
let strength = weight.value(); // Returns f64 in range [0.0, 1.0]
```

---

## 🧠 MemoryGraph

The central memory system that manages concepts and their associations.

```rust
pub struct MemoryGraph { /* private fields */ }
```

### Creation

##### `MemoryGraph::new(config: MemoryConfig) -> MemoryGraph`
Creates a new memory graph with custom configuration.

```rust
let config = MemoryConfig {
    learning_rate: 0.15,
    decay_rate: 0.02,
    consolidation_threshold: 0.4,
    max_short_term_connections: 5000,
    consolidation_interval_hours: 12,
    max_recall_results: 15,
};
let memory = MemoryGraph::new(config);
```

##### `MemoryGraph::new_with_defaults() -> MemoryGraph`
Creates a memory graph with default configuration.

```rust
let memory = MemoryGraph::new_with_defaults();
```

### Learning Operations

##### `memory.learn(content: String) -> ConceptId`
Creates a new concept and returns its ID.

```rust
let cat_id = memory.learn("A small furry animal that meows".to_string());
```

##### `memory.add_concept(concept: Concept) -> ConceptId`
Adds an existing concept to the memory system.

```rust
let concept = Concept::new("content".to_string());
let id = memory.add_concept(concept);
```

##### `memory.associate(from_id: ConceptId, to_id: ConceptId) -> Result<(), String>`
Creates a directed association between two concepts.

```rust
match memory.associate(cat_id, pet_id) {
    Ok(()) => println!("Association created"),
    Err(e) => println!("Error: {}", e),
}
```

##### `memory.associate_bidirectional(concept_a: ConceptId, concept_b: ConceptId) -> Result<(), String>`
Creates bidirectional associations between concepts.

```rust
memory.associate_bidirectional(cat_id, pet_id)?;
// Creates both cat->pet and pet->cat associations
```

### Access Operations

##### `memory.access_concept(concept_id: &ConceptId) -> Result<(), String>`
Marks a concept as accessed, updating its usage statistics and strengthening related connections.

```rust
memory.access_concept(&cat_id)?;
```

##### `memory.get_concept(concept_id: &ConceptId) -> Option<Concept>`
Retrieves a concept by its ID.

```rust
if let Some(concept) = memory.get_concept(&cat_id) {
    println!("Concept content: {}", concept.content);
}
```

##### `memory.get_all_concept_ids() -> Vec<ConceptId>`
Returns all concept IDs in the system.

```rust
let all_ids = memory.get_all_concept_ids();
println!("Total concepts: {}", all_ids.len());
```

### Memory Management

##### `memory.consolidate_memory() -> ConsolidationStats`
Performs hippocampus-to-cortex memory consolidation.

```rust
let stats = memory.consolidate_memory();
println!("Promoted {} connections to long-term memory", stats.promoted_to_long_term);
```

##### `memory.force_consolidation() -> ConsolidationStats`
Forces immediate consolidation regardless of timing.

```rust
let stats = memory.force_consolidation();
```

##### `memory.should_consolidate() -> bool`
Checks if automatic consolidation should be triggered.

```rust
if memory.should_consolidate() {
    memory.consolidate_memory();
}
```

### Plasticity Operations

##### `memory.apply_ltp_strengthening()`
Applies Long-Term Potentiation to strengthen active connections.

```rust
memory.apply_ltp_strengthening();
```

##### `memory.apply_ltd_decay()`
Applies Long-Term Depression to weaken unused connections.

```rust
memory.apply_ltd_decay();
```

##### `memory.sleep_cycle()`
Performs sleep-like memory processing (combines LTP, LTD, and cleanup).

```rust
memory.sleep_cycle(); // Recommended for periodic maintenance
```

##### `memory.hebbian_strengthening(concept_ids: &[ConceptId])`
Strengthens connections between co-activated concepts.

```rust
let active_concepts = vec![cat_id, pet_id, mammal_id];
memory.hebbian_strengthening(&active_concepts);
```

##### `memory.adaptive_learning_rate(current_weight: SynapticWeight) -> f64`
Calculates adaptive learning rate based on connection strength.

```rust
let weight = SynapticWeight::new(0.3);
let rate = memory.adaptive_learning_rate(weight);
```

### Forgetting Operations

##### `memory.forget(config: ForgettingConfig) -> ForgettingStats`
Performs comprehensive forgetting cycle.

```rust
let config = ForgettingConfig::default();
let stats = memory.forget(config);
println!("Forgot {} concepts", stats.concepts_forgotten);
```

##### `memory.forget_concepts(concept_ids: &[ConceptId]) -> usize`
Forgets specific concepts and their associations.

```rust
let forgotten_count = memory.forget_concepts(&[old_concept_id]);
```

##### `memory.get_forgetting_candidates(config: &ForgettingConfig) -> Vec<ConceptId>`
Returns concepts that are candidates for forgetting.

```rust
let candidates = memory.get_forgetting_candidates(&ForgettingConfig::default());
println!("Found {} forgetting candidates", candidates.len());
```

### Statistics

##### `memory.get_stats() -> MemoryStats`
Returns current memory system statistics.

```rust
let stats = memory.get_stats();
println!("{}", stats); // Implements Display trait
```

---

## 🔍 Recall System

### RecallQuery

Configuration for memory recall operations.

```rust
#[derive(Debug, Clone)]
pub struct RecallQuery {
    pub max_results: Option<usize>,
    pub min_relevance: f64,
    pub max_path_length: usize,
    pub include_semantic_similarity: bool,
    pub boost_recent_memories: bool,
}
```

#### Default Configuration

```rust
impl Default for RecallQuery {
    fn default() -> Self {
        Self {
            max_results: Some(10),
            min_relevance: 0.1,
            max_path_length: 3,
            include_semantic_similarity: false,
            boost_recent_memories: true,
        }
    }
}
```

### RecallResult

Result of a memory recall operation.

```rust
#[derive(Debug, Clone)]
pub struct RecallResult {
    pub concept: Concept,
    pub relevance_score: f64,
    pub association_path: Vec<ConceptId>,
    pub connection_strength: f64,
}
```

### Recall Methods

##### `memory.recall(concept_id: &ConceptId, query: RecallQuery) -> Vec<RecallResult>`
Performs associative recall from a source concept.

```rust
let query = RecallQuery {
    max_results: Some(5),
    min_relevance: 0.2,
    max_path_length: 2,
    include_semantic_similarity: false,
    boost_recent_memories: true,
};

let results = memory.recall(&cat_id, query);
for result in results {
    println!("Found: {} (score: {:.3})", 
             result.concept.content, 
             result.relevance_score);
}
```

##### `memory.recall_by_content(query_content: &str, recall_query: RecallQuery) -> Vec<RecallResult>`
Performs content-based similarity recall.

```rust
let results = memory.recall_by_content("furry animal", RecallQuery::default());
for result in results {
    println!("Similar: {} (similarity: {:.3})", 
             result.concept.content, 
             result.relevance_score);
}
```

##### `memory.spreading_activation_recall(seed_concepts: &[ConceptId], activation_threshold: f64, max_iterations: usize) -> Vec<RecallResult>`
Performs spreading activation recall from multiple seed concepts.

```rust
let seed_concepts = vec![cat_id, dog_id];
let results = memory.spreading_activation_recall(&seed_concepts, 0.2, 5);
println!("Spreading activation found {} concepts", results.len());
```

---

## 💾 **PersistentMemoryGraph**

The persistent version of MemoryGraph that automatically saves all data to disk using RocksDB.

```rust
pub struct PersistentMemoryGraph { /* private fields */ }
```

### Creation Methods

##### `PersistentMemoryGraph::new(memory_config: MemoryConfig, persistence_config: PersistenceConfig) -> Result<PersistentMemoryGraph, Box<dyn Error>>`

Creates a new persistent memory graph with custom configurations.

```rust
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let memory = PersistentMemoryGraph::new(
        MemoryConfig::default(),
        PersistenceConfig {
            db_path: PathBuf::from("my_brain.db"),
            auto_save_interval_seconds: 60,
            enable_compression: true,
            ..PersistenceConfig::default()
        }
    ).await?;
    
    Ok(())
}
```

##### `PersistentMemoryGraph::new_with_defaults() -> Result<PersistentMemoryGraph, Box<dyn Error>>`

Creates a persistent memory graph with default settings.

```rust
let memory = PersistentMemoryGraph::new_with_defaults().await?;
```

### Memory Operations (Async)

All memory operations return `Result` types and are asynchronous for optimal performance.

##### `async fn learn(&self, content: String) -> Result<ConceptId, Box<dyn Error>>`

Learn a new concept and automatically persist it.

```rust
let concept_id = memory.learn("Persistent memory concept".to_string()).await?;
```

##### `async fn associate(&self, from: ConceptId, to: ConceptId) -> Result<(), Box<dyn Error>>`

Create an association between concepts and persist it.

```rust
memory.associate(concept1, concept2).await?;
```

##### `async fn access_concept(&self, concept_id: &ConceptId) -> Result<(), Box<dyn Error>>`

Access a concept, updating its usage statistics in the database.

```rust
memory.access_concept(&concept_id).await?;
```

### Persistence Operations

##### `async fn force_save(&self) -> Result<(), Box<dyn Error>>`

Force immediate save of all data to disk.

```rust
memory.force_save().await?;
```

##### `async fn backup<P: AsRef<Path>>(&self, backup_path: P) -> Result<(), Box<dyn Error>>`

Create a complete backup of the database.

```rust
memory.backup("backup.db").await?;
```

##### `async fn restore<P: AsRef<Path>>(&mut self, backup_path: P) -> Result<(), Box<dyn Error>>`

Restore database from a backup file.

```rust
memory.restore("backup.db").await?;
```

##### `async fn compact(&self) -> Result<(), Box<dyn Error>>`

Compact the database to reclaim space.

```rust
memory.compact().await?;
```

### Statistics

##### `async fn get_combined_stats(&self) -> (MemoryStats, PersistenceStats)`

Get both memory and persistence statistics.

```rust
let (memory_stats, persistence_stats) = memory.get_combined_stats().await;
println!("Concepts: {}", memory_stats.total_concepts);
println!("Database size: {} bytes", persistence_stats.database_size_bytes);
println!("Cache hit rate: {:.1}%", persistence_stats.cache_hit_rate * 100.0);
```

### Access to Internal Components

##### `fn memory_graph(&self) -> &MemoryGraph`

Get reference to the internal memory graph for advanced operations.

```rust
let internal_graph = memory.memory_graph();
let results = internal_graph.recall(&concept_id, RecallQuery::default());
```

---

## 🔧 **Persistence Configuration**

Configuration for persistent storage behavior.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    pub db_path: PathBuf,
    pub auto_save_interval_seconds: u64,
    pub batch_size: usize,
    pub enable_compression: bool,
    pub max_cache_size: usize,
    pub enable_wal: bool,
}
```

### Fields

- **`db_path`**: Path to the database file (default: `"leafmind.db"`)
- **`auto_save_interval_seconds`**: Auto-save frequency in seconds (default: `300`, 0 = disabled)
- **`batch_size`**: Number of items per batch operation (default: `1000`)
- **`enable_compression`**: Enable LZ4 compression (default: `true`)
- **`max_cache_size`**: Maximum items in memory cache (default: `100000`)
- **`enable_wal`**: Enable Write-Ahead Logging for crash recovery (default: `true`)

### Default Configuration

```rust
let config = PersistenceConfig::default();
// Equivalent to:
let config = PersistenceConfig {
    db_path: PathBuf::from("leafmind.db"),
    auto_save_interval_seconds: 300,  // 5 minutes
    batch_size: 1000,
    enable_compression: true,
    max_cache_size: 100000,
    enable_wal: true,
};
```

### Usage Examples

#### High-Performance Configuration
```rust
let high_perf_config = PersistenceConfig {
    db_path: PathBuf::from("hp_brain.db"),
    auto_save_interval_seconds: 120,  // 2 minutes
    batch_size: 5000,                 // Large batches
    enable_compression: true,
    max_cache_size: 500000,          // Large cache
    enable_wal: true,
};
```

#### Storage-Optimized Configuration
```rust
let storage_config = PersistenceConfig {
    db_path: PathBuf::from("compact_brain.db"),
    auto_save_interval_seconds: 600,  // 10 minutes
    batch_size: 2000,
    enable_compression: true,         // Compress for space
    max_cache_size: 50000,           // Smaller cache
    enable_wal: true,
};
```

---

## 🏭 **Factory Patterns**

The `MemoryGraphFactory` provides convenient methods to create different types of memory systems.

```rust
pub struct MemoryGraphFactory;
```

### Factory Methods

##### `async fn create_persistent_default() -> Result<PersistentMemoryGraph, Box<dyn Error>>`

Create a persistent memory graph with default settings.

```rust
let memory = MemoryGraphFactory::create_persistent_default().await?;
```

##### `async fn create_high_performance() -> Result<PersistentMemoryGraph, Box<dyn Error>>`

Create a memory graph optimized for high-performance workloads.

```rust
let memory = MemoryGraphFactory::create_high_performance().await?;
```

Configuration:
- Database: `"leafmind_hp.db"`
- Auto-save: Every 2 minutes
- Batch size: 5000 items
- Cache size: 500k items
- Memory config: Conservative learning, high capacity

##### `async fn create_research_optimized() -> Result<PersistentMemoryGraph, Box<dyn Error>>`

Create a memory graph optimized for research and analysis.

```rust
let memory = MemoryGraphFactory::create_research_optimized().await?;
```

Configuration:
- Database: `"leafmind_research.db"`
- Auto-save: Every 10 minutes
- Batch size: 2000 items
- Cache size: 200k items
- Memory config: Balanced learning and decay rates

##### `async fn create_persistent(memory_config: MemoryConfig, persistence_config: PersistenceConfig) -> Result<PersistentMemoryGraph, Box<dyn Error>>`

Create a persistent memory graph with fully custom configuration.

```rust
let memory = MemoryGraphFactory::create_persistent(
    MemoryConfig {
        learning_rate: 0.15,
        decay_rate: 0.005,
        consolidation_threshold: 0.7,
        ..MemoryConfig::default()
    },
    PersistenceConfig {
        db_path: PathBuf::from("custom_brain.db"),
        auto_save_interval_seconds: 180,
        enable_compression: true,
        max_cache_size: 250000,
        ..PersistenceConfig::default()
    }
).await?;
```

##### `fn create_memory_only(config: MemoryConfig) -> MemoryGraph`

Create an in-memory only graph (no persistence).

```rust
let memory = MemoryGraphFactory::create_memory_only(MemoryConfig::default());
```

### Usage Patterns

#### For Web Applications
```rust
// High-performance setup for real-time applications
let memory = MemoryGraphFactory::create_high_performance().await?;
```

#### For Research Projects
```rust
// Balanced setup for research and experimentation
let memory = MemoryGraphFactory::create_research_optimized().await?;
```

#### For Mobile/Edge Devices
```rust
// Storage-optimized setup for resource-constrained environments
let memory = MemoryGraphFactory::create_persistent(
    MemoryConfig::default(),
    PersistenceConfig {
        auto_save_interval_seconds: 900,  // 15 minutes
        max_cache_size: 25000,           // Small cache
        enable_compression: true,        // Save space
        ..PersistenceConfig::default()
    }
).await?;
```

---

## ⚙️ Configuration

### MemoryConfig

Main configuration for the memory system.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    pub learning_rate: f64,
    pub decay_rate: f64,
    pub consolidation_threshold: f64,
    pub max_short_term_connections: usize,
    pub consolidation_interval_hours: u64,
    pub max_recall_results: usize,
}
```

#### Default Values

```rust
impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            learning_rate: 0.1,              // 10% strengthening per activation
            decay_rate: 0.01,                // 1% decay per cycle
            consolidation_threshold: 0.5,     // 50% strength for promotion
            max_short_term_connections: 10000,
            consolidation_interval_hours: 24, // Daily consolidation
            max_recall_results: 20,
        }
    }
}
```

#### Parameter Explanations

- **learning_rate**: Controls how much connections strengthen (LTP rate)
- **decay_rate**: Controls how much connections weaken (LTD rate)
- **consolidation_threshold**: Minimum strength for long-term promotion
- **max_short_term_connections**: Capacity limit for short-term memory
- **consolidation_interval_hours**: How often automatic consolidation occurs
- **max_recall_results**: Default limit for recall operations

### ForgettingConfig

Configuration for forgetting operations.

```rust
#[derive(Debug, Clone)]
pub struct ForgettingConfig {
    pub concept_isolation_threshold: usize,
    pub unused_concept_days: i64,
    pub weak_connection_threshold: f64,
    pub aggressive_forgetting: bool,
}
```

#### Default Values

```rust
impl Default for ForgettingConfig {
    fn default() -> Self {
        Self {
            concept_isolation_threshold: 1,  // Min connections to keep concept
            unused_concept_days: 30,         // Days before forgetting unused concepts
            weak_connection_threshold: 0.05, // Threshold for pruning weak connections
            aggressive_forgetting: false,    // Conservative forgetting by default
        }
    }
}
```

---

## 📊 Statistics

### MemoryStats

Basic memory system statistics.

```rust
#[derive(Debug, Clone)]
pub struct MemoryStats {
    pub total_concepts: usize,
    pub short_term_connections: usize,
    pub long_term_connections: usize,
    pub working_memory_size: usize,
    pub last_consolidation: DateTime<Utc>,
}
```

#### Display Implementation

```rust
println!("{}", memory.get_stats());
// Output:
// Memory Stats:
//   Concepts: 150
//   Short-term connections: 45
//   Long-term connections: 203
//   Working memory: 12
//   Last consolidation: 2025-10-16 09:25:32 UTC
```

### ConsolidationStats

Results of memory consolidation operations.

```rust
#[derive(Debug, Clone)]
pub struct ConsolidationStats {
    pub promoted_to_long_term: usize,
    pub pruned_weak_connections: usize,
    pub reactivated_connections: usize,
    pub total_short_term_before: usize,
    pub total_long_term_after: usize,
}
```

### ForgettingStats

Results of forgetting operations.

```rust
#[derive(Debug, Clone)]
pub struct ForgettingStats {
    pub concepts_forgotten: usize,
    pub connections_pruned: usize,
    pub weak_connections_decayed: usize,
    pub isolated_concepts_removed: usize,
}
```

---

## ❌ Error Handling

Most operations that can fail return `Result<T, String>` with descriptive error messages:

```rust
match memory.associate(from_id, to_id) {
    Ok(()) => println!("Association created successfully"),
    Err(e) => eprintln!("Failed to create association: {}", e),
}
```

Common error scenarios:
- **Concept not found**: When referencing non-existent concept IDs
- **Invalid parameters**: When providing out-of-range values
- **Capacity limits**: When exceeding configured limits

---

## 🎯 Complete Examples

### Basic Usage

```rust
use leafmind::{MemoryGraph, RecallQuery};

fn main() {
    // Create memory system
    let memory = MemoryGraph::new_with_defaults();
    
    // Learn concepts
    let cat_id = memory.learn("A small furry animal that meows".to_string());
    let dog_id = memory.learn("A loyal furry animal that barks".to_string());
    let pet_id = memory.learn("A domesticated animal companion".to_string());
    
    // Create associations
    memory.associate_bidirectional(cat_id.clone(), pet_id.clone()).unwrap();
    memory.associate_bidirectional(dog_id.clone(), pet_id.clone()).unwrap();
    
    // Access concepts to strengthen connections
    memory.access_concept(&cat_id).unwrap();
    memory.access_concept(&pet_id).unwrap();
    
    // Recall related concepts
    let results = memory.recall(&pet_id, RecallQuery::default());
    println!("Pet is associated with {} other concepts", results.len());
    
    // Apply brain-like processing
    memory.hebbian_strengthening(&[cat_id.clone(), pet_id.clone()]);
    memory.sleep_cycle();
    
    // Consolidate memories
    let stats = memory.consolidate_memory();
    println!("Consolidated {} connections", stats.promoted_to_long_term);
    
    // Check system health
    let memory_stats = memory.get_stats();
    println!("System has {} concepts and {} total connections",
             memory_stats.total_concepts,
             memory_stats.short_term_connections + memory_stats.long_term_connections);
}
```

### Advanced Usage with Custom Configuration

```rust
use leafmind::{MemoryGraph, MemoryConfig, RecallQuery, ForgettingConfig};

fn main() {
    // Custom configuration for fast learning
    let config = MemoryConfig {
        learning_rate: 0.2,           // Faster learning
        decay_rate: 0.005,            // Slower forgetting  
        consolidation_threshold: 0.3,  // Easier promotion
        max_short_term_connections: 5000,
        consolidation_interval_hours: 6, // More frequent consolidation
        max_recall_results: 50,
    };
    
    let memory = MemoryGraph::new(config);
    
    // Build a knowledge network
    let mut concept_ids = Vec::new();
    let topics = vec![
        "Machine Learning", "Neural Networks", "Deep Learning",
        "Artificial Intelligence", "Computer Vision", "Natural Language Processing"
    ];
    
    for topic in topics {
        let id = memory.learn(format!("Topic: {}", topic));
        concept_ids.push(id);
    }
    
    // Create interconnections
    for i in 0..concept_ids.len() {
        for j in i+1..concept_ids.len() {
            memory.associate_bidirectional(
                concept_ids[i].clone(), 
                concept_ids[j].clone()
            ).unwrap();
        }
    }
    
    // Simulate usage patterns
    for _ in 0..10 {
        // Randomly access concepts
        for id in &concept_ids[0..3] {
            memory.access_concept(id).unwrap();
        }
        memory.apply_ltp_strengthening();
    }
    
    // Advanced recall with spreading activation
    let seed_concepts = vec![concept_ids[0].clone(), concept_ids[1].clone()];
    let results = memory.spreading_activation_recall(&seed_concepts, 0.1, 3);
    
    println!("Spreading activation found {} related concepts", results.len());
    
    // Periodic maintenance
    memory.sleep_cycle();
    let consolidation_stats = memory.consolidate_memory();
    
    // Cleanup old memories
    let forgetting_config = ForgettingConfig {
        aggressive_forgetting: true,
        unused_concept_days: 7,
        ..ForgettingConfig::default()
    };
    let forgetting_stats = memory.forget(forgetting_config);
    
    println!("System maintenance complete:");
    println!("  Consolidated: {} connections", consolidation_stats.promoted_to_long_term);
    println!("  Forgot: {} concepts", forgetting_stats.concepts_forgotten);
}
```

This API reference provides complete documentation for all public interfaces in LeafMind. Use it as a quick reference while developing with the library!