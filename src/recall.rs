use crate::memory_graph::MemoryGraph;
use crate::types::{Concept, ConceptId, SynapticWeight};
use std::collections::{HashMap, HashSet, VecDeque};
use tracing::{debug, trace};

/// A recall result with associated concepts and their relevance scores
#[derive(Debug, Clone)]
pub struct RecallResult {
    pub concept: Concept,
    pub relevance_score: f64,
    pub association_path: Vec<ConceptId>,
    pub connection_strength: f64,
}

/// Recall query configuration
#[derive(Debug, Clone)]
pub struct RecallQuery {
    pub max_results: Option<usize>,
    pub min_relevance: f64,
    pub max_path_length: usize,
    pub include_semantic_similarity: bool,
    pub boost_recent_memories: bool,
}

impl Default for RecallQuery {
    fn default() -> Self {
        Self {
            max_results: Some(10),
            min_relevance: 0.1,
            max_path_length: 3,
            include_semantic_similarity: false,
            boost_recent_memories: true,
        }
    }
}

impl MemoryGraph {
    /// Recall concepts associated with a given concept
    /// This mimics how the brain retrieves related memories through associative pathways
    pub fn recall(&self, source_concept_id: &ConceptId, query: RecallQuery) -> Vec<RecallResult> {
        debug!("Starting recall for concept: {:?}", source_concept_id);

        // Mark the source concept as accessed
        let _ = self.access_concept(source_concept_id);

        let mut results = Vec::new();
        let mut visited = HashSet::new();
        let mut relevance_scores: HashMap<ConceptId, (f64, Vec<ConceptId>, f64)> = HashMap::new();

        // BFS through the associative network
        let mut queue = VecDeque::new();
        queue.push_back((source_concept_id.clone(), 1.0, vec![source_concept_id.clone()], 0));
        visited.insert(source_concept_id.clone());

        while let Some((current_id, current_relevance, path, depth)) = queue.pop_front() {
            if depth >= query.max_path_length {
                continue;
            }

            // Explore connections from current concept
            self.explore_connections(
                &current_id,
                current_relevance,
                &path,
                depth,
                &mut queue,
                &mut visited,
                &mut relevance_scores,
                &query,
            );
        }

        // Convert relevance scores to results
        for (concept_id, (score, path, strength)) in relevance_scores {
            if score >= query.min_relevance && concept_id != *source_concept_id {
                if let Some(concept) = self.get_concept(&concept_id) {
                    let mut boosted_score = score;

                    // Boost recent memories if requested
                    if query.boost_recent_memories {
                        boosted_score *= self.calculate_recency_boost(&concept);
                    }

                    results.push(RecallResult {
                        concept,
                        relevance_score: boosted_score,
                        association_path: path,
                        connection_strength: strength,
                    });
                }
            }
        }

        // Sort by relevance score
        results.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());

        // Limit results
        if let Some(max_results) = query.max_results {
            results.truncate(max_results);
        }

