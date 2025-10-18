# 🧠 LeafMind - Brain-Inspired Persistent Memory System

LeafMind is a Rust implementation of a neuromorphic memory system that mimics biological memory processes while providing **persistent storage capabilities** and **high-performance gRPC + WebSocket API access**. It bridges neuroscience and computer science by implementing computational models of synaptic plasticity, memory consolidation, and associative recall - all while **automatically saving to disk** for permanent knowledge retention.

**🌟 NEW: High-Performance gRPC + WebSocket API!**  
LeafMind now features a cutting-edge gRPC API with real-time WebSocket streaming, offering 10x better performance than REST APIs with type-safe Protocol Buffers and bidirectional communication.

## 🎯 Core Features

### 🧬 Neuromorphic Architecture
- **Concept Nodes**: Represent individual pieces of information (like neurons)
- **Synaptic Edges**: Weighted connections between concepts (like synapses)
- **Dynamic Weights**: Connection strengths that change over time based on usage
- **Memory Zones**: Separate short-term (hippocampus) and long-term (cortex) storage

### 💾 **NEW: Persistent Storage**
- **RocksDB Backend**: High-performance, embedded database for durability
- **Auto-Save**: Configurable automatic saving to disk
- **Crash Recovery**: WAL (Write-Ahead Logging) for data integrity
- **Backup & Restore**: Full database backup and restoration capabilities
- **Compression**: Optional data compression for storage efficiency
- **Cache System**: Intelligent caching for optimal performance

### 🔋 Synaptic Plasticity
- **Long-Term Potentiation (LTP)**: Strengthening of frequently used connections
- **Long-Term Depression (LTD)**: Weakening and pruning of unused connections
- **Adaptive Learning Rates**: Weaker connections learn faster, stronger ones stabilize
- **Hebbian Learning**: "Neurons that fire together, wire together"

### 🏛️ Memory Consolidation
- **Hippocampus-to-Cortex Transfer**: Automatic promotion of important memories
- **Multi-Criteria Assessment**: Weight, frequency, recency, and concept importance
- **Interference Management**: Competing memories can weaken each other
- **Reconsolidation**: Recalled memories become modifiable again

### 🔍 Intelligent Recall
- **Associative Pathways**: Follow connection chains to find related concepts
- **Spreading Activation**: Neural network-style activation propagation
- **Content-Based Similarity**: Semantic matching using content analysis
- **Recency Boosting**: Recent memories get retrieval advantages

### 🗑️ Natural Forgetting
- **Ebbinghaus Curves**: Exponential decay over time
- **Isolation Pruning**: Remove concepts with few connections
- **Interference Effects**: New similar memories can weaken old ones
- **Aggressive Cleanup**: Optional deep cleaning for memory optimization

### 😴 Sleep-Like Processing
- **Consolidation Cycles**: Periodic memory reorganization
- **Working Memory Cleanup**: Clear temporary activations
- **Pattern Strengthening**: Reinforce important connection patterns

### 🚀 **NEW: gRPC + WebSocket API**
- **High-Performance gRPC**: Binary protocol buffers for 10x faster communication
- **Real-Time WebSocket**: Bidirectional streaming for live updates and notifications
- **Type-Safe APIs**: Generated clients with compile-time safety in multiple languages
- **Streaming Operations**: Server streaming, client streaming, and bidirectional streaming
- **Universal Language Support**: Auto-generated clients for Python, JavaScript, Go, Java, C#, etc.
- **Low Latency**: Sub-millisecond response times with persistent connections
- **HTTP/2 Benefits**: Multiplexing, compression, and efficient binary encoding

## 🚀 Quick Start

### Option 1: Use as a Library (Rust)

```rust
use leafmind::{MemoryGraphFactory, RecallQuery};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Create persistent memory (saves to disk automatically)
    let memory = MemoryGraphFactory::persistent("./my_memory_db").await?;
    
    // Learn concepts
    let rust_id = memory.learn("Rust is a systems programming language").await?;
    let memory_id = memory.learn("Memory safety prevents crashes").await?;
    
    // Create associations
    memory.associate(rust_id, memory_id).await?;
    
    // Recall related concepts
    let results = memory.recall(&rust_id, RecallQuery::default()).await?;
    for result in results {
        println!("Recalled: {} (relevance: {:.3})", 
                 result.concept.content, result.relevance_score);
    }
    
    Ok(())
}
```

### Option 2: Use as a High-Performance Server (Any Language)

**1. Start the LeafMind gRPC + WebSocket Server:**

