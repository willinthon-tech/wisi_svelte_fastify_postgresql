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

export function initWebSocketConnection(onNewMarcajeCallback) {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = getWsUrl();

  try {
    socket = new WebSocket(url);

    socket.onopen = () => {
      isWsConnectedStore.set(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);

      // Start 25s ping interval to keep connection alive
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'PING' }));
        }
      }, 25000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'NEW_MARCAJE' && payload.data) {
          const rec = payload.data;
          const status = (rec.attendancestatus || '').toLowerCase();

          if (status === 'checkin') {
            latestCheckInStore.set(rec);
            latestAttlogEventStore.set(rec); // backward compat
          } else if (status === 'checkout') {
            latestCheckOutStore.set(rec);
            latestAttlogEventStore.set(rec); // backward compat
          } else {
            // undefined or any other value → separate alert toast
            latestMarcajeAlertStore.set(rec);
          }

          // Always fire App.svelte callback so it can apply its own sala/auth filter
          if (typeof onNewMarcajeCallback === 'function') {
            onNewMarcajeCallback(rec);
          }
        }
      } catch (err) {
        console.warn('Error parseando mensaje WebSocket:', err);
      }
    };

    socket.onclose = () => {
      isWsConnectedStore.set(false);
      if (pingInterval) clearInterval(pingInterval);
      reconnectTimer = setTimeout(() => {
        initWebSocketConnection(onNewMarcajeCallback);
      }, 5000);
    };

    socket.onerror = () => {
      isWsConnectedStore.set(false);
      try { socket.close(); } catch (e) { }
    };

  } catch (err) {
    console.error('Error inicializando WebSocket:', err);
    reconnectTimer = setTimeout(() => {
      initWebSocketConnection(onNewMarcajeCallback);
    }, 5000);
  }
}

export function closeWebSocketConnection() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingInterval) clearInterval(pingInterval);
  if (socket) {
    try { socket.close(); } catch (e) { }
    socket = null;
  }
  isWsConnectedStore.set(false);
}
