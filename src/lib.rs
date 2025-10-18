pub mod types;
pub mod memory_graph;
pub mod plasticity;
pub mod consolidation;
pub mod recall;
pub mod forgetting;
pub mod persistence;
pub mod persistent_memory;
pub mod server;

// Re-export main types for convenience
pub use types::{Concept, ConceptId, MemoryConfig, MemoryZone, SynapticWeight};
pub use memory_graph::{MemoryGraph, MemoryStats};
pub use recall::{RecallQuery, RecallResult};
pub use consolidation::ConsolidationStats;
pub use forgetting::{ForgettingConfig, ForgettingStats};
pub use persistence::{PersistentMemoryStore, PersistenceConfig, PersistenceStats, AutoSaveManager};
pub use persistent_memory::{PersistentMemoryGraph, MemoryGraphFactory};
pub use server::{LeafMindGrpcServer, HybridServer, HybridConfig, WebSocketServer};
pub use server::grpc::ServerConfig as GrpcServerConfig;

/// LeafMind - A hippocampus-inspired neuromorphic memory system
/// 
/// This library implements brain-like memory mechanisms including:
/// - Synaptic plasticity (LTP/LTD)
/// - Memory consolidation (hippocampus → cortex)
/// - Associative recall with spreading activation
/// - Natural forgetting and interference
/// - Working memory management 
/// - **Persistent storage with RocksDB**
/// - **Auto-save and backup capabilities**
/// - **High-performance gRPC API with streaming support**
/// - **Real-time WebSocket communication**
/// 
/// # In-Memory Example
/// 
/// ```rust
/// use leafmind::{MemoryGraph, MemoryConfig, RecallQuery};
/// 
/// // Create a new memory system (RAM only)
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
/// ```
/// 
/// # Persistent Memory Example
/// 
/// ```rust,no_run
/// use leafmind::{PersistentMemoryGraph, MemoryConfig, PersistenceConfig, RecallQuery};
/// use std::path::PathBuf;
/// 
/// #[tokio::main]
/// async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
///     // Create persistent memory (automatically saves to disk)
///     let mut memory = PersistentMemoryGraph::new_with_defaults().await?;
///     
///     // Learn concepts (automatically persisted)
///     let concept1 = memory.learn("Persistent memory concept".to_string()).await?;
///     let concept2 = memory.learn("Another persistent concept".to_string()).await?;
///     
///     // Create associations (persisted)
///     memory.associate(concept1.clone(), concept2.clone()).await?;
///     
///     // Access concepts (updates timestamps in DB)
///     memory.access_concept(&concept1).await?;
///     
///     // Force immediate save
///     memory.force_save().await?;
///     
///     // Backup database
///     memory.backup("backup.db").await?;
///     
///     // Get stats
///     let (memory_stats, persistence_stats) = memory.get_combined_stats().await;
///     println!("Concepts: {}, DB size: {} bytes", 
///              memory_stats.total_concepts, 
///              persistence_stats.database_size_bytes);
///     
///     Ok(())
/// }
/// ```
/// 
/// # Factory Pattern for Different Use Cases
/// 
/// ```rust,no_run
/// use leafmind::MemoryGraphFactory;
/// 
/// #[tokio::main]
/// async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
///     // High-performance setup (larger cache, frequent saves)
///     let hp_memory = MemoryGraphFactory::create_high_performance().await?;
///     
///     // Research optimized setup (balanced performance/accuracy)
///     let research_memory = MemoryGraphFactory::create_research_optimized().await?;
///     
///     // Custom configuration
///     let custom_memory = MemoryGraphFactory::create_persistent(
///         MemoryConfig::default(),
///         PersistenceConfig {
///             db_path: std::path::PathBuf::from("my_brain.db"),
///             auto_save_interval_seconds: 60, // Save every minute
///             batch_size: 1000,
///             enable_compression: true,
///             max_cache_size: 100000,
///             enable_wal: true,
///         }
///     ).await?;
///     
///     Ok(())
/// }
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

    #[tokio::test]
    async fn test_persistent_memory_basic() {
        use std::path::PathBuf;
        use tempfile::TempDir;
        
        // Create temporary directory for test database
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        
        let persistence_config = PersistenceConfig {
            db_path: db_path.clone(),
            auto_save_interval_seconds: 0, // Disable auto-save for test
            batch_size: 100,
            enable_compression: false,
            max_cache_size: 1000,
            enable_wal: false,
        };

        // Create persistent memory
        let memory = PersistentMemoryGraph::new(
            MemoryConfig::default(),
            persistence_config
        ).await.unwrap();

        // Test basic operations
        let concept1 = memory.learn("Persistent concept 1".to_string()).await.unwrap();
        let concept2 = memory.learn("Persistent concept 2".to_string()).await.unwrap();
        
        memory.associate(concept1.clone(), concept2.clone()).await.unwrap();
        memory.access_concept(&concept1).await.unwrap();
        
        // Force save
        memory.force_save().await.unwrap();
        
        // Verify concept exists
        assert!(memory.get_concept(&concept1).is_some());
        assert!(memory.get_concept(&concept2).is_some());
        
        let stats = memory.get_stats();
        assert_eq!(stats.total_concepts, 2);
    }

    #[tokio::test]
    async fn test_persistence_load_save() {
        use std::path::PathBuf;
        use tempfile::TempDir;
        
        // Create temporary directory for test database
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test_load_save.db");
        
        let persistence_config = PersistenceConfig {
            db_path: db_path.clone(),
            auto_save_interval_seconds: 0,
            batch_size: 100,
            enable_compression: false,
            max_cache_size: 1000,
            enable_wal: false,
        };

        let concept_content = "Persistent test concept".to_string();

        // Create first instance and save data
        {
            let memory = PersistentMemoryGraph::new(
                MemoryConfig::default(),
                persistence_config.clone()
            ).await.unwrap();

            let concept_id = memory.learn(concept_content.clone()).await.unwrap();
            memory.force_save().await.unwrap();
        }

        // Create second instance and verify data is loaded
        {
            let memory = PersistentMemoryGraph::new(
                MemoryConfig::default(),
                persistence_config
            ).await.unwrap();

            let stats = memory.get_stats();
            assert_eq!(stats.total_concepts, 1);
            
            // Find the concept by content
            let all_ids = memory.get_all_concept_ids();
            assert_eq!(all_ids.len(), 1);
            
            let concept = memory.get_concept(&all_ids[0]).unwrap();
            assert_eq!(concept.content, concept_content);
        }
    }

    #[tokio::test]
    async fn test_factory_patterns() {
        // Test factory creation methods
        let _hp_memory = MemoryGraphFactory::create_high_performance().await;
        let _research_memory = MemoryGraphFactory::create_research_optimized().await;
        let _default_memory = MemoryGraphFactory::create_persistent_default().await;
        
        // All should succeed in creation
        assert!(_hp_memory.is_ok());
        assert!(_research_memory.is_ok());
        assert!(_default_memory.is_ok());
    }
}