        debug!("Recall completed with {} results", results.len());
        results
    }

    /// Explore connections from a concept during recall
    fn explore_connections(
        &self,
        concept_id: &ConceptId,
        current_relevance: f64,
        path: &[ConceptId],
        depth: usize,
        queue: &mut VecDeque<(ConceptId, f64, Vec<ConceptId>, usize)>,
        visited: &mut HashSet<ConceptId>,
        relevance_scores: &mut HashMap<ConceptId, (f64, Vec<ConceptId>, f64)>,
        query: &RecallQuery,
    ) {
        // Check short-term connections
        for edge_ref in self.short_term_edges.iter() {
            let edge = edge_ref.value();
            let (from, to) = edge_ref.key();

            if from == concept_id {
                self.process_connection(
                    to,
                    edge.weight,
                    current_relevance,
                    path,
                    depth,
                    queue,
                    visited,
                    relevance_scores,
                    query,
                );
            } else if to == concept_id {
                self.process_connection(
                    from,
                    edge.weight,
                    current_relevance,
                    path,
                    depth,
                    queue,
                    visited,
                    relevance_scores,
                    query,
                );
            }
        }

        // Check long-term connections
        for edge_ref in self.long_term_edges.iter() {
            let edge = edge_ref.value();
            let (from, to) = edge_ref.key();

            if from == concept_id {
                self.process_connection(
                    to,
                    edge.weight,
                    current_relevance,
                    path,
                    depth,
                    queue,
                    visited,
                    relevance_scores,
                    query,
                );
            } else if to == concept_id {
                self.process_connection(
                    from,
                    edge.weight,
                    current_relevance,
                    path,
                    depth,
                    queue,
                    visited,
                    relevance_scores,
                    query,
                );
            }
        }
    }

    /// Process a single connection during recall
    fn process_connection(
        &self,
        target_id: &ConceptId,
        weight: SynapticWeight,
        current_relevance: f64,
        path: &[ConceptId],
        depth: usize,
        queue: &mut VecDeque<(ConceptId, f64, Vec<ConceptId>, usize)>,
        visited: &mut HashSet<ConceptId>,
        relevance_scores: &mut HashMap<ConceptId, (f64, Vec<ConceptId>, f64)>,
        query: &RecallQuery,
    ) {
        if !weight.is_active() {
            return;
        }

        // Calculate relevance degradation through the path
        let path_degradation = 0.8_f64.powi(depth as i32);
        let new_relevance = current_relevance * weight.value() * path_degradation;

        // Update relevance score for this concept
        let entry = relevance_scores.entry(target_id.clone()).or_insert((0.0, vec![], 0.0));
        if new_relevance > entry.0 {
            let mut new_path = path.to_vec();
            new_path.push(target_id.clone());
            *entry = (new_relevance, new_path, weight.value());
        }

        // Add to queue for further exploration if not visited and relevance is sufficient
        if !visited.contains(target_id) && new_relevance >= query.min_relevance {
            visited.insert(target_id.clone());
            let mut new_path = path.to_vec();
            new_path.push(target_id.clone());
            queue.push_back((target_id.clone(), new_relevance, new_path, depth + 1));
        }
    }

    /// Calculate recency boost based on when the concept was last accessed
    fn calculate_recency_boost(&self, concept: &Concept) -> f64 {
        use chrono::{Duration, Utc};

        let now = Utc::now();
        let time_since_access = now - concept.last_accessed;

        if time_since_access < Duration::hours(1) {
            1.5 // 50% boost for very recent
        } else if time_since_access < Duration::days(1) {
            1.2 // 20% boost for recent
        } else if time_since_access < Duration::days(7) {
            1.0 // No boost for week-old
        } else {
            0.8 // 20% penalty for old memories
        }
    }

    /// Content-based recall using simple keyword matching
    /// This models semantic similarity recall
    pub fn recall_by_content(&self, query_content: &str, recall_query: RecallQuery) -> Vec<RecallResult> {
        debug!("Starting content-based recall for: '{}'", query_content);

        let query_lower = query_content.to_lowercase();
        let query_words: HashSet<_> = query_lower
            .split_whitespace()
            .filter(|word| word.len() > 2) // Filter out short words
            .collect();

        let mut results = Vec::new();

        // Score all concepts based on content similarity
        for concept_ref in self.concepts.iter() {
            let concept = concept_ref.value();
            let similarity_score = self.calculate_content_similarity(&query_words, &concept.content);

            if similarity_score >= recall_query.min_relevance {
                let mut boosted_score = similarity_score;

                if recall_query.boost_recent_memories {
                    boosted_score *= self.calculate_recency_boost(concept);
                }

                results.push(RecallResult {
                    concept: concept.clone(),
                    relevance_score: boosted_score,
                    association_path: vec![concept.id.clone()],
                    connection_strength: similarity_score,
                });
            }
        }

        // Sort by relevance
        results.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());

        // Limit results
        if let Some(max_results) = recall_query.max_results {
            results.truncate(max_results);
        }

        debug!("Content-based recall completed with {} results", results.len());
        results
    }

    /// Calculate simple content similarity using word overlap
    fn calculate_content_similarity(&self, query_words: &HashSet<&str>, content: &str) -> f64 {
        let content_lower = content.to_lowercase();
        let content_words: HashSet<_> = content_lower
            .split_whitespace()
            .filter(|word| word.len() > 2)
            .collect();

        if content_words.is_empty() || query_words.is_empty() {
            return 0.0;
        }

        // Jaccard similarity
        let intersection_size = query_words.intersection(&content_words).count() as f64;
        let union_size = query_words.union(&content_words).count() as f64;

        if union_size == 0.0 {
            0.0
        } else {
            intersection_size / union_size
        }
    }

    /// Spreading activation recall - models how activation spreads through neural networks
    pub fn spreading_activation_recall(
        &self,
        seed_concepts: &[ConceptId],
        activation_threshold: f64,
        max_iterations: usize,
    ) -> Vec<RecallResult> {
        debug!("Starting spreading activation recall with {} seeds", seed_concepts.len());

        let mut activation_levels: HashMap<ConceptId, f64> = HashMap::new();
        
        // Initialize seed concepts with full activation
        for concept_id in seed_concepts {
            activation_levels.insert(concept_id.clone(), 1.0);
        }

        // Iteratively spread activation
        for iteration in 0..max_iterations {
            let mut new_activations = activation_levels.clone();
            let mut any_change = false;

            for (concept_id, activation) in &activation_levels {
                if *activation < activation_threshold {
                    continue;
                }

                // Spread activation to connected concepts
                self.spread_activation_to_neighbors(
                    concept_id,
                    *activation,
                    &mut new_activations,
                    &mut any_change,
                );
            }

            activation_levels = new_activations;

            if !any_change {
                debug!("Spreading activation converged at iteration {}", iteration);
                break;
            }
        }

        // Convert activation levels to results
        let mut results = Vec::new();
        for (concept_id, activation) in activation_levels {
            if activation >= activation_threshold && !seed_concepts.contains(&concept_id) {
                if let Some(concept) = self.get_concept(&concept_id) {
                    results.push(RecallResult {
                        concept,
                        relevance_score: activation,
                        association_path: vec![concept_id],
                        connection_strength: activation,
                    });
                }
            }
        }

        results.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());
        debug!("Spreading activation recall completed with {} results", results.len());
        results
    }

    /// Spread activation to neighboring concepts
    fn spread_activation_to_neighbors(
        &self,
        concept_id: &ConceptId,
        activation: f64,
        activation_levels: &mut HashMap<ConceptId, f64>,
        any_change: &mut bool,
    ) {
        let decay_factor = 0.7; // Activation decays as it spreads

        // Spread through short-term connections
        for edge_ref in self.short_term_edges.iter() {
            let edge = edge_ref.value();
            let (from, to) = edge_ref.key();

            if from == concept_id || to == concept_id {
                let target = if from == concept_id { to } else { from };
                let spread_activation = activation * edge.weight.value() * decay_factor;
                
                let current_activation = activation_levels.get(target).copied().unwrap_or(0.0);
                let new_activation = current_activation.max(spread_activation);
                
                if new_activation > current_activation {
                    activation_levels.insert(target.clone(), new_activation);
                    *any_change = true;
                }
            }
        }

        // Spread through long-term connections
        for edge_ref in self.long_term_edges.iter() {
            let edge = edge_ref.value();
            let (from, to) = edge_ref.key();

            if from == concept_id || to == concept_id {
                let target = if from == concept_id { to } else { from };
                let spread_activation = activation * edge.weight.value() * decay_factor;
                
                let current_activation = activation_levels.get(target).copied().unwrap_or(0.0);
                let new_activation = current_activation.max(spread_activation);
                
                if new_activation > current_activation {
                    activation_levels.insert(target.clone(), new_activation);
                    *any_change = true;
                }
            }
        }
    }
}