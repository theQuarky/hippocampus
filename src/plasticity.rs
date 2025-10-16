use crate::memory_graph::MemoryGraph;
use crate::types::{ConceptId, SynapticWeight};
use chrono::{Duration, Utc};
use std::collections::HashSet;
use tracing::{debug, info, trace, warn};

impl MemoryGraph {
    /// Apply Long-Term Depression (LTD) - decay unused connections
    pub fn apply_ltd_decay(&self) {
        let mut decayed_short_term = 0;
        let mut decayed_long_term = 0;
        let mut pruned_connections = 0;

        // Decay short-term connections
        let keys_to_remove: Vec<_> = self.short_term_edges
            .iter_mut()
            .filter_map(|mut edge| {
                edge.decay(self.config.decay_rate);
                
                if edge.is_active() {
                    decayed_short_term += 1;
                    None
                } else {
                    // Connection is too weak, mark for removal
                    pruned_connections += 1;
                    Some(edge.key().clone())
                }
            })
            .collect();

        // Remove pruned short-term connections
        for key in keys_to_remove {
            self.short_term_edges.remove(&key);
        }

        // Decay long-term connections (they decay slower)
        let long_term_decay_rate = self.config.decay_rate * 0.1; // 10x slower decay
        let keys_to_remove: Vec<_> = self.long_term_edges
            .iter_mut()
            .filter_map(|mut edge| {
                edge.decay(long_term_decay_rate);
                
                if edge.is_active() {
                    decayed_long_term += 1;
                    None
                } else {
                    // Even long-term connections can be forgotten if never used
                    pruned_connections += 1;
                    Some(edge.key().clone())
                }
            })
            .collect();

        // Remove pruned long-term connections
        for key in keys_to_remove {
            self.long_term_edges.remove(&key);
        }

        if decayed_short_term > 0 || decayed_long_term > 0 || pruned_connections > 0 {
            debug!(
                "LTD decay applied: {} short-term decayed, {} long-term decayed, {} connections pruned",
                decayed_short_term, decayed_long_term, pruned_connections
            );
        }
    }

    /// Apply Long-Term Potentiation (LTP) - strengthen frequently used connections
    pub fn apply_ltp_strengthening(&self) {
        let mut strengthened = 0;

        // Strengthen connections in working memory
        let working_concepts: HashSet<ConceptId> = self.working_memory
            .iter()
            .map(|entry| entry.key().clone())
            .collect();

        // Apply extra strengthening to connections between concepts in working memory
        for mut edge in self.short_term_edges.iter_mut() {
            let (from, to) = edge.key();
            if working_concepts.contains(from) && working_concepts.contains(to) {
                // Double strengthening for working memory connections
                edge.activate(self.config.learning_rate * 2.0);
                strengthened += 1;
            }
        }

        for mut edge in self.long_term_edges.iter_mut() {
            let (from, to) = edge.key();
            if working_concepts.contains(from) && working_concepts.contains(to) {
                edge.activate(self.config.learning_rate);
                strengthened += 1;
            }
        }

        if strengthened > 0 {
            trace!("LTP strengthening applied to {} connections", strengthened);
        }
    }

    /// Simulate sleep-like memory processing
    /// This combines decay, strengthening, and working memory cleanup
    pub fn sleep_cycle(&self) {
        info!("Starting sleep cycle - memory consolidation and cleanup");

        // Apply synaptic plasticity
        self.apply_ltd_decay();
        self.apply_ltp_strengthening();

        // Clear old working memory entries (older than 1 hour)
        let cutoff_time = Utc::now() - Duration::hours(1);
        let mut cleared_working_memory = 0;

        let keys_to_remove: Vec<_> = self.working_memory
            .iter()
            .filter_map(|entry| {
                if *entry.value() < cutoff_time {
                    Some(entry.key().clone())
                } else {
                    None
                }
            })
            .collect();

        for key in keys_to_remove {
            self.working_memory.remove(&key);
            cleared_working_memory += 1;
        }

        if cleared_working_memory > 0 {
            debug!("Cleared {} entries from working memory", cleared_working_memory);
        }

        info!("Sleep cycle completed");
    }

    /// Adaptive learning rate based on connection strength
    /// Weaker connections learn faster (more plasticity)
    /// Stronger connections learn slower (more stability)
    pub fn adaptive_learning_rate(&self, current_weight: SynapticWeight) -> f64 {
        let base_rate = self.config.learning_rate;
        let weight_factor = 1.0 - current_weight.value(); // Inverse relationship
        
        // Scale learning rate: weak connections learn faster
        base_rate * (0.5 + weight_factor)
    }

    /// Hebbian learning rule: "Neurons that fire together, wire together"
    /// Strengthen connections between co-activated concepts
    pub fn hebbian_strengthening(&self, concept_ids: &[ConceptId]) {
        if concept_ids.len() < 2 {
            return;
        }

        let mut strengthened_pairs = 0;

        // Create or strengthen connections between all pairs of co-activated concepts
        for i in 0..concept_ids.len() {
            for j in (i + 1)..concept_ids.len() {
                let concept_a = &concept_ids[i];
                let concept_b = &concept_ids[j];

                // Try to strengthen existing connections in both directions
                let edge_ab = (concept_a.clone(), concept_b.clone());
                let edge_ba = (concept_b.clone(), concept_a.clone());

                if let Some(mut edge) = self.short_term_edges.get_mut(&edge_ab) {
                    let adaptive_rate = self.adaptive_learning_rate(edge.weight);
                    edge.activate(adaptive_rate);
                    strengthened_pairs += 1;
                } else if let Some(mut edge) = self.long_term_edges.get_mut(&edge_ab) {
                    let adaptive_rate = self.adaptive_learning_rate(edge.weight);
                    edge.activate(adaptive_rate);
                    strengthened_pairs += 1;
                }

                if let Some(mut edge) = self.short_term_edges.get_mut(&edge_ba) {
                    let adaptive_rate = self.adaptive_learning_rate(edge.weight);
                    edge.activate(adaptive_rate);
                    strengthened_pairs += 1;
                } else if let Some(mut edge) = self.long_term_edges.get_mut(&edge_ba) {
                    let adaptive_rate = self.adaptive_learning_rate(edge.weight);
                    edge.activate(adaptive_rate);
                    strengthened_pairs += 1;
                }
            }
        }

        if strengthened_pairs > 0 {
            trace!("Hebbian strengthening applied to {} connection pairs", strengthened_pairs);
        }
    }

    /// Competitive learning: strengthen some connections while weakening others
    /// Models the brain's resource allocation and connection competition
    pub fn competitive_learning(&self, winner_concepts: &[ConceptId], loser_concepts: &[ConceptId]) {
        // Strengthen connections involving winner concepts
        for concept_id in winner_concepts {
            for mut edge in self.short_term_edges.iter_mut() {
                let (from, to) = edge.key();
                if from == concept_id || to == concept_id {
                    edge.activate(self.config.learning_rate * 1.5); // Boost winners
                }
            }
        }

        // Weaken connections involving loser concepts
        for concept_id in loser_concepts {
            for mut edge in self.short_term_edges.iter_mut() {
                let (from, to) = edge.key();
                if from == concept_id || to == concept_id {
                    edge.decay(self.config.decay_rate * 2.0); // Accelerate losers' decay
                }
            }
        }

        debug!(
            "Competitive learning: {} winners boosted, {} losers weakened",
            winner_concepts.len(),
            loser_concepts.len()
        );
    }
}