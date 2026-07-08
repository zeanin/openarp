import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';

interface AGUIContextProps {
  connected: boolean;
  sessionId: string;
  sendUserAction: (componentId: string, actionType: string, dataModel?: any) => void;
  registerUpdateHandler: (handler: (payload: any) => void) => () => void;
  syncSession: (schemaUid: string) => void;
}

const AGUIContext = createContext<AGUIContextProps | null>(null);

export const useAGUI = () => {
  const ctx = useContext(AGUIContext);
  if (!ctx) throw new Error('useAGUI must be used within AGUIProvider');
  return ctx;
};

export const AGUIProvider: React.FC<{ children: React.ReactNode; sessionId?: string }> = ({
  children,
  sessionId: customSessionId
}) => {
  const [connected, setConnected] = useState(false);
  const sessionId = useRef(customSessionId || `session_${Math.random().toString(36).slice(2, 10)}`).current;
  const socketRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<(payload: any) => void>>(new Set());

  const registerUpdateHandler = useCallback((handler: (payload: any) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const sendUserAction = useCallback((componentId: string, actionType: string, dataModel?: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        event: 'user_action',
        timestamp: Date.now(),
        sessionId,
        payload: {
          surfaceId: 'page-surface',
          componentId,
          actionType,
          dataModel
        }
      }));
      console.log(`[AG-UI Client] Sent user_action for component: ${componentId}`);
    } else {
      console.warn('[AG-UI Client] Cannot send user_action: WebSocket is not open.');
    }
  }, [sessionId]);

  const syncSession = useCallback((schemaUid: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        event: 'sync_session',
        timestamp: Date.now(),
        sessionId,
        schemaUid
      }));
      console.log(`[AG-UI Client] Sent sync_session for schemaUid: ${schemaUid}`);
    } else {
      console.warn('[AG-UI Client] Cannot send sync_session: WebSocket is not open.');
    }
  }, [sessionId]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const apiBase = import.meta.env.VITE_API_BASE_URL || '';
    // Strip trailing slash if any
    const cleanApiBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
    const host = cleanApiBase ? cleanApiBase.replace(/^https?:\/\//, '') : window.location.host;
    const wsUrl = `${protocol}//${host}/api/ai/a2ui`;

    let reconnectAttempts = 0;
    let ws: WebSocket;
    let keepAliveInterval: ReturnType<typeof setInterval>;

    const connect = () => {
      console.log(`[AG-UI Client] Connecting to: ${wsUrl}`);
      ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('[AG-UI Client] Connected.');
        setConnected(true);
        reconnectAttempts = 0;
        // Send handshake
        ws.send(JSON.stringify({
          event: 'handshake',
          timestamp: Date.now(),
          sessionId
        }));

        // Setup ping intervals
        keepAliveInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.event === 'handshake_ack') {
            console.log('[AG-UI Client] Handshake acknowledged.');
          } else if (message.event === 'update_ui') {
            console.log('[AG-UI Client] Received update_ui payload:', message.payload);
            handlersRef.current.forEach((handler) => handler(message.payload));
          }
        } catch (e) {
          console.error('[AG-UI Client] Failed to parse message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[AG-UI Client] Connection closed.');
        setConnected(false);
        clearInterval(keepAliveInterval);
        if (reconnectAttempts < 5) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
          console.log(`[AG-UI Client] Attempting reconnect in ${delay}ms...`);
          setTimeout(connect, delay);
        }
      };

      ws.onerror = (err) => {
        console.error('[AG-UI Client] WebSocket error:', err);
      };
    };

    connect();

    return () => {
      clearInterval(keepAliveInterval);
      if (ws) {
        ws.close();
      }
    };
  }, [sessionId]);

  return (
    <AGUIContext.Provider value={{ connected, sessionId, sendUserAction, registerUpdateHandler, syncSession }}>
      {children}
    </AGUIContext.Provider>
  );
};
