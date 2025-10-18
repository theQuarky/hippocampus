use leafmind::{HybridServer, HybridConfig};
use tracing::{info, Level};
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    info!("🧠 Starting LeafMind Hybrid Server (gRPC + WebSocket)");

    // Create hybrid server configuration
    let config = HybridConfig {
        grpc_host: "127.0.0.1".to_string(),
        grpc_port: 50051,
        websocket_host: "127.0.0.1".to_string(),
        websocket_port: 8080,
        max_connections: 10000,
        ping_interval: std::time::Duration::from_secs(30),
        pong_timeout: std::time::Duration::from_secs(10),
        max_message_size: 1024 * 1024,
        enable_compression: true,
    };

    // Create memory system - for now using dummy Arc (server creates its own)
    let dummy_memory = std::sync::Arc::new(42u32) as std::sync::Arc<dyn std::any::Any + Send + Sync>;

    // Create and start hybrid server
    let server = HybridServer::new(dummy_memory, config).await?;
    
    info!("🚀 Hybrid Server starting:");
    info!("  📡 gRPC service on {}:{}", server.config().grpc_host, server.config().grpc_port);
    info!("  🌐 WebSocket service on {}:{}", server.config().websocket_host, server.config().websocket_port);
    info!("  🔄 Real-time streaming enabled");
    info!("  ⚡ Bidirectional communication ready");
    
    server.start().await?;

    Ok(())
}