```bash
# Start hybrid server (gRPC + WebSocket)
cargo run -- hybrid

# Or start gRPC-only server
cargo run -- grpc

# Or use the binary directly
cargo run --bin leafmind-server -- ./my_database 127.0.0.1 8080
```

**2. Use from Python (gRPC):**

```python
import asyncio
from leafmind_grpc_client import LeafMindGrpcClient

async def main():
    async with LeafMindGrpcClient("localhost:50051") as client:
        # Learn concepts
        python_id = await client.learn("Python is great for AI")
        ai_id = await client.learn("AI is transforming technology")
        
        # Create associations
        await client.associate(python_id, ai_id, bidirectional=True)
        
        # Recall memories
        results = await client.recall_from_concept(python_id)
        for result in results:
            print(f"Recalled: {result.concept.content}")
            
        # Real-time streaming - watch for concept updates
        async for update in client.watch_concept_updates(python_id):
            print(f"Live update: {update}")

asyncio.run(main())
```

**3. Use from JavaScript/Node.js (gRPC):**

```javascript
import { LeafMindGrpcClient } from './leafmind-grpc-client.js';

const client = new LeafMindGrpcClient('localhost:50051');

// Learn and associate concepts
const jsId = await client.learn('JavaScript is versatile');
const webId = await client.learn('Web development is evolving');
await client.associate(jsId, webId);

// Recall related concepts
const results = await client.recallFromConcept(jsId);
results.forEach(result => {
    console.log(`Recalled: ${result.concept.content}`);
});

// WebSocket real-time updates
const wsClient = client.connectWebSocket('ws://localhost:8080');
wsClient.on('conceptUpdate', (update) => {
    console.log('Real-time update:', update);
});
```

**4. Use from any gRPC client (Go, Java, C#, etc.):**

```bash
# Using grpcurl for testing
grpcurl -plaintext -d '{"content":"gRPC enables fast cross-language integration"}' \
  localhost:50051 leafmind.v1.LeafMindService/Learn

# List available services
grpcurl -plaintext localhost:50051 list

# Stream concept updates  
grpcurl -plaintext -d '{"concept_id":{"uuid":"..."}}' \
  localhost:50051 leafmind.v1.LeafMindService/WatchConceptUpdates
```

📖 **[Complete gRPC + WebSocket Documentation](docs/GRPC_WEBSOCKET_ARCHITECTURE.md)**  
📱 **[Client SDK Examples](clients/)**  
🎯 **[gRPC Demo Scripts](examples/grpc_demo.sh)**

## 🚀 Original Quick Start (Library Usage)

### Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
leafmind = "0.1.0"
tokio = { version = "1.0", features = ["full"] }  # Required for async persistence
```

### Basic Usage (In-Memory)

```rust
use leafmind::{MemoryGraph, MemoryConfig, RecallQuery};

// Create a memory system (RAM only)
let memory = MemoryGraph::new_with_defaults();

// Learn concepts
let cat_id = memory.learn("A small furry animal that meows".to_string());
let dog_id = memory.learn("A loyal furry animal that barks".to_string());
let pet_id = memory.learn("A domesticated animal companion".to_string());

// Create associations
memory.associate_bidirectional(cat_id.clone(), pet_id.clone()).unwrap();
memory.associate_bidirectional(dog_id.clone(), pet_id.clone()).unwrap();

// Recall related concepts
let results = memory.recall(&pet_id, RecallQuery::default());
println!("Found {} related concepts", results.len());

// Memory consolidation (hippocampus → cortex)
let stats = memory.consolidate_memory();
println!("Promoted {} connections to long-term memory", stats.promoted_to_long_term);
```

### 💾 **Persistent Usage (Database)**

```rust
use leafmind::{PersistentMemoryGraph, MemoryConfig, PersistenceConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Create persistent memory (automatically saves to disk)
    let memory = PersistentMemoryGraph::new_with_defaults().await?;
    
    // Learn concepts (automatically persisted)
    let ai_id = memory.learn("Artificial Intelligence".to_string()).await?;
    let ml_id = memory.learn("Machine Learning".to_string()).await?;
    
    // Create associations (persisted)
    memory.associate(ai_id.clone(), ml_id.clone()).await?;
    
    // Access concepts (updates timestamps in DB)
    memory.access_concept(&ai_id).await?;
    
    // Get combined statistics
    let (memory_stats, persistence_stats) = memory.get_combined_stats().await;
    println!("Concepts: {}, DB size: {} bytes", 
             memory_stats.total_concepts, 
             persistence_stats.database_size_bytes);
    
    // Backup database
    memory.backup("my_knowledge_backup.db").await?;
    
    Ok(())
    // Memory is automatically saved when dropped
}
```

### 🏭 **Factory Patterns for Different Use Cases**

```rust
use leafmind::MemoryGraphFactory;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // High-performance setup (larger cache, frequent saves)
    let hp_memory = MemoryGraphFactory::create_high_performance().await?;
    
    // Research optimized setup (balanced performance/accuracy)
    let research_memory = MemoryGraphFactory::create_research_optimized().await?;
    
    // Custom configuration
    let custom_memory = MemoryGraphFactory::create_persistent(
        MemoryConfig::default(),
        PersistenceConfig {
            db_path: std::path::PathBuf::from("my_brain.db"),
            auto_save_interval_seconds: 60, // Save every minute
            enable_compression: true,
            max_cache_size: 100000,
            ..PersistenceConfig::default()
        }
    ).await?;
    
    Ok(())
}
```

## 🧪 Advanced Features

### Custom Configuration

```rust
let config = MemoryConfig {
    learning_rate: 0.15,        // How fast connections strengthen
    decay_rate: 0.02,           // Forgetting rate
    consolidation_threshold: 0.4, // Strength needed for long-term storage
    max_short_term_connections: 10000,
    consolidation_interval_hours: 24, // Daily consolidation like sleep
    max_recall_results: 20,
};

