import { whatsappService } from '../services/whatsapp.service.js';
import { parseWhatsAppMessage } from '../services/whatsapp-parser.js';
import { sql, isPgConnected } from '../config/db.js';

export default async function whatsappRoutes(fastify, options) {
  // 1. Estado de la conexión
  fastify.get('/api/whatsapp/status', async (req, reply) => {
    return {
      success: true,
      data: whatsappService.getStatus()
    };
  });

  // 2. Conectar / Generar QR
  fastify.post('/api/whatsapp/connect', async (req, reply) => {
    const status = await whatsappService.connect();
    return {
      success: true,
      data: status
    };
  });

  // 3. Desconectar / Cerrar sesión (Logout)
  fastify.post('/api/whatsapp/disconnect', async (req, reply) => {
    const status = await whatsappService.disconnect();
    return {
      success: true,
      data: status
    };
  });

  // 4. Lista de grupos donde participa el bot
  fastify.get('/api/whatsapp/groups', async (req, reply) => {
    const groups = await whatsappService.getParticipatingGroups();
    return {
      success: true,
      data: groups
    };
  });

  // 5. Mapeos de grupos a salas
  fastify.get('/api/whatsapp/mappings', async (req, reply) => {
    if (!isPgConnected || !sql) {
      return { success: true, data: [] };
    }
    const mappings = await sql`
      SELECT 
        m.*,
        s.nombre AS sala_nombre
      FROM whatsapp_group_mappings m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      ORDER BY m.created_at DESC
    `;
    return {
      success: true,
      data: mappings
    };
  });

  // 6. Crear o actualizar mapeo de grupo
  fastify.post('/api/whatsapp/mappings', async (req, reply) => {
    const {
      group_jid,
      group_name,
      sala_uuid,
      multisala_uuid,
      modulo_destino,
      caja_default,
      auto_reply,
      is_active
    } = req.body || {};

    if (!group_jid) {
      return reply.code(400).send({ success: false, error: 'group_jid es obligatorio' });
    }
    if (!sala_uuid) {
      return reply.code(400).send({ success: false, error: 'Debe seleccionar una sala' });
    }

    if (!isPgConnected || !sql) {
      return reply.code(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    const res = await sql`
      INSERT INTO whatsapp_group_mappings (
        group_jid,
        group_name,
        sala_uuid,
        multisala_uuid,
        modulo_destino,
        caja_default,
        auto_reply,
        is_active,
        updated_at
      ) VALUES (
        ${group_jid},
        ${group_name || 'Grupo WhatsApp'},
        ${sala_uuid}::uuid,
        ${multisala_uuid ? sql`${multisala_uuid}::uuid` : sql`NULL`},
        ${modulo_destino || 'control_clientes'},
        ${caja_default || 'Mesas'},
        ${auto_reply !== false},
        ${is_active !== false},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (group_jid) DO UPDATE SET
        group_name = EXCLUDED.group_name,
        sala_uuid = EXCLUDED.sala_uuid,
        multisala_uuid = EXCLUDED.multisala_uuid,
        modulo_destino = EXCLUDED.modulo_destino,
        caja_default = EXCLUDED.caja_default,
        auto_reply = EXCLUDED.auto_reply,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return {
      success: true,
      data: res[0]
    };
  });

  // 7. Eliminar mapeo de grupo
  fastify.delete('/api/whatsapp/mappings/:id', async (req, reply) => {
    const { id } = req.params;
    if (!isPgConnected || !sql) {
      return reply.code(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    await sql`
      DELETE FROM whatsapp_group_mappings
      WHERE id::text = ${id} OR uuid::text = ${id}
    `;

    return { success: true };
  });

  // 8. Logs de mensajes recibidos y procesados
  fastify.get('/api/whatsapp/logs', async (req, reply) => {
    if (!isPgConnected || !sql) {
      return { success: true, data: [] };
    }
    const limit = parseInt(req.query.limit || '50', 10);
    const logs = await sql`
      SELECT * FROM whatsapp_logs
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return {
      success: true,
      data: logs
    };
  });

  // 9. Endpoint de prueba para el parser interactivo
  fastify.post('/api/whatsapp/test-parse', async (req, reply) => {
    const { text, caja_default, modulo_destino } = req.body || {};
    if (!text) {
      return reply.code(400).send({ success: false, error: 'Texto es requerido' });
    }

    const result = parseWhatsAppMessage(text, {
      caja_default: caja_default || 'Mesas',
      modulo_destino: modulo_destino || 'control_clientes'
    });

    return {
      success: true,
      data: result,
      interpreted: Boolean(result && result.success)
    };
  });
}

