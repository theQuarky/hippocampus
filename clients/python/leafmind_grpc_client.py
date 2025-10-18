"""
LeafMind gRPC Client for Python
High-performance neuromorphic memory access with streaming support
"""

import grpc
import asyncio
from typing import List, Optional, AsyncIterator, Dict, Any
import leafmind_pb2
import leafmind_pb2_grpc
import json
import logging

class LeafMindGrpcClient:
    def __init__(self, server_address: str = "localhost:50051"):
        self.server_address = server_address
        self.channel = None
        self.stub = None
        
    async def connect(self):
        """Establish connection to gRPC server"""
        self.channel = grpc.aio.insecure_channel(self.server_address)
        self.stub = leafmind_pb2_grpc.LeafMindServiceStub(self.channel)
        
        # Test connection with health check
        try:
            health = await self.health_check()
            logging.info(f"Connected to LeafMind gRPC server v{health.version}")
            return True
        except Exception as e:
            logging.error(f"Connection failed: {e}")
            return False
    
    async def close(self):
        """Close the gRPC connection"""
        if self.channel:
            await self.channel.close()
    
    async def learn_concept(self, content: str, metadata: Dict[str, str] = None, tags: List[str] = None) -> str:
        """Learn a new concept and return its ID"""
        request = leafmind_pb2.LearnConceptRequest(
            content=content,
            metadata=metadata or {},
            tags=tags or []
        )
        
        response = await self.stub.LearnConcept(request)
        if response.success:
            return response.concept_id.uuid
        else:
            raise Exception(f"Failed to learn concept: {response.message}")
    
    async def get_concept(self, concept_id: str, include_associations: bool = False) -> Optional[Dict[str, Any]]:
        """Retrieve a specific concept by ID"""
        request = leafmind_pb2.GetConceptRequest(
            concept_id=leafmind_pb2.ConceptId(uuid=concept_id),
            include_associations=include_associations
        )
        
        response = await self.stub.GetConcept(request)
        if response.found:
            return {
                'id': response.concept.id.uuid,
                'content': response.concept.content,
                'created_at': response.concept.created_at,
                'last_accessed': response.concept.last_accessed,
                'access_count': response.concept.access_count,
                'metadata': dict(response.concept.metadata),
                'associations': [self._association_to_dict(a) for a in response.associations]
            }
        return None
    
    async def list_concepts(self, page: int = 1, page_size: int = 50, filter_text: str = "") -> Dict[str, Any]:
        """List concepts with pagination"""
        request = leafmind_pb2.ListConceptsRequest(
            page=page,
            page_size=page_size,
            filter=filter_text,
            include_metadata=True
        )
        
        response = await self.stub.ListConcepts(request)
        return {
            'concepts': [self._concept_to_dict(c) for c in response.concepts],
            'total_count': response.total_count,
            'page': response.page,
            'page_size': response.page_size,
            'has_more': response.has_more
        }
    
    async def access_concept(self, concept_id: str) -> Dict[str, Any]:
        """Access a concept (updates access statistics)"""
        request = leafmind_pb2.AccessConceptRequest(
            concept_id=leafmind_pb2.ConceptId(uuid=concept_id)
        )
        
        response = await self.stub.AccessConcept(request)
        if response.success:
            return self._concept_to_dict(response.updated_concept)
        else:
            raise Exception("Failed to access concept")
    
    async def create_association(self, from_concept_id: str, to_concept_id: str, 
                               strength: float = 1.0, association_type: str = "related", 
                               bidirectional: bool = False) -> Dict[str, Any]:
        """Create an association between two concepts"""
        request = leafmind_pb2.CreateAssociationRequest(
            from_concept=leafmind_pb2.ConceptId(uuid=from_concept_id),
            to_concept=leafmind_pb2.ConceptId(uuid=to_concept_id),
            strength=strength,
            association_type=association_type,
            bidirectional=bidirectional
        )
        
        response = await self.stub.CreateAssociation(request)
        if response.success:
            return self._association_to_dict(response.created_association)
        else:
            raise Exception(f"Failed to create association: {response.message}")
    
    async def recall_memory(self, source_concept_id: str = None, content_query: str = None,
                          max_results: int = 10, min_relevance: float = 0.1) -> Dict[str, Any]:
        """Recall related memories"""
        request = leafmind_pb2.RecallRequest(
            max_results=max_results,
            min_relevance=min_relevance,
            max_path_length=3,
            include_semantic_similarity=True,
            use_recency_boost=True,
            exploration_breadth=2
        )
        
        if source_concept_id:
            request.source_concept_id.CopyFrom(leafmind_pb2.ConceptId(uuid=source_concept_id))
        elif content_query:
            request.content_query = content_query
        else:
            raise ValueError("Either source_concept_id or content_query must be provided")
        
        response = await self.stub.RecallMemory(request)
        return {
            'results': [self._recall_result_to_dict(r) for r in response.results],
            'total_found': response.total_found,
            'query_time_ms': response.query_time_ms,
            'source_concept_id': response.source_concept_id.uuid if response.source_concept_id else None
        }
    
    async def streaming_recall(self, source_concept_id: str = None, content_query: str = None,
                             max_results: int = 10) -> AsyncIterator[Dict[str, Any]]:
        """Stream recall results as they're found"""
        request = leafmind_pb2.RecallRequest(max_results=max_results)
        
        if source_concept_id:
            request.source_concept_id.CopyFrom(leafmind_pb2.ConceptId(uuid=source_concept_id))
        elif content_query:
            request.content_query = content_query
        
        async for result in self.stub.StreamingRecall(request):
            yield self._recall_result_to_dict(result)
    
    async def get_memory_stats(self, include_persistence: bool = True) -> Dict[str, Any]:
        """Get comprehensive memory statistics"""
        request = leafmind_pb2.GetStatsRequest(include_persistence_stats=include_persistence)
        response = await self.stub.GetMemoryStats(request)
        
        stats = {
            'total_concepts': response.total_concepts,
            'short_term_concepts': response.short_term_concepts,
            'long_term_concepts': response.long_term_concepts,
            'total_associations': response.total_associations,
            'short_term_associations': response.short_term_associations,
            'long_term_associations': response.long_term_associations,
            'memory_usage_bytes': response.memory_usage_bytes,
            'consolidation_ratio': response.consolidation_ratio
        }
        
        if response.persistence_stats:
            stats['persistence'] = {
                'database_size_bytes': response.persistence_stats.database_size_bytes,
                'concepts_persisted': response.persistence_stats.concepts_persisted,
                'associations_persisted': response.persistence_stats.associations_persisted,
                'last_save_timestamp': response.persistence_stats.last_save_timestamp,
                'pending_operations': response.persistence_stats.pending_operations
            }
        
        return stats
    
    async def consolidate_memory(self, force: bool = False, min_strength: float = 0.1) -> Dict[str, Any]:
        """Trigger memory consolidation"""
        request = leafmind_pb2.ConsolidateRequest(
            force_consolidation=force,
            min_strength_threshold=min_strength
        )
        
        response = await self.stub.ConsolidateMemory(request)
        return {
            'success': response.success,
            'concepts_consolidated': response.concepts_consolidated,
            'associations_strengthened': response.associations_strengthened,
            'consolidation_time_ms': response.consolidation_time_ms
        }
    
    async def watch_concept(self, concept_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Watch for real-time updates to a specific concept"""
        request = leafmind_pb2.WatchConceptRequest(
            concept_id=leafmind_pb2.ConceptId(uuid=concept_id),
            include_associations=True
        )
        
        async for event in self.stub.WatchConcept(request):
            yield {
                'update_type': event.update_type,
                'concept_id': event.concept_id.uuid,
                'updated_concept': self._concept_to_dict(event.updated_concept) if event.updated_concept else None,
                'updated_association': self._association_to_dict(event.updated_association) if event.updated_association else None,
                'timestamp': event.timestamp
            }
    
    async def health_check(self) -> Dict[str, Any]:
        """Check server health and get version info"""
        request = leafmind_pb2.HealthCheckRequest(service="leafmind")
        response = await self.stub.HealthCheck(request)
        
        return {
            'status': response.status,
            'version': response.version,
            'uptime_seconds': response.uptime_seconds,
            'memory_stats': self._memory_stats_to_dict(response.memory_stats) if response.memory_stats else None
        }
    
    def _concept_to_dict(self, concept) -> Dict[str, Any]:
        """Convert protobuf Concept to dictionary"""
        return {
            'id': concept.id.uuid,
            'content': concept.content,
            'created_at': concept.created_at,
            'last_accessed': concept.last_accessed,
            'access_count': concept.access_count,
            'metadata': dict(concept.metadata)
        }
    
    def _association_to_dict(self, association) -> Dict[str, Any]:
        """Convert protobuf Association to dictionary"""
        return {
            'from_concept': association.from_concept.uuid,
            'to_concept': association.to_concept.uuid,
            'strength': association.strength,
            'association_type': association.association_type,
            'created_at': association.created_at,
            'is_bidirectional': association.is_bidirectional
        }
    
    def _recall_result_to_dict(self, result) -> Dict[str, Any]:
        """Convert protobuf RecallResult to dictionary"""
        return {
            'concept': self._concept_to_dict(result.concept),
            'relevance_score': result.relevance_score,
            'path_length': result.path_length,
            'connection_strength': result.connection_strength,
            'path': list(result.path)
        }
    
    def _memory_stats_to_dict(self, stats) -> Dict[str, Any]:
        """Convert protobuf MemoryStatsResponse to dictionary"""
        return {
            'total_concepts': stats.total_concepts,
            'short_term_concepts': stats.short_term_concepts,
            'long_term_concepts': stats.long_term_concepts,
            'total_associations': stats.total_associations,
            'memory_usage_bytes': stats.memory_usage_bytes,
            'consolidation_ratio': stats.consolidation_ratio
        }

# Example usage
async def main():
    client = LeafMindGrpcClient("localhost:50051")
    
    if await client.connect():
        try:
            # Learn some concepts
            cat_id = await client.learn_concept("A small furry animal that meows", {"type": "animal"})
            dog_id = await client.learn_concept("A loyal animal that barks", {"type": "animal"}) 
            pet_id = await client.learn_concept("A domesticated companion animal", {"category": "relationship"})
            
            print(f"Learned concepts: cat={cat_id}, dog={dog_id}, pet={pet_id}")
            
            # Create associations
            await client.create_association(cat_id, pet_id, strength=0.9, bidirectional=True)
            await client.create_association(dog_id, pet_id, strength=0.8, bidirectional=True)
            
            # Recall related concepts
            recall_results = await client.recall_memory(source_concept_id=pet_id, max_results=5)
            print(f"Recalled {len(recall_results['results'])} related concepts")
            
            # Watch for concept updates (in real application, this would run in background)
            print("Watching concept updates...")
            async for update in client.watch_concept(pet_id):
                print(f"Concept update: {update['update_type']}")
                break  # Just show one update for demo
                
            # Get memory statistics
            stats = await client.get_memory_stats()
            print(f"Memory stats: {stats['total_concepts']} concepts, {stats['total_associations']} associations")
            
        finally:
            await client.close()

if __name__ == "__main__":
    asyncio.run(main())