use crate::memory_graph::MemoryGraph;
use crate::types::{ConceptId, SynapticEdge};
use chrono::{Duration, Utc};
use std::collections::{HashMap, HashSet};
use tracing::{debug, info, warn};

/// Consolidation statistics
#[derive(Debug, Clone)]
pub struct ConsolidationStats {
    pub promoted_to_long_term: usize,
    pub pruned_weak_connections: usize,
    pub reactivated_connections: usize,
    pub total_short_term_before: usize,
    pub total_long_term_after: usize,
}

impl MemoryGraph {
    /// Hippocampus-style memory consolidation
    /// Moves important short-term memories to long-term storage
    pub fn consolidate_memory(&self) -> ConsolidationStats {
        info!("Starting memory consolidation - hippocampus to cortex transfer");

        let initial_short_term_count = self.short_term_edges.len();
        let initial_long_term_count = self.long_term_edges.len();

        let mut promoted = 0;
        let mut pruned = 0;
        let mut reactivated = 0;

        // Phase 1: Identify connections ready for long-term storage
        let mut connections_to_promote = Vec::new();
        let mut connections_to_prune = Vec::new();

        for edge_ref in self.short_term_edges.iter() {
            let edge = edge_ref.value();
            
            if self.should_promote_to_long_term(edge) {
                connections_to_promote.push(edge_ref.key().clone());
            } else if !edge.is_active() {
                connections_to_prune.push(edge_ref.key().clone());
            }
        }

        // Phase 2: Promote strong connections to long-term memory
        for edge_key in connections_to_promote {
            if let Some((_, edge)) = self.short_term_edges.remove(&edge_key) {
                // Check if connection already exists in long-term memory
                if let Some(mut existing_edge) = self.long_term_edges.get_mut(&edge_key) {
                    // Merge the strengths - reactivate the long-term connection
                    let combined_strength = (existing_edge.weight.value() + edge.weight.value()) / 2.0;
                    existing_edge.weight = crate::types::SynapticWeight::new(combined_strength);
                    existing_edge.last_accessed = edge.last_accessed.max(existing_edge.last_accessed);
                    existing_edge.activation_count += edge.activation_count;
                    reactivated += 1;
                } else {
                    // Move to long-term memory
                    self.long_term_edges.insert(edge_key, edge);
                    promoted += 1;
                }
            }
        }

        // Phase 3: Prune weak connections
        for edge_key in connections_to_prune {
            self.short_term_edges.remove(&edge_key);
            pruned += 1;
        }

        // Phase 4: Apply interference - competing memories
        self.apply_memory_interference();

        // Phase 5: Update consolidation timestamp
        {
            let mut last_consolidation = self.last_consolidation.write().unwrap();
            *last_consolidation = Utc::now();
        }

        let stats = ConsolidationStats {
            promoted_to_long_term: promoted,
            pruned_weak_connections: pruned,
            reactivated_connections: reactivated,
            total_short_term_before: initial_short_term_count,
            total_long_term_after: self.long_term_edges.len(),
        };

        info!(
            "Memory consolidation completed: {} promoted, {} pruned, {} reactivated",
            promoted, pruned, reactivated
        );

        stats
    }

    /// Determine if a short-term connection should be promoted to long-term memory
    fn should_promote_to_long_term(&self, edge: &SynapticEdge) -> bool {
        // Multiple criteria for promotion:
        
        // 1. Weight threshold
        let weight_criteria = edge.weight.value() >= self.config.consolidation_threshold;
        
        // 2. Activation frequency
        let activation_criteria = edge.activation_count >= 3;
        
        // 3. Recent usage (accessed within last 7 days)
        let recency_criteria = {
            let week_ago = Utc::now() - Duration::days(7);
            edge.last_accessed > week_ago
        };
        
        // 4. Connection age (existed for at least 1 hour)
        let maturity_criteria = {
            let hour_ago = Utc::now() - Duration::hours(1);
            edge.created_at < hour_ago
        };

        // 5. Both concepts are frequently accessed
        let concept_importance = self.are_concepts_important(&edge.from, &edge.to);

        // Need at least 3 out of 5 criteria to promote
        let criteria_met = [
            weight_criteria,
            activation_criteria,
            recency_criteria,
            maturity_criteria,
            concept_importance,
        ].iter().filter(|&&x| x).count();

        criteria_met >= 3
    }

    /// Check if both concepts in a connection are frequently accessed
    fn are_concepts_important(&self, concept_a: &ConceptId, concept_b: &ConceptId) -> bool {
        let importance_threshold = 5; // Access count threshold

        let a_important = self.concepts.get(concept_a)
            .map(|c| c.access_count >= importance_threshold)
            .unwrap_or(false);

        let b_important = self.concepts.get(concept_b)
            .map(|c| c.access_count >= importance_threshold)
            .unwrap_or(false);

        a_important && b_important
    }

