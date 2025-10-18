use crate::memory_graph::MemoryGraph;
use crate::types::ConceptId;
use chrono::{Duration, Utc};
use std::collections::{HashMap, HashSet};
use tracing::{debug, info};

/// Forgetting statistics
#[derive(Debug, Clone)]
pub struct ForgettingStats {
    pub concepts_forgotten: usize,
    pub connections_pruned: usize,
    pub weak_connections_decayed: usize,
    pub isolated_concepts_removed: usize,
}

/// Forgetting configuration
#[derive(Debug, Clone)]
pub struct ForgettingConfig {
    pub concept_isolation_threshold: usize, // Min connections to keep a concept
    pub unused_concept_days: i64,           // Days before unused concepts are forgotten
    pub weak_connection_threshold: f64,     // Threshold below which connections are pruned
    pub aggressive_forgetting: bool,        // More aggressive pruning
}

impl Default for ForgettingConfig {
    fn default() -> Self {
        Self {
            concept_isolation_threshold: 1,
            unused_concept_days: 30,
            weak_connection_threshold: 0.05,
            aggressive_forgetting: false,
        }
    }
}

impl MemoryGraph {
    /// Comprehensive forgetting cycle that mimics natural memory loss
    pub fn forget(&self, config: ForgettingConfig) -> ForgettingStats {
        info!("Starting forgetting cycle");

        let mut stats = ForgettingStats {
            concepts_forgotten: 0,
            connections_pruned: 0,
            weak_connections_decayed: 0,
            isolated_concepts_removed: 0,
        };

        // Phase 1: Prune weak connections
        stats.connections_pruned += self.prune_weak_connections(config.weak_connection_threshold);

        // Phase 2: Apply forgetting curves (Ebbinghaus-style decay)
        stats.weak_connections_decayed += self.apply_forgetting_curves();

        // Phase 3: Remove isolated concepts
        stats.isolated_concepts_removed += self.remove_isolated_concepts(config.concept_isolation_threshold);

        // Phase 4: Remove unused concepts
        stats.concepts_forgotten += self.remove_unused_concepts(config.unused_concept_days);

        // Phase 5: Aggressive forgetting if requested
        if config.aggressive_forgetting {
            stats.connections_pruned += self.aggressive_connection_pruning();
            stats.concepts_forgotten += self.aggressive_concept_removal();
        }

        info!(
            "Forgetting cycle completed: {} concepts forgotten, {} connections pruned",
            stats.concepts_forgotten,
            stats.connections_pruned
        );

        stats
    }

