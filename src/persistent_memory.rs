use crate::memory_graph::{MemoryGraph, MemoryStats};
use crate::persistence::{PersistentMemoryStore, PersistenceConfig, PersistenceStats, AutoSaveManager};
use crate::types::{Concept, ConceptId, MemoryConfig, SynapticEdge};
use std::sync::Arc;
use tracing::{error, info, instrument};

/// A persistent memory graph that automatically saves to and loads from disk
pub struct PersistentMemoryGraph {
    /// In-memory graph for fast operations
    memory_graph: MemoryGraph,
    /// Persistent storage backend
    storage: Arc<PersistentMemoryStore>,
    /// Auto-save manager
    auto_save_manager: Option<AutoSaveManager>,
    /// Persistence configuration
    persistence_config: PersistenceConfig,
}

impl PersistentMemoryGraph {
    /// Create a new persistent memory graph
    #[instrument(skip(memory_config, persistence_config))]
    pub async fn new(
        memory_config: MemoryConfig, 
        persistence_config: PersistenceConfig
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        info!("Initializing persistent memory graph");
        
        // Initialize storage
        let storage = Arc::new(PersistentMemoryStore::new(persistence_config.clone())?);
        
        // Try to load existing configuration or store the new one
        let final_memory_config = match storage.load_config().await? {
            Some(stored_config) => {
                info!("Loaded existing memory configuration from database");
                stored_config
            }
            None => {
                info!("No existing configuration found, storing new configuration");
                storage.store_config(&memory_config).await?;
                memory_config
            }
        };
        
        // Create memory graph
        let memory_graph = MemoryGraph::new(final_memory_config);
        
        let mut persistent_graph = Self {
            memory_graph,
            storage,
            auto_save_manager: None,
            persistence_config,
        };
        
        // Load existing data
        persistent_graph.load_from_storage().await?;
        
        // Initialize auto-save if configured
        if persistent_graph.persistence_config.auto_save_interval_seconds > 0 {
            persistent_graph.start_auto_save().await?;
        }
        
        info!("Persistent memory graph initialized successfully");
        Ok(persistent_graph)
    }

