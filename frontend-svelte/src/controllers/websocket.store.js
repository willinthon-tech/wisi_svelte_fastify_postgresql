import { writable } from 'svelte/store';
import { getWsUrl } from '../config/api.config.js';

export const isWsConnectedStore = writable(false);

// All checkIn / checkOut marcajes (backward compat)
export const latestAttlogEventStore = writable(null);

// checkIn only → consumed by ULTIMOS DE ENTRADA card
export const latestCheckInStore = writable(null);

// checkOut only → consumed by ULTIMOS DE SALIDA card
export const latestCheckOutStore = writable(null);

// Everything else (undefined, other statuses) → separate alert toast
export const latestMarcajeAlertStore = writable(null);

let socket = null;
let reconnectTimer = null;
let pingInterval = null;
let pongTimeoutTimer = null;
let currentCallback = null;
let lifecycleListenersAttached = false;
let reconnectAttempts = 0;

export function initWebSocketConnection(onNewMarcajeCallback) {
  if (onNewMarcajeCallback) {
    currentCallback = onNewMarcajeCallback;
  }

  // Si ya está conectado y activo, no duplicar
  if (socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  // Si está en proceso de conexión, dejarlo fluir
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return;
  }

  // Adjuntar escuchas de ciclo de vida una sola vez
  attachLifecycleListeners();

  const url = getWsUrl();

  try {
    // Cerrar instancia previa si existe en estado defectuoso
    if (socket) {
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      } catch (e) {}
      socket = null;
    }

    socket = new WebSocket(url);

    socket.onopen = () => {
      isWsConnectedStore.set(true);
      reconnectAttempts = 0;
      if (reconnectTimer) clearTimeout(reconnectTimer);

      // Heartbeat ping cada 12s para evitar caídas por proxies o redes móviles Android / Windows
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ type: 'PING' }));
            
            // Timeout de seguridad: si no responde PONG en 6s, forzar reconexión
            if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
            pongTimeoutTimer = setTimeout(() => {
              console.warn('⚠️ [WebSocket] Pong timeout recibido. Forzando reconexión...');
              try { socket.close(); } catch (e) {}
            }, 6000);
          } catch (e) {
            console.warn('⚠️ [WebSocket] Error enviando ping:', e);
            try { socket.close(); } catch (err) {}
          }
        }
      }, 12000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === 'PONG') {
          if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
          return;
        }

        if (payload.type === 'NEW_MARCAJE' && payload.data) {
          const rec = payload.data;
          const status = String(rec.attendancestatus || rec.status || '').toLowerCase().trim();

          // Publicar en latestAttlogEventStore para la tarjeta unificada de último registro
          latestAttlogEventStore.set(rec);

          if (status === 'checkin') {
            latestCheckInStore.set(rec);
          } else if (status === 'checkout') {
            latestCheckOutStore.set(rec);
          } else {
            latestMarcajeAlertStore.set(rec);
          }

          // Always fire callback so it can apply its own sala/auth filter
          if (typeof currentCallback === 'function') {
            try {
              currentCallback(rec);
            } catch (cbErr) {
              console.warn('Error en callback de marcaje:', cbErr);
            }
          }
        } else if (payload.type === 'MASTER_SYNC') {
          // Dynamic real-time sync with PostgreSQL
          import('./master.store.js').then(({ loadMasterStoresFromBackend }) => {
            loadMasterStoresFromBackend().catch(() => {});
          });
        }
      } catch (err) {
        console.warn('Error parseando mensaje WebSocket:', err);
      }
    };

    socket.onclose = () => {
      isWsConnectedStore.set(false);
      cleanupPingTimers();
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.warn('⚠️ [WebSocket] Error de socket:', err);
      isWsConnectedStore.set(false);
      try { socket?.close(); } catch (e) {}
    };

  } catch (err) {
    console.error('Error inicializando WebSocket:', err);
    scheduleReconnect();
  }
}

function cleanupPingTimers() {
  if (pingInterval) clearInterval(pingInterval);
  if (pongTimeoutTimer) clearTimeout(pongTimeoutTimer);
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts++;
  // Backoff exponencial suave: 1s, 2s, 3s, máximo 5s
  const delay = Math.min(reconnectAttempts * 1000, 5000);
  reconnectTimer = setTimeout(() => {
    initWebSocketConnection(currentCallback);
  }, delay);
}

/**
 * Escucha cambios de visibilidad, conexión a internet y retorno de segundo plano
 * para reconectar instantáneamente en Android y Windows.
 */
function attachLifecycleListeners() {
  if (lifecycleListenersAttached || typeof window === 'undefined') return;
  lifecycleListenersAttached = true;

  const handleWakeUp = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log('🔄 [WebSocket] Reactivando conexión por evento de ciclo de vida...');
      initWebSocketConnection(currentCallback);
    }
  };

  // 1. Cuando la pestaña o ventana vuelve a estar visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      handleWakeUp();
    }
  });

  // 2. Cuando recupera conexión a internet (WiFi / Datos) o recobra el foco
  window.addEventListener('online', handleWakeUp);
  window.addEventListener('focus', handleWakeUp);
  document.addEventListener('resume', handleWakeUp);

  // 3. Si corre en Android con Capacitor, escuchar retorno a primer plano
  try {
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App?.addListener) {
      window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
        if (state && state.isActive) {
          handleWakeUp();
        }
      }).catch(() => {});
    }
  } catch (e) {}
}

export function closeWebSocketConnection() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  cleanupPingTimers();
  if (socket) {
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    } catch (e) {}
    socket = null;
  }
  isWsConnectedStore.set(false);
}
