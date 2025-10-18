use crate::types::{Concept, ConceptId, SynapticEdge, MemoryConfig};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use rocksdb::{DB, Options, WriteBatch, IteratorMode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn, instrument};

/// Persistence configuration for the memory system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    /// Database file path
    pub db_path: PathBuf,
    /// Auto-save interval in seconds (0 = manual save only)
    pub auto_save_interval_seconds: u64,
    /// Batch size for bulk operations
    pub batch_size: usize,
    /// Enable compression
    pub enable_compression: bool,
    /// Maximum memory cache size before forcing writes
    pub max_cache_size: usize,
    /// Enable WAL (Write-Ahead Logging) for crash recovery
    pub enable_wal: bool,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            db_path: PathBuf::from("leafmind.db"),
            auto_save_interval_seconds: 300, // 5 minutes
            batch_size: 1000,
            enable_compression: true,
            max_cache_size: 100000, // 100k items
            enable_wal: true,
        }
    }
}

/// Storage keys for different data types
#[derive(Debug)]
pub enum StorageKey {
    Concept(ConceptId),
    ShortTermEdge(ConceptId, ConceptId),
    LongTermEdge(ConceptId, ConceptId),
    WorkingMemory(ConceptId),
    Metadata(String),
    Config,
}

impl StorageKey {
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            StorageKey::Concept(id) => {
                let mut key = b"concept:".to_vec();
                key.extend_from_slice(id.0.as_bytes());
                key
            }
            StorageKey::ShortTermEdge(from, to) => {
                let mut key = b"st_edge:".to_vec();
                key.extend_from_slice(from.0.as_bytes());
                key.push(b':');
                key.extend_from_slice(to.0.as_bytes());
                key
            }
            StorageKey::LongTermEdge(from, to) => {
                let mut key = b"lt_edge:".to_vec();
                key.extend_from_slice(from.0.as_bytes());
                key.push(b':');
                key.extend_from_slice(to.0.as_bytes());
                key
            }
            StorageKey::WorkingMemory(id) => {
                let mut key = b"working:".to_vec();
                key.extend_from_slice(id.0.as_bytes());
                key
            }
            StorageKey::Metadata(name) => {
                let mut key = b"meta:".to_vec();
                key.extend_from_slice(name.as_bytes());
                key
            }
            StorageKey::Config => b"config".to_vec(),
        }
    }
}

/// Statistics about persistence operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceStats {
    pub total_concepts_stored: u64,
    pub total_edges_stored: u64,
    pub last_save_time: DateTime<Utc>,
    pub last_load_time: DateTime<Utc>,
    pub save_count: u64,
    pub load_count: u64,
    pub database_size_bytes: u64,
    pub cache_hit_rate: f64,
}

impl Default for PersistenceStats {
    fn default() -> Self {
        Self {
            total_concepts_stored: 0,
            total_edges_stored: 0,
            last_save_time: Utc::now(),
            last_load_time: Utc::now(),
            save_count: 0,
            load_count: 0,
            database_size_bytes: 0,
            cache_hit_rate: 0.0,
        }
    }
}

/// Persistent storage engine for LeafMind memory system
pub struct PersistentMemoryStore {
    db: Arc<DB>,
    config: PersistenceConfig,
    stats: Arc<RwLock<PersistenceStats>>,
    cache: DashMap<String, Vec<u8>>,
    cache_hits: Arc<std::sync::atomic::AtomicU64>,
    cache_misses: Arc<std::sync::atomic::AtomicU64>,
}

impl PersistentMemoryStore {
    /// Create a new persistent memory store
    #[instrument(skip(config))]
    pub fn new(config: PersistenceConfig) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        info!("Initializing persistent memory store at {:?}", config.db_path);
        
        // Create database directory if it doesn't exist
        if let Some(parent) = config.db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Configure RocksDB options
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.set_compression_type(if config.enable_compression {
            rocksdb::DBCompressionType::Lz4
        } else {
            rocksdb::DBCompressionType::None
        });
        
        // Performance optimizations
        opts.set_max_background_jobs(4);
        opts.set_write_buffer_size(64 * 1024 * 1024); // 64MB
        opts.set_max_write_buffer_number(3);
        opts.set_target_file_size_base(64 * 1024 * 1024); // 64MB
        
        // WAL configuration
        if !config.enable_wal {
            opts.set_use_fsync(false);
        }

        let db = DB::open(&opts, &config.db_path)?;
        