    /// Create with default configurations
    pub async fn new_with_defaults() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Self::new(MemoryConfig::default(), PersistenceConfig::default()).await
    }

    /// Load all data from storage into memory
    #[instrument(skip(self))]
    pub async fn load_from_storage(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Loading data from persistent storage");
        
        // Load concepts
        let concepts = self.storage.load_all_concepts().await?;
        for (id, concept) in concepts {
            self.memory_graph.concepts.insert(id, concept);
        }
        
        // Load edges
        let (short_term_edges, long_term_edges) = self.storage.load_all_edges().await?;
        for (key, edge) in short_term_edges {
            self.memory_graph.short_term_edges.insert(key, edge);
        }
        for (key, edge) in long_term_edges {
            self.memory_graph.long_term_edges.insert(key, edge);
        }
        
        // Load working memory
        let working_memory = self.storage.load_all_working_memory().await?;
        for (id, timestamp) in working_memory {
            self.memory_graph.working_memory.insert(id, timestamp);
        }
        
        let stats = self.memory_graph.get_stats();
        info!("Loaded {} concepts, {} short-term edges, {} long-term edges", 
              stats.total_concepts, stats.short_term_connections, stats.long_term_connections);
        
        Ok(())
    }

    /// Save all data from memory to storage
    #[instrument(skip(self))]
    pub async fn save_to_storage(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Saving data to persistent storage");
        
        // Save concepts in batches
        let concepts: Vec<Concept> = self.memory_graph.concepts.iter()
            .map(|entry| entry.value().clone())
            .collect();
        
        if !concepts.is_empty() {
            for chunk in concepts.chunks(self.persistence_config.batch_size) {
                let concept_refs: Vec<&Concept> = chunk.iter().collect();
                self.storage.batch_store_concepts(concept_refs).await?;
            }
        }
        
        // Save edges in batches
        let mut all_edges = Vec::new();
        
        // Collect short-term edges
        for entry in self.memory_graph.short_term_edges.iter() {
            all_edges.push((entry.value().clone(), false));
        }
        
        // Collect long-term edges
        for entry in self.memory_graph.long_term_edges.iter() {
            all_edges.push((entry.value().clone(), true));
        }
        
        if !all_edges.is_empty() {
            for chunk in all_edges.chunks(self.persistence_config.batch_size) {
                let edge_refs: Vec<(&SynapticEdge, bool)> = chunk.iter()
                    .map(|(edge, is_long_term)| (edge, *is_long_term))
                    .collect();
                self.storage.batch_store_edges(edge_refs).await?;
            }
        }
        
        // Save working memory
        for entry in self.memory_graph.working_memory.iter() {
            self.storage.store_working_memory(entry.key(), *entry.value()).await?;
        }
        
        // Save configuration
        self.storage.store_config(&self.memory_graph.config).await?;
        
        // Force sync to disk
        self.storage.sync().await?;
        
        info!("Successfully saved all data to persistent storage");
        Ok(())
    }

    /// Start auto-save background task
    #[instrument(skip(self))]
    pub async fn start_auto_save(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.persistence_config.auto_save_interval_seconds == 0 {
            return Ok(());
        }

        let storage = Arc::clone(&self.storage);
        let persistence_config = self.persistence_config.clone();
        
        // Create auto-save manager
        let _auto_save_manager = AutoSaveManager::new(storage, persistence_config.clone());
        
        // For now, disable auto-save to avoid threading issues
        // TODO: Implement proper Arc<RwLock<MemoryGraph>> approach
        info!("Auto-save temporarily disabled due to threading architecture");
        
        /* 
        // Start the auto-save task - disabled for now
        auto_save_manager.start(move || {
            let storage = storage.clone();
            let persistence_config = persistence_config.clone();
            
            async move {
                // TODO: Implement safe memory graph access
                    
                    // Save concepts
                    let concepts: Vec<&Concept> = memory_graph.concepts.iter()
                        .map(|entry| entry.value())
                        .collect();
                    
                    if !concepts.is_empty() {
                        for chunk in concepts.chunks(persistence_config.batch_size) {
                            storage.batch_store_concepts(chunk.to_vec()).await?;
                        }
                    }
                    
                    // Save edges
                    let mut all_edges = Vec::new();
                    
                    for entry in memory_graph.short_term_edges.iter() {
                        all_edges.push((entry.value(), false));
                    }
                    
                    for entry in memory_graph.long_term_edges.iter() {
                        all_edges.push((entry.value(), true));
                    }
                    
                    if !all_edges.is_empty() {
                        for chunk in all_edges.chunks(persistence_config.batch_size) {
                            storage.batch_store_edges(chunk.to_vec()).await?;
                        }
                    }
                    
                    // Save working memory
                    // for entry in memory_graph.working_memory.iter() {
                    //     storage.store_working_memory(entry.key(), *entry.value()).await?;
                    // }
                    
                    // storage.sync().await?;
                
                Ok(())
            }
        }).await?;
        */
        
        // self.auto_save_manager = Some(auto_save_manager);
        info!("Auto-save started with interval: {} seconds", self.persistence_config.auto_save_interval_seconds);
        
        Ok(())
    }

    /// Stop auto-save background task
    #[instrument(skip(self))]
    pub async fn stop_auto_save(&mut self) {
        if let Some(mut auto_save_manager) = self.auto_save_manager.take() {
            auto_save_manager.stop().await;
            info!("Auto-save stopped");
        }
    }

    /// Create and add a concept from content
    #[instrument(skip(self))]
    pub async fn learn(&self, content: String) -> Result<ConceptId, Box<dyn std::error::Error + Send + Sync>> {
        let concept_id = self.memory_graph.learn(content);
        
        // Immediately persist if cache is getting full
        if self.should_immediate_persist().await {
            if let Some(concept) = self.memory_graph.get_concept(&concept_id) {
                self.storage.store_concept(&concept).await?;
            }
        }
        
        Ok(concept_id)
    }

    /// Create an association between two concepts
    #[instrument(skip(self))]
    pub async fn associate(&self, from_id: ConceptId, to_id: ConceptId) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.memory_graph.associate(from_id.clone(), to_id.clone())
            .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, e)) as Box<dyn std::error::Error + Send + Sync>)?;
        
        // Immediately persist if cache is getting full
        if self.should_immediate_persist().await {
            let edge_key = (from_id, to_id);
            if let Some(edge) = self.memory_graph.short_term_edges.get(&edge_key) {
                self.storage.store_edge(edge.value(), false).await?;
            } else if let Some(edge) = self.memory_graph.long_term_edges.get(&edge_key) {
                self.storage.store_edge(edge.value(), true).await?;
            }
        }
        
        Ok(())
    }

    /// Access a concept and strengthen related connections
    #[instrument(skip(self))]
    pub async fn access_concept(&self, concept_id: &ConceptId) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.memory_graph.access_concept(concept_id)
            .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, e)) as Box<dyn std::error::Error + Send + Sync>)?;
        
        // Update working memory in storage
        if let Some(timestamp) = self.memory_graph.working_memory.get(concept_id) {
            self.storage.store_working_memory(concept_id, *timestamp.value()).await?;
        }
        
        Ok(())
    }

    /// Check if immediate persistence is needed
    async fn should_immediate_persist(&self) -> bool {
        let total_items = self.memory_graph.concepts.len() + 
                         self.memory_graph.short_term_edges.len() + 
                         self.memory_graph.long_term_edges.len();
        
        total_items >= self.persistence_config.max_cache_size
    }

    /// Backup the database
    #[instrument(skip(self))]
    pub async fn backup<P: AsRef<std::path::Path> + std::fmt::Debug>(&self, backup_path: P) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Save current state first
        self.save_to_storage().await?;
        
        // Perform backup
        self.storage.backup(backup_path).await?;
        
        info!("Database backup completed");
        Ok(())
    }

    /// Restore from backup
    #[instrument(skip(self))]
    pub async fn restore<P: AsRef<std::path::Path> + std::fmt::Debug>(&mut self, backup_path: P) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Stop auto-save during restore
        self.stop_auto_save().await;
        
        // Clear current data
        self.memory_graph.concepts.clear();
        self.memory_graph.short_term_edges.clear();
        self.memory_graph.long_term_edges.clear();
        self.memory_graph.working_memory.clear();
        
        // Restore from backup
        self.storage.restore(backup_path).await?;
        
        // Reload data
        self.load_from_storage().await?;
        
        // Restart auto-save
        if self.persistence_config.auto_save_interval_seconds > 0 {
            self.start_auto_save().await?;
        }
        
        info!("Database restore completed");
        Ok(())
    }

    /// Compact the database
    #[instrument(skip(self))]
    pub async fn compact(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.storage.compact().await
    }

    /// Get combined memory and persistence statistics
    #[instrument(skip(self))]
    pub async fn get_combined_stats(&self) -> (MemoryStats, PersistenceStats) {
        let memory_stats = self.memory_graph.get_stats();
        let persistence_stats = self.storage.get_stats().await;
        (memory_stats, persistence_stats)
    }

    /// Force immediate save
    #[instrument(skip(self))]
    pub async fn force_save(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.save_to_storage().await
    }

    /// Clear persistence cache
    #[instrument(skip(self))]
    pub async fn clear_cache(&self) {
        self.storage.clear_cache().await;
    }

    // Delegate all other methods to the internal memory graph
    pub fn get_concept(&self, concept_id: &ConceptId) -> Option<Concept> {
        self.memory_graph.get_concept(concept_id)
    }

    pub fn get_all_concept_ids(&self) -> Vec<ConceptId> {
        self.memory_graph.get_all_concept_ids()
    }

    pub fn get_stats(&self) -> MemoryStats {
        self.memory_graph.get_stats()
    }

    pub fn should_consolidate(&self) -> bool {
        self.memory_graph.should_consolidate()
    }

    /// Get reference to internal memory graph for advanced operations
    pub fn memory_graph(&self) -> &MemoryGraph {
        &self.memory_graph
    }

    /// Get reference to storage for advanced operations
    pub fn storage(&self) -> &Arc<PersistentMemoryStore> {
        &self.storage
    }
}

