use crate::types::{Concept, ConceptId, MemoryConfig, SynapticEdge};
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, trace};

/// Core memory graph implementing neuromorphic memory principles
#[derive(Debug)]
pub struct MemoryGraph {
    /// All concepts stored in the system
    pub(crate) concepts: DashMap<ConceptId, Concept>,
    
    /// Short-term memory connections (hippocampus equivalent)
    pub(crate) short_term_edges: DashMap<(ConceptId, ConceptId), SynapticEdge>,
    
    /// Long-term memory connections (cortex equivalent)
    pub(crate) long_term_edges: DashMap<(ConceptId, ConceptId), SynapticEdge>,
    
    /// Working memory - currently active concepts
    pub(crate) working_memory: DashMap<ConceptId, DateTime<Utc>>,
    
    /// Configuration parameters
    pub(crate) config: MemoryConfig,
    
    /// Last consolidation timestamp
    pub(crate) last_consolidation: Arc<std::sync::RwLock<DateTime<Utc>>>,
}

impl MemoryGraph {
    pub fn new(config: MemoryConfig) -> Self {
        Self {
            concepts: DashMap::new(),
            short_term_edges: DashMap::new(),
            long_term_edges: DashMap::new(),
            working_memory: DashMap::new(),
            config,
            last_consolidation: Arc::new(std::sync::RwLock::new(Utc::now())),
        }
    }

    pub fn new_with_defaults() -> Self {
        Self::new(MemoryConfig::default())
    }

    /// Add a new concept to the memory system
    pub fn add_concept(&self, mut concept: Concept) -> ConceptId {
        concept.access();
        let id = concept.id.clone();
        
        // Add to working memory
        self.working_memory.insert(id.clone(), Utc::now());
        
        // Store the concept
        self.concepts.insert(id.clone(), concept);
        
        debug!("Added concept: {:?}", id);
        id
    }

    /// Create and add a concept from content
    pub fn learn(&self, content: String) -> ConceptId {
        let concept = Concept::new(content);
        self.add_concept(concept)
    }

    /// Create an association between two concepts (synaptic connection)
    pub fn associate(&self, from_id: ConceptId, to_id: ConceptId) -> Result<(), String> {
        // Ensure both concepts exist
        if !self.concepts.contains_key(&from_id) {
            return Err(format!("Source concept {:?} not found", from_id));
        }
        if !self.concepts.contains_key(&to_id) {
            return Err(format!("Target concept {:?} not found", to_id));
        }

        let edge_key = (from_id.clone(), to_id.clone());
        
        // Check if edge already exists in either memory zone
        if let Some(mut edge) = self.short_term_edges.get_mut(&edge_key) {
            // Strengthen existing short-term connection
            edge.activate(self.config.learning_rate);
            trace!("Strengthened short-term edge: {:?} -> {:?}", from_id, to_id);
        } else if let Some(mut edge) = self.long_term_edges.get_mut(&edge_key) {
            // Reactivate long-term connection
            edge.activate(self.config.learning_rate);
            trace!("Reactivated long-term edge: {:?} -> {:?}", from_id, to_id);
        } else {
            // Create new short-term connection
            let new_edge = SynapticEdge::new(from_id.clone(), to_id.clone());
            self.short_term_edges.insert(edge_key, new_edge);
            debug!("Created new association: {:?} -> {:?}", from_id, to_id);
        }

        // Add both concepts to working memory
        self.working_memory.insert(from_id, Utc::now());
        self.working_memory.insert(to_id, Utc::now());

        Ok(())
    }

    /// Learn a bidirectional association
    pub fn associate_bidirectional(&self, concept_a: ConceptId, concept_b: ConceptId) -> Result<(), String> {
        self.associate(concept_a.clone(), concept_b.clone())?;
        self.associate(concept_b, concept_a)?;
        Ok(())
    }

    /// Access a concept and strengthen related connections
    pub fn access_concept(&self, concept_id: &ConceptId) -> Result<(), String> {
        // Update concept access info
        if let Some(mut concept) = self.concepts.get_mut(concept_id) {
            concept.access();
        } else {
            return Err(format!("Concept {:?} not found", concept_id));
        }

        // Add to working memory
        self.working_memory.insert(concept_id.clone(), Utc::now());

        // Strengthen all connections involving this concept
        self.strengthen_concept_connections(concept_id);

        Ok(())
    }

    /// Strengthen all edges connected to a concept
    fn strengthen_concept_connections(&self, concept_id: &ConceptId) {
        // Strengthen short-term connections
        for mut edge in self.short_term_edges.iter_mut() {
            let (from, to) = edge.key();
            if from == concept_id || to == concept_id {
                edge.activate(self.config.learning_rate);
            }
        }

        // Strengthen long-term connections
        for mut edge in self.long_term_edges.iter_mut() {
            let (from, to) = edge.key();
            if from == concept_id || to == concept_id {
                edge.activate(self.config.learning_rate);
            }
        }
    }

    /// Get concept by ID
    pub fn get_concept(&self, concept_id: &ConceptId) -> Option<Concept> {
        self.concepts.get(concept_id).map(|c| c.clone())
    }

    /// Get all concept IDs
    pub fn get_all_concept_ids(&self) -> Vec<ConceptId> {
        self.concepts.iter().map(|entry| entry.key().clone()).collect()
    }

    /// Get memory statistics
    pub fn get_stats(&self) -> MemoryStats {
        MemoryStats {
            total_concepts: self.concepts.len(),
            short_term_connections: self.short_term_edges.len(),
            long_term_connections: self.long_term_edges.len(),
            working_memory_size: self.working_memory.len(),
            last_consolidation: *self.last_consolidation.read().unwrap(),
        }
    }

    /// Check if automatic consolidation should be triggered
    pub fn should_consolidate(&self) -> bool {
        let last_consolidation = *self.last_consolidation.read().unwrap();
        let now = Utc::now();
        let duration_since_consolidation = now - last_consolidation;
        
        duration_since_consolidation > Duration::hours(self.config.consolidation_interval_hours as i64)
    }
}

/// Memory system statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total_concepts: usize,
    pub short_term_connections: usize,
    pub long_term_connections: usize,
    pub working_memory_size: usize,
    pub last_consolidation: DateTime<Utc>,
}

impl std::fmt::Display for MemoryStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Memory Stats:\n  Concepts: {}\n  Short-term connections: {}\n  Long-term connections: {}\n  Working memory: {}\n  Last consolidation: {}",
            self.total_concepts,
            self.short_term_connections,
            self.long_term_connections,
            self.working_memory_size,
            self.last_consolidation.format("%Y-%m-%d %H:%M:%S UTC")
        )
    }
}