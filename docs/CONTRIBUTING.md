# 🤝 Contributing to LeafMind

Thank you for your interest in contributing to LeafMind! This guide will help you understand how to contribute effectively to our brain-inspired memory system.

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Organization](#code-organization)
- [Contribution Guidelines](#contribution-guidelines)
- [Adding New Features](#adding-new-features)
- [Testing](#testing)
- [Documentation](#documentation)
- [Code Review Process](#code-review-process)
- [Community](#community)

## 🚀 Getting Started

### Prerequisites

- **Rust 1.90.0 or later**: LeafMind uses modern Rust features
- **Git**: For version control
- **IDE/Editor**: VS Code with rust-analyzer is recommended

### First Time Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/yourusername/leafmind.git
   cd leafmind
   ```

2. **Install Dependencies**
   ```bash
   cargo build
   ```

3. **Run Tests**
   ```bash
   cargo test
   ```

4. **Run Examples**
   ```bash
   cargo run --example basic_usage
   ```

## 🛠️ Development Setup

### Recommended Development Environment

```bash
# Install useful development tools
cargo install cargo-watch    # Auto-rebuild on changes
cargo install cargo-tarpaulin # Code coverage
cargo install clippy         # Additional linting
```

### Development Workflow

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes with Auto-reload**
   ```bash
   cargo watch -x check -x test
   ```

3. **Ensure Code Quality**
   ```bash
   cargo fmt              # Format code
   cargo clippy           # Check for issues
   cargo test             # Run all tests
   ```

4. **Check Coverage** (optional)
   ```bash
   cargo tarpaulin --out Html
   ```

## 📁 Code Organization

LeafMind follows a modular architecture. Here's where different types of contributions should go:

### Core System (`src/`)

```
src/
├── lib.rs              # Public API and integration tests
├── types.rs            # Core data structures
├── memory_graph.rs     # Central memory system
├── plasticity.rs       # Learning algorithms (LTP/LTD)
├── consolidation.rs    # Memory consolidation logic
├── recall.rs           # Memory retrieval mechanisms
├── forgetting.rs       # Memory decay and pruning
└── utils.rs           # Utility functions (create if needed)
```

### Where to Add Your Contribution

| **Feature Type** | **Primary Location** | **Secondary Files** |
|------------------|---------------------|---------------------|
| **New memory algorithms** | `plasticity.rs` | Add tests to `lib.rs` |
| **Recall strategies** | `recall.rs` | Update `RecallQuery` in `types.rs` |
| **Consolidation mechanisms** | `consolidation.rs` | May need `MemoryConfig` updates |
| **New data structures** | `types.rs` | Update `memory_graph.rs` integration |
| **Performance optimizations** | Relevant module | Add benchmarks to `benches/` |
| **New forgetting models** | `forgetting.rs` | Update configuration options |

### Adding New Modules

If your feature requires a new module:

1. **Create the module file**: `src/your_module.rs`
2. **Add to lib.rs**: 
   ```rust
   mod your_module;
   pub use your_module::*;
   ```
3. **Follow naming conventions**: Use `snake_case` for files and functions
4. **Add comprehensive tests**: Both unit and integration tests

## 📝 Contribution Guidelines

### Code Style

LeafMind follows standard Rust conventions:

```rust
// ✅ Good: Clear, descriptive names
fn strengthen_synaptic_connection(weight: &mut SynapticWeight, factor: f64) {
    weight.apply_ltp(factor);
}

// ❌ Avoid: Unclear abbreviations
fn str_syn_conn(w: &mut SynapticWeight, f: f64) {
    w.apply_ltp(f);
}

// ✅ Good: Comprehensive documentation
/// Applies Long-Term Potentiation to strengthen synaptic connections.
/// 
/// This implements the biological process where repeated activation
/// leads to persistent strengthening of synapses.
/// 
/// # Arguments
/// * `activation_count` - Number of recent activations
/// * `time_window` - Time window for considering activations (hours)
/// 
/// # Returns
/// The new connection strength after LTP application
pub fn apply_ltp_strengthening(&self, activation_count: usize, time_window: f64) -> f64 {
    // Implementation here
}
```

### Commit Message Format

Follow conventional commits:

```
type(scope): description

feat(plasticity): add spike-timing dependent plasticity algorithm
fix(recall): resolve infinite loop in associative search
docs(api): update memory consolidation examples
test(integration): add comprehensive forgetting mechanism tests
perf(memory): optimize connection lookup with spatial indexing
```

### Pull Request Guidelines

1. **Clear Title**: Describe what the PR does
2. **Comprehensive Description**: 
   ```markdown
   ## Changes Made
   - Added new STDP algorithm to plasticity.rs
   - Updated MemoryConfig to include STDP parameters
   - Added comprehensive tests and benchmarks
   
   ## Motivation
   Spike-timing dependent plasticity provides more biologically accurate
   learning compared to rate-based LTP/LTD.
   
   ## Testing
   - Unit tests for STDP algorithm
   - Integration tests with existing memory system
   - Benchmarks show 15% improvement in learning accuracy
   ```

3. **Small, Focused Changes**: One feature per PR
4. **Tests Included**: All new code must have tests
5. **Documentation Updated**: Update relevant docs

## 🔧 Adding New Features

### Feature Development Process

1. **Research Phase**
   - Study relevant neuroscience papers
   - Check existing implementations
   - Design API that fits LeafMind's architecture

2. **Design Phase**
   ```rust
   // Create a design document or RFC for major features
   /*
   Feature: Attention-Based Memory Recall
   
   Problem: Current recall is breadth-first, but biological memory
   uses attention to focus on relevant pathways.
   
   Solution: Add attention weights to recall queries.
   
   API Design:
   struct AttentionWeight {
       concept_type: String,
       weight: f64,
   }
   
   impl RecallQuery {
       pub fn with_attention(mut self, weights: Vec<AttentionWeight>) -> Self
   }
   */
   ```

3. **Implementation Phase**
   - Start with failing tests (TDD approach)
   - Implement minimal functionality
   - Iterate with tests

4. **Integration Phase**
   - Ensure compatibility with existing features
   - Update documentation
   - Add examples

### Example: Adding a New Plasticity Algorithm

```rust
// 1. Add to types.rs
#[derive(Debug, Clone)]
pub struct STDPConfig {
    pub pre_post_window_ms: f64,
    pub post_pre_window_ms: f64,
    pub max_weight_change: f64,
}

// 2. Update MemoryConfig
impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            // ... existing fields
            stdp_config: STDPConfig {
                pre_post_window_ms: 20.0,
                post_pre_window_ms: 20.0,
                max_weight_change: 0.1,
            },
        }
    }
}

// 3. Implement in plasticity.rs
impl MemoryGraph {
    /// Applies Spike-Timing Dependent Plasticity between two concepts
    pub fn apply_stdp(&self, pre_concept: &ConceptId, post_concept: &ConceptId, 
                     time_difference_ms: f64) -> Result<(), MemoryError> {
        // Implementation here
        todo!("Implement STDP algorithm")
    }
}

// 4. Add comprehensive tests
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_stdp_potentiation() {
        let memory = MemoryGraph::new_with_defaults();
        let pre_id = memory.learn("Pre-synaptic concept".to_string());
        let post_id = memory.learn("Post-synaptic concept".to_string());
        
        // Pre before post should strengthen connection
        memory.apply_stdp(&pre_id, &post_id, 10.0).unwrap();
        
        // Verify strengthening
        let connections = memory.recall(&pre_id, RecallQuery::default());
        assert!(!connections.is_empty());
        // More specific assertions...
    }
}
```

## 🧪 Testing

### Test Categories

1. **Unit Tests**: Test individual functions
   ```rust
   #[test]
   fn test_synaptic_weight_ltp() {
       let mut weight = SynapticWeight::new(0.5);
       weight.apply_ltp(0.1);
       assert!(weight.strength > 0.5);
   }
   ```

2. **Integration Tests**: Test feature interactions
   ```rust
   #[test]
   fn test_learning_and_recall_integration() {
       let memory = MemoryGraph::new_with_defaults();
       let concept_id = memory.learn("Test concept".to_string());
       
       let results = memory.recall(&concept_id, RecallQuery::default());
       assert_eq!(results.len(), 1);
       assert_eq!(results[0].concept.content, "Test concept");
   }
   ```

3. **Property-Based Tests**: Test invariants
   ```rust
   use proptest::prelude::*;
   
   proptest! {
       #[test]
       fn test_weight_always_positive(strength in 0.0f64..1.0) {
           let weight = SynapticWeight::new(strength);
           prop_assert!(weight.strength >= 0.0);
           prop_assert!(weight.strength <= 1.0);
       }
   }
   ```

4. **Performance Tests**: Ensure scalability
   ```rust
   #[test]
   fn test_large_scale_recall_performance() {
       let memory = create_large_memory_graph(10000);
       let start = std::time::Instant::now();
       
       let results = memory.recall(&some_concept, RecallQuery::default());
       let duration = start.elapsed();
       
       assert!(duration < std::time::Duration::from_millis(100));
       assert!(!results.is_empty());
   }
   ```

### Running Tests

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_synaptic_weight_ltp

# Run tests with output
cargo test -- --nocapture

# Run performance tests
cargo test --release test_large_scale

# Run with coverage
cargo tarpaulin --out Html
```

## 📚 Documentation

### Documentation Standards

1. **Public API**: Must have comprehensive docs
   ```rust
   /// Applies Long-Term Potentiation to strengthen synaptic connections.
   /// 
   /// This method implements the biological process where repeated activation
   /// of synaptic pathways leads to persistent strengthening. The strengthening
   /// follows a saturation curve to prevent unlimited growth.
   /// 
   /// # Arguments
   /// 
   /// * `activation_strength` - The intensity of the activation (0.0 to 1.0)
   /// 
   /// # Examples
   /// 
   /// ```rust
   /// use leafmind::SynapticWeight;
   /// 
   /// let mut weight = SynapticWeight::new(0.3);
   /// weight.apply_ltp(0.2);
   /// assert!(weight.strength > 0.3);
   /// ```
   /// 
   /// # Panics
   /// 
   /// Panics if `activation_strength` is negative or greater than 1.0.
   /// 
   /// # See Also
   /// 
   /// * [`apply_ltd`] - For synaptic weakening
   /// * [`MemoryGraph::hebbian_strengthening`] - For network-wide strengthening
   pub fn apply_ltp(&mut self, activation_strength: f64) {
       // Implementation
   }
   ```

2. **Internal Functions**: Brief but clear
   ```rust
   /// Calculates the saturation factor for LTP based on current strength
   fn calculate_ltp_saturation(current_strength: f64) -> f64 {
       // Implementation
   }
   ```

3. **Update Documentation Files**:
   - Update `README.md` for major features
   - Add to `docs/ARCHITECTURE.md` for architectural changes
   - Create examples in `docs/EXAMPLES.md`
   - Update `docs/API_REFERENCE.md` for API changes

### Documentation Commands

```bash
# Generate and view docs
cargo doc --open

# Check documentation
cargo doc --no-deps

# Test documentation examples
cargo test --doc
```

## 🔍 Code Review Process

### Before Submitting

1. **Self-Review Checklist**:
   - [ ] Code follows Rust conventions
   - [ ] All tests pass
   - [ ] Documentation is complete
   - [ ] No `todo!()` or `unimplemented!()` in main code
   - [ ] Performance impact considered
   - [ ] Backward compatibility maintained

2. **Automated Checks**:
   ```bash
   cargo fmt --check     # Code formatting
   cargo clippy          # Linting
   cargo test           # All tests
   cargo doc --no-deps  # Documentation builds
   ```

### Review Criteria

Reviewers will check for:

1. **Correctness**: Does the code do what it claims?
2. **Performance**: Is it efficient enough?
3. **Safety**: Are there potential panics or memory issues?
4. **API Design**: Is the interface intuitive and consistent?
5. **Testing**: Are edge cases covered?
6. **Documentation**: Can others understand and use it?

### Addressing Review Comments

```bash
# Make requested changes
git add .
git commit -m "address review: fix edge case in STDP algorithm"

# Update your PR
git push origin feature/your-feature
```

## 🎯 Specific Contribution Areas

We welcome contributions in these areas:

### 🧠 Neuroscience-Inspired Features
- **Spike-timing dependent plasticity**
- **Attention mechanisms**
- **Episodic vs semantic memory distinction**
- **Emotional weighting of memories**
- **Sleep-dependent consolidation variants**

### ⚡ Performance Optimizations
- **Parallel processing for large graphs**
- **Memory usage optimizations**
- **Cache-friendly data structures**
- **SIMD operations for weight calculations**

### 🔧 Developer Experience
- **Better error messages**
- **More comprehensive examples**
- **Performance profiling tools**
- **Memory visualization utilities**

### 🧪 Research Applications
- **Cognitive modeling features**
- **Research-specific metrics**
- **Export formats for analysis**
- **Integration with ML frameworks**

## 📞 Community

### Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and brainstorming
- **Code Review**: Submit PRs for collaborative development

### Communication Guidelines

- Be respectful and inclusive
- Provide context and examples
- Focus on technical merit
- Help others learn and contribute

## 🏆 Recognition

Contributors will be:
- Listed in `CONTRIBUTORS.md`
- Mentioned in release notes
- Given credit in relevant documentation

## 📋 Quick Contribution Checklist

- [ ] Fork and clone the repository
- [ ] Create a feature branch
- [ ] Write tests first (TDD approach)
- [ ] Implement your feature
- [ ] Add comprehensive documentation
- [ ] Run all quality checks
- [ ] Submit a well-described pull request
- [ ] Respond to review feedback promptly

Thank you for contributing to LeafMind! Your contributions help advance our understanding of brain-inspired computing and memory systems. 🧠✨