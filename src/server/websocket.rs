// WebSocket layer for real-time LeafMind memory updates
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tokio::net::{TcpListener, TcpStream};
use futures_util::{SinkExt, StreamExt};
use serde_json;
use std::sync::Arc;
use uuid::Uuid;

use super::grpc::{LeafMindGrpcServer, ServerConfig};

#[derive(Debug, Clone)]
pub struct HybridConfig {
    pub grpc_host: String,
    pub grpc_port: u16,
    pub websocket_host: String,
    pub websocket_port: u16,
    pub max_connections: usize,
    pub ping_interval: std::time::Duration,
    pub pong_timeout: std::time::Duration,
    pub max_message_size: usize,
    pub enable_compression: bool,
}

impl Default for HybridConfig {
    fn default() -> Self {
        Self {
            grpc_host: "127.0.0.1".to_string(),
            grpc_port: 50051,
            websocket_host: "127.0.0.1".to_string(),
            websocket_port: 8080,
            max_connections: 10000,
            ping_interval: std::time::Duration::from_secs(30),
            pong_timeout: std::time::Duration::from_secs(10),
            max_message_size: 1024 * 1024,
            enable_compression: true,
        }
    }
}

pub struct HybridServer {
    config: HybridConfig,
    #[allow(dead_code)]
    grpc_server: Option<Arc<LeafMindGrpcServer>>,
    #[allow(dead_code)]
    websocket_server: Option<WebSocketServer>,
}

impl HybridServer {
    pub async fn new(_memory: Arc<dyn std::any::Any + Send + Sync>, config: HybridConfig) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Self {
            config,
            grpc_server: None,
            websocket_server: None,
        })
    }
    
    pub fn config(&self) -> &HybridConfig {
        &self.config
    }
    
    pub async fn start(self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("🚀 Starting Hybrid Server (gRPC + WebSocket)");
        println!("  📡 gRPC: {}:{}", self.config.grpc_host, self.config.grpc_port);
        println!("  🌐 WebSocket: {}:{}", self.config.websocket_host, self.config.websocket_port);
        
        // Create a dummy gRPC server for WebSocket integration
        // In a real implementation, this would be a proper gRPC server
        use crate::MemoryGraphFactory;
        
        let memory = MemoryGraphFactory::create_high_performance().await?;
        let memory_any = Arc::new(memory) as Arc<dyn std::any::Any + Send + Sync>;
        
        let config = ServerConfig {
            host: self.config.grpc_host.clone(),
            port: self.config.grpc_port,
            max_concurrent_streams: 1000,
            max_message_size: self.config.max_message_size,
            keepalive_time: self.config.ping_interval,
            keepalive_timeout: self.config.pong_timeout,
            enable_reflection: true,
        };
        
        let grpc_server = Arc::new(LeafMindGrpcServer::new(memory_any, config).await?);
        
        // Create and start WebSocket server
        let ws_server = WebSocketServer::new(grpc_server, self.config.websocket_port);
        
        println!("Hybrid server started successfully");
        
        // Start the WebSocket server (this will run indefinitely)
        ws_server.start().await
    }
}

