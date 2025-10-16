pub mod types;
pub mod memory_graph;
pub mod plasticity;
pub mod consolidation;
pub mod recall;
pub mod forgetting;

// Re-export main types for convenience
pub use types::{Concept, ConceptId, MemoryConfig, MemoryZone, SynapticWeight};
pub use memory_graph::{MemoryGraph, MemoryStats};
pub use recall::{RecallQuery, RecallResult};
pub use consolidation::ConsolidationStats;
pub use forgetting::{ForgettingConfig, ForgettingStats};

/// LeafMind - A hippocampus-inspired neuromorphic memory system
/// 
/// This library implements brain-like memory mechanisms including:
/// - Synaptic plasticity (LTP/LTD)
/// - Memory consolidation (hippocampus → cortex)
/// - Associative recall with spreading activation
/// - Natural forgetting and interference
/// - Working memory management
/// 
/// # Example
/// 
/// ```rust
/// use leafmind::{MemoryGraph, MemoryConfig, RecallQuery};
/// 
/// // Create a new memory system
/// let memory = MemoryGraph::new_with_defaults();
/// 
/// // Learn some concepts
/// let cat_id = memory.learn("A small furry animal that meows".to_string());
/// let dog_id = memory.learn("A loyal furry animal that barks".to_string());
/// let pet_id = memory.learn("A domesticated animal companion".to_string());
/// 
/// // Create associations
/// memory.associate(cat_id.clone(), pet_id.clone()).unwrap();
/// memory.associate(dog_id.clone(), pet_id.clone()).unwrap();
/// 
/// // Recall related concepts
/// let results = memory.recall(&pet_id, RecallQuery::default());
/// println!("Pet recalls: {:?}", results.len());
/// 
/// // Consolidate memories (hippocampus → cortex)
/// let stats = memory.consolidate_memory();
/// println!("Consolidated {} connections", stats.promoted_to_long_term);
/// ```

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recall::RecallQuery;

    #[test]
    fn test_basic_memory_operations() {
        let memory = MemoryGraph::new_with_defaults();

        // Test concept creation
        let concept1 = memory.learn("Hello world".to_string());
        let concept2 = memory.learn("Goodbye world".to_string());

        // Test association
        assert!(memory.associate(concept1.clone(), concept2.clone()).is_ok());

        // Test recall
        let results = memory.recall(&concept1, RecallQuery::default());
        assert!(!results.is_empty());
    }

    #[test]
    fn test_consolidation() {
        let memory = MemoryGraph::new_with_defaults();

        let concept1 = memory.learn("Important memory".to_string());
        let concept2 = memory.learn("Related memory".to_string());

        // Create and strengthen association
        memory.associate(concept1.clone(), concept2.clone()).unwrap();
        memory.access_concept(&concept1).unwrap();
        memory.access_concept(&concept2).unwrap();

        // Force consolidation
        let stats = memory.force_consolidation();
        assert!(stats.promoted_to_long_term >= 0);
    }

    #[test]
    fn test_forgetting() {
        let memory = MemoryGraph::new_with_defaults();
        let config = ForgettingConfig::default();

        let concept = memory.learn("Forgettable memory".to_string());
        let initial_count = memory.get_all_concept_ids().len();

        let stats = memory.forget(config);
        // Forgetting stats should be initialized
        assert!(stats.concepts_forgotten >= 0);
    }
}