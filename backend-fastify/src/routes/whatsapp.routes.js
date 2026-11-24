import { whatsappService } from '../services/whatsapp.service.js';
import { parseWhatsAppMessage } from '../services/whatsapp-parser.js';
import { whatsappDictionaryService } from '../services/whatsapp-dictionary.service.js';
import { sql, isPgConnected } from '../config/db.js';

export default async function whatsappRoutes(fastify, options) {
  // 1. Estado de la conexión (Lectura pura sin efectos secundarios para no saturar al consultar el estado)
  fastify.get('/api/whatsapp/status', async (req, reply) => {
    return {
      success: true,
      data: whatsappService.getStatus()
    };
  });

  // 2. Conectar / Generar QR / Forzar reinicio
  fastify.post('/api/whatsapp/connect', async (req, reply) => {
    const { force } = req.body || {};
    const status = await whatsappService.connect(Boolean(force));
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

  // 4. Lista de grupos donde participa el bot (soporta caché y recarga forzada)
  fastify.get('/api/whatsapp/groups', async (req, reply) => {
    const { refresh } = req.query || {};
    const groups = await whatsappService.getParticipatingGroups(Boolean(refresh));
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
        s.nombre AS sala_nombre,
        s.multisalas AS sala_multisalas
      FROM whatsapp_group_mappings m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      ORDER BY m.created_at DESC
    `;

    const enriched = mappings.map(m => {
      let sub_sala_nombre = null;
      if (m.multisala_uuid && m.sala_multisalas) {
        let subList = [];
        if (Array.isArray(m.sala_multisalas)) {
          subList = m.sala_multisalas;
        } else if (typeof m.sala_multisalas === 'string') {
          try {
            subList = JSON.parse(m.sala_multisalas);
          } catch(e) {}
        }
        if (Array.isArray(subList)) {
          const found = subList.find(sub => 
            (sub && sub.uuid && String(sub.uuid).toLowerCase() === String(m.multisala_uuid).toLowerCase()) ||
            (sub && sub.id && String(sub.id) === String(m.multisala_uuid))
          );
          if (found) {
            sub_sala_nombre = found.nombre || found.name || null;
          }
        }
      }
      return {
        ...m,
        sub_sala_nombre
      };
    });

    return {
      success: true,
      data: enriched
    };
  });

  // 6. Crear o actualizar mapeo de grupo
  fastify.post('/api/whatsapp/mappings', async (req, reply) => {
    const {
      group_jid,
      group_name,
      sala_uuid,
      multisala_uuid,
      tipo_operaciones,
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

    const safeMultisalaUuid = (multisala_uuid && String(multisala_uuid).trim() !== '') 
      ? String(multisala_uuid).trim() 
      : null;

    const safeTipoOperaciones = ['control_clientes', 'aportes_maquinas'].includes(tipo_operaciones)
      ? tipo_operaciones
      : 'todo';

    const res = await sql`
      INSERT INTO whatsapp_group_mappings (
        group_jid,
        group_name,
        sala_uuid,
        multisala_uuid,
        tipo_operaciones,
        auto_reply,
        is_active,
        updated_at
      ) VALUES (
        ${group_jid},
        ${group_name || 'Grupo WhatsApp'},
        ${sala_uuid}::uuid,
        ${safeMultisalaUuid ? sql`${safeMultisalaUuid}::uuid` : sql`NULL`},
        ${safeTipoOperaciones},
        ${auto_reply !== false},
        ${is_active !== false},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (group_jid) DO UPDATE SET
        group_name = EXCLUDED.group_name,
        sala_uuid = EXCLUDED.sala_uuid,
        multisala_uuid = EXCLUDED.multisala_uuid,
        tipo_operaciones = EXCLUDED.tipo_operaciones,
        auto_reply = EXCLUDED.auto_reply,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    whatsappService.invalidateMappingsCache();

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

    whatsappService.invalidateMappingsCache();

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
    const { text, caja_default, modulo_destino, sala_uuid } = req.body || {};
    if (!text) {
      return reply.code(400).send({ success: false, error: 'Texto es requerido' });
    }

    const dynamicRules = whatsappDictionaryService.getRangoRules();
    const result = parseWhatsAppMessage(text, {
      caja_default: caja_default || 'Mesas',
      modulo_destino: modulo_destino || 'control_clientes',
      rangoRules: dynamicRules
    });

    if (result && result.success) {
      let checkEmoji = '✅';
      let checkLabel = 'Coincidencia Completa (Check Verde)';

      if (result.modulo === 'aportes_maquinas') {
        const hasRg = Boolean(result.explicit?.rango);
        const hasOp = Boolean(result.explicit?.operador);

        // Resolver operador con el diccionario para dar feedback inmediato en el probador
        const empRes = await whatsappDictionaryService.resolveEmpleado(result.operador, sala_uuid);
        result.resolved_empleado = empRes;

        const rangoRes = await whatsappDictionaryService.resolveRango(result.rango, sala_uuid);
        result.resolved_rango = rangoRes;

        if (!hasRg || !hasOp || !empRes.foundEmp || !empRes.esCoincidenciaExacta) {
          checkEmoji = '☑️';
          if (!hasOp) {
            checkLabel = 'Entra por verificar (Check Azul): Falta operador';
          } else if (empRes.ambiguedad) {
            checkLabel = `Entra por verificar (Check Azul): Ambigüedad en operador "${result.operador}" (${(empRes.candidatos || []).slice(0, 2).join(', ')})`;
          } else if (!empRes.foundEmp) {
            checkLabel = `Entra por verificar (Check Azul): Empleado "${result.operador}" no encontrado en sala`;
          } else if (!empRes.esCoincidenciaExacta) {
            checkLabel = `Entra por verificar (Check Azul): Coincidencia parcial con ${empRes.empleadoNombre}`;
          } else if (!hasRg) {
            checkLabel = 'Entra por verificar (Check Azul): Falta rango';
          }
        }
      } else {
        const hasCl = Boolean(result.explicit?.cliente);
        const hasMet = Boolean(result.explicit?.metodo);

        const cliRes = await whatsappDictionaryService.resolveCliente(result.cliente, sala_uuid);
        result.resolved_cliente = cliRes;

        const metRes = await whatsappDictionaryService.resolveMetodoPago(result.metodo);
        result.resolved_metodo = metRes;

        if (!hasCl || !hasMet || !cliRes.foundClient || !cliRes.esCoincidenciaExacta) {
          checkEmoji = '☑️';
          if (!hasCl) {
            checkLabel = 'Entra por verificar (Check Azul): Falta cliente';
          } else if (!cliRes.foundClient) {
            checkLabel = `Entra por verificar (Check Azul): Cliente nuevo (${result.cliente})`;
          } else if (!cliRes.esCoincidenciaExacta) {
            checkLabel = `Entra por verificar (Check Azul): Coincidencia parcial de cliente (${cliRes.clienteNombre})`;
          } else if (!hasMet) {
            checkLabel = 'Entra por verificar (Check Azul): Falta método de pago';
          }
        }
      }

      result.check_emoji = checkEmoji;
      result.check_label = checkLabel;
    }

    return {
      success: true,
      data: result,
      interpreted: Boolean(result && result.success)
    };
  });

  // 10. Estado y estadísticas del diccionario inteligente
  fastify.get('/api/whatsapp/dictionary/status', async (req, reply) => {
    return {
      success: true,
      data: whatsappDictionaryService.getStatus()
    };
  });

  // 11. Sincronizar catálogo integral del diccionario
  fastify.post('/api/whatsapp/dictionary/sync', async (req, reply) => {
    try {
      const res = await whatsappDictionaryService.syncDictionary();
      return {
        success: true,
        data: res
      };
    } catch (err) {
      return reply.code(500).send({
        success: false,
        error: `Error sincronizando diccionario: ${err.message}`
      });
    }
  });

  // 12. Vista previa de entidades del diccionario filtradas por sala
  fastify.get('/api/whatsapp/dictionary/preview', async (req, reply) => {
    const { sala_uuid } = req.query || {};
    return {
      success: true,
      data: whatsappDictionaryService.getPreviewBySala(sala_uuid)
    };
  });
}

