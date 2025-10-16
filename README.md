# 🧠 LeafMind - Hippocampus-Inspired Neuromorphic Memory System

LeafMind is a Rust implementation of a brain-inspired memory system that mimics the neurological processes of learning, memory consolidation, recall, and forgetting. It bridges neuroscience and computer science by implementing computational models of synaptic plasticity, hippocampal memory consolidation, and associative recall mechanisms.

## 🎯 Core Features

### 🧬 Neuromorphic Architecture
- **Concept Nodes**: Represent individual pieces of information (like neurons)
- **Synaptic Edges**: Weighted connections between concepts (like synapses)
- **Dynamic Weights**: Connection strengths that change over time based on usage
- **Memory Zones**: Separate short-term (hippocampus) and long-term (cortex) storage

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

## 🚀 Quick Start

### Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
leafmind = "0.1.0"
```

### Basic Usage

```rust
use leafmind::{MemoryGraph, MemoryConfig, RecallQuery};

// Create a memory system
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

// Apply brain-like plasticity
memory.sleep_cycle(); // Combines LTP, LTD, and cleanup

// Natural forgetting
use leafmind::ForgettingConfig;
let forgetting_stats = memory.forget(ForgettingConfig::default());
println!("Forgot {} unused concepts", forgetting_stats.concepts_forgotten);
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