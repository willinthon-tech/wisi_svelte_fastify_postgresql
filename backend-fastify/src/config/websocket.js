import websocketPlugin from '@fastify/websocket';
import { attlogEvents } from '../events/attlog.events.js';
import { sendPushNotificationForAttlog } from '../services/push.service.js';

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

    // Determinar badge según attendancestatus
    const rawStatus = String(data.attendancestatus || data.tipo_evento || data.status || '').toLowerCase().trim();
    let statusBadge = '🚪 PUERTA / OTROS';
    let statusLabel = 'PUERTA / OTROS';
    if (rawStatus === 'checkin' || rawStatus === 'entrada') {
      statusBadge = '🟢 ENTRADA';
      statusLabel = 'ENTRADA';
    } else if (rawStatus === 'checkout' || rawStatus === 'salida') {
      statusBadge = '🔴 SALIDA';
      statusLabel = 'SALIDA';
    }

    const cargoName = data.cargo_nombre || data.cargo || '';
    const salaName = data.sala_nombre || 'Sala';
    let timeStr = data.hora || '';
    if (!timeStr && data.event_time) {
      const cleanTime = String(data.event_time).replace('T', ' ');
      timeStr = cleanTime.split(' ')[1] ? cleanTime.split(' ')[1].split('.')[0] : cleanTime;
    }

    // Formato estructurado para Android y Windows:
    // Título limpio con Estado + Nombre: "🟢 ENTRADA • Juan Pérez"
    // Cuerpo ordenado línea por línea (sin amontonar ni truncar)
    const title = `${statusBadge} • ${empName}`;
    const bodyLines = [
      `🕒 Hora: ${timeStr}`,
      `📍 Sala: ${salaName}`,
      `💼 Cargo: ${cargoName || 'Sin cargo asignado'}`
    ];
    const notificationBody = bodyLines.join('\n');

    let photoUrl = null;
    if (data.id) {
      photoUrl = `https://willinthon.wisi.space/api/attlogs/${data.id}.jpg`;
    } else if (data.empleado_foto) {
      photoUrl = data.empleado_foto.startsWith('http') ? data.empleado_foto : `https://willinthon.wisi.space${data.empleado_foto.startsWith('/') ? '' : '/'}${data.empleado_foto}`;
    } else if (data.foto) {
      photoUrl = data.foto.startsWith('http') ? data.foto : `https://willinthon.wisi.space${data.foto.startsWith('/') ? '' : '/'}${data.foto}`;
    } else if (data.empleado_id) {
      photoUrl = `https://willinthon.wisi.space/api/empleados/${data.empleado_id}.jpg`;
    }

    sendPushNotificationForAttlog({
      salaId: data.sala_id,
      title,
      body: notificationBody,
      imageUrl: photoUrl,
      data: {
        attlog_id: String(data.id || ''),
        empleado_id: String(data.empleado_id || ''),
        sala_id: String(data.sala_id || ''),
        tipo: statusLabel,
        cargo: String(cargoName),
        sala: String(salaName),
        nombre: String(empName),
        image_url: String(photoUrl || '')
      }
    }).catch(() => {});
  }
});