        let store = Self {
            db: Arc::new(db),
            config,
            stats: Arc::new(RwLock::new(PersistenceStats::default())),
            cache: DashMap::new(),
            cache_hits: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            cache_misses: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        };

        info!("Persistent memory store initialized successfully");
        Ok(store)
    }

    /// Store a concept in the database
    #[instrument(skip(self, concept))]
    pub async fn store_concept(&self, concept: &Concept) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::Concept(concept.id.clone()).to_bytes();
        let value = bincode::serialize(concept)?;
        
        self.db.put(&key, &value)?;
        
        // Update cache
        self.cache.insert(String::from_utf8_lossy(&key).to_string(), value);
        
        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_concepts_stored += 1;
        
        debug!("Stored concept: {}", concept.id.0);
        Ok(())
    }

    /// Load a concept from the database
    #[instrument(skip(self))]
    pub async fn load_concept(&self, id: &ConceptId) -> Result<Option<Concept>, Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::Concept(id.clone()).to_bytes();
        let key_str = String::from_utf8_lossy(&key).to_string();
        
        // Check cache first
        if let Some(cached_value) = self.cache.get(&key_str) {
            self.cache_hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let concept: Concept = bincode::deserialize(&cached_value)?;
            return Ok(Some(concept));
        }
        
        // Cache miss - check database
        self.cache_misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        
        match self.db.get(&key)? {
            Some(value) => {
                let concept: Concept = bincode::deserialize(&value)?;
                
                // Update cache
                self.cache.insert(key_str, value);
                
                debug!("Loaded concept: {}", id.0);
                Ok(Some(concept))
            }
            None => Ok(None)
        }
    }

    /// Store a synaptic edge
    #[instrument(skip(self, edge))]
    pub async fn store_edge(&self, edge: &SynapticEdge, is_long_term: bool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = if is_long_term {
            StorageKey::LongTermEdge(edge.from.clone(), edge.to.clone())
        } else {
            StorageKey::ShortTermEdge(edge.from.clone(), edge.to.clone())
        }.to_bytes();
        
        let value = bincode::serialize(edge)?;
        self.db.put(&key, &value)?;
        
        // Update cache
        self.cache.insert(String::from_utf8_lossy(&key).to_string(), value);
        
        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_edges_stored += 1;
        
        debug!("Stored {} edge: {} -> {}", 
               if is_long_term { "long-term" } else { "short-term" },
               edge.from.0, edge.to.0);
        Ok(())
    }

    /// Load a synaptic edge
    #[instrument(skip(self))]
    pub async fn load_edge(&self, from: &ConceptId, to: &ConceptId, is_long_term: bool) -> Result<Option<SynapticEdge>, Box<dyn std::error::Error + Send + Sync>> {
        let key = if is_long_term {
            StorageKey::LongTermEdge(from.clone(), to.clone())
        } else {
            StorageKey::ShortTermEdge(from.clone(), to.clone())
        }.to_bytes();
        
        let key_str = String::from_utf8_lossy(&key).to_string();
        
        // Check cache first
        if let Some(cached_value) = self.cache.get(&key_str) {
            self.cache_hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let edge: SynapticEdge = bincode::deserialize(&cached_value)?;
            return Ok(Some(edge));
        }
        
        // Cache miss - check database
        self.cache_misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        
        match self.db.get(&key)? {
            Some(value) => {
                let edge: SynapticEdge = bincode::deserialize(&value)?;
                
                // Update cache
                self.cache.insert(key_str, value);
                
                debug!("Loaded {} edge: {} -> {}", 
                       if is_long_term { "long-term" } else { "short-term" },
                       from.0, to.0);
                Ok(Some(edge))
            }
            None => Ok(None)
        }
    }

    /// Store working memory timestamp
    #[instrument(skip(self))]
    pub async fn store_working_memory(&self, concept_id: &ConceptId, timestamp: DateTime<Utc>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::WorkingMemory(concept_id.clone()).to_bytes();
        let value = bincode::serialize(&timestamp)?;
        
        self.db.put(&key, &value)?;
        
        // Update cache
        self.cache.insert(String::from_utf8_lossy(&key).to_string(), value);
        
        debug!("Stored working memory: {}", concept_id.0);
        Ok(())
    }

    /// Load working memory timestamp
    #[instrument(skip(self))]
    pub async fn load_working_memory(&self, concept_id: &ConceptId) -> Result<Option<DateTime<Utc>>, Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::WorkingMemory(concept_id.clone()).to_bytes();
        let key_str = String::from_utf8_lossy(&key).to_string();
        
        // Check cache first
        if let Some(cached_value) = self.cache.get(&key_str) {
            self.cache_hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let timestamp: DateTime<Utc> = bincode::deserialize(&cached_value)?;
            return Ok(Some(timestamp));
        }
        
        // Cache miss - check database
        self.cache_misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        
        match self.db.get(&key)? {
            Some(value) => {
                let timestamp: DateTime<Utc> = bincode::deserialize(&value)?;
                
                // Update cache
                self.cache.insert(key_str, value);
                
                Ok(Some(timestamp))
            }
            None => Ok(None)
        }
    }

    /// Store memory configuration
    #[instrument(skip(self, config))]
    pub async fn store_config(&self, config: &MemoryConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::Config.to_bytes();
        let value = bincode::serialize(config)?;
        
        self.db.put(&key, &value)?;
        
        // Update cache
        self.cache.insert(String::from_utf8_lossy(&key).to_string(), value);
        
        info!("Stored memory configuration");
        Ok(())
    }

    /// Load memory configuration
    #[instrument(skip(self))]
    pub async fn load_config(&self) -> Result<Option<MemoryConfig>, Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::Config.to_bytes();
        let key_str = String::from_utf8_lossy(&key).to_string();
        
        // Check cache first
        if let Some(cached_value) = self.cache.get(&key_str) {
            self.cache_hits.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let config: MemoryConfig = bincode::deserialize(&cached_value)?;
            return Ok(Some(config));
        }
        
        // Cache miss - check database
        self.cache_misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        
        match self.db.get(&key)? {
            Some(value) => {
                let config: MemoryConfig = bincode::deserialize(&value)?;
                
                // Update cache
                self.cache.insert(key_str, value);
                
                info!("Loaded memory configuration");
                Ok(Some(config))
            }
            None => Ok(None)
        }
    }

    /// Batch store multiple concepts
    #[instrument(skip(self, concepts))]
    pub async fn batch_store_concepts(&self, concepts: Vec<&Concept>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut batch = WriteBatch::default();
        let mut cache_updates = Vec::new();
        
        for concept in &concepts {
            let key = StorageKey::Concept(concept.id.clone()).to_bytes();
            let value = bincode::serialize(concept)?;
            
            batch.put(&key, &value);
            cache_updates.push((String::from_utf8_lossy(&key).to_string(), value));
        }
        
        self.db.write(batch)?;
        
        // Update cache
        for (key, value) in cache_updates {
            self.cache.insert(key, value);
        }
        
        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_concepts_stored += concepts.len() as u64;
        stats.save_count += 1;
        stats.last_save_time = Utc::now();
        
        info!("Batch stored {} concepts", concepts.len());
        Ok(())
    }

    /// Batch store multiple edges
    #[instrument(skip(self, edges))]
    pub async fn batch_store_edges(&self, edges: Vec<(&SynapticEdge, bool)>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut batch = WriteBatch::default();
        let mut cache_updates = Vec::new();
        
        for (edge, is_long_term) in &edges {
            let key = if *is_long_term {
                StorageKey::LongTermEdge(edge.from.clone(), edge.to.clone())
            } else {
                StorageKey::ShortTermEdge(edge.from.clone(), edge.to.clone())
            }.to_bytes();
            
            let value = bincode::serialize(edge)?;
            
            batch.put(&key, &value);
            cache_updates.push((String::from_utf8_lossy(&key).to_string(), value));
        }
        
        self.db.write(batch)?;
        
        // Update cache
        for (key, value) in cache_updates {
            self.cache.insert(key, value);
        }
        
        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_edges_stored += edges.len() as u64;
        stats.save_count += 1;
        stats.last_save_time = Utc::now();
        
        info!("Batch stored {} edges", edges.len());
        Ok(())
    }

    /// Load all concepts from the database
    #[instrument(skip(self))]
    pub async fn load_all_concepts(&self) -> Result<HashMap<ConceptId, Concept>, Box<dyn std::error::Error + Send + Sync>> {
        let mut concepts = HashMap::new();
        let prefix = b"concept:";
        
        let iter = self.db.iterator(IteratorMode::From(prefix, rocksdb::Direction::Forward));
        
        for item in iter {
            let (key, value) = item?;
            
            // Check if this is still a concept key
            if !key.starts_with(prefix) {
                break;
            }
            
            let concept: Concept = bincode::deserialize(&value)?;
            concepts.insert(concept.id.clone(), concept);
        }
        
        // Update stats
        let mut stats = self.stats.write().await;
        stats.load_count += 1;
        stats.last_load_time = Utc::now();
        
        info!("Loaded {} concepts from database", concepts.len());
        Ok(concepts)
    }

    /// Load all edges from the database
    #[instrument(skip(self))]
    pub async fn load_all_edges(&self) -> Result<(HashMap<(ConceptId, ConceptId), SynapticEdge>, HashMap<(ConceptId, ConceptId), SynapticEdge>), Box<dyn std::error::Error + Send + Sync>> {
        let mut short_term_edges = HashMap::new();
        let mut long_term_edges = HashMap::new();
        
        // Load short-term edges
        let st_prefix = b"st_edge:";
        let iter = self.db.iterator(IteratorMode::From(st_prefix, rocksdb::Direction::Forward));
        
        for item in iter {
            let (key, value) = item?;
            
            if !key.starts_with(st_prefix) {
                break;
            }
            
            let edge: SynapticEdge = bincode::deserialize(&value)?;
            short_term_edges.insert((edge.from.clone(), edge.to.clone()), edge);
        }
        
        // Load long-term edges
        let lt_prefix = b"lt_edge:";
        let iter = self.db.iterator(IteratorMode::From(lt_prefix, rocksdb::Direction::Forward));
        
        for item in iter {
            let (key, value) = item?;
            
            if !key.starts_with(lt_prefix) {
                break;
            }
            
            let edge: SynapticEdge = bincode::deserialize(&value)?;
            long_term_edges.insert((edge.from.clone(), edge.to.clone()), edge);
        }
        
        info!("Loaded {} short-term and {} long-term edges", 
              short_term_edges.len(), long_term_edges.len());
        
        Ok((short_term_edges, long_term_edges))
    }

    /// Load all working memory entries
    #[instrument(skip(self))]
    pub async fn load_all_working_memory(&self) -> Result<HashMap<ConceptId, DateTime<Utc>>, Box<dyn std::error::Error + Send + Sync>> {
        let mut working_memory = HashMap::new();
        let prefix = b"working:";
        
        let iter = self.db.iterator(IteratorMode::From(prefix, rocksdb::Direction::Forward));
        
        for item in iter {
            let (key, value) = item?;
            
            if !key.starts_with(prefix) {
                break;
            }
            
            let timestamp: DateTime<Utc> = bincode::deserialize(&value)?;
            
            // Extract concept ID from key
            let key_str = String::from_utf8_lossy(&key);
            if let Some(uuid_str) = key_str.strip_prefix("working:") {
                if let Ok(uuid) = uuid::Uuid::parse_str(uuid_str) {
                    working_memory.insert(ConceptId(uuid), timestamp);
                }
            }
        }
        
        info!("Loaded {} working memory entries", working_memory.len());
        Ok(working_memory)
    }

    /// Delete a concept from the database
    #[instrument(skip(self))]
    pub async fn delete_concept(&self, id: &ConceptId) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = StorageKey::Concept(id.clone()).to_bytes();
        self.db.delete(&key)?;
        
        // Remove from cache
        let key_str = String::from_utf8_lossy(&key).to_string();
        self.cache.remove(&key_str);
        
        debug!("Deleted concept: {}", id.0);
        Ok(())
    }

    /// Delete an edge from the database
    #[instrument(skip(self))]
    pub async fn delete_edge(&self, from: &ConceptId, to: &ConceptId, is_long_term: bool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = if is_long_term {
            StorageKey::LongTermEdge(from.clone(), to.clone())
        } else {
            StorageKey::ShortTermEdge(from.clone(), to.clone())
        }.to_bytes();
        
        self.db.delete(&key)?;
        
        // Remove from cache
        let key_str = String::from_utf8_lossy(&key).to_string();
        self.cache.remove(&key_str);
        
        debug!("Deleted {} edge: {} -> {}", 
               if is_long_term { "long-term" } else { "short-term" },
               from.0, to.0);
        Ok(())
    }

    /// Compact the database to reclaim space
    #[instrument(skip(self))]
    pub async fn compact(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        info!("Starting database compaction");
        
        self.db.compact_range(None::<&[u8]>, None::<&[u8]>);
        
        info!("Database compaction completed");
        Ok(())
    }

    /// Get persistence statistics
    #[instrument(skip(self))]
    pub async fn get_stats(&self) -> PersistenceStats {
        let mut stats = self.stats.read().await.clone();
        
        // Update cache hit rate
        let hits = self.cache_hits.load(std::sync::atomic::Ordering::Relaxed);
        let misses = self.cache_misses.load(std::sync::atomic::Ordering::Relaxed);
        if hits + misses > 0 {
            stats.cache_hit_rate = hits as f64 / (hits + misses) as f64;
        }
        
        // Get database size
        if let Some(db_path) = self.config.db_path.to_str() {
            if let Ok(metadata) = std::fs::metadata(db_path) {
                stats.database_size_bytes = metadata.len();
            }
        }
        
        stats
    }

    /// Clear the in-memory cache
    #[instrument(skip(self))]
    pub async fn clear_cache(&self) {
        self.cache.clear();
        self.cache_hits.store(0, std::sync::atomic::Ordering::Relaxed);
        self.cache_misses.store(0, std::sync::atomic::Ordering::Relaxed);
        info!("Cleared persistence cache");
    }

    /// Force a database sync (flush to disk)
    #[instrument(skip(self))]
    pub async fn sync(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.db.flush()?;
        info!("Database synchronized to disk");
        Ok(())
    }

    /// Backup the database to a specified path
    #[instrument(skip(self))]
    pub async fn backup<P: AsRef<Path> + std::fmt::Debug>(&self, backup_path: P) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let backup_path = backup_path.as_ref();
        
        // Create backup directory
        if let Some(parent) = backup_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        // Perform backup
        let backup_options = rocksdb::backup::BackupEngineOptions::new(backup_path)?;
        let mut backup_engine = rocksdb::backup::BackupEngine::open(
            &backup_options,
            &rocksdb::Env::new()?
        )?;
        
        backup_engine.create_new_backup(&self.db)?;
        
        info!("Database backed up to {:?}", backup_path);
        Ok(())
    }

    /// Restore the database from a backup
    #[instrument(skip(self))]
    pub async fn restore<P: AsRef<Path> + std::fmt::Debug>(&self, backup_path: P) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let backup_path = backup_path.as_ref();
        
        let backup_options = rocksdb::backup::BackupEngineOptions::new(backup_path)?;
        let mut backup_engine = rocksdb::backup::BackupEngine::open(
            &backup_options,
            &rocksdb::Env::new()?
        )?;
        
        backup_engine.restore_from_latest_backup(
            &self.config.db_path,
            &self.config.db_path,
            &rocksdb::backup::RestoreOptions::default()
        )?;
        
        info!("Database restored from {:?}", backup_path);
        Ok(())
    }
}