let memory = MemoryGraph::new(config);
```

### Spreading Activation Recall

```rust
// Multiple seed concepts activate the network
let seed_concepts = vec![cat_id, dog_id];
let results = memory.spreading_activation_recall(&seed_concepts, 0.2, 5);
```

### Content-Based Similarity

```rust
// Find concepts similar to a query string
let results = memory.recall_by_content("furry pet animal", RecallQuery::default());
```

### Hebbian Strengthening

```rust
// Strengthen connections between co-activated concepts
let active_concepts = vec![cat_id, pet_id, mammal_id];
memory.hebbian_strengthening(&active_concepts);
```

## 🧠 Neuroscience Inspiration

### Biological Basis

| Brain Structure | LeafMind Component | Function |
|----------------|-------------------|----------|
| **Neuron** | `Concept` | Information processing unit |
| **Synapse** | `SynapticEdge` | Weighted connection |
| **Hippocampus** | Short-term memory | Temporary storage & consolidation |
| **Cortex** | Long-term memory | Permanent knowledge storage |
| **Synaptic Plasticity** | LTP/LTD algorithms | Learning and forgetting |
| **Sleep Consolidation** | `sleep_cycle()` | Memory reorganization |

### Key Algorithms

- **LTP Formula**: `weight += α * (1 - weight)` (asymptotic strengthening)
- **LTD Formula**: `weight *= (1 - β)` (exponential decay)
- **Ebbinghaus Curve**: `R = e^(-t/S)` (forgetting over time)
- **Hebbian Rule**: Simultaneous activation strengthens connections

## 📊 Performance Characteristics

- **Thread-Safe**: Built with `DashMap` for concurrent access
- **Memory Efficient**: Automatic pruning of weak connections
- **Scalable**: Handles thousands of concepts and connections
- **Fast Recall**: O(log n) average case for associative lookup
- **Configurable**: Tunable parameters for different use cases

## 🎮 Demo Application

Run the included demonstration:

```bash
cargo run
```

This shows:
- Learning hierarchical concept networks
- Associative and content-based recall
- Memory consolidation in action
- Synaptic plasticity mechanisms
- Natural forgetting processes

## 🔬 Research Applications

LeafMind is designed for:
- **AI Memory Systems**: Long-term memory for AI agents
- **Knowledge Graphs**: Dynamic, self-organizing knowledge bases
- **Cognitive Modeling**: Simulate human-like memory processes
- **Adaptive Systems**: Self-modifying information networks
- **Research**: Study computational models of memory

## 🤝 Contributing

Contributions welcome! Areas of interest:
- Advanced NLP integration for semantic similarity
- GPU acceleration for large-scale networks
- Additional plasticity mechanisms
- Visualization tools for memory networks
- Performance optimizations

## 📜 License

MIT License - see LICENSE file for details.

## 🔗 References

This implementation draws inspiration from:
- Hebbian Learning Theory
- Complementary Learning Systems (McClelland et al.)
- Synaptic Plasticity Research (LTP/LTD mechanisms)
- Memory Consolidation Studies
- Ebbinghaus Forgetting Curve Research

---

**Built with ❤️ and 🧠 by Hiren Rana**

*"Bridging the gap between biological and artificial intelligence"*