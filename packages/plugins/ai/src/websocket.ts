import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';

export interface AGUIGatewayOptions {
  onUserAction?: (sessionId: string, payload: any) => void;
}

export class AGUIGateway {
  private wss: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map(); // sessionId -> WebSocket
  private sessionSchemas: Map<string, string> = new Map(); // sessionId -> schemaUid
  private onUserAction?: (sessionId: string, payload: any) => void;

  constructor(server: any, options?: AGUIGatewayOptions) {
    this.onUserAction = options?.onUserAction;
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket: any, head: any) => {
      try {
        const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
        if (url.pathname === '/api/ai/a2ui') {
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
          });
        }
      } catch (err: any) {
        console.error('[AG-UI Gateway] Upgrade failed:', err.message);
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      let clientSessionId: string | null = null;
      let isAlive = true;

      ws.on('pong', () => {
        isAlive = true;
      });

      ws.on('message', async (data: string) => {
        try {
          const message = JSON.parse(data);

          if (message.event === 'handshake') {
            clientSessionId = message.sessionId;
            if (clientSessionId) {
              this.clients.set(clientSessionId, ws);
              ws.send(JSON.stringify({
                event: 'handshake_ack',
                timestamp: Date.now(),
                sessionId: clientSessionId
              }));
              console.log(`[AG-UI Gateway] Handshake accepted for session: ${clientSessionId}`);
            }
          } else if (message.event === 'user_action') {
            console.log(`[AG-UI Gateway] Received user_action from session ${clientSessionId}:`, message.payload);
            this.handleUserAction(clientSessionId!, message.payload);
          } else if (message.event === 'sync_session') {
            const schemaUid = message.schemaUid;
            if (schemaUid && clientSessionId) {
              this.sessionSchemas.set(clientSessionId, schemaUid);
              console.log(`[AG-UI Gateway] Synced session ${clientSessionId} to schema: ${schemaUid}`);
            }
            ws.send(JSON.stringify({
              event: 'sync_ack',
              timestamp: Date.now(),
              sessionId: clientSessionId
            }));
          }
        } catch (e: any) {
          ws.send(JSON.stringify({
            event: 'error',
            message: `Failed to parse message: ${e.message}`
          }));
        }
      });

      ws.on('close', () => {
        if (clientSessionId) {
          this.clients.delete(clientSessionId);
          this.sessionSchemas.delete(clientSessionId);
          console.log(`[AG-UI Gateway] Session closed: ${clientSessionId}`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[AG-UI Gateway] WebSocket error for session ${clientSessionId}:`, err.message);
      });

      // Keepalive ping check every 30s
      const pingInterval = setInterval(() => {
        if (!isAlive) {
          ws.terminate();
          clearInterval(pingInterval);
          return;
        }
        isAlive = false;
        ws.ping();
      }, 30000);

      ws.on('close', () => {
        clearInterval(pingInterval);
      });
    });

    console.log('[AG-UI Gateway] Initialized WebSocket handler at pathname: /api/ai/a2ui');
  }

  // Push UI updates down to the client session
  public sendUIUpdate(sessionId: string, payload: { surfaceId: string; operation: string; components: any[] }) {
    const ws = this.clients.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: 'update_ui',
        timestamp: Date.now(),
        sessionId,
        payload
      }));
    }
  }

  private handleUserAction(sessionId: string, payload: any) {
    if (this.onUserAction) {
      this.onUserAction(sessionId, payload);
    }
  }

  public getSessionSchema(sessionId: string): string | undefined {
    return this.sessionSchemas.get(sessionId);
  }

  public getSessionsForSchema(schemaUid: string): string[] {
    const sessionIds: string[] = [];
    for (const [sessId, schUid] of this.sessionSchemas.entries()) {
      if (schUid === schemaUid) {
        sessionIds.push(sessId);
      }
    }
    return sessionIds;
  }

  public broadcastToSchema(schemaUid: string, excludeSessionId: string | null, payload: any) {
    const sessionIds = this.getSessionsForSchema(schemaUid);
    for (const sessId of sessionIds) {
      if (sessId === excludeSessionId) continue;
      this.sendUIUpdate(sessId, payload);
    }
  }
}
