#!/bin/bash

# LeafMind API Examples using curl
# This script demonstrates how to use LeafMind as a database from any language
# that can make HTTP requests (including curl, PHP, Ruby, etc.)

echo "🧠 LeafMind API Demo using curl"
echo "================================"

# Configuration
API_URL="http://localhost:8080"
CONTENT_TYPE="Content-Type: application/json"

# Helper function to make pretty JSON output
pretty_json() {
    if command -v jq &> /dev/null; then
        echo "$1" | jq .
    else
        echo "$1"
    fi
}

# Helper function to make API requests
api_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -z "$data" ]; then
        response=$(curl -s -X "$method" "$API_URL$endpoint")
    else
        response=$(curl -s -X "$method" -H "$CONTENT_TYPE" -d "$data" "$API_URL$endpoint")
    fi
    
    echo "$response"
}

echo
echo "1. Checking server health..."
health_response=$(api_request "GET" "/health")
echo "Health Response:"
pretty_json "$health_response"

# Extract status from response (basic string parsing)
if [[ "$health_response" == *"healthy"* ]]; then
    echo "✅ Server is healthy"
else
    echo "❌ Server is not healthy"
    exit 1
fi

echo
echo "2. Learning new concepts..."

# Learn some concepts
learn_python='{"content": "Python is a versatile programming language", "metadata": {"type": "programming_language", "paradigm": "object_oriented"}}'
python_response=$(api_request "POST" "/concepts" "$learn_python")
python_id=$(echo "$python_response" | grep -o '"concept_id":"[^"]*"' | cut -d'"' -f4)
echo "Learned Python concept: $python_id"

learn_ai='{"content": "Artificial Intelligence involves machine learning and neural networks", "metadata": {"type": "technology", "field": "computer_science"}}'
ai_response=$(api_request "POST" "/concepts" "$learn_ai")
ai_id=$(echo "$ai_response" | grep -o '"concept_id":"[^"]*"' | cut -d'"' -f4)
echo "Learned AI concept: $ai_id"

learn_data='{"content": "Data science combines statistics, programming, and domain expertise", "metadata": {"type": "field", "skills": "statistics,programming"}}'
data_response=$(api_request "POST" "/concepts" "$learn_data")
data_id=$(echo "$data_response" | grep -o '"concept_id":"[^"]*"' | cut -d'"' -f4)
echo "Learned Data Science concept: $data_id"

echo
echo "3. Creating associations..."

# Associate Python with AI
associate_py_ai="{\"from_concept_id\": \"$python_id\", \"to_concept_id\": \"$ai_id\", \"bidirectional\": true}"
assoc_response1=$(api_request "POST" "/associations" "$associate_py_ai")
echo "Python <-> AI association: $(echo "$assoc_response1" | grep -o '"edge_created":[^,}]*' | cut -d':' -f2)"

# Associate AI with Data Science
associate_ai_data="{\"from_concept_id\": \"$ai_id\", \"to_concept_id\": \"$data_id\", \"bidirectional\": true}"
assoc_response2=$(api_request "POST" "/associations" "$associate_ai_data")
echo "AI <-> Data Science association: $(echo "$assoc_response2" | grep -o '"edge_created":[^,}]*' | cut -d':' -f2)"

# Associate Python with Data Science
associate_py_data="{\"from_concept_id\": \"$python_id\", \"to_concept_id\": \"$data_id\", \"bidirectional\": false}"
assoc_response3=$(api_request "POST" "/associations" "$associate_py_data")
echo "Python -> Data Science association: $(echo "$assoc_response3" | grep -o '"edge_created":[^,}]*' | cut -d':' -f2)"

echo
echo "4. Retrieving a specific concept..."
concept_response=$(api_request "GET" "/concepts/$python_id")
echo "Python concept details:"
pretty_json "$concept_response"

echo
echo "5. Recalling memories from Python concept..."
recall_request="{\"source_concept_id\": \"$python_id\", \"max_results\": 5, \"min_relevance\": 0.1}"
recall_response=$(api_request "POST" "/recall" "$recall_request")
echo "Recall results:"
pretty_json "$recall_response"

echo
echo "6. Content-based recall..."
content_recall='{"content_query": "programming", "max_results": 3}'
content_response=$(api_request "POST" "/recall/content" "$content_recall")
echo "Content recall results for 'programming':"
pretty_json "$content_response"

echo
echo "7. Memory consolidation..."
consolidate_response=$(api_request "POST" "/memory/consolidate")
echo "Consolidation result:"
pretty_json "$consolidate_response"

echo
echo "8. Getting memory statistics..."
stats_response=$(api_request "GET" "/stats")
echo "Memory statistics:"
pretty_json "$stats_response"

echo
echo "9. Saving to persistent storage..."
save_request='{"action": "Save"}'
save_response=$(api_request "POST" "/persistence" "$save_request")
echo "Save result:"
pretty_json "$save_response"

echo
echo "10. Batch learning example..."
batch_concepts='[
    {"content": "Machine Learning automates analytical model building", "metadata": {"type": "technology"}},
    {"content": "Deep Learning uses neural networks with multiple layers", "metadata": {"type": "technology"}},
    {"content": "Natural Language Processing enables computers to understand human language", "metadata": {"type": "technology"}}
]'
batch_response=$(api_request "POST" "/batch/learn" "$batch_concepts")
echo "Batch learning result:"
pretty_json "$batch_response"

echo
echo "✅ API Demo completed successfully!"
echo "LeafMind can be used as a database from any programming language! 🧠💾"

# Demonstrate with other common tools
echo
echo "📝 Example API calls for other languages:"
echo
echo "Python (requests):"
echo "  import requests"
echo "  response = requests.post('$API_URL/concepts', json={'content': 'Hello from Python'})"
echo "  concept_id = response.json()['concept_id']"
echo
echo "JavaScript (fetch):"
echo "  const response = await fetch('$API_URL/concepts', {"
echo "    method: 'POST',"
echo "    headers: {'Content-Type': 'application/json'},"
echo "    body: JSON.stringify({content: 'Hello from JavaScript'})"
echo "  });"
echo "  const data = await response.json();"
echo
echo "PHP:"
echo "  \$data = json_encode(['content' => 'Hello from PHP']);"
echo "  \$context = stream_context_create(['http' => ["
echo "    'method' => 'POST',"
echo "    'header' => 'Content-Type: application/json',"
echo "    'content' => \$data"
echo "  ]]);"
echo "  \$response = file_get_contents('$API_URL/concepts', false, \$context);"
echo
echo "Go:"
echo "  data := map[string]string{\"content\": \"Hello from Go\"}"
echo "  jsonData, _ := json.Marshal(data)"
echo "  resp, _ := http.Post(\"$API_URL/concepts\", \"application/json\", bytes.NewBuffer(jsonData))"