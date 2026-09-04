import websocketPlugin from '@fastify/websocket';
import { attlogEvents } from '../events/attlog.events.js';
import { sendPushNotificationToAll } from '../services/push.service.js';

// Active WebSocket client connections
const activeClients = new Set();

export async function initWebsockets(fastify) {
  await fastify.register(websocketPlugin, {
    options: { maxPayload: 1048576 }
  });

  // WebSocket endpoint for real-time attlog notifications
  fastify.get('/ws/attlogs', { websocket: true }, (connection, req) => {
    const socket = connection.socket;
    activeClients.add(socket);
    //console.log(`\x1b[36m⚡ [WEBSOCKET]\x1b[0m Cliente conectado en /ws/attlogs. Total activos: ${activeClients.size}`);

    socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'PING') {
          socket.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (e) {
        // silent parse error
      }
    });

    socket.on('close', () => {
      activeClients.delete(socket);
      //console.log(`\x1b[33m⚡ [WEBSOCKET]\x1b[0m Cliente desconectado. Total activos: ${activeClients.size}`);
    });

    socket.on('error', (err) => {
      activeClients.delete(socket);
    });
  });

  // Alias endpoint for root /ws
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    const socket = connection.socket;
    activeClients.add(socket);
    //console.log(`\x1b[36m⚡ [WEBSOCKET]\x1b[0m Cliente conectado en /ws. Total activos: ${activeClients.size}`);

    socket.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'PING') {
          socket.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (e) {
        // silent parse error
      }
    });

    socket.on('close', () => {
      activeClients.delete(socket);
      //console.log(`\x1b[33m⚡ [WEBSOCKET]\x1b[0m Cliente desconectado. Total activos: ${activeClients.size}`);
    });

    socket.on('error', (err) => {
      activeClients.delete(socket);
    });
  });
}

/**
 * Broadcasts a new attendance log event to all connected WebSocket clients
 */
export function broadcastNewAttlog(attlogData) {
  if (activeClients.size === 0) return;

  const payload = JSON.stringify({
    type: 'NEW_MARCAJE',
    data: attlogData,
    timestamp: new Date().toISOString()
  });

  for (const client of activeClients) {
    if (client.readyState === 1) { // 1 = OPEN
      try {
        client.send(payload);
      } catch (err) {
        activeClients.delete(client);
      }
    }
  }
  //console.log(`\x1b[32m⚡ [WEBSOCKET BROADCAST]\x1b[0m Notificación de marcaje enviada a ${activeClients.size} clientes.`);
}

// Automatically subscribe to system-wide attlog events
attlogEvents.on('new_attlog', (data) => {
  // 1. Enviar a clientes WebSocket en primer plano
  broadcastNewAttlog(data);

  // 2. Enviar Notificación Push FCM a Android (para recibir con app cerrada/segundo plano)
  if (data) {
    const empName = data.nombre || `Empleado ${data.employee_no || ''}`;
    const actionType = String(data.tipo_evento || data.status || 'Marcaje').toUpperCase();
    const salaName = data.sala_nombre || 'Sala';
    const timeStr = data.hora || (data.event_time ? String(data.event_time).split(' ')[1] : '');

    sendPushNotificationToAll({
      title: `🔔 ${empName}`,
      body: `${actionType} en ${salaName} (${timeStr})`,
      data: {
        attlog_id: String(data.id || ''),
        empleado_id: String(data.empleado_id || ''),
        sala_id: String(data.sala_id || ''),
        tipo: String(data.tipo_evento || data.status || '')
      }
    }).catch(() => {});
  }
});
