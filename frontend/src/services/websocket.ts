import { 
  WebSocketMessage, 
  ConceptLearnMessage, 
  AssociationMessage, 
  MemoryUpdateEvent 
} from '../types';

export class LeafMindWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 1000;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private connectionHandlers: Set<() => void> = new Set();
  private disconnectionHandlers: Set<() => void> = new Set();

  constructor(url: string = 'ws://localhost:8080') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log('🔗 Connected to LeafMind WebSocket');
          this.reconnectAttempts = 0;
          this.connectionHandlers.forEach(handler => handler());
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('🔌 Disconnected from LeafMind WebSocket');
          this.disconnectionHandlers.forEach(handler => handler());
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
        });
      }, this.reconnectInterval * this.reconnectAttempts);
    } else {
      console.error('❌ Max reconnection attempts reached');
    }
  }

  private handleMessage(message: WebSocketMessage) {
    const handler = this.messageHandlers.get(message.message_type);
    if (handler) {
      handler(message.payload);
    } else {
      console.log('Unhandled message type:', message.message_type, message.payload);
    }
  }

  // Send a concept to be learned
  learnConcept(content: string, metadata?: Record<string, string>): void {
    const message: ConceptLearnMessage = {
      content,
      metadata
    };
    this.sendMessage('learn_concept', message);
  }

  // Create an association between concepts
  createAssociation(
    fromConceptId: string, 
    toConceptId: string, 
    strength: number = 1.0, 
    bidirectional: boolean = false
  ): void {
    const message: AssociationMessage = {
      from_concept_id: fromConceptId,
      to_concept_id: toConceptId,
      strength,
      bidirectional
    };
    this.sendMessage('create_association', message);
  }

  // Request memory recall
  recallMemory(query: string, maxResults: number = 10, minRelevance: number = 0.1): void {
    const message = {
      query,
      max_results: maxResults,
      min_relevance: minRelevance
    };
    this.sendMessage('recall_memory', message);
  }

  // Subscribe to concept updates
  subscribeConcept(conceptId: string): void {
    this.sendMessage('subscribe_concept', conceptId);
  }

  private sendMessage(messageType: string, payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = {
        message_type: messageType,
        payload,
        timestamp: Date.now()
      };
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected. Message not sent:', messageType);
    }
  }

  // Event handlers
  onMessage(messageType: string, handler: (data: any) => void): void {
    this.messageHandlers.set(messageType, handler);
  }

  onConnect(handler: () => void): void {
    this.connectionHandlers.add(handler);
  }

  onDisconnect(handler: () => void): void {
    this.disconnectionHandlers.add(handler);
  }

  // Memory update events
  onMemoryUpdate(handler: (event: MemoryUpdateEvent) => void): void {
    this.onMessage('memory_update', handler);
  }

  // Recall results
  onRecallResults(handler: (results: any[]) => void): void {
    this.onMessage('recall_results', handler);
  }

  // Connection status
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton instance
export const leafMindWS = new LeafMindWebSocket();