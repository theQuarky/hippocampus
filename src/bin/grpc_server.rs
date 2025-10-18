use leafmind::{LeafMindGrpcServer, GrpcServerConfig};
use tracing::{info, Level};
use tracing_subscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .init();

    info!("🧠 Starting LeafMind gRPC Server");

    // Create server configuration
    let config = GrpcServerConfig {
        host: "127.0.0.1".to_string(),
        port: 50051,
        max_concurrent_streams: 1000,
        max_message_size: 4 * 1024 * 1024, // 4MB
        keepalive_time: std::time::Duration::from_secs(30),
        keepalive_timeout: std::time::Duration::from_secs(5),
        enable_reflection: true,
    };

    // Create memory system - for now using dummy Arc (server creates its own)
    let dummy_memory = std::sync::Arc::new(42u32) as std::sync::Arc<dyn std::any::Any + Send + Sync>;

    // Create and start gRPC server
    let server = LeafMindGrpcServer::new(dummy_memory, config).await?;
    
    info!("🚀 gRPC Server starting on {}:{}", server.config().host, server.config().port);
    info!("📡 Protocol Buffers service available");
    info!("🔄 Streaming operations enabled");
    
    server.start().await?;

    Ok(())
}