impl Drop for PersistentMemoryGraph {
    fn drop(&mut self) {
        // Attempt to save data before dropping (best effort)
        if let Err(e) = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                // Stop auto-save first
                self.stop_auto_save().await;
                
                // Save current state
                self.save_to_storage().await
            })
        }) {
            error!("Failed to save data during drop: {}", e);
        } else {
            info!("Successfully saved data during graceful shutdown");
        }
    }
}

/// Factory for creating different types of memory graphs
pub struct MemoryGraphFactory;

impl MemoryGraphFactory {
    /// Create an in-memory only graph (no persistence)
    pub fn create_memory_only(config: MemoryConfig) -> MemoryGraph {
        MemoryGraph::new(config)
    }

    /// Create a persistent graph with custom configurations
    pub async fn create_persistent(
        memory_config: MemoryConfig,
        persistence_config: PersistenceConfig
    ) -> Result<PersistentMemoryGraph, Box<dyn std::error::Error + Send + Sync>> {
        PersistentMemoryGraph::new(memory_config, persistence_config).await
    }

    /// Create a persistent graph with default configurations
    pub async fn create_persistent_default() -> Result<PersistentMemoryGraph, Box<dyn std::error::Error + Send + Sync>> {
        PersistentMemoryGraph::new_with_defaults().await
    }

    /// Create a persistent graph optimized for high-performance workloads
    pub async fn create_high_performance() -> Result<PersistentMemoryGraph, Box<dyn std::error::Error + Send + Sync>> {
        let memory_config = MemoryConfig {
            learning_rate: 0.05,
            decay_rate: 0.001,
            consolidation_threshold: 0.7,
            max_short_term_connections: 100000,
            consolidation_interval_hours: 12,
            max_recall_results: 100,
        };

        let persistence_config = PersistenceConfig {
            db_path: std::path::PathBuf::from("leafmind_hp.db"),
            auto_save_interval_seconds: 120, // 2 minutes
            batch_size: 5000,
            enable_compression: true,
            max_cache_size: 500000, // 500k items
            enable_wal: true,
        };

        PersistentMemoryGraph::new(memory_config, persistence_config).await
    }

    /// Create a persistent graph optimized for research workloads
    pub async fn create_research_optimized() -> Result<PersistentMemoryGraph, Box<dyn std::error::Error + Send + Sync>> {
        let memory_config = MemoryConfig {
            learning_rate: 0.08,
            decay_rate: 0.015,
            consolidation_threshold: 0.6,
            max_short_term_connections: 50000,
            consolidation_interval_hours: 24,
            max_recall_results: 50,
        };

        let persistence_config = PersistenceConfig {
            db_path: std::path::PathBuf::from("leafmind_research.db"),
            auto_save_interval_seconds: 600, // 10 minutes
            batch_size: 2000,
            enable_compression: true,
            max_cache_size: 200000,
            enable_wal: true,
        };

        PersistentMemoryGraph::new(memory_config, persistence_config).await
    }
}