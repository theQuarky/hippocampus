#!/usr/bin/env python3
"""
LeafMind Python Client Example

This example demonstrates how to use LeafMind as a database from Python.
"""

import asyncio
import sys
import os
sys.path.append(os.path.dirname(__file__))

from leafmind_client import LeafMindClient, RecallQuery, quick_learn_and_associate, build_knowledge_graph


async def basic_example():
    """Basic usage example of LeafMind as a database."""
    print("🧠 LeafMind Python Client Demo")
    print("=" * 40)
    
    async with LeafMindClient("http://localhost:8080") as client:
        # Check server health
        try:
            health = await client.health_check()
            print(f"✅ Server status: {health['status']}")
            print(f"📊 Memory stats: {health['memory_stats']['total_concepts']} concepts")
        except Exception as e:
            print(f"❌ Failed to connect to server: {e}")
            print("Make sure the LeafMind server is running on localhost:8080")
            return
        
        print("\n1. Learning new concepts...")
        
        # Learn some concepts about programming
        python_id = await client.learn("Python is a high-level programming language")
        rust_id = await client.learn("Rust is a systems programming language")
        memory_id = await client.learn("Memory management is crucial for performance")
        ai_id = await client.learn("Artificial Intelligence mimics human cognition")
        
        print(f"   Learned Python concept: {python_id}")
        print(f"   Learned Rust concept: {rust_id}")
        
        print("\n2. Creating associations...")
        
        # Create associations between concepts
        await client.associate(python_id, ai_id, bidirectional=True)
        await client.associate(rust_id, memory_id, bidirectional=True)
        await client.associate(python_id, rust_id, bidirectional=False)  # Python -> Rust
        
        print("   ✅ Created associations between related concepts")
        
        print("\n3. Recalling memories from Python concept...")
        
        # Recall memories starting from Python
        results = await client.recall_from_concept(python_id)
        for i, result in enumerate(results[:3], 1):
            print(f"   {i}. {result.concept.content}")
            print(f"      Relevance: {result.relevance_score:.3f}, Strength: {result.connection_strength:.3f}")
        
        print("\n4. Content-based recall...")
        
        # Search by content
        search_results = await client.recall_by_content("programming")
        print(f"   Found {len(search_results)} results for 'programming':")
        for result in search_results[:2]:
            print(f"   - {result.concept.content} (score: {result.relevance_score:.3f})")
        
        print("\n5. Memory consolidation...")
        
        # Consolidate memory
        consolidation_result = await client.consolidate_memory()
        print(f"   ✅ Consolidated {consolidation_result.get('consolidated_connections', 0)} connections")
        
        print("\n6. Saving to persistent storage...")
        
        # Save to disk
        save_result = await client.save_to_disk()
        if save_result.get('success'):
            print("   ✅ Memory saved to disk successfully")
        
        # Get final stats
        stats = await client.get_stats()
        print(f"\n📈 Final Stats:")
        print(f"   Total concepts: {stats.total_concepts}")
        print(f"   Short-term connections: {stats.short_term_connections}")
        print(f"   Long-term connections: {stats.long_term_connections}")


async def knowledge_graph_example():
    """Example of building a knowledge graph with LeafMind."""
    print("\n" + "=" * 40)
    print("🕸️  Knowledge Graph Example")
    print("=" * 40)
    
    async with LeafMindClient("http://localhost:8080") as client:
        # Define knowledge as concept pairs
        knowledge_pairs = [
            ("Machine Learning", "Artificial Intelligence"),
            ("Deep Learning", "Machine Learning"),
            ("Neural Networks", "Deep Learning"),
            ("Python", "Machine Learning"),
            ("TensorFlow", "Deep Learning"),
            ("Data Science", "Machine Learning"),
            ("Statistics", "Data Science"),
            ("Programming", "Python"),
            ("Algorithms", "Programming"),
        ]
        
        print("Building knowledge graph...")
        concept_map = await build_knowledge_graph(client, knowledge_pairs)
        
        print(f"✅ Created knowledge graph with {len(concept_map)} concepts")
        
        # Explore connections starting from "Machine Learning"
        ml_id = concept_map["Machine Learning"]
        print(f"\n🔍 Exploring from 'Machine Learning' (ID: {ml_id})...")
        
        # Use spreading activation to find related concepts
        related = await client.spreading_activation_recall(ml_id)
        print(f"Found {len(related)} related concepts:")
        
        for i, result in enumerate(related[:5], 1):
            print(f"   {i}. {result.concept.content}")
            print(f"      Connection strength: {result.connection_strength:.3f}")


async def batch_operations_example():
    """Example of batch operations for efficiency."""
    print("\n" + "=" * 40)
    print("⚡ Batch Operations Example")
    print("=" * 40)
    
    async with LeafMindClient("http://localhost:8080") as client:
        # Prepare batch data
        book_concepts = [
            {"content": "The Great Gatsby by F. Scott Fitzgerald", "metadata": {"type": "book", "genre": "classic"}},
            {"content": "1984 by George Orwell", "metadata": {"type": "book", "genre": "dystopian"}},
            {"content": "To Kill a Mockingbird by Harper Lee", "metadata": {"type": "book", "genre": "classic"}},
            {"content": "Brave New World by Aldous Huxley", "metadata": {"type": "book", "genre": "dystopian"}},
            {"content": "Pride and Prejudice by Jane Austen", "metadata": {"type": "book", "genre": "romance"}},
        ]
        
        print(f"Learning {len(book_concepts)} books in batch...")
        
        # Batch learn
        learn_results = await client.batch_learn(book_concepts)
        book_ids = [result["concept_id"] for result in learn_results if result["concept_id"]]
        
        print(f"✅ Learned {len(book_ids)} books successfully")
        
        # Create associations between books of the same genre
        associations = []
        for i, book1_id in enumerate(book_ids):
            for book2_id in book_ids[i+1:]:
                associations.append({
                    "from_concept_id": book1_id,
                    "to_concept_id": book2_id,
                    "bidirectional": True
                })
        
        print(f"Creating {len(associations)} associations in batch...")
        association_results = await client.batch_associate(associations)
        successful_associations = sum(1 for result in association_results if result.get("edge_created"))
        
        print(f"✅ Created {successful_associations} associations")
        
        # Test recall from one of the books
        if book_ids:
            print(f"\n🔍 Recalling from first book...")
            recall_results = await client.recall_from_concept(book_ids[0])
            for result in recall_results[:3]:
                print(f"   - {result.concept.content}")


async def main():
    """Run all examples."""
    try:
        await basic_example()
        await knowledge_graph_example()
        await batch_operations_example()
        
        print("\n" + "=" * 40)
        print("🎉 All examples completed successfully!")
        print("LeafMind is working as a neuromorphic database! 🧠💾")
        
    except KeyboardInterrupt:
        print("\n⏹️  Examples interrupted by user")
    except Exception as e:
        print(f"\n❌ Error running examples: {e}")
        print("Make sure the LeafMind server is running: cargo run --bin leafmind-server")


if __name__ == "__main__":
    asyncio.run(main())