    /// Apply memory interference - competing memories can weaken each other
    fn apply_memory_interference(&self) {
        let mut concept_connection_counts: HashMap<ConceptId, usize> = HashMap::new();

        // Count connections per concept
        for edge_ref in self.short_term_edges.iter() {
            let edge = edge_ref.value();
            *concept_connection_counts.entry(edge.from.clone()).or_insert(0) += 1;
            *concept_connection_counts.entry(edge.to.clone()).or_insert(0) += 1;
        }

        // Find concepts with too many connections (interference threshold)
        let interference_threshold = 50;
        let overloaded_concepts: Vec<_> = concept_connection_counts
            .iter()
            .filter(|(_, &count)| count > interference_threshold)
            .map(|(concept_id, _)| concept_id.clone())
            .collect();

        if !overloaded_concepts.is_empty() {
            debug!("Applying interference to {} overloaded concepts", overloaded_concepts.len());

            // Weaken connections for overloaded concepts
            for mut edge in self.short_term_edges.iter_mut() {
                let (from, to) = edge.key();
                if overloaded_concepts.contains(from) || overloaded_concepts.contains(to) {
                    edge.decay(self.config.decay_rate * 2.0); // Double decay for interference
                }
            }
        }
    }

    /// Reconsolidation - when memories are recalled, they become labile again
    /// This models how recalled memories can be modified
    pub fn reconsolidate(&self, concept_ids: &[ConceptId]) {
        info!("Starting reconsolidation for {} concepts", concept_ids.len());

        let concept_set: HashSet<_> = concept_ids.iter().collect();
        let mut reconsolidated = 0;

        // Move relevant long-term connections back to short-term for modification
        let keys_to_move: Vec<_> = self.long_term_edges
            .iter()
            .filter_map(|edge_ref| {
                let (from, to) = edge_ref.key();
                if concept_set.contains(from) || concept_set.contains(to) {
                    Some(edge_ref.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_move {
            if let Some((_, mut edge)) = self.long_term_edges.remove(&key) {
                // Slightly weaken the connection during reconsolidation (memory lability)
                edge.weight = crate::types::SynapticWeight::new(edge.weight.value() * 0.9);
                edge.last_accessed = Utc::now();
                
                self.short_term_edges.insert(key, edge);
                reconsolidated += 1;
            }
        }

        if reconsolidated > 0 {
            debug!("Reconsolidated {} connections", reconsolidated);
        }
    }

    /// Forced consolidation - manually trigger consolidation regardless of timing
    pub fn force_consolidation(&self) -> ConsolidationStats {
        self.consolidate_memory()
    }

    /// Schema consolidation - gradually transfer semantic knowledge patterns
    /// This models how abstract knowledge becomes independent of specific episodes
    pub fn schema_consolidation(&self) {
        info!("Starting schema consolidation");

        // Find frequent patterns in connections
        let mut pattern_strength: HashMap<String, f64> = HashMap::new();
        
        // Analyze connection patterns
        for edge_ref in self.long_term_edges.iter() {
            let edge = edge_ref.value();
            
            // Extract content patterns (simplified - would be more sophisticated in practice)
            if let (Some(from_concept), Some(to_concept)) = 
                (self.concepts.get(&edge.from), self.concepts.get(&edge.to)) {
                
                let pattern = self.extract_pattern(&from_concept.content, &to_concept.content);
                if !pattern.is_empty() {
                    *pattern_strength.entry(pattern).or_insert(0.0) += edge.weight.value();
                }
            }
        }

        // Strengthen connections that follow strong patterns
        for mut edge in self.long_term_edges.iter_mut() {
            if let (Some(from_concept), Some(to_concept)) = 
                (self.concepts.get(&edge.from), self.concepts.get(&edge.to)) {
                
                let pattern = self.extract_pattern(&from_concept.content, &to_concept.content);
                if let Some(&strength) = pattern_strength.get(&pattern) {
                    if strength > 5.0 { // Strong pattern threshold
                        edge.weight.strengthen(self.config.learning_rate * 0.5);
                    }
                }
            }
        }

        debug!("Schema consolidation completed for {} patterns", pattern_strength.len());
    }

    /// Extract simple patterns from content (placeholder for more sophisticated analysis)
    fn extract_pattern(&self, content_a: &str, content_b: &str) -> String {
        // Very basic pattern extraction - in practice, this would use NLP/ML
        let content_a_lower = content_a.to_lowercase();
        let content_b_lower = content_b.to_lowercase();
        let words_a: HashSet<_> = content_a_lower.split_whitespace().collect();
        let words_b: HashSet<_> = content_b_lower.split_whitespace().collect();
        
        let common_words: Vec<_> = words_a.intersection(&words_b).collect();
        
        if common_words.len() >= 2 {
            let mut pattern = common_words.into_iter().cloned().collect::<Vec<_>>();
            pattern.sort();
            pattern.join("_")
        } else {
            String::new()
        }
    }
}