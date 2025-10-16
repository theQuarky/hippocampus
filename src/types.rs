use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

/// Represents a concept or data node in the memory graph
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ConceptId(pub Uuid);

impl ConceptId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn from_string(s: &str) -> Self {
        Self(Uuid::new_v5(&Uuid::NAMESPACE_OID, s.as_bytes()))
    }
}

impl Default for ConceptId {
    fn default() -> Self {
        Self::new()
    }
}

/// A concept node containing data and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Concept {
    pub id: ConceptId,
    pub content: String,
    pub metadata: HashMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
    pub access_count: u64,
}

impl Concept {
    pub fn new(content: String) -> Self {
        let now = Utc::now();
        Self {
            id: ConceptId::new(),
            content,
            metadata: HashMap::new(),
            created_at: now,
            last_accessed: now,
            access_count: 0,
        }
    }

    pub fn with_id(id: ConceptId, content: String) -> Self {
        let now = Utc::now();
        Self {
            id,
            content,
            metadata: HashMap::new(),
            created_at: now,
            last_accessed: now,
            access_count: 0,
        }
    }

    pub fn access(&mut self) {
        self.last_accessed = Utc::now();
        self.access_count += 1;
    }
}

/// Represents the strength of a synaptic connection
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialOrd, PartialEq)]
pub struct SynapticWeight(pub f64);

impl SynapticWeight {
    pub const MIN: f64 = 0.0;
    pub const MAX: f64 = 1.0;
    pub const INITIAL: f64 = 0.1;
    pub const THRESHOLD: f64 = 0.01;

    pub fn new(weight: f64) -> Self {
        Self(weight.clamp(Self::MIN, Self::MAX))
    }

    pub fn initial() -> Self {
        Self(Self::INITIAL)
    }

    pub fn strengthen(&mut self, learning_rate: f64) {
        // LTP: Asymptotic strengthening - approaches 1.0 but never reaches it
        self.0 += learning_rate * (Self::MAX - self.0);
        self.0 = self.0.clamp(Self::MIN, Self::MAX);
    }

    pub fn weaken(&mut self, decay_rate: f64) {
        // LTD: Exponential decay
        self.0 *= 1.0 - decay_rate;
        if self.0 < Self::THRESHOLD {
            self.0 = 0.0;
        }
    }

    pub fn is_active(&self) -> bool {
        self.0 > Self::THRESHOLD
    }

    pub fn value(&self) -> f64 {
        self.0
    }
}

impl Default for SynapticWeight {
    fn default() -> Self {
        Self::initial()
    }
}

/// An edge representing a synaptic connection between concepts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynapticEdge {
    pub from: ConceptId,
    pub to: ConceptId,
    pub weight: SynapticWeight,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
    pub activation_count: u64,
}

impl SynapticEdge {
    pub fn new(from: ConceptId, to: ConceptId) -> Self {
        let now = Utc::now();
        Self {
            from,
            to,
            weight: SynapticWeight::initial(),
            created_at: now,
            last_accessed: now,
            activation_count: 0,
        }
    }

    pub fn activate(&mut self, learning_rate: f64) {
        self.weight.strengthen(learning_rate);
        self.last_accessed = Utc::now();
        self.activation_count += 1;
    }

    pub fn decay(&mut self, decay_rate: f64) {
        self.weight.weaken(decay_rate);
    }

    pub fn is_active(&self) -> bool {
        self.weight.is_active()
    }
}

/// Memory zones mimicking different brain regions
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemoryZone {
    /// Hippocampus - temporary storage and consolidation
    ShortTerm,
    /// Cortex - long-term storage
    LongTerm,
    /// Working memory - active processing
    Working,
}

/// Configuration for the neuromorphic memory system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    pub learning_rate: f64,
    pub decay_rate: f64,
    pub consolidation_threshold: f64,
    pub max_short_term_connections: usize,
    pub consolidation_interval_hours: u64,
    pub max_recall_results: usize,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            learning_rate: 0.1,        // 10% strengthening per activation
            decay_rate: 0.01,          // 1% decay per cycle
            consolidation_threshold: 0.5, // 50% strength needed for long-term storage
            max_short_term_connections: 10000,
            consolidation_interval_hours: 24, // Daily consolidation like sleep
            max_recall_results: 20,
        }
    }
}