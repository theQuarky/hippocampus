// LeafMind gRPC server implementation with WebSocket support
use tonic::{transport::Server, Request, Response, Status, Streaming};
use tokio::sync::{broadcast, RwLock};
use tokio_stream::{wrappers::ReceiverStream, StreamExt};
use std::sync::Arc;
use std::collections::HashMap;
use uuid::Uuid;

// Generated protobuf code
pub mod leafmind {
    tonic::include_proto!("leafmind.v1");
}

use leafmind::{
    leaf_mind_service_server::{LeafMindService, LeafMindServiceServer},
    *,
};

// Import our existing memory system (once compilation issues are fixed)
use crate::{
    memory_graph::MemoryGraph,
    types::{Concept as MemoryConcept, ConceptId as MemoryConceptId},
};

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub max_concurrent_streams: u32,
    pub max_message_size: usize,
    pub keepalive_time: std::time::Duration,
    pub keepalive_timeout: std::time::Duration,
    pub enable_reflection: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 50051,
            max_concurrent_streams: 1000,
            max_message_size: 4 * 1024 * 1024,
            keepalive_time: std::time::Duration::from_secs(30),
            keepalive_timeout: std::time::Duration::from_secs(5),
            enable_reflection: true,
        }
    }
}

pub struct LeafMindGrpcServer {
    memory: Arc<RwLock<MemoryGraph>>,
    config: ServerConfig,
    // Broadcast channel for real-time updates
    update_sender: broadcast::Sender<ConceptUpdateEvent>,
    // WebSocket connection manager
    websocket_connections: Arc<RwLock<HashMap<String, tokio::sync::mpsc::Sender<ConceptUpdateEvent>>>>,
}

impl LeafMindGrpcServer {
    pub async fn new(_memory: Arc<dyn std::any::Any + Send + Sync>, config: ServerConfig) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let (update_sender, _) = broadcast::channel(1000);
        
