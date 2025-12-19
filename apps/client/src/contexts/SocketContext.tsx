import React, { createContext, useState, useEffect, useRef } from 'react';
type SocketLike = WebSocket;

const isDemoMode = (import.meta.env.VITE_DEMO_MODE as string | undefined)?.toLowerCase() === 'true';

interface SocketContextType {
  socket: SocketLike | null;
  isConnected: boolean;
  lastMessage: any;
}

export const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  lastMessage: null,
});

interface SocketProviderProps {
  children: React.ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const [socket, setSocket] = useState<SocketLike | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    // Demo-mode: skip WS entirely (GitHub Pages has no backend).
    if (isDemoMode) {
      return;
    }

    let ws: SocketLike | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const ensureNotificationPermission = () => {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => undefined);
      }
    };

    const buildWsUrl = () => {
      const configured = import.meta.env.VITE_WS_URL as string | undefined;
      const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
      const base = configured && configured.length > 0
        ? configured
        : `${apiUrl.replace(/^http/, apiUrl.startsWith('https') ? 'wss' : 'ws').replace(/\/$/, '')}/ws`;
      const url = new URL(base);
      const token = localStorage.getItem('accessToken');
      if (token) {
        url.searchParams.set('token', token);
      }
      const traceId = (window.crypto?.randomUUID?.() || `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      url.searchParams.set('traceId', traceId);
      return url.toString();
    };

    const showNotification = (title: string, message?: string) => {
      if ('Notification' in window && Notification.permission === 'granted' && message) {
        new Notification(title, { body: message });
      }
    };

    const connect = () => {
      if (!active) {
        return;
      }
      try {
        ws = new WebSocket(buildWsUrl());
      } catch (err) {
        console.error('WebSocket init error:', err);
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        setIsConnected(true);
        setSocket(ws);
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (active) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        ws?.close();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          setLastMessage({ type: msg.type || 'message', data: msg.data, timestamp: new Date() });
          if (msg.type === 'deal_alert') showNotification('New Deal Alert!', msg.data?.message);
          if (msg.type === 'price_watch') showNotification('Price Drop!', msg.data?.message);
          if (msg.type === 'booking_update') showNotification('Booking Update', msg.data?.message);
        } catch {
          // ignore non-JSON payloads
        }
      };
    };

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }
      const attempt = reconnectAttempts.current + 1;
      reconnectAttempts.current = attempt;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
      retryTimer = setTimeout(() => connect(), delay);
    };

    ensureNotificationPermission();
    connect();

    return () => {
      active = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, lastMessage }}>
      {children}
    </SocketContext.Provider>
  );
}
