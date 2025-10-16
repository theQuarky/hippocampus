# 🧪 LeafMind Examples Collection

This document contains practical examples for common LeafMind use cases. Each example is self-contained and demonstrates specific features.

## 📋 Table of Contents

- [Basic Memory Operations](#basic-memory-operations)
- [Knowledge Graph Building](#knowledge-graph-building)
- [AI Agent Memory](#ai-agent-memory)  
- [Learning from Text](#learning-from-text)
- [Chatbot Conversation Memory](#chatbot-conversation-memory)
- [Recommendation System](#recommendation-system)
- [Research Applications](#research-applications)
- [Performance Optimization](#performance-optimization)

## 🎯 Basic Memory Operations

### Simple Concept Learning and Recall

```rust
use leafmind::{MemoryGraph, RecallQuery};

fn basic_example() {
    let memory = MemoryGraph::new_with_defaults();
    
    // Learn individual facts
    let paris_id = memory.learn("Paris is the capital of France".to_string());
    let france_id = memory.learn("France is a country in Europe".to_string());
    let europe_id = memory.learn("Europe is a continent".to_string());
    
    // Create logical associations
    memory.associate(paris_id.clone(), france_id.clone()).unwrap();
    memory.associate(france_id.clone(), europe_id.clone()).unwrap();
    
    // Recall chain: Paris -> France -> Europe
    let results = memory.recall(&paris_id, RecallQuery {
        max_path_length: 3,
        min_relevance: 0.1,
        ..RecallQuery::default()
    });
    
    println!("Starting from Paris, I can recall:");
    for result in results {
        println!("  • {} (via {} hops)", 
                 result.concept.content, 
                 result.association_path.len() - 1);
    }
}
```

### Memory Strengthening Through Repetition

```rust
fn strengthening_example() {
    let memory = MemoryGraph::new_with_defaults();
    
    let coffee_id = memory.learn("Coffee gives me energy".to_string());
    let morning_id = memory.learn("I drink coffee in the morning".to_string());
    
    memory.associate(coffee_id.clone(), morning_id.clone()).unwrap();
    
    // Simulate daily coffee routine (repetition strengthens memory)
    for day in 1..=30 {
        memory.access_concept(&coffee_id).unwrap();
        memory.access_concept(&morning_id).unwrap();
        
        if day % 7 == 0 {
            // Weekly consolidation
            let stats = memory.consolidate_memory();
            println!("Day {}: Consolidated {} connections", day, stats.promoted_to_long_term);
        }
    }
    
    // After 30 days, this should be a very strong association
    let results = memory.recall(&coffee_id, RecallQuery::default());
    if let Some(result) = results.first() {
        println!("Coffee-morning association strength: {:.3}", result.relevance_score);
    }
}
```

## 🕸️ Knowledge Graph Building

### Scientific Knowledge Base

```rust
use std::collections::HashMap;

fn build_scientific_knowledge() -> MemoryGraph {
    let memory = MemoryGraph::new_with_defaults();
    let mut concepts = HashMap::new();
    
    // Physics concepts
    concepts.insert("physics", memory.learn("Physics: Study of matter and energy".to_string()));
    concepts.insert("quantum", memory.learn("Quantum mechanics: Behavior of matter at atomic scale".to_string()));
    concepts.insert("relativity", memory.learn("Relativity: Einstein's theories of space and time".to_string()));
    concepts.insert("particle", memory.learn("Particle physics: Study of fundamental particles".to_string()));
    
    // Chemistry concepts  
    concepts.insert("chemistry", memory.learn("Chemistry: Study of matter and chemical reactions".to_string()));
    concepts.insert("atom", memory.learn("Atom: Basic unit of matter".to_string()));
    concepts.insert("molecule", memory.learn("Molecule: Group of atoms bonded together".to_string()));
    concepts.insert("reaction", memory.learn("Chemical reaction: Process that changes substances".to_string()));
    
    // Biology concepts
    concepts.insert("biology", memory.learn("Biology: Study of living organisms".to_string()));
    concepts.insert("cell", memory.learn("Cell: Basic unit of life".to_string()));
    concepts.insert("dna", memory.learn("DNA: Genetic material in living organisms".to_string()));
    concepts.insert("evolution", memory.learn("Evolution: Change in species over time".to_string()));
    
    // Create interdisciplinary connections
    let connections = vec![
        ("quantum", "particle"),
        ("quantum", "atom"),
        ("atom", "molecule"),
        ("molecule", "reaction"),
        ("atom", "cell"),
        ("dna", "molecule"),
        ("physics", "quantum"),
        ("physics", "relativity"),
        ("chemistry", "atom"),
        ("chemistry", "reaction"),
        ("biology", "cell"),
        ("biology", "dna"),
    ];
    
    for (from_key, to_key) in connections {
        if let (Some(&from_id), Some(&to_id)) = (concepts.get(from_key), concepts.get(to_key)) {
            memory.associate_bidirectional(from_id, to_id).unwrap();
        }
    }
    
    // Simulate research activity (some areas get more attention)
    let hot_topics = ["quantum", "dna", "particle"];
    for _ in 0..20 {
        for topic in &hot_topics {
            if let Some(&concept_id) = concepts.get(topic) {
                memory.access_concept(&concept_id).unwrap();
            }
        }
        memory.apply_ltp_strengthening();
    }
    
    println!("🔬 Built scientific knowledge base with {} concepts", concepts.len());
    memory
}

fn explore_knowledge_connections() {
    let memory = build_scientific_knowledge();
    
    // Find what connects to quantum mechanics
    if let Some(quantum_concept) = memory.get_all_concept_ids().into_iter()
        .find(|id| memory.get_concept(id).unwrap().content.contains("Quantum")) {
        
        let results = memory.recall(&quantum_concept, RecallQuery {
            max_results: Some(10),
            max_path_length: 2,
            ..RecallQuery::default()
        });
        
        println!("\n🔗 Quantum mechanics connects to:");
        for result in results {
            println!("  • {}", result.concept.content);
        }
    }
}
```

### Hierarchical Taxonomy

```rust
fn build_animal_taxonomy() -> MemoryGraph {
    let memory = MemoryGraph::new_with_defaults();
    
    // Build taxonomic hierarchy
    let kingdom_id = memory.learn("Kingdom Animalia: All animals".to_string());
    let phylum_id = memory.learn("Phylum Chordata: Animals with backbones".to_string());
    let class_mammal_id = memory.learn("Class Mammalia: Warm-blooded, hair-bearing animals".to_string());
    let class_bird_id = memory.learn("Class Aves: Feathered, winged animals".to_string());
    
    // Mammal orders
    let carnivora_id = memory.learn("Order Carnivora: Meat-eating mammals".to_string());
    let primates_id = memory.learn("Order Primates: Humans, apes, monkeys".to_string());
    
    // Families
    let felidae_id = memory.learn("Family Felidae: Cats and their relatives".to_string());
    let canidae_id = memory.learn("Family Canidae: Dogs, wolves, foxes".to_string());
    let hominidae_id = memory.learn("Family Hominidae: Great apes including humans".to_string());
    
    // Species
    let cat_id = memory.learn("Felis catus: Domestic cat".to_string());
    let dog_id = memory.learn("Canis lupus familiaris: Domestic dog".to_string());
    let human_id = memory.learn("Homo sapiens: Modern humans".to_string());
    let eagle_id = memory.learn("Aquila chrysaetos: Golden eagle".to_string());
    
    // Build hierarchical connections (child -> parent)
    let hierarchy = vec![
        (phylum_id, kingdom_id),
        (class_mammal_id, phylum_id),
        (class_bird_id, phylum_id),
        (carnivora_id, class_mammal_id),
        (primates_id, class_mammal_id),
        (felidae_id, carnivora_id),
        (canidae_id, carnivora_id),
        (hominidae_id, primates_id),
        (cat_id, felidae_id),
        (dog_id, canidae_id),
        (human_id, hominidae_id),
        (eagle_id, class_bird_id),
    ];
    
    for (child, parent) in hierarchy {
        memory.associate(child, parent).unwrap();
    }
    
    // Add some cross-connections (shared characteristics)
    memory.associate(cat_id, dog_id).unwrap(); // Both are pets
    memory.associate(eagle_id, cat_id).unwrap(); // Both are predators
    
    println!("🦁 Built animal taxonomy with hierarchical relationships");
    memory
}
```

## 🤖 AI Agent Memory

### Personal Assistant Memory

```rust
use chrono::{DateTime, Utc};
use std::collections::HashMap;

struct PersonalAssistant {
    memory: MemoryGraph,
    user_preferences: HashMap<String, String>,
}

impl PersonalAssistant {
    fn new() -> Self {
        let config = MemoryConfig {
            learning_rate: 0.15,  // Quick learning for user preferences
            consolidation_threshold: 0.3, // Easy consolidation
            ..MemoryConfig::default()
        };
        
        Self {
            memory: MemoryGraph::new(config),
            user_preferences: HashMap::new(),
        }
    }
    
    fn learn_user_preference(&mut self, preference: String, context: Option<String>) -> ConceptId {
        let content = match context {
            Some(ctx) => format!("User preference: {} (Context: {})", preference, ctx),
            None => format!("User preference: {}", preference),
        };
        
        let pref_id = self.memory.learn(content);
        
        // Associate with time of day if relevant
        let now = Utc::now();
        let time_context = if now.hour() < 12 {
            "morning preference"
        } else if now.hour() < 18 {
            "afternoon preference"  
        } else {
            "evening preference"
        };
        
        let time_id = self.memory.learn(time_context.to_string());
        self.memory.associate(pref_id.clone(), time_id).unwrap();
        
        pref_id
    }
    
    fn remember_interaction(&mut self, user_input: String, response: String) {
        let interaction_id = self.memory.learn(
            format!("Interaction - User: '{}' | Assistant: '{}'", user_input, response)
        );
        
        // Find related concepts to associate
        let related = self.memory.recall_by_content(&user_input, RecallQuery {
            max_results: Some(3),
            min_relevance: 0.2,
            ..RecallQuery::default()
        });
        
        for result in related {
            self.memory.associate(interaction_id.clone(), result.concept.id).unwrap();
        }
    }
    
    fn get_contextual_suggestions(&self, query: &str) -> Vec<String> {
        let results = self.memory.recall_by_content(query, RecallQuery {
            max_results: Some(5),
            min_relevance: 0.15,
            boost_recent_memories: true,
            ..RecallQuery::default()
        });
        
        results.into_iter()
            .map(|r| r.concept.content)
            .collect()
    }
    
    fn daily_memory_consolidation(&mut self) {
        // Simulate end-of-day memory processing
        self.memory.sleep_cycle();
        let stats = self.memory.consolidate_memory();
        
        println!("🌙 Daily memory consolidation: {} preferences consolidated", 
                 stats.promoted_to_long_term);
    }
}

fn assistant_example() {
    let mut assistant = PersonalAssistant::new();
    
    // Learn user preferences over time
    assistant.learn_user_preference("I like coffee in the morning".to_string(), None);
    assistant.learn_user_preference("Prefer Italian restaurants".to_string(), Some("dining".to_string()));
    assistant.learn_user_preference("Enjoy jazz music while working".to_string(), Some("productivity".to_string()));
    
    // Simulate interactions
    assistant.remember_interaction(
        "What's a good coffee shop nearby?".to_string(),
        "Based on your morning coffee preference, I recommend Cafe Luna".to_string()
    );
    
    assistant.remember_interaction(
        "Find me a restaurant for dinner".to_string(),
        "I found an Italian restaurant that matches your preferences".to_string()
    );
    
    // Get contextual suggestions
    let suggestions = assistant.get_contextual_suggestions("restaurant dinner");
    println!("🍽️ Restaurant suggestions based on memory:");
    for suggestion in suggestions {
        println!("  • {}", suggestion);
    }
    
    // End of day processing
    assistant.daily_memory_consolidation();
}
```

### Learning Agent

```rust
struct LearningAgent {
    memory: MemoryGraph,
    learning_sessions: u64,
}

impl LearningAgent {
    fn new() -> Self {
        Self {
            memory: MemoryGraph::new_with_defaults(),
            learning_sessions: 0,
        }
    }
    
    fn learn_from_experience(&mut self, experience: &str, outcome: &str, success: bool) {
        self.learning_sessions += 1;
        
        let experience_id = self.memory.learn(format!("Experience: {}", experience));
        let outcome_id = self.memory.learn(format!("Outcome: {} ({})", 
                                                  outcome, 
                                                  if success { "Success" } else { "Failure" }));
        
        // Create association with different strengths based on success
        self.memory.associate(experience_id.clone(), outcome_id).unwrap();
        
        if success {
            // Strengthen successful patterns
            self.memory.access_concept(&experience_id).unwrap();
            self.memory.access_concept(&outcome_id).unwrap();
            self.memory.apply_ltp_strengthening();
        } else {
            // Let failures decay naturally (no strengthening)
            self.memory.apply_ltd_decay();
        }
        
        // Periodic consolidation
        if self.learning_sessions % 10 == 0 {
            self.memory.consolidate_memory();
        }
    }
    
    fn predict_outcome(&self, new_experience: &str) -> Vec<(String, f64)> {
        let similar_experiences = self.memory.recall_by_content(new_experience, RecallQuery {
            max_results: Some(5),
            min_relevance: 0.2,
            ..RecallQuery::default()
        });
        
        let mut predictions = Vec::new();
        
        for exp_result in similar_experiences {
            // Find outcomes associated with this experience
            let outcomes = self.memory.recall(&exp_result.concept.id, RecallQuery {
                max_results: Some(3),
                min_relevance: 0.1,
                ..RecallQuery::default()
            });
            
            for outcome in outcomes {
                if outcome.concept.content.contains("Outcome:") {
                    predictions.push((
                        outcome.concept.content.clone(),
                        exp_result.relevance_score * outcome.relevance_score
                    ));
                }
            }
        }
        
        // Sort by confidence
        predictions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        predictions
    }
}

fn learning_agent_example() {
    let mut agent = LearningAgent::new();
    
    // Train the agent with experiences
    let training_data = vec![
        ("Approach customer with smile", "Customer engaged positively", true),
        ("Approach customer aggressively", "Customer walked away", false),
        ("Listen to customer needs first", "Sale completed successfully", true),
        ("Push product immediately", "Customer became defensive", false),
        ("Ask open-ended questions", "Customer shared requirements", true),
        ("Use technical jargon", "Customer looked confused", false),
    ];
    
    for (experience, outcome, success) in training_data {
        agent.learn_from_experience(experience, outcome, success);
    }
    
    // Test prediction
    let predictions = agent.predict_outcome("Approach new customer");
    println!("🤖 Predictions for 'Approach new customer':");
    for (outcome, confidence) in predictions.iter().take(3) {
        println!("  • {} (confidence: {:.2})", outcome, confidence);
    }
}
```

## 📖 Learning from Text

### Document Processing and Knowledge Extraction

```rust
fn process_document(memory: &MemoryGraph, document: &str, title: &str) -> Vec<ConceptId> {
    let mut concept_ids = Vec::new();
    
    // Split document into sentences/concepts
    let sentences: Vec<&str> = document.split('.').collect();
    
    for sentence in sentences {
        let trimmed = sentence.trim();
        if trimmed.len() > 10 { // Filter out very short sentences
            let concept_id = memory.learn(format!("{}: {}", title, trimmed));
            concept_ids.push(concept_id);
        }
    }
    
    // Create associations between consecutive sentences
    for i in 0..(concept_ids.len() - 1) {
        memory.associate(concept_ids[i].clone(), concept_ids[i + 1].clone()).unwrap();
    }
    
    concept_ids
}

fn text_learning_example() {
    let memory = MemoryGraph::new_with_defaults();
    
    // Process multiple documents
    let documents = vec![
        ("Machine Learning", "Machine learning is a subset of artificial intelligence. It enables computers to learn without being explicitly programmed. Neural networks are a key component of modern ML. Deep learning uses multiple layers of neural networks"),
        
        ("Neural Networks", "Neural networks are inspired by biological neurons. They consist of interconnected nodes called neurons. Each connection has a weight that affects signal strength. Training adjusts these weights to improve performance"),
        
        ("AI History", "Artificial intelligence began in the 1950s. Early AI focused on symbolic reasoning. Neural networks gained popularity in the 1980s. Modern AI combines multiple approaches for better results"),
    ];
    
    let mut all_concepts = Vec::new();
    
    for (title, content) in documents {
        let concepts = process_document(&memory, content, title);
        all_concepts.extend(concepts);
        println!("📄 Processed '{}': {} concepts extracted", title, concepts.len());
    }
    
    // Create cross-document associations for similar content
    for (i, concept_id) in all_concepts.iter().enumerate() {
        let concept = memory.get_concept(concept_id).unwrap();
        
        // Find similar concepts from other documents
        let similar = memory.recall_by_content(&concept.content, RecallQuery {
            max_results: Some(3),
            min_relevance: 0.3,
            ..RecallQuery::default()
        });
        
        for similar_concept in similar {
            if similar_concept.concept.id != *concept_id {
                memory.associate(concept_id.clone(), similar_concept.concept.id).unwrap();
            }
        }
    }
    
    // Consolidate the learned knowledge
    let stats = memory.consolidate_memory();
    println!("🧠 Knowledge consolidation: {} cross-references established", 
             stats.promoted_to_long_term);
    
    // Test knowledge retrieval
    let query_results = memory.recall_by_content("neural networks learning", RecallQuery::default());
    println!("\n🔍 Query 'neural networks learning' found {} related concepts:", query_results.len());
    for result in query_results.iter().take(3) {
        println!("  • {} (relevance: {:.2})", 
                 result.concept.content.chars().take(80).collect::<String>(), 
                 result.relevance_score);
    }
}
```

### Concept Extraction and Relationship Mining

```rust
use std::collections::HashSet;

fn extract_key_concepts(text: &str) -> Vec<String> {
    // Simple keyword extraction (in practice, use NLP libraries)
    let stop_words: HashSet<&str> = ["the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by"].iter().cloned().collect();
    
    text.to_lowercase()
        .split_whitespace()
        .filter(|word| word.len() > 3 && !stop_words.contains(word))
        .map(|word| word.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|word| !word.is_empty())
        .collect()
}

fn build_concept_network_from_text() {
    let memory = MemoryGraph::new_with_defaults();
    
    let texts = vec![
        "Machine learning algorithms can learn patterns from data without explicit programming",
        "Deep learning uses neural networks with multiple hidden layers for complex pattern recognition",
        "Artificial intelligence includes machine learning, natural language processing, and computer vision",
        "Neural networks are inspired by biological brain structures and synaptic connections",
        "Data science combines statistics, programming, and domain expertise for insights",
    ];
    
    let mut concept_network: HashMap<String, ConceptId> = HashMap::new();
    
    // Extract concepts and create nodes
    for text in &texts {
        let concepts = extract_key_concepts(text);
        
        for concept in concepts {
            if !concept_network.contains_key(&concept) {
                let concept_id = memory.learn(format!("Concept: {}", concept));
                concept_network.insert(concept.clone(), concept_id);
            }
        }
    }
    
    // Create associations based on co-occurrence
    for text in &texts {
        let concepts = extract_key_concepts(text);
        
        // Connect concepts that appear in the same text
        for i in 0..concepts.len() {
            for j in (i + 1)..concepts.len() {
                if let (Some(&id1), Some(&id2)) = (concept_network.get(&concepts[i]), concept_network.get(&concepts[j])) {
                    memory.associate_bidirectional(id1, id2).unwrap();
                }
            }
        }
    }
    
    println!("🕸️ Built concept network with {} concepts", concept_network.len());
    
    // Find central concepts (most connected)
    let mut concept_connectivity = Vec::new();
    
    for (concept_name, concept_id) in &concept_network {
        let connections = memory.recall(concept_id, RecallQuery {
            max_results: Some(100),
            min_relevance: 0.01,
            max_path_length: 1,
            ..RecallQuery::default()
        }).len();
        
        concept_connectivity.push((concept_name.clone(), connections));
    }
    
    concept_connectivity.sort_by(|a, b| b.1.cmp(&a.1));
    
    println!("\n🌟 Most connected concepts:");
    for (concept, connections) in concept_connectivity.iter().take(5) {
        println!("  • {}: {} connections", concept, connections);
    }
}
```

## 💬 Chatbot Conversation Memory

### Context-Aware Chatbot

```rust
struct ConversationalBot {
    memory: MemoryGraph,
    conversation_history: Vec<(String, String)>, // (user, bot) pairs
    current_session_id: ConceptId,
}

impl ConversationalBot {
    fn new() -> Self {
        let config = MemoryConfig {
            learning_rate: 0.2,  // Quick learning of conversation patterns
            consolidation_threshold: 0.25,
            boost_recent_memories: true,
            ..MemoryConfig::default()
        };
        
        let memory = MemoryGraph::new(config);
        let session_id = memory.learn(format!("Conversation session started at {}", Utc::now()));
        
        Self {
            memory,
            conversation_history: Vec::new(),
            current_session_id: session_id,
        }
    }
    
    fn process_user_message(&mut self, user_message: &str) -> String {
        // Store the user message
        let user_msg_id = self.memory.learn(format!("User: {}", user_message));
        self.memory.associate(user_msg_id.clone(), self.current_session_id.clone()).unwrap();
        
        // Find relevant context from memory
        let context = self.get_relevant_context(user_message);
        
        // Generate response (simplified - would use actual NLP/LLM)
        let response = self.generate_response(user_message, &context);
        
        // Store the bot response  
        let bot_msg_id = self.memory.learn(format!("Bot: {}", response));
        self.memory.associate(bot_msg_id.clone(), user_msg_id).unwrap();
        self.memory.associate(bot_msg_id, self.current_session_id.clone()).unwrap();
        
        // Update conversation history
        self.conversation_history.push((user_message.to_string(), response.clone()));
        
        // Strengthen recent conversation concepts
        self.memory.access_concept(&user_msg_id).unwrap();
        
        response
    }
    
    fn get_relevant_context(&self, user_message: &str) -> Vec<String> {
        // Find similar past conversations
        let similar_conversations = self.memory.recall_by_content(user_message, RecallQuery {
            max_results: Some(5),
            min_relevance: 0.2,
            boost_recent_memories: true,
            ..RecallQuery::default()
        });
        
        similar_conversations.into_iter()
            .map(|result| result.concept.content)
            .collect()
    }
    
    fn generate_response(&self, user_message: &str, context: &[String]) -> String {
        // Simplified response generation based on context
        if user_message.to_lowercase().contains("hello") || user_message.to_lowercase().contains("hi") {
            if context.iter().any(|c| c.contains("User: hello") || c.contains("User: hi")) {
                "Hello again! Good to see you back.".to_string()
            } else {
                "Hello! Nice to meet you.".to_string()
            }
        } else if user_message.to_lowercase().contains("recommend") {
            if context.iter().any(|c| c.contains("restaurant")) {
                "Based on our previous conversation about restaurants, I'd suggest trying that Italian place we discussed.".to_string()
            } else {
                "I'd be happy to make a recommendation. What are you looking for?".to_string()
            }
        } else if user_message.to_lowercase().contains("remember") {
            if context.is_empty() {
                "I don't have any relevant memories about this topic yet.".to_string()
            } else {
                format!("Yes, I remember we talked about: {}", 
                       context.first().unwrap_or(&"something similar".to_string()))
            }
        } else {
            format!("I understand you're talking about: {}. How can I help?", user_message)
        }
    }
    
    fn end_session_consolidation(&mut self) {
        // Consolidate conversation memories
        self.memory.sleep_cycle();
        let stats = self.memory.consolidate_memory();
        
        println!("💤 Session ended. Consolidated {} conversation memories", 
                 stats.promoted_to_long_term);
    }
    
    fn get_user_profile(&self) -> Vec<String> {
        // Extract user preferences and patterns from memory
        let profile_concepts = self.memory.recall(&self.current_session_id, RecallQuery {
            max_results: Some(20),
            min_relevance: 0.1,
            ..RecallQuery::default()
        });
        
        profile_concepts.into_iter()
            .filter(|result| result.concept.content.starts_with("User:"))
            .map(|result| result.concept.content)
            .collect()
    }
}

fn chatbot_example() {
    let mut bot = ConversationalBot::new();
    
    // Simulate a conversation
    let conversation = vec![
        "Hello there!",
        "I'm looking for a good restaurant recommendation",
        "I prefer Italian food",
        "What about something with outdoor seating?",
        "Thanks! Can you remember my preference for Italian food?",
        "Goodbye for now",
    ];
    
    println!("🤖 Chatbot Conversation:");
    for user_message in conversation {
        let response = bot.process_user_message(user_message);
        println!("User: {}", user_message);
        println!("Bot:  {}\n", response);
    }
    
    // Show learned user profile
    let profile = bot.get_user_profile();
    println!("👤 Learned user profile:");
    for preference in profile.iter().take(5) {
        println!("  • {}", preference);
    }
    
    // End session
    bot.end_session_consolidation();
    
    // Start new session to test memory retention
    println!("\n--- New Session ---");
    let response = bot.process_user_message("Hi again! Remember my restaurant preferences?");
    println!("User: Hi again! Remember my restaurant preferences?");
    println!("Bot:  {}", response);
}
```

## 🎯 Recommendation System

### Preference Learning System

```rust
struct RecommendationEngine {
    memory: MemoryGraph,
    user_id: ConceptId,
    item_categories: HashMap<String, ConceptId>,
}

impl RecommendationEngine {
    fn new(user_name: &str) -> Self {
        let memory = MemoryGraph::new_with_defaults();
        let user_id = memory.learn(format!("User: {}", user_name));
        
        Self {
            memory,
            user_id,
            item_categories: HashMap::new(),
        }
    }
    
    fn add_user_interaction(&mut self, item: &str, category: &str, rating: f64, context: Option<&str>) {
        // Create or get category concept
        let category_id = *self.item_categories.entry(category.to_string())
            .or_insert_with(|| self.memory.learn(format!("Category: {}", category)));
        
        // Create item concept
        let item_content = match context {
            Some(ctx) => format!("Item: {} ({})", item, ctx),
            None => format!("Item: {}", item),
        };
        let item_id = self.memory.learn(item_content);
        
        // Create rating concept
        let rating_category = if rating >= 4.0 {
            "loved"
        } else if rating >= 3.0 {
            "liked"
        } else if rating >= 2.0 {
            "neutral"
        } else {
            "disliked"
        };
        let rating_id = self.memory.learn(format!("Rating: {} ({})", rating, rating_category));
        
        // Create associations
        self.memory.associate(self.user_id.clone(), item_id.clone()).unwrap();
        self.memory.associate(item_id.clone(), category_id).unwrap();
        self.memory.associate(item_id.clone(), rating_id).unwrap();
        
        // Strengthen connections based on rating
        for _ in 0..(rating as usize) {
            self.memory.access_concept(&item_id).unwrap();
            if rating >= 4.0 {
                self.memory.access_concept(&category_id).unwrap();
            }
        }
        
        // Apply learning
        if rating >= 3.0 {
            self.memory.apply_ltp_strengthening();
        } else {
            self.memory.apply_ltd_decay();
        }
    }
    
    fn get_recommendations(&self, category: Option<&str>, count: usize) -> Vec<(String, f64)> {
        let base_concept = if let Some(cat) = category {
            self.item_categories.get(cat).cloned().unwrap_or(self.user_id.clone())
        } else {
            self.user_id.clone()
        };
        
        let related_items = self.memory.recall(&base_concept, RecallQuery {
            max_results: Some(count * 3), // Get more than needed for filtering
            min_relevance: 0.1,
            boost_recent_memories: true,
            ..RecallQuery::default()
        });
        
        let mut recommendations = Vec::new();
        
        for result in related_items {
            if result.concept.content.starts_with("Item:") {
                // Check if this was highly rated
                let item_ratings = self.memory.recall(&result.concept.id, RecallQuery {
                    max_results: Some(5),
                    min_relevance: 0.1,
                    ..RecallQuery::default()
                });
                
                let mut max_rating = 0.0;
                for rating_result in item_ratings {
                    if rating_result.concept.content.contains("loved") {
                        max_rating = max_rating.max(5.0);
                    } else if rating_result.concept.content.contains("liked") {
                        max_rating = max_rating.max(4.0);
                    }
                }
                
                if max_rating > 3.0 {
                    let recommendation_score = result.relevance_score * (max_rating / 5.0);
                    recommendations.push((result.concept.content, recommendation_score));
                }
            }
        }
        
        recommendations.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        recommendations.truncate(count);
        recommendations
    }
    
    fn get_user_preferences(&self) -> HashMap<String, f64> {
        let mut preferences = HashMap::new();
        
        for (category_name, category_id) in &self.item_categories {
            let category_strength = self.memory.recall(&self.user_id, RecallQuery {
                max_results: Some(50),
                min_relevance: 0.01,
                ..RecallQuery::default()
            }).iter()
             .filter(|result| {
                 self.memory.recall(&result.concept.id, RecallQuery {
                     max_results: Some(10),
                     min_relevance: 0.01,
                     ..RecallQuery::default()
                 }).iter().any(|r| r.concept.id == *category_id)
             })
             .map(|result| result.relevance_score)
             .sum::<f64>();
            
            preferences.insert(category_name.clone(), category_strength);
        }
        
        preferences
    }
}

fn recommendation_example() {
    let mut recommender = RecommendationEngine::new("Alice");
    
    // Simulate user interactions
    let interactions = vec![
        ("The Godfather", "Movies", 5.0, Some("Classic drama")),
        ("Pulp Fiction", "Movies", 4.5, Some("Crime thriller")),
        ("Casablanca", "Movies", 4.0, Some("Romance classic")),
        ("Fast & Furious", "Movies", 2.0, Some("Action")),
        ("The Beatles - Abbey Road", "Music", 5.0, Some("Rock classic")),
        ("Miles Davis - Kind of Blue", "Music", 4.5, Some("Jazz masterpiece")),
        ("Taylor Swift - 1989", "Music", 3.0, Some("Pop")),
        ("Death Metal Album", "Music", 1.0, Some("Heavy metal")),
        ("Italian Pasta", "Food", 4.5, Some("Dinner")),
        ("Sushi", "Food", 4.0, Some("Japanese cuisine")),
        ("Fast Food Burger", "Food", 2.5, Some("Quick meal")),
    ];
    
    for (item, category, rating, context) in interactions {
        recommender.add_user_interaction(item, category, rating, context);
    }
    
    // Consolidate preferences
    recommender.memory.consolidate_memory();
    
    // Get recommendations
    println!("🎬 Movie recommendations:");
    let movie_recs = recommender.get_recommendations(Some("Movies"), 3);
    for (item, score) in movie_recs {
        println!("  • {} (score: {:.2})", item, score);
    }
    
    println!("\n🎵 Music recommendations:");
    let music_recs = recommender.get_recommendations(Some("Music"), 3);
    for (item, score) in music_recs {
        println!("  • {} (score: {:.2})", item, score);
    }
    
    // Show user preferences profile
    let preferences = recommender.get_user_preferences();
    println!("\n👤 User preference strength by category:");
    let mut pref_vec: Vec<_> = preferences.into_iter().collect();
    pref_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    
    for (category, strength) in pref_vec {
        println!("  • {}: {:.2}", category, strength);
    }
}
```

## 🔬 Research Applications

### Cognitive Memory Model

```rust
struct CognitiveMemoryModel {
    memory: MemoryGraph,
    episodic_memories: Vec<ConceptId>,
    semantic_knowledge: Vec<ConceptId>,
    working_memory_capacity: usize,
}

impl CognitiveMemoryModel {
    fn new() -> Self {
        let config = MemoryConfig {
            learning_rate: 0.08,  // Realistic human learning rate
            decay_rate: 0.015,    // Natural forgetting
            consolidation_threshold: 0.6, // Requires strong evidence
            consolidation_interval_hours: 24, // Daily consolidation like sleep
            ..MemoryConfig::default()
        };
        
        Self {
            memory: MemoryGraph::new(config),
            episodic_memories: Vec::new(),
            semantic_knowledge: Vec::new(),
            working_memory_capacity: 7, // Miller's magic number
        }
    }
    
    fn encode_episodic_memory(&mut self, event: &str, context: &str, emotional_valence: f64) {
        let memory_content = format!("Episode: {} | Context: {} | Emotion: {:.1}", 
                                   event, context, emotional_valence);
        let episode_id = self.memory.learn(memory_content);
        
        // Emotional memories are strengthened
        let strengthening_factor = (emotional_valence.abs() * 3.0) as usize;
        for _ in 0..strengthening_factor {
            self.memory.access_concept(&episode_id).unwrap();
        }
        
        self.episodic_memories.push(episode_id);
    }
    
    fn encode_semantic_knowledge(&mut self, fact: &str, domain: &str) {
        let knowledge_content = format!("Fact: {} | Domain: {}", fact, domain);
        let knowledge_id = self.memory.learn(knowledge_content);
        
        // Associate with existing knowledge in the same domain
        for existing_id in &self.semantic_knowledge {
            if let Some(existing_concept) = self.memory.get_concept(existing_id) {
                if existing_concept.content.contains(domain) {
                    self.memory.associate(knowledge_id.clone(), existing_id.clone()).unwrap();
                }
            }
        }
        
        self.semantic_knowledge.push(knowledge_id);
    }
    
    fn simulate_retrieval_practice(&mut self, query: &str, repetitions: usize) {
        for _ in 0..repetitions {
            let recalled = self.memory.recall_by_content(query, RecallQuery {
                max_results: Some(5),
                min_relevance: 0.2,
                boost_recent_memories: false, // Testing long-term retention
                ..RecallQuery::default()
            });
            
            // Strengthen recalled memories (testing effect)
            for result in recalled {
                self.memory.access_concept(&result.concept.id).unwrap();
            }
            
            self.memory.apply_ltp_strengthening();
        }
    }
    
    fn simulate_sleep_consolidation(&mut self) -> ConsolidationStats {
        // Simulate REM sleep memory consolidation
        self.memory.sleep_cycle();
        
        // Preferentially consolidate emotional and recently accessed memories
        let recent_concepts: Vec<_> = self.episodic_memories.iter()
            .chain(self.semantic_knowledge.iter())
            .cloned()
            .collect();
        
        if !recent_concepts.is_empty() {
            self.memory.hebbian_strengthening(&recent_concepts[..recent_concepts.len().min(5)]);
        }
        
        self.memory.consolidate_memory()
    }
    
    fn measure_memory_performance(&self) -> MemoryPerformanceMetrics {
        let total_concepts = self.memory.get_stats().total_concepts;
        let total_connections = self.memory.get_stats().short_term_connections + 
                              self.memory.get_stats().long_term_connections;
        
        // Test recall accuracy for different memory types
        let episodic_recall_count = self.episodic_memories.iter()
            .map(|id| self.memory.recall(id, RecallQuery::default()).len())
            .sum::<usize>();
        
        let semantic_recall_count = self.semantic_knowledge.iter()
            .map(|id| self.memory.recall(id, RecallQuery::default()).len())
            .sum::<usize>();
        
        MemoryPerformanceMetrics {
            total_memories: total_concepts,
            total_associations: total_connections,
            episodic_connectivity: if self.episodic_memories.is_empty() { 0.0 } else {
                episodic_recall_count as f64 / self.episodic_memories.len() as f64
            },
            semantic_connectivity: if self.semantic_knowledge.is_empty() { 0.0 } else {
                semantic_recall_count as f64 / self.semantic_knowledge.len() as f64
            },
        }
    }
}

#[derive(Debug)]
struct MemoryPerformanceMetrics {
    total_memories: usize,
    total_associations: usize,
    episodic_connectivity: f64,
    semantic_connectivity: f64,
}

fn cognitive_research_example() {
    let mut model = CognitiveMemoryModel::new();
    
    // Simulate learning experiences
    println!("🧠 Simulating cognitive memory formation...");
    
    // Episodic memories (personal experiences)
    model.encode_episodic_memory("First day of school", "Elementary school", 3.5);
    model.encode_episodic_memory("Learning to ride a bike", "Childhood", 4.0);
    model.encode_episodic_memory("College graduation", "University", 4.5);
    model.encode_episodic_memory("Failed exam", "High school", -2.5);
    
    // Semantic knowledge (facts)
    model.encode_semantic_knowledge("Paris is the capital of France", "Geography");
    model.encode_semantic_knowledge("E=mc²", "Physics");
    model.encode_semantic_knowledge("Mitochondria is the powerhouse of the cell", "Biology");
    model.encode_semantic_knowledge("Python is a programming language", "Computer Science");
    
    // Initial performance
    let initial_metrics = model.measure_memory_performance();
    println!("Initial memory metrics: {:?}", initial_metrics);
    
    // Simulate retrieval practice (spaced repetition)
    println!("\n📚 Simulating retrieval practice...");
    model.simulate_retrieval_practice("Paris", 3);
    model.simulate_retrieval_practice("graduation", 2);
    
    // Simulate sleep consolidation
    println!("\n😴 Simulating sleep consolidation...");
    let consolidation_stats = model.simulate_sleep_consolidation();
    println!("Sleep consolidation results: {:?}", consolidation_stats);
    
    // Final performance
    let final_metrics = model.measure_memory_performance();
    println!("\nFinal memory metrics: {:?}", final_metrics);
    
    // Test memory recall after consolidation
    println!("\n🔍 Testing memory recall:");
    let geography_recall = model.memory.recall_by_content("Paris France", RecallQuery::default());
    println!("Geography recall: {} items", geography_recall.len());
    
    let emotional_recall = model.memory.recall_by_content("graduation school", RecallQuery::default());
    println!("Emotional event recall: {} items", emotional_recall.len());
}
```

## ⚡ Performance Optimization

### High-Performance Configuration

```rust
fn optimized_memory_system() -> MemoryGraph {
    let config = MemoryConfig {
        learning_rate: 0.05,           // Conservative learning for stability
        decay_rate: 0.001,             // Very slow decay for persistence
        consolidation_threshold: 0.7,   // High threshold for quality
        max_short_term_connections: 100000, // Large capacity
        consolidation_interval_hours: 12,    // Frequent consolidation
        max_recall_results: 100,
    };
    
    MemoryGraph::new(config)
}

fn benchmark_memory_operations() {
    use std::time::Instant;
    
    let memory = optimized_memory_system();
    let mut concept_ids = Vec::new();
    
    println!("🚀 Performance Benchmarking");
    
    // Benchmark learning
    let start = Instant::now();
    for i in 0..10000 {
        let id = memory.learn(format!("Concept {}: Performance test data", i));
        concept_ids.push(id);
    }
    let learning_time = start.elapsed();
    println!("Learning 10,000 concepts: {:?}", learning_time);
    
    // Benchmark association creation
    let start = Instant::now();
    for i in 0..5000 {
        let from_idx = i % concept_ids.len();
        let to_idx = (i + 1) % concept_ids.len();
        memory.associate(concept_ids[from_idx].clone(), concept_ids[to_idx].clone()).unwrap();
    }
    let association_time = start.elapsed();
    println!("Creating 5,000 associations: {:?}", association_time);
    
    // Benchmark recall
    let start = Instant::now();
    let mut total_results = 0;
    for i in 0..1000 {
        let concept_idx = i % concept_ids.len();
        let results = memory.recall(&concept_ids[concept_idx], RecallQuery {
            max_results: Some(10),
            max_path_length: 2,
            ..RecallQuery::default()
        });
        total_results += results.len();
    }
    let recall_time = start.elapsed();
    println!("1,000 recall operations: {:?} (avg {} results)", recall_time, total_results / 1000);
    
    // Benchmark consolidation
    let start = Instant::now();
    let stats = memory.consolidate_memory();
    let consolidation_time = start.elapsed();
    println!("Memory consolidation: {:?} ({} promoted)", consolidation_time, stats.promoted_to_long_term);
    
    // Memory usage statistics
    let memory_stats = memory.get_stats();
    println!("\n📊 Final Statistics:");
    println!("  Concepts: {}", memory_stats.total_concepts);
    println!("  Short-term connections: {}", memory_stats.short_term_connections);
    println!("  Long-term connections: {}", memory_stats.long_term_connections);
    println!("  Working memory: {}", memory_stats.working_memory_size);
}

fn memory_stress_test() {
    let memory = MemoryGraph::new_with_defaults();
    let mut concept_pool = Vec::new();
    
    println!("🏋️ Memory Stress Test");
    
    // Create a large, interconnected network
    for batch in 0..100 {
        println!("Processing batch {}/100", batch + 1);
        
        // Add concepts
        for i in 0..100 {
            let id = memory.learn(format!("Batch {} Concept {}", batch, i));
            concept_pool.push(id);
        }
        
        // Create random associations
        for _ in 0..200 {
            let from_idx = rand::random::<usize>() % concept_pool.len();
            let to_idx = rand::random::<usize>() % concept_pool.len();
            if from_idx != to_idx {
                memory.associate(concept_pool[from_idx].clone(), concept_pool[to_idx].clone()).unwrap();
            }
        }
        
        // Periodic maintenance
        if batch % 10 == 0 {
            memory.sleep_cycle();
            let stats = memory.consolidate_memory();
            println!("  Consolidated {} connections", stats.promoted_to_long_term);
        }
    }
    
    println!("✅ Stress test completed successfully!");
    let final_stats = memory.get_stats();
    println!("Final system state: {}", final_stats);
}
```

## 🎮 Running the Examples

To run any of these examples, create a new file in your LeafMind project:

```rust
// examples/your_example.rs
use leafmind::*;
use std::collections::HashMap;

fn main() {
    // Copy any example function here and call it
    basic_example();
    // assistant_example();
    // text_learning_example();
    // chatbot_example();
    // recommendation_example();
    // cognitive_research_example();
    // benchmark_memory_operations();
}

// Paste the example functions here
```

Then run with:
```bash
cargo run --example your_example
```

These examples demonstrate the versatility and power of LeafMind's brain-inspired memory system across different domains and use cases!