        Ok(Self {
            memory: Arc::new(RwLock::new(MemoryGraph::new_with_defaults())),
            config,
            update_sender,
            websocket_connections: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    pub fn config(&self) -> &ServerConfig {
        &self.config
    }
    
    // Public accessors for WebSocket server integration
    pub fn get_websocket_connections(&self) -> &Arc<RwLock<HashMap<String, tokio::sync::mpsc::Sender<ConceptUpdateEvent>>>> {
        &self.websocket_connections
    }
    
    pub fn get_memory(&self) -> &Arc<RwLock<MemoryGraph>> {
        &self.memory
    }
    
    pub async fn start(self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let addr = format!("{}:{}", self.config.host, self.config.port).parse()?;
        
        println!("🧠 LeafMind gRPC Server listening on {}", addr);
        
        Server::builder()
            .add_service(LeafMindServiceServer::new(self))
            .serve(addr)
            .await?;
            
        Ok(())
    }
    

    
    // Helper function to convert internal types to protobuf
    fn concept_to_proto(&self, concept: &MemoryConcept) -> Concept {
        Concept {
            id: Some(ConceptId {
                uuid: concept.id.0.to_string(),
            }),
            content: concept.content.clone(),
            created_at: concept.created_at.timestamp(),
            last_accessed: concept.last_accessed.timestamp(),
            access_count: concept.access_count,
            metadata: HashMap::new(), // TODO: Add metadata support
        }
    }
    
    // Helper function to broadcast updates to WebSocket clients
    async fn broadcast_update(&self, event: ConceptUpdateEvent) {
        // Broadcast to gRPC streaming clients
        let _ = self.update_sender.send(event.clone());
        
        // Send to WebSocket connections
        let connections = self.websocket_connections.read().await;
        for (_, sender) in connections.iter() {
            let _ = sender.send(event.clone()).await;
        }
    }
}

#[tonic::async_trait]
impl LeafMindService for LeafMindGrpcServer {
    async fn learn_concept(
        &self,
        request: Request<LearnConceptRequest>,
    ) -> Result<Response<LearnConceptResponse>, Status> {
        let req = request.into_inner();
        
        if req.content.trim().is_empty() {
            return Err(Status::invalid_argument("Content cannot be empty"));
        }
        
        let memory = self.memory.read().await;
        let concept_id = memory.learn(req.content.clone());
        
        let proto_id = ConceptId {
            uuid: concept_id.0.to_string(),
        };
        
        // Broadcast update event
        let update_event = ConceptUpdateEvent {
            update_type: concept_update_event::UpdateType::ConceptModified as i32,
            concept_id: Some(proto_id.clone()),
            updated_concept: None, // Could populate if needed
            updated_association: None,
            timestamp: chrono::Utc::now().timestamp(),
        };
        self.broadcast_update(update_event).await;
        
        Ok(Response::new(LearnConceptResponse {
            concept_id: Some(proto_id),
            message: "Concept learned successfully".to_string(),
            success: true,
        }))
    }
    
    async fn get_concept(
        &self,
        request: Request<GetConceptRequest>,
    ) -> Result<Response<GetConceptResponse>, Status> {
        let req = request.into_inner();
        
        let concept_id_str = req.concept_id
            .ok_or_else(|| Status::invalid_argument("Concept ID required"))?
            .uuid;
            
        let concept_uuid = Uuid::parse_str(&concept_id_str)
            .map_err(|_| Status::invalid_argument("Invalid UUID format"))?;
            
        let memory_concept_id = MemoryConceptId(concept_uuid);
        let memory = self.memory.read().await;
        
        match memory.get_concept(&memory_concept_id) {
            Some(concept) => {
                let proto_concept = self.concept_to_proto(&concept);
                
                Ok(Response::new(GetConceptResponse {
                    concept: Some(proto_concept),
                    associations: vec![], // TODO: Implement associations
                    found: true,
                }))
            }
            None => Ok(Response::new(GetConceptResponse {
                concept: None,
                associations: vec![],
                found: false,
            }))
        }
    }
    
    async fn list_concepts(
        &self,
        request: Request<ListConceptsRequest>,
    ) -> Result<Response<ListConceptsResponse>, Status> {
        let req = request.into_inner();
        let page = req.page.max(1);
        let page_size = req.page_size.min(100).max(1); // Limit page size
        
        let memory = self.memory.read().await;
        let all_ids = memory.get_all_concept_ids();
        
        let start = ((page - 1) * page_size) as usize;
        let end = (start + page_size as usize).min(all_ids.len());
        
        let mut concepts = Vec::new();
        for id in &all_ids[start..end] {
            if let Some(concept) = memory.get_concept(id) {
                concepts.push(self.concept_to_proto(&concept));
            }
        }
        
        Ok(Response::new(ListConceptsResponse {
            concepts,
            total_count: all_ids.len() as u32,
            page,
            page_size,
            has_more: end < all_ids.len(),
        }))
    }
    
    async fn access_concept(
        &self,
        request: Request<AccessConceptRequest>,
    ) -> Result<Response<AccessConceptResponse>, Status> {
        let req = request.into_inner();
        
        let concept_id_str = req.concept_id
            .ok_or_else(|| Status::invalid_argument("Concept ID required"))?
            .uuid;
            
        let concept_uuid = Uuid::parse_str(&concept_id_str)
            .map_err(|_| Status::invalid_argument("Invalid UUID format"))?;
            
        let memory_concept_id = MemoryConceptId(concept_uuid);
        let memory = self.memory.read().await;
        
        match memory.access_concept(&memory_concept_id) {
            Ok(()) => {
                if let Some(updated_concept) = memory.get_concept(&memory_concept_id) {
                    let proto_concept = self.concept_to_proto(&updated_concept);
                    
                    // Broadcast access event
                    let update_event = ConceptUpdateEvent {
                        update_type: concept_update_event::UpdateType::ConceptAccessed as i32,
                        concept_id: Some(ConceptId {
                            uuid: concept_id_str,
                        }),
                        updated_concept: Some(proto_concept.clone()),
                        updated_association: None,
                        timestamp: chrono::Utc::now().timestamp(),
                    };
                    self.broadcast_update(update_event).await;
                    
                    Ok(Response::new(AccessConceptResponse {
                        updated_concept: Some(proto_concept),
                        success: true,
                    }))
                } else {
                    Err(Status::not_found("Concept not found"))
                }
            }
            Err(e) => Err(Status::internal(format!("Access failed: {}", e))),
        }
    }
    
    async fn create_association(
        &self,
        request: Request<CreateAssociationRequest>,
    ) -> Result<Response<CreateAssociationResponse>, Status> {
        let req = request.into_inner();
        
        let from_uuid = Uuid::parse_str(&req.from_concept.unwrap().uuid)
            .map_err(|_| Status::invalid_argument("Invalid from concept UUID"))?;
        let to_uuid = Uuid::parse_str(&req.to_concept.unwrap().uuid)
            .map_err(|_| Status::invalid_argument("Invalid to concept UUID"))?;
            
        let from_id = MemoryConceptId(from_uuid);
        let to_id = MemoryConceptId(to_uuid);
        
        let memory = self.memory.read().await;
        
        match memory.associate(from_id.clone(), to_id.clone()) {
            Ok(()) => {
                // Create bidirectional if requested
                if req.bidirectional {
                    let _ = memory.associate(to_id.clone(), from_id.clone());
                }
                
                let association = Association {
                    from_concept: Some(ConceptId { uuid: from_uuid.to_string() }),
                    to_concept: Some(ConceptId { uuid: to_uuid.to_string() }),
                    strength: req.strength,
                    association_type: req.association_type.clone(),
                    created_at: chrono::Utc::now().timestamp(),
                    is_bidirectional: req.bidirectional,
                };
                
                // Broadcast association event
                let update_event = ConceptUpdateEvent {
                    update_type: concept_update_event::UpdateType::AssociationAdded as i32,
                    concept_id: Some(ConceptId { uuid: from_uuid.to_string() }),
                    updated_concept: None,
                    updated_association: Some(association.clone()),
                    timestamp: chrono::Utc::now().timestamp(),
                };
                self.broadcast_update(update_event).await;
                
                Ok(Response::new(CreateAssociationResponse {
                    success: true,
                    message: "Association created successfully".to_string(),
                    created_association: Some(association),
                }))
            }
            Err(e) => Err(Status::internal(format!("Association failed: {}", e))),
        }
    }
    
    async fn recall_memory(
        &self,
        request: Request<RecallRequest>,
    ) -> Result<Response<RecallResponse>, Status> {
        let _req = request.into_inner();
        
        // TODO: Implement recall using the existing recall module
        // This would need the compilation issues resolved first
        
        Ok(Response::new(RecallResponse {
            results: vec![],
            total_found: 0,
            query_time_ms: 0,
            source_concept_id: None,
        }))
    }
    
    // Streaming recall - sends results as they're found
    type StreamingRecallStream = ReceiverStream<Result<RecallResult, Status>>;
    
    async fn streaming_recall(
        &self,
        _request: Request<RecallRequest>,
    ) -> Result<Response<Self::StreamingRecallStream>, Status> {
        let (_tx, rx) = tokio::sync::mpsc::channel(128);
        
        // TODO: Implement streaming recall
        // This would progressively send results as they're discovered
        
        Ok(Response::new(ReceiverStream::new(rx)))
    }
    
    async fn get_memory_stats(
        &self,
        _request: Request<GetStatsRequest>,
    ) -> Result<Response<MemoryStatsResponse>, Status> {
        let memory = self.memory.read().await;
        let stats = memory.get_stats();
        
        Ok(Response::new(MemoryStatsResponse {
            total_concepts: stats.total_concepts as u64,
            short_term_concepts: stats.short_term_connections as u64,
            long_term_concepts: stats.long_term_connections as u64,
            total_associations: (stats.short_term_connections + stats.long_term_connections) as u64,
            short_term_associations: stats.short_term_connections as u64,
            long_term_associations: stats.long_term_connections as u64,
            memory_usage_bytes: 0, // TODO: Calculate actual memory usage
            consolidation_ratio: 0.0,
            persistence_stats: None,
        }))
    }
    
    async fn consolidate_memory(
        &self,
        _request: Request<ConsolidateRequest>,
    ) -> Result<Response<ConsolidateResponse>, Status> {
        let memory = self.memory.read().await;
        let stats = memory.force_consolidation();
        
        Ok(Response::new(ConsolidateResponse {
            concepts_consolidated: stats.promoted_to_long_term as u32,
            associations_strengthened: 0, // Field not available in ConsolidationStats
            consolidation_time_ms: 0, // TODO: Add timing
            success: true,
        }))
    }
    
    // Real-time bidirectional streaming
    type StreamMemoryUpdatesStream = ReceiverStream<Result<MemoryUpdateResponse, Status>>;
    
    async fn stream_memory_updates(
        &self,
        request: Request<Streaming<MemoryUpdateRequest>>,
    ) -> Result<Response<Self::StreamMemoryUpdatesStream>, Status> {
        let (_tx, rx) = tokio::sync::mpsc::channel(128);
        let mut stream = request.into_inner();
        
        // Handle incoming streaming requests
        tokio::spawn(async move {
            while let Some(result) = stream.next().await {
                match result {
                    Ok(_update_req) => {
                        // Process the update request and send response
                        // TODO: Implement based on update_type
                    }
                    Err(e) => {
                        eprintln!("Error in streaming updates: {}", e);
                        break;
                    }
                }
            }
        });
        
        Ok(Response::new(ReceiverStream::new(rx)))
    }
    
    // Watch concept changes
    type WatchConceptStream = ReceiverStream<Result<ConceptUpdateEvent, Status>>;
    
    async fn watch_concept(
        &self,
        request: Request<WatchConceptRequest>,
    ) -> Result<Response<Self::WatchConceptStream>, Status> {
        let req = request.into_inner();
        let (tx, rx) = tokio::sync::mpsc::channel(128);
        
        let concept_id = req.concept_id.unwrap().uuid;
        let mut update_receiver = self.update_sender.subscribe();
        
        // Filter updates for this specific concept
        tokio::spawn(async move {
            while let Ok(event) = update_receiver.recv().await {
                if let Some(event_concept_id) = &event.concept_id {
                    if event_concept_id.uuid == concept_id {
                        if tx.send(Ok(event)).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                }
            }
        });
        
        Ok(Response::new(ReceiverStream::new(rx)))
    }
    
    async fn get_associations(
        &self,
        request: Request<GetAssociationsRequest>,
    ) -> Result<Response<GetAssociationsResponse>, Status> {
        let req = request.into_inner();
        
        let concept_id_str = req.concept_id
            .ok_or_else(|| Status::invalid_argument("Concept ID required"))?
            .uuid;
            
        let concept_uuid = Uuid::parse_str(&concept_id_str)
            .map_err(|_| Status::invalid_argument("Invalid UUID format"))?;
            
        let _memory_concept_id = MemoryConceptId(concept_uuid);
        let _memory = self.memory.read().await;
        
        // Get associations for this concept
        // TODO: Implement proper association retrieval when memory graph supports it
        let associations = vec![]; // Placeholder
        
        Ok(Response::new(GetAssociationsResponse {
            associations,
            total_count: 0,
        }))
    }
    
    async fn health_check(
        &self,
        _request: Request<HealthCheckRequest>,
    ) -> Result<Response<HealthCheckResponse>, Status> {
        let memory = self.memory.read().await;
        let stats = memory.get_stats();
        
        let memory_stats = MemoryStatsResponse {
            total_concepts: stats.total_concepts as u64,
            short_term_concepts: stats.short_term_connections as u64, // Using connections as proxy
            long_term_concepts: stats.long_term_connections as u64,  // Using connections as proxy
            total_associations: (stats.short_term_connections + stats.long_term_connections) as u64,
            short_term_associations: stats.short_term_connections as u64,
            long_term_associations: stats.long_term_connections as u64,
            memory_usage_bytes: 0,
            consolidation_ratio: 0.0,
            persistence_stats: None,
        };
        
        Ok(Response::new(HealthCheckResponse {
            status: health_check_response::ServingStatus::Serving as i32,
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_seconds: 0, // TODO: Track uptime
            memory_stats: Some(memory_stats),
        }))
    }
}

// Server startup function - moved to binary entry points