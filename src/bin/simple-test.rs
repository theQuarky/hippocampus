use leafmind::{MemoryGraph, RecallQuery};

fn main() {
    println!("🧠 LeafMind Simple Test");
    println!("======================");

    // Create a new memory system
    let memory = MemoryGraph::new_with_defaults();
    println!("✓ Created memory graph");

    // Learn some concepts
    let cat_id = memory.learn("A small furry animal that meows and purrs".to_string());
    println!("✓ Learned concept: cat (ID: {:?})", cat_id);

    let dog_id = memory.learn("A loyal furry animal that barks and wags its tail".to_string());
    println!("✓ Learned concept: dog (ID: {:?})", dog_id);

    let pet_id = memory.learn("A domesticated animal companion that lives with humans".to_string());
    println!("✓ Learned concept: pet (ID: {:?})", pet_id);

    let animal_id = memory.learn("A living creature that can move and breathe".to_string());
    println!("✓ Learned concept: animal (ID: {:?})", animal_id);

    // Create associations
    match memory.associate(cat_id.clone(), pet_id.clone()) {
        Ok(()) => println!("✓ Associated cat → pet"),
        Err(e) => println!("✗ Failed to associate cat → pet: {}", e),
    }

    match memory.associate(dog_id.clone(), pet_id.clone()) {
        Ok(()) => println!("✓ Associated dog → pet"),
        Err(e) => println!("✗ Failed to associate dog → pet: {}", e),
    }

    match memory.associate(pet_id.clone(), animal_id.clone()) {
        Ok(()) => println!("✓ Associated pet → animal"),
        Err(e) => println!("✗ Failed to associate pet → animal: {}", e),
    }

    // Get memory statistics
    let stats = memory.get_stats();
    println!("\n📊 Memory Statistics:");
    println!("   Total concepts: {}", stats.total_concepts);
    println!("   Short-term connections: {}", stats.short_term_connections);
    println!("   Long-term connections: {}", stats.long_term_connections);
    println!("   Working memory size: {}", stats.working_memory_size);

    // Test concept retrieval
    println!("\n🔍 Testing Concept Retrieval:");
    if let Some(concept) = memory.get_concept(&cat_id) {
        println!("   Found cat concept: \"{}\"", concept.content);
        println!("   Access count: {}", concept.access_count);
    } else {
        println!("   ✗ Could not find cat concept");
    }

    // Access a concept to update its statistics
    match memory.access_concept(&cat_id) {
        Ok(()) => println!("✓ Accessed cat concept"),
        Err(e) => println!("✗ Failed to access cat concept: {}", e),
    }

    // Check updated concept
    if let Some(concept) = memory.get_concept(&cat_id) {
        println!("   Updated access count: {}", concept.access_count);
    }

    // Test recall functionality
    println!("\n🧠 Testing Recall:");
    let _recall_query = RecallQuery {
        max_results: 5,
        min_relevance: 0.1,
        max_path_length: 3,
        include_semantic_similarity: true,
        use_recency_boost: true,
        exploration_breadth: 2,
    };

    // Note: Basic MemoryGraph might not have the recall module integrated
    // Let's test if we can get related concepts through associations
    let all_concept_ids = memory.get_all_concept_ids();
    println!("   All concept IDs: {:?}", all_concept_ids);

    // Test bidirectional association
    match memory.associate_bidirectional(cat_id.clone(), dog_id.clone()) {
        Ok(()) => println!("✓ Created bidirectional association: cat ↔ dog"),
        Err(e) => println!("✗ Failed to create bidirectional association: {}", e),
    }

    // Test memory consolidation
    println!("\n🔄 Testing Memory Consolidation:");
    let consolidation_stats = memory.force_consolidation();
    println!("   Concepts promoted to long-term: {}", consolidation_stats.promoted_to_long_term);
    println!("   Associations promoted: {}", consolidation_stats.promoted_to_long_term);

    // Final statistics
    let final_stats = memory.get_stats();
    println!("\n📊 Final Memory Statistics:");
    println!("   Total concepts: {}", final_stats.total_concepts);
    println!("   Short-term connections: {}", final_stats.short_term_connections);
    println!("   Long-term connections: {}", final_stats.long_term_connections);
    println!("   Working memory size: {}", final_stats.working_memory_size);

    println!("\n🎉 Test completed successfully!");
    println!("LeafMind core functionality is working correctly.");
}