# 🌐 LeafMind REST API Documentation

LeafMind provides a comprehensive REST API that allows you to use the neuromorphic memory system as a database from any programming language. This document describes all available endpoints, request/response formats, and usage examples.

## 📋 Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [Core Endpoints](#core-endpoints)
4. [Memory Management](#memory-management)
5. [Persistence Operations](#persistence-operations) 
6. [Batch Operations](#batch-operations)
7. [Client SDKs](#client-sdks)
8. [Error Handling](#error-handling)
9. [Examples](#examples)

## 🚀 Getting Started

### Starting the Server

```bash
# Start with default settings (database: ./leafmind_db, host: 127.0.0.1, port: 8080)
cargo run --bin leafmind-server

# Start with custom settings
cargo run --bin leafmind-server -- /path/to/database 0.0.0.0 9000

# Or after installation
leafmind-server /path/to/database 127.0.0.1 8080
```

### Base URL

All API endpoints are relative to the base URL where your LeafMind server is running:

```
http://localhost:8080  (default)
```

### Content Type

All requests should use `Content-Type: application/json` for POST requests.

## 🔐 Authentication

LeafMind supports optional API key authentication:

```bash
# Start server with authentication
LEAFMIND_API_KEY=your-secret-key cargo run --bin leafmind-server
```

Include the API key in requests:

```bash
curl -H "Authorization: Bearer your-secret-key" http://localhost:8080/health
```

## 🎯 Core Endpoints

### Health and Status

#### `GET /health`
Check server health and get basic statistics.

**Response:**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime_seconds": 3600,
  "memory_stats": {
    "total_concepts": 150,
    "short_term_connections": 45,
    "long_term_connections": 89,
    "working_memory_size": 12,
    "last_consolidation": "2024-01-15T10:30:00Z"
  },
  "persistence_stats": {
    "total_keys": 284,
    "total_size_bytes": 1048576,
    "cache_hit_rate": 0.85
  }
}
```

#### `GET /stats`
Get detailed memory system statistics.

**Response:**
```json
{
  "total_concepts": 150,
  "short_term_connections": 45,
  "long_term_connections": 89,
  "working_memory_size": 12,
  "last_consolidation": "2024-01-15T10:30:00Z"
}
```

### Concept Operations

#### `POST /concepts`
Learn a new concept.

**Request:**
```json
{
  "content": "Python is a high-level programming language",
  "metadata": {
    "type": "programming_language",
    "paradigm": "object_oriented"
  }
}
```

**Response:**
```json
{
  "concept_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Concept learned successfully"
}
```

#### `GET /concepts/{id}`
Retrieve a specific concept.

**Response:**
```json
{
  "concept": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "content": "Python is a high-level programming language",
    "metadata": {
      "type": "programming_language",
      "paradigm": "object_oriented"
    },
    "created_at": "2024-01-15T10:00:00Z",
    "last_accessed": "2024-01-15T10:30:00Z",
    "access_count": 5
  }
}
```

#### `GET /concepts`
List all concepts with pagination.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `page_size` (optional): Items per page (default: 50, max: 1000)

**Response:**
```json
{
  "concepts": [
    "550e8400-e29b-41d4-a716-446655440000",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
  ],
  "total_count": 150,
  "page": 1,
  "page_size": 50
}
```

#### `DELETE /concepts/{id}`
Delete a concept.

**Response:** `204 No Content` (success) or `404 Not Found`

#### `POST /concepts/{id}/access`
Access a concept (update access time and count).

**Response:** `200 OK` (success) or `404 Not Found`

### Association Operations

#### `POST /associations`
Create an association between concepts.

**Request:**
```json
{
  "from_concept_id": "550e8400-e29b-41d4-a716-446655440000",
  "to_concept_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "bidirectional": true
}
```

**Response:**
```json
{
  "message": "Bidirectional association created successfully",
  "edge_created": true
}
```

#### `DELETE /associations/{from_id}/{to_id}`
Remove an association between concepts.

**Response:** `204 No Content` (success) or `404 Not Found`

### Recall Operations

#### `POST /recall`
Recall memories from a source concept or by content.

**Request (from concept):**
```json
{
  "source_concept_id": "550e8400-e29b-41d4-a716-446655440000",
  "max_results": 10,
  "min_relevance": 0.1,
  "use_recency_boost": true,
  "exploration_breadth": 5,
  "max_path_length": 3
}
```

**Request (by content):**
```json
{
  "content_query": "programming language",
  "max_results": 10,
  "min_relevance": 0.2
}
```

**Response:**
```json
{
  "results": [
    {
      "concept": {
        "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        "content": "Machine learning uses algorithms to find patterns",
        "metadata": {},
        "created_at": "2024-01-15T09:00:00Z",
        "last_accessed": "2024-01-15T10:15:00Z",
        "access_count": 3
      },
      "relevance_score": 0.85,
      "path_length": 2,
      "connection_strength": 0.72
    }
  ],
  "query_info": {
    "total_results": 5,
    "query_time_ms": 15,
    "source_concept": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "content": "Python is a high-level programming language",
      "metadata": {"type": "programming_language"},
      "created_at": "2024-01-15T10:00:00Z",
      "last_accessed": "2024-01-15T10:30:00Z",
      "access_count": 5
    }
  }
}
```

#### `POST /recall/content`
Recall memories by content similarity (alternative endpoint).

Same as `POST /recall` with `content_query` field.

#### `POST /recall/spreading`
Perform spreading activation recall.

**Request:**
```json
{
  "source_concept_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:** Same format as `/recall` endpoint.

## 🧠 Memory Management

#### `POST /memory/consolidate`
Consolidate memory (move short-term to long-term).

**Response:**
```json
{
  "message": "Memory consolidation completed",
  "consolidated_connections": 12
}
```

#### `POST /memory/forget`
Forget weak memories (cleanup).

**Response:**
```json
{
  "message": "Memory forgetting completed", 
  "forgotten_connections": 8
}
```

#### `POST /memory/optimize`
Optimize memory (consolidate + forget).

**Response:**
```json
{
  "message": "Memory optimization completed",
  "consolidated_connections": 12,
  "forgotten_connections": 8
}
```

## 💾 Persistence Operations

#### `POST /persistence`
Handle persistence operations.

**Save to disk:**
```json
{
  "action": "Save"
}
```

**Load from disk:**
```json
{
  "action": "Load" 
}
```

**Create backup:**
```json
{
  "action": {
    "Backup": {
      "path": "/path/to/backup"
    }
  }
}
```

**Restore from backup:**
```json
{
  "action": {
    "Restore": {
      "path": "/path/to/backup"
    }
  }
}
```

**Optimize storage:**
```json
{
  "action": "Optimize"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Data saved successfully",
  "stats": {
    "total_keys": 284,
    "total_size_bytes": 1048576,
    "cache_hit_rate": 0.85
  }
}
```

#### `GET /persistence/stats`
Get persistence statistics.

**Response:**
```json
{
  "total_keys": 284,
  "total_size_bytes": 1048576,
  "cache_hit_rate": 0.85,
  "write_throughput": 1250.5,
  "read_throughput": 8932.1
}
```

## ⚡ Batch Operations

#### `POST /batch/learn`
Learn multiple concepts in batch.

**Request:**
```json
[
  {
    "content": "Concept 1",
    "metadata": {"type": "example"}
  },
  {
    "content": "Concept 2", 
    "metadata": {"type": "example"}
  }
]
```

**Response:**
```json
[
  {
    "concept_id": "550e8400-e29b-41d4-a716-446655440000",
    "message": "Concept learned successfully"
  },
  {
    "concept_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8", 
    "message": "Concept learned successfully"
  }
]
```

#### `POST /batch/associate`
Create multiple associations in batch.

**Request:**
```json
[
  {
    "from_concept_id": "550e8400-e29b-41d4-a716-446655440000",
    "to_concept_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "bidirectional": true
  }
]
```

**Response:**
```json
[
  {
    "message": "Association created successfully",
    "edge_created": true
  }
]
```

## 📚 Client SDKs

### Python Client

Install dependencies:
```bash
pip install aiohttp
```

Usage:
```python
from leafmind_client import LeafMindClient

async with LeafMindClient("http://localhost:8080") as client:
    # Learn concepts
    concept_id = await client.learn("Hello from Python")
    
    # Recall memories
    results = await client.recall_from_concept(concept_id)
    for result in results:
        print(f"Recalled: {result.concept.content}")
```

### JavaScript/Node.js Client

Install dependencies:
```bash
npm install node-fetch
```

Usage:
```javascript
import { LeafMindClient } from './leafmind-client.js';

const client = new LeafMindClient('http://localhost:8080');

// Learn and recall
const conceptId = await client.learn('Hello from JavaScript');
const results = await client.recallFromConcept(conceptId);
results.forEach(result => {
    console.log(`Recalled: ${result.concept.content}`);
});
```

### HTTP Clients (curl, etc.)

```bash
# Learn a concept
curl -X POST http://localhost:8080/concepts \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello from curl"}'

# Recall memories
curl -X POST http://localhost:8080/recall \
  -H "Content-Type: application/json" \
  -d '{"content_query": "hello", "max_results": 5}'
```

## ❌ Error Handling

All errors return appropriate HTTP status codes and JSON error responses:

```json
{
  "error": "Concept not found",
  "code": 404,
  "details": "No concept found with ID: 550e8400-e29b-41d4-a716-446655440000"
}
```

**Common Status Codes:**
- `200 OK`: Success
- `201 Created`: Resource created
- `204 No Content`: Success with no response body
- `400 Bad Request`: Invalid request data
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## 🎯 Examples

### Building a Knowledge Graph

```bash
# Learn concepts
PYTHON_ID=$(curl -X POST http://localhost:8080/concepts \
  -H "Content-Type: application/json" \
  -d '{"content": "Python programming language"}' | jq -r .concept_id)

ML_ID=$(curl -X POST http://localhost:8080/concepts \
  -H "Content-Type: application/json" \
  -d '{"content": "Machine Learning"}' | jq -r .concept_id)

# Create association
curl -X POST http://localhost:8080/associations \
  -H "Content-Type: application/json" \
  -d "{\"from_concept_id\": \"$PYTHON_ID\", \"to_concept_id\": \"$ML_ID\", \"bidirectional\": true}"

# Recall related concepts
curl -X POST http://localhost:8080/recall \
  -H "Content-Type: application/json" \
  -d "{\"source_concept_id\": \"$PYTHON_ID\", \"max_results\": 10}"
```

### Cross-Language Usage Examples

**PHP:**
```php
$data = json_encode(['content' => 'Hello from PHP']);
$context = stream_context_create([
  'http' => [
    'method' => 'POST',
    'header' => 'Content-Type: application/json',
    'content' => $data
  ]
]);
$response = file_get_contents('http://localhost:8080/concepts', false, $context);
$result = json_decode($response, true);
echo "Concept ID: " . $result['concept_id'];
```

**Go:**
```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

func main() {
    data := map[string]string{"content": "Hello from Go"}
    jsonData, _ := json.Marshal(data)
    
    resp, _ := http.Post("http://localhost:8080/concepts", 
        "application/json", bytes.NewBuffer(jsonData))
    defer resp.Body.Close()
    
    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    fmt.Println("Concept ID:", result["concept_id"])
}
```

**Ruby:**
```ruby
require 'net/http'
require 'json'

uri = URI('http://localhost:8080/concepts')
http = Net::HTTP.new(uri.host, uri.port)
request = Net::HTTP::Post.new(uri)
request['Content-Type'] = 'application/json'
request.body = {content: 'Hello from Ruby'}.to_json

response = http.request(request)
result = JSON.parse(response.body)
puts "Concept ID: #{result['concept_id']}"
```

**C# (.NET):**
```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

class Program
{
    static async Task Main()
    {
        var client = new HttpClient();
        var data = new { content = "Hello from C#" };
        var json = JsonConvert.SerializeObject(data);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        
        var response = await client.PostAsync("http://localhost:8080/concepts", content);
        var result = await response.Content.ReadAsStringAsync();
        Console.WriteLine(result);
    }
}
```

## 🔧 Configuration

Server configuration can be customized via command line arguments:

```bash
# Syntax: leafmind-server [database_path] [host] [port]
leafmind-server /path/to/db 0.0.0.0 8080
```

**Parameters:**
- `database_path`: Path to RocksDB database directory (default: `./leafmind_db`)
- `host`: Server bind address (default: `127.0.0.1`)
- `port`: Server port (default: `8080`)

**Advanced Configuration:**
- Auto-save is enabled with 30-second intervals by default
- Compression is enabled for storage efficiency
- Cache size is set to 128MB by default
- CORS is enabled for web browser access

## 🚀 Performance Tips

1. **Use Batch Operations**: For multiple operations, use `/batch/learn` and `/batch/associate` endpoints
2. **Optimize Recall Queries**: Set appropriate `max_results` and `min_relevance` values
3. **Memory Management**: Periodically call `/memory/optimize` for cleanup
4. **Persistence**: Use `/persistence` with `"Save"` action to persist important changes
5. **Connection Pooling**: Reuse HTTP connections when making multiple requests

## 🔒 Security Considerations

1. **API Keys**: Use authentication in production environments
2. **Network Security**: Run behind reverse proxy (nginx, Apache) with HTTPS
3. **Rate Limiting**: Implement rate limiting at the reverse proxy level
4. **Validation**: All inputs are validated, but sanitize data before storage
5. **Access Control**: Restrict network access to trusted clients only

## 📊 Monitoring

Monitor your LeafMind server using:

1. **Health Endpoint**: Regular `/health` checks for uptime monitoring
2. **Statistics**: `/stats` and `/persistence/stats` for performance metrics
3. **Logs**: Server logs provide detailed operation information
4. **Resource Usage**: Monitor CPU, memory, and disk usage of the server process

For production deployment, consider using monitoring tools like Prometheus, Grafana, or similar solutions.