pub struct WebSocketServer {
    grpc_server: Arc<LeafMindGrpcServer>,
    port: u16,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct WebSocketMessage {
    pub message_type: String,
    pub payload: serde_json::Value,
    pub timestamp: i64,
    pub client_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ConceptLearnMessage {
    pub content: String,
    pub metadata: Option<std::collections::HashMap<String, String>>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AssociationMessage {
    pub from_concept_id: String,
    pub to_concept_id: String,
    pub strength: f64,
    pub bidirectional: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct RecallMessage {
    pub query: String,
    pub max_results: u32,
    pub min_relevance: f64,
}

impl WebSocketServer {
    pub fn new(grpc_server: Arc<LeafMindGrpcServer>, port: u16) -> Self {
        Self {
            grpc_server,
            port,
        }
    }
    
    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let addr = format!("127.0.0.1:{}", self.port);
        println!("🔧 Attempting to bind to address: {}", addr);
        
        let listener = TcpListener::bind(&addr).await?;
        println!("✅ Successfully bound to address: {}", addr);
        
        println!("🌐 LeafMind WebSocket Server listening on ws://{}", addr);
        println!("🔄 Entering accept loop...");
        
        loop {
            println!("⏳ Waiting for connection...");
            match listener.accept().await {
                Ok((stream, peer_addr)) => {
                    let grpc_server = self.grpc_server.clone();
                    println!("New WebSocket connection from: {}", peer_addr);
                    
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_connection(stream, grpc_server).await {
                            eprintln!("WebSocket connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    eprintln!("Error accepting WebSocket connection: {}", e);
                    // Continue listening for new connections instead of breaking
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    }
    
    async fn handle_connection(
        stream: TcpStream,
        grpc_server: Arc<LeafMindGrpcServer>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("🤝 Starting WebSocket handshake...");
        let ws_stream = accept_async(stream).await?;
        println!("✅ WebSocket handshake completed successfully");
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();
        
        let client_id = Uuid::new_v4().to_string();
        println!("👤 Created client ID: {}", client_id);
        let (tx, mut rx) = tokio::sync::mpsc::channel(128);
        
        // Register this WebSocket connection for updates
        {
            let mut connections = grpc_server.get_websocket_connections().write().await;
            connections.insert(client_id.clone(), tx);
            println!("📋 Registered client {} in connection map", client_id);
        }
        
        // Handle incoming WebSocket messages
        let grpc_server_clone = grpc_server.clone();
        let client_id_clone = client_id.clone();
        let client_id_for_outgoing = client_id.clone();
        let incoming_task = tokio::spawn(async move {
            while let Some(msg) = ws_receiver.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        if let Err(e) = Self::handle_incoming_message(
                            &text, 
                            &grpc_server_clone,
                            &client_id_clone
                        ).await {
                            eprintln!("Error handling WebSocket message: {}", e);
                        }
                    }
                    Ok(Message::Close(_)) => {
                        println!("WebSocket client {} disconnected", client_id_clone);
                        break;
                    }
                    Err(e) => {
                        eprintln!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        });
        
        // Handle outgoing updates to this WebSocket client
        let outgoing_task = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                let ws_message = WebSocketMessage {
                    message_type: "memory_update".to_string(),
                    payload: serde_json::json!({
                        "event_type": "concept_update",
                        "concept_id": event.concept_id.map(|id| id.uuid).unwrap_or_default(),
                        "event_data": "update_notification"
                    }),
                    timestamp: chrono::Utc::now().timestamp(),
                    client_id: Some(client_id_for_outgoing.clone()),
                };
                
                let message_text = serde_json::to_string(&ws_message).unwrap_or_default();
                if ws_sender.send(Message::Text(message_text)).await.is_err() {
                    break; // Client disconnected
                }
            }
        });
        
        // Wait for either task to complete
        tokio::select! {
            _ = incoming_task => {},
            _ = outgoing_task => {},
        }
        
        // Clean up the connection
        {
            let mut connections = grpc_server.get_websocket_connections().write().await;
            connections.remove(&client_id);
            println!("🧹 Cleaned up client {} from connection map", client_id);
        }
        
        println!("👋 Connection handler finished for client {}", client_id);
        Ok(())
    }
    
    async fn handle_incoming_message(
        text: &str,
        grpc_server: &LeafMindGrpcServer,
        client_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let ws_message: WebSocketMessage = serde_json::from_str(text)?;
        
        match ws_message.message_type.as_str() {
            "learn_concept" => {
                let learn_msg: ConceptLearnMessage = serde_json::from_value(ws_message.payload)?;
                
                // Use the gRPC server's memory directly
                let memory = grpc_server.get_memory().read().await;
                let concept_id = memory.learn(learn_msg.content);
                
                println!("Learned concept via WebSocket: {:?} for client {}", concept_id, client_id);
            }
            
            "create_association" => {
                let assoc_msg: AssociationMessage = serde_json::from_value(ws_message.payload)?;
                
                let from_uuid = Uuid::parse_str(&assoc_msg.from_concept_id)?;
                let to_uuid = Uuid::parse_str(&assoc_msg.to_concept_id)?;
                
                let memory = grpc_server.get_memory().read().await;
                let from_id = crate::types::ConceptId(from_uuid);
                let to_id = crate::types::ConceptId(to_uuid);
                
                memory.associate(from_id, to_id)?;
                
                println!("Created association via WebSocket for client {}", client_id);
            }
            
            "recall_memory" => {
                let recall_msg: RecallMessage = serde_json::from_value(ws_message.payload)?;
                
                // TODO: Implement recall via WebSocket
                println!("Recall request via WebSocket: {} for client {}", recall_msg.query, client_id);
            }
            
            "subscribe_concept" => {
                // Client wants to subscribe to updates for specific concepts
                let concept_id: String = serde_json::from_value(ws_message.payload)?;
                println!("Client {} subscribed to concept {}", client_id, concept_id);
            }
            
            _ => {
                println!("Unknown WebSocket message type: {}", ws_message.message_type);
            }
        }
        
        Ok(())
    }
}

// Example usage (this would be in a separate binary)
/*
#[tokio::main]
pub async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use crate::MemoryGraphFactory;
    
    let memory = MemoryGraphFactory::create_high_performance().await?;
    let config = HybridConfig::default();
    let hybrid_server = HybridServer::new(memory, config).await?;
    hybrid_server.start().await
}
*/