    /// Prune connections below a certain strength threshold
    fn prune_weak_connections(&self, threshold: f64) -> usize {
        let mut pruned = 0;

        // Prune weak short-term connections
        let keys_to_remove: Vec<_> = self.short_term_edges
            .iter()
            .filter_map(|edge_ref| {
                if edge_ref.value().weight.value() < threshold {
                    Some(edge_ref.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_remove {
            self.short_term_edges.remove(&key);
            pruned += 1;
        }

        // Prune weak long-term connections (more conservative threshold)
        let long_term_threshold = threshold * 0.5;
        let keys_to_remove: Vec<_> = self.long_term_edges
            .iter()
            .filter_map(|edge_ref| {
                if edge_ref.value().weight.value() < long_term_threshold {
                    Some(edge_ref.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_remove {
            self.long_term_edges.remove(&key);
            pruned += 1;
        }

        debug!("Pruned {} weak connections", pruned);
        pruned
    }

    /// Apply Ebbinghaus forgetting curve - exponential decay over time
    fn apply_forgetting_curves(&self) -> usize {
        let mut decayed = 0;
        let now = Utc::now();

        // Decay short-term connections based on time since last access
        for mut edge in self.short_term_edges.iter_mut() {
            let time_since_access = now - edge.last_accessed;
            let days_since_access = time_since_access.num_seconds() as f64 / 86400.0;

            // Ebbinghaus curve: R = e^(-t/S) where t is time and S is strength
            let retention_rate = (-days_since_access / (edge.weight.value() * 30.0)).exp();
            let decay_amount = 1.0 - retention_rate;

            if decay_amount > 0.0 {
                edge.decay(decay_amount);
                decayed += 1;
            }
        }

        // More gradual decay for long-term connections
        for mut edge in self.long_term_edges.iter_mut() {
            let time_since_access = now - edge.last_accessed;
            let days_since_access = time_since_access.num_seconds() as f64 / 86400.0;

            // Slower forgetting curve for consolidated memories
            let retention_rate = (-days_since_access / (edge.weight.value() * 180.0)).exp();
            let decay_amount = (1.0 - retention_rate) * 0.1; // Much slower decay

            if decay_amount > 0.0 {
                edge.decay(decay_amount);
                decayed += 1;
            }
        }

        debug!("Applied forgetting curves to {} connections", decayed);
        decayed
    }

    /// Remove concepts that have no or very few connections (isolated nodes)
    fn remove_isolated_concepts(&self, min_connections: usize) -> usize {
        let mut connection_counts: HashMap<ConceptId, usize> = HashMap::new();

        // Count connections for each concept
        for edge_ref in self.short_term_edges.iter() {
            let (from, to) = edge_ref.key();
            *connection_counts.entry(from.clone()).or_insert(0) += 1;
            *connection_counts.entry(to.clone()).or_insert(0) += 1;
        }

        for edge_ref in self.long_term_edges.iter() {
            let (from, to) = edge_ref.key();
            *connection_counts.entry(from.clone()).or_insert(0) += 1;
            *connection_counts.entry(to.clone()).or_insert(0) += 1;
        }

        // Find isolated concepts
        let isolated_concepts: Vec<_> = self.concepts
            .iter()
            .filter_map(|concept_ref| {
                let concept_id = concept_ref.key();
                let connection_count = connection_counts.get(concept_id).copied().unwrap_or(0);
                
                if connection_count < min_connections {
                    Some(concept_id.clone())
                } else {
                    None
                }
            })
            .collect();

        let removed_count = isolated_concepts.len();

        // Remove isolated concepts
        for concept_id in isolated_concepts {
            self.concepts.remove(&concept_id);
            self.working_memory.remove(&concept_id);
        }

        debug!("Removed {} isolated concepts", removed_count);
        removed_count
    }

    /// Remove concepts that haven't been accessed for a long time
    fn remove_unused_concepts(&self, days_threshold: i64) -> usize {
        let cutoff_time = Utc::now() - Duration::days(days_threshold);
        let mut removed = 0;

        let concepts_to_remove: Vec<_> = self.concepts
            .iter()
            .filter_map(|concept_ref| {
                let concept = concept_ref.value();
                if concept.last_accessed < cutoff_time && concept.access_count < 3 {
                    Some(concept.id.clone())
                } else {
                    None
                }
            })
            .collect();

        for concept_id in concepts_to_remove {
            // Remove the concept
            self.concepts.remove(&concept_id);
            self.working_memory.remove(&concept_id);
            
            // Remove all connections involving this concept
            self.remove_concept_connections(&concept_id);
            
            removed += 1;
        }

        debug!("Removed {} unused concepts", removed);
        removed
    }

    /// Remove all connections involving a specific concept
    fn remove_concept_connections(&self, concept_id: &ConceptId) {
        // Remove short-term connections
        let keys_to_remove: Vec<_> = self.short_term_edges
            .iter()
            .filter_map(|edge_ref| {
                let (from, to) = edge_ref.key();
                if from == concept_id || to == concept_id {
                    Some(edge_ref.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_remove {
            self.short_term_edges.remove(&key);
        }

        // Remove long-term connections
        let keys_to_remove: Vec<_> = self.long_term_edges
            .iter()
            .filter_map(|edge_ref| {
                let (from, to) = edge_ref.key();
                if from == concept_id || to == concept_id {
                    Some(edge_ref.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_remove {
            self.long_term_edges.remove(&key);
        }
    }

    /// Aggressive connection pruning for memory cleanup
    fn aggressive_connection_pruning(&self) -> usize {
        let mut pruned = 0;
        let now = Utc::now();
        let week_ago = now - Duration::days(7);

        // Remove connections that haven't been accessed in a week and are weak
        let keys_to_remove: Vec<_> = self.short_term_edges
            .iter()
            .filter_map(|edge_ref| {
                let edge = edge_ref.value();
                if edge.last_accessed < week_ago && edge.weight.value() < 0.3 {
                    Some(edge_ref.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_remove {
            self.short_term_edges.remove(&key);
            pruned += 1;
        }

        debug!("Aggressively pruned {} connections", pruned);
        pruned
    }

    /// Aggressive concept removal for memory cleanup
    fn aggressive_concept_removal(&self) -> usize {
        let mut removed = 0;
        let now = Utc::now();
        let two_weeks_ago = now - Duration::days(14);

        let concepts_to_remove: Vec<_> = self.concepts
            .iter()
            .filter_map(|concept_ref| {
                let concept = concept_ref.value();
                // Remove concepts that are old, rarely accessed, and have short content
                if concept.last_accessed < two_weeks_ago 
                    && concept.access_count < 5 
                    && concept.content.len() < 50 {
                    Some(concept.id.clone())
                } else {
                    None
                }
            })
            .collect();

        for concept_id in concepts_to_remove {
            self.concepts.remove(&concept_id);
            self.working_memory.remove(&concept_id);
            self.remove_concept_connections(&concept_id);
            removed += 1;
        }

        debug!("Aggressively removed {} concepts", removed);
        removed
    }

    /// Targeted forgetting - forget specific concepts and their associations
    pub fn forget_concepts(&self, concept_ids: &[ConceptId]) -> usize {
        let mut forgotten = 0;

        for concept_id in concept_ids {
            if self.concepts.remove(concept_id).is_some() {
                self.working_memory.remove(concept_id);
                self.remove_concept_connections(concept_id);
                forgotten += 1;
            }
        }

        debug!("Targeted forgetting: {} concepts removed", forgotten);
        forgotten
    }

    /// Interference-based forgetting - new learning can cause forgetting of similar old memories
    pub fn interference_forgetting(&self, new_concept_id: &ConceptId, similarity_threshold: f64) -> usize {
        let mut forgotten = 0;

        if let Some(new_concept) = self.get_concept(new_concept_id) {
            let similar_concepts: Vec<_> = self.concepts
                .iter()
                .filter_map(|concept_ref| {
                    let concept = concept_ref.value();
                    if concept.id != *new_concept_id {
                        let similarity = self.calculate_concept_similarity(&new_concept, concept);
                        if similarity > similarity_threshold {
                            Some(concept.id.clone())
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .collect();

            // Weaken similar concepts (proactive interference)
            for concept_id in &similar_concepts {
                // Weaken connections involving similar concepts
                for mut edge in self.short_term_edges.iter_mut() {
                    let (from, to) = edge.key();
                    if from == concept_id || to == concept_id {
                        edge.decay(0.2); // 20% decay due to interference
                    }
                }

                // Reduce access count to make them more likely to be forgotten
                if let Some(mut concept) = self.concepts.get_mut(concept_id) {
                    concept.access_count = concept.access_count.saturating_sub(1);
                }
            }

            forgotten = similar_concepts.len();
        }

        debug!("Interference forgetting affected {} similar concepts", forgotten);
        forgotten
    }

    /// Calculate similarity between two concepts (simple content-based)
    fn calculate_concept_similarity(&self, concept_a: &crate::types::Concept, concept_b: &crate::types::Concept) -> f64 {
        let content_a_lower = concept_a.content.to_lowercase();
        let content_b_lower = concept_b.content.to_lowercase();
        let words_a: HashSet<_> = content_a_lower.split_whitespace().collect();
        let words_b: HashSet<_> = content_b_lower.split_whitespace().collect();

        if words_a.is_empty() || words_b.is_empty() {
            return 0.0;
        }

        let intersection = words_a.intersection(&words_b).count() as f64;
        let union = words_a.union(&words_b).count() as f64;

        if union == 0.0 {
            0.0
        } else {
            intersection / union
        }
    }

    /// Get concepts that are candidates for forgetting
    pub fn get_forgetting_candidates(&self, config: &ForgettingConfig) -> Vec<ConceptId> {
        let mut candidates = Vec::new();
        let cutoff_time = Utc::now() - Duration::days(config.unused_concept_days);

        for concept_ref in self.concepts.iter() {
            let concept = concept_ref.value();
            
            // Check if concept meets forgetting criteria
            if concept.last_accessed < cutoff_time 
                && concept.access_count < 3 {
                candidates.push(concept.id.clone());
            }
        }

        candidates
    }
}