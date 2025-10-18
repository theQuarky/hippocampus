"""
LeafMind Python Client SDK

A neuromorphic memory database client for Python applications.
"""

import aiohttp
import asyncio
import json
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from datetime import datetime
import uuid


@dataclass
class Concept:
    """Represents a concept in the LeafMind memory system."""
    id: str
    content: str
    metadata: Dict[str, str]
    created_at: str
    last_accessed: str
    access_count: int


@dataclass
class RecallResult:
    """Represents a recall result with relevance score."""
    concept: Concept
    relevance_score: float
    path_length: int
    connection_strength: float


@dataclass
class RecallQuery:
    """Configuration for memory recall operations."""
    max_results: int = 10
    min_relevance: float = 0.1
    use_recency_boost: bool = True
    exploration_breadth: int = 5
    max_path_length: int = 3


@dataclass
class MemoryStats:
    """Memory system statistics."""
    total_concepts: int
    short_term_connections: int
    long_term_connections: int
    working_memory_size: int
    last_consolidation: str


class LeafMindClient:
    """
    Async client for LeafMind neuromorphic memory database.
    
    This client provides a Python interface to interact with a LeafMind API server,
    allowing you to use LeafMind as a database from your Python applications.
    
    Example:
        ```python
        async with LeafMindClient("http://localhost:8080") as client:
            # Learn new concepts
            concept_id = await client.learn("Python is a programming language")
            
            # Create associations
            other_id = await client.learn("Programming requires logical thinking")
            await client.associate(concept_id, other_id)
            
            # Recall related memories
            results = await client.recall_from_concept(concept_id)
            for result in results:
                print(f"Recalled: {result.concept.content} (score: {result.relevance_score})")
        ```
    """
    
    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        """
        Initialize the LeafMind client.
        
        Args:
            base_url: The base URL of the LeafMind API server
            api_key: Optional API key for authentication
        """
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session: Optional[aiohttp.ClientSession] = None
        
    async def __aenter__(self):
        """Async context manager entry."""
        headers = {}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'
            
        connector = aiohttp.TCPConnector(limit=100)
        timeout = aiohttp.ClientTimeout(total=30)
        
        self.session = aiohttp.ClientSession(
            headers=headers,
            connector=connector,
            timeout=timeout
        )
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()
            
    async def _request(self, method: str, endpoint: str, data: Any = None) -> Dict[str, Any]:
        """Make an HTTP request to the API."""
        if not self.session:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")
            
        url = f"{self.base_url}{endpoint}"
        
        try:
            if data is not None:
                async with self.session.request(method, url, json=data) as response:
                    response.raise_for_status()
                    return await response.json()
            else:
                async with self.session.request(method, url) as response:
                    response.raise_for_status()
                    return await response.json()
        except aiohttp.ClientResponseError as e:
            if e.status == 404:
                raise LeafMindError(f"Resource not found: {e.message}")
            elif e.status == 400:
                raise LeafMindError(f"Bad request: {e.message}")
            elif e.status == 500:
                raise LeafMindError(f"Server error: {e.message}")
            else:
                raise LeafMindError(f"HTTP {e.status}: {e.message}")
        except aiohttp.ClientError as e:
            raise LeafMindError(f"Connection error: {str(e)}")
    
    # Health and Status
    async def health_check(self) -> Dict[str, Any]:
        """Check the health status of the LeafMind server."""
        return await self._request("GET", "/health")
    
    async def get_stats(self) -> MemoryStats:
        """Get memory system statistics."""
        data = await self._request("GET", "/stats")
        return MemoryStats(**data)
    
    # Core Memory Operations
    async def learn(self, content: str, metadata: Optional[Dict[str, str]] = None) -> str:
        """
        Learn a new concept.
        
        Args:
            content: The content of the concept to learn
            metadata: Optional metadata dictionary
            
        Returns:
            The UUID of the newly created concept
        """
        request_data = {
            "content": content,
            "metadata": metadata
        }
        response = await self._request("POST", "/concepts", request_data)
        return response["concept_id"]
    
    async def get_concept(self, concept_id: str) -> Optional[Concept]:
        """
        Retrieve a specific concept by ID.
        
        Args:
            concept_id: The UUID of the concept to retrieve
            
        Returns:
            The concept if found, None otherwise
        """
        try:
            response = await self._request("GET", f"/concepts/{concept_id}")
            if response.get("concept"):
                concept_data = response["concept"]
                return Concept(**concept_data)
            return None
        except LeafMindError as e:
            if "not found" in str(e).lower():
                return None
            raise
    
    async def list_concepts(self, page: int = 1, page_size: int = 50) -> Dict[str, Any]:
        """
        List all concepts with pagination.
        
        Args:
            page: Page number (1-indexed)
            page_size: Number of concepts per page
            
        Returns:
            Dictionary with concepts list, pagination info
        """
        params = {"page": page, "page_size": page_size}
        return await self._request("GET", f"/concepts?page={page}&page_size={page_size}")
    
    async def delete_concept(self, concept_id: str) -> bool:
        """
        Delete a concept.
        
        Args:
            concept_id: The UUID of the concept to delete
            
        Returns:
            True if deleted successfully
        """
        try:
            await self._request("DELETE", f"/concepts/{concept_id}")
            return True
        except LeafMindError as e:
            if "not found" in str(e).lower():
                return False
            raise
    
    async def access_concept(self, concept_id: str) -> bool:
        """
        Access a concept (update access time and count).
        
        Args:
            concept_id: The UUID of the concept to access
            
        Returns:
            True if accessed successfully
        """
        try:
            await self._request("POST", f"/concepts/{concept_id}/access")
            return True
        except LeafMindError as e:
            if "not found" in str(e).lower():
                return False
            raise
    
    # Association Operations
    async def associate(self, from_concept_id: str, to_concept_id: str, bidirectional: bool = False) -> bool:
        """
        Create an association between two concepts.
        
        Args:
            from_concept_id: Source concept UUID
            to_concept_id: Target concept UUID
            bidirectional: Whether to create a bidirectional association
            
        Returns:
            True if association created successfully
        """
        request_data = {
            "from_concept_id": from_concept_id,
            "to_concept_id": to_concept_id,
            "bidirectional": bidirectional
        }
        response = await self._request("POST", "/associations", request_data)
        return response.get("edge_created", False)
    
    async def remove_association(self, from_concept_id: str, to_concept_id: str) -> bool:
        """
        Remove an association between two concepts.
        
        Args:
            from_concept_id: Source concept UUID
            to_concept_id: Target concept UUID
            
        Returns:
            True if association removed successfully
        """
        try:
            await self._request("DELETE", f"/associations/{from_concept_id}/{to_concept_id}")
            return True
        except LeafMindError as e:
            if "not found" in str(e).lower():
                return False
            raise
    
    # Recall Operations
    async def recall_from_concept(
        self, 
        concept_id: str, 
        query: Optional[RecallQuery] = None
    ) -> List[RecallResult]:
        """
        Recall memories starting from a specific concept.
        
        Args:
            concept_id: The UUID of the source concept
            query: Optional recall query configuration
            
        Returns:
            List of recall results
        """
        if query is None:
            query = RecallQuery()
            
        request_data = {
            "source_concept_id": concept_id,
            "max_results": query.max_results,
            "min_relevance": query.min_relevance,
            "use_recency_boost": query.use_recency_boost,
            "exploration_breadth": query.exploration_breadth,
            "max_path_length": query.max_path_length
        }
        
        response = await self._request("POST", "/recall", request_data)
        return [
            RecallResult(
                concept=Concept(**result["concept"]),
                relevance_score=result["relevance_score"],
                path_length=result["path_length"],
                connection_strength=result["connection_strength"]
            )
            for result in response["results"]
        ]
    
    async def recall_by_content(
        self, 
        content_query: str, 
        query: Optional[RecallQuery] = None
    ) -> List[RecallResult]:
        """
        Recall memories by content similarity.
        
        Args:
            content_query: Text to search for
            query: Optional recall query configuration
            
        Returns:
            List of recall results
        """
        if query is None:
            query = RecallQuery()
            
        request_data = {
            "content_query": content_query,
            "max_results": query.max_results,
            "min_relevance": query.min_relevance,
            "use_recency_boost": query.use_recency_boost,
            "exploration_breadth": query.exploration_breadth,
            "max_path_length": query.max_path_length
        }
        
        response = await self._request("POST", "/recall/content", request_data)
        return [
            RecallResult(
                concept=Concept(**result["concept"]),
                relevance_score=result["relevance_score"],
                path_length=result["path_length"],
                connection_strength=result["connection_strength"]
            )
            for result in response["results"]
        ]
    
    async def spreading_activation_recall(self, concept_id: str) -> List[RecallResult]:
        """
        Perform spreading activation recall from a concept.
        
        Args:
            concept_id: The UUID of the source concept
            
        Returns:
            List of recall results
        """
        request_data = {"source_concept_id": concept_id}
        response = await self._request("POST", "/recall/spreading", request_data)
        return [
            RecallResult(
                concept=Concept(**result["concept"]),
                relevance_score=result["relevance_score"],
                path_length=result["path_length"],
                connection_strength=result["connection_strength"]
            )
            for result in response["results"]
        ]
    
    # Memory Management
    async def consolidate_memory(self) -> Dict[str, Any]:
        """Consolidate memory (move short-term to long-term)."""
        return await self._request("POST", "/memory/consolidate")
    
    async def forget_memories(self) -> Dict[str, Any]:
        """Forget weak memories (cleanup)."""
        return await self._request("POST", "/memory/forget")
    
    async def optimize_memory(self) -> Dict[str, Any]:
        """Optimize memory (consolidate + forget)."""
        return await self._request("POST", "/memory/optimize")
    
    # Persistence Operations
    async def save_to_disk(self) -> Dict[str, Any]:
        """Save current memory state to disk."""
        request_data = {"action": "Save"}
        return await self._request("POST", "/persistence", request_data)
    
    async def load_from_disk(self) -> Dict[str, Any]:
        """Load memory state from disk."""
        request_data = {"action": "Load"}
        return await self._request("POST", "/persistence", request_data)
    
    async def backup_database(self, backup_path: str) -> Dict[str, Any]:
        """Create a backup of the database."""
        request_data = {"action": {"Backup": {"path": backup_path}}}
        return await self._request("POST", "/persistence", request_data)
    
    async def restore_database(self, backup_path: str) -> Dict[str, Any]:
        """Restore database from a backup."""
        request_data = {"action": {"Restore": {"path": backup_path}}}
        return await self._request("POST", "/persistence", request_data)
    
    async def optimize_storage(self) -> Dict[str, Any]:
        """Optimize database storage."""
        request_data = {"action": "Optimize"}
        return await self._request("POST", "/persistence", request_data)
    
    async def get_persistence_stats(self) -> Optional[Dict[str, Any]]:
        """Get persistence statistics."""
        return await self._request("GET", "/persistence/stats")
    
    # Batch Operations
    async def batch_learn(self, concepts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Learn multiple concepts in a batch.
        
        Args:
            concepts: List of concept dictionaries with 'content' and optional 'metadata'
            
        Returns:
            List of responses for each concept
        """
        return await self._request("POST", "/batch/learn", concepts)
    
    async def batch_associate(self, associations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Create multiple associations in a batch.
        
        Args:
            associations: List of association dictionaries
            
        Returns:
            List of responses for each association
        """
        return await self._request("POST", "/batch/associate", associations)


class LeafMindError(Exception):
    """Exception raised for LeafMind API errors."""
    pass


# Convenience functions for common patterns
async def quick_learn_and_associate(
    client: LeafMindClient, 
    concepts: List[str], 
    create_associations: bool = True
) -> List[str]:
    """
    Quickly learn multiple concepts and optionally create associations between them.
    
    Args:
        client: LeafMind client instance
        concepts: List of concept contents to learn
        create_associations: Whether to create bidirectional associations between all concepts
        
    Returns:
        List of concept IDs
    """
    # Learn all concepts
    concept_ids = []
    for content in concepts:
        concept_id = await client.learn(content)
        concept_ids.append(concept_id)
    
    # Create associations if requested
    if create_associations and len(concept_ids) > 1:
        for i, from_id in enumerate(concept_ids):
            for j, to_id in enumerate(concept_ids):
                if i != j:
                    await client.associate(from_id, to_id, bidirectional=False)
    
    return concept_ids


async def build_knowledge_graph(
    client: LeafMindClient, 
    knowledge_pairs: List[tuple]
) -> Dict[str, str]:
    """
    Build a knowledge graph from concept pairs.
    
    Args:
        client: LeafMind client instance
        knowledge_pairs: List of (concept1, concept2) tuples to associate
        
    Returns:
        Dictionary mapping concept content to concept IDs
    """
    concept_map = {}
    
    # Learn all unique concepts
    all_concepts = set()
    for concept1, concept2 in knowledge_pairs:
        all_concepts.add(concept1)
        all_concepts.add(concept2)
    
    for concept in all_concepts:
        concept_id = await client.learn(concept)
        concept_map[concept] = concept_id
    
    # Create associations
    for concept1, concept2 in knowledge_pairs:
        await client.associate(
            concept_map[concept1], 
            concept_map[concept2], 
            bidirectional=True
        )
    
    return concept_map