/// Auto-save manager for periodic persistence
pub struct AutoSaveManager {
    #[allow(dead_code)]
    store: Arc<PersistentMemoryStore>,
    config: PersistenceConfig,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl AutoSaveManager {
    pub fn new(store: Arc<PersistentMemoryStore>, config: PersistenceConfig) -> Self {
        Self {
            store,
            config,
            shutdown_tx: None,
        }
    }

    /// Start auto-save background task
    #[instrument(skip(self, save_fn))]
    pub async fn start<F, Fut>(&mut self, save_fn: F) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<(), Box<dyn std::error::Error + Send + Sync>>> + Send,
    {
        if self.config.auto_save_interval_seconds == 0 {
            info!("Auto-save disabled (interval = 0)");
            return Ok(());
        }

        let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
        self.shutdown_tx = Some(shutdown_tx);

        let interval_duration = std::time::Duration::from_secs(self.config.auto_save_interval_seconds);
        let save_fn = Arc::new(save_fn);

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(interval_duration);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            info!("Auto-save started with interval: {:?}", interval_duration);

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        debug!("Auto-save triggered");
                        if let Err(e) = save_fn().await {
                            warn!("Auto-save failed: {}", e);
                        } else {
                            debug!("Auto-save completed successfully");
                        }
                    }
                    _ = &mut shutdown_rx => {
                        info!("Auto-save shutdown requested");
                        break;
                    }
                }
            }

            info!("Auto-save task terminated");
        });

        Ok(())
    }

    /// Stop auto-save background task
    #[instrument(skip(self))]
    pub async fn stop(&mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
            info!("Auto-save stop signal sent");
        }
    }
}