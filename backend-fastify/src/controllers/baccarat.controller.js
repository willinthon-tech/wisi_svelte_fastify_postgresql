import { sql, isPgConnected } from '../config/db.js';

// In-Memory Fallback cuando la base de datos esté en modo offline/desconectada
let memorySessions = [];
let memoryMesaData = new Map();
let memorySessionIdCounter = 1;

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getNextDateStr(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return getTodayStr();
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = date.getUTCFullYear();
  const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(date.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Obtener lista de sesiones para una sala ordenadas cronológicamente
 */
export async function getSessions(req, reply) {
  try {
    const salaId = String(req.query?.sala_id || req.params?.sala_id || '').trim();
    if (!salaId) {
      return reply.code(400).send({ success: false, message: 'El parámetro sala_id es requerido' });
    }

    if (isPgConnected && sql) {
      let sessions = await sql`
        SELECT id, uuid, sala_id, fecha, estado, created_at, updated_at
        FROM record_libro_score_baccarat
        WHERE sala_id = ${salaId}
        ORDER BY id ASC;
      `;

      // Si no existe ninguna sesión aún, auto-crear la primera con la fecha de hoy
      if (sessions.length === 0) {
        const todayStr = getTodayStr();
        const [newSession] = await sql`
          INSERT INTO record_libro_score_baccarat (sala_id, fecha, estado)
          VALUES (${salaId}, ${todayStr}, 'abierta')
          RETURNING id, uuid, sala_id, fecha, estado, created_at, updated_at;
        `;
        sessions = [newSession];
      }

      return reply.send({ success: true, data: sessions });
    }

    // Fallback en memoria
    let salaSessions = memorySessions.filter(s => String(s.sala_id) === salaId);
    if (salaSessions.length === 0) {
      const todayStr = getTodayStr();
      const newSession = {
        id: memorySessionIdCounter++,
        uuid: `mem-${Date.now()}`,
        sala_id: salaId,
        fecha: todayStr,
        estado: 'abierta',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      memorySessions.push(newSession);
      salaSessions = [newSession];
    }

    return reply.send({ success: true, data: salaSessions });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ success: false, message: error.message });
  }
}

/**
 * Crear una nueva sesión para la sala, sumando +1 día a la última sesión registrada
 */
export async function createSession(req, reply) {
  try {
    const salaId = String(req.body?.sala_id || req.query?.sala_id || '').trim();
    if (!salaId) {
      return reply.code(400).send({ success: false, message: 'El parámetro sala_id es requerido' });
    }

    let nextFecha = getTodayStr();

    if (isPgConnected && sql) {
      const lastSession = await sql`
        SELECT id, fecha
        FROM record_libro_score_baccarat
        WHERE sala_id = ${salaId}
        ORDER BY id DESC
        LIMIT 1;
      `;

      if (lastSession.length > 0 && lastSession[0].fecha) {
        nextFecha = getNextDateStr(lastSession[0].fecha);
      }

      const [created] = await sql`
        INSERT INTO record_libro_score_baccarat (sala_id, fecha, estado)
        VALUES (${salaId}, ${nextFecha}, 'abierta')
        RETURNING id, uuid, sala_id, fecha, estado, created_at, updated_at;
      `;

      return reply.send({ success: true, data: created });
    }

    // Fallback en memoria
    const lastSession = [...memorySessions.filter(s => String(s.sala_id) === salaId)].pop();
    if (lastSession && lastSession.fecha) {
      nextFecha = getNextDateStr(lastSession.fecha);
    }

    const created = {
      id: memorySessionIdCounter++,
      uuid: `mem-${Date.now()}`,
      sala_id: salaId,
      fecha: nextFecha,
      estado: 'abierta',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memorySessions.push(created);

    return reply.send({ success: true, data: created });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ success: false, message: error.message });
  }
}

/**
 * Borrar la última sesión registrada de la sala
 */
export async function deleteLastSession(req, reply) {
  try {
    const salaId = String(req.body?.sala_id || req.query?.sala_id || '').trim();
    if (!salaId) {
      return reply.code(400).send({ success: false, message: 'El parámetro sala_id es requerido' });
    }

    if (isPgConnected && sql) {
      const lastSessions = await sql`
        SELECT id, uuid, fecha
        FROM record_libro_score_baccarat
        WHERE sala_id = ${salaId}
        ORDER BY id DESC
        LIMIT 2;
      `;

      if (lastSessions.length === 0) {
        return reply.code(404).send({ success: false, message: 'No existen sesiones para esta sala' });
      }

      const targetToDelete = lastSessions[0];
      const previousSession = lastSessions[1] || null;

      await sql`
        DELETE FROM record_libro_score_baccarat
        WHERE id = ${targetToDelete.id};
      `;

      return reply.send({
        success: true,
        deleted: targetToDelete,
        previous: previousSession
      });
    }

    // Fallback en memoria
    const salaSessions = memorySessions.filter(s => String(s.sala_id) === salaId);
    if (salaSessions.length === 0) {
      return reply.code(404).send({ success: false, message: 'No existen sesiones para esta sala' });
    }

    const targetToDelete = salaSessions[salaSessions.length - 1];
    const previousSession = salaSessions.length > 1 ? salaSessions[salaSessions.length - 2] : null;

    memorySessions = memorySessions.filter(s => s.id !== targetToDelete.id);

    return reply.send({
      success: true,
      deleted: targetToDelete,
      previous: previousSession
    });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ success: false, message: error.message });
  }
}

/**
 * Obtener los datos (zapatos, historial de manos, tieMode) de una mesa en una sesión
 */
export async function getMesaData(req, reply) {
  try {
    const sessionId = req.query?.session_id;
    const mesaId = String(req.query?.mesa_id || '').trim();

    if (!sessionId || !mesaId) {
      return reply.code(400).send({ success: false, message: 'session_id y mesa_id son requeridos' });
    }

    if (isPgConnected && sql) {
      const rows = await sql`
        SELECT id, uuid, session_id, mesa_id, shoe_number, tie_mode, history, updated_at
        FROM record_libro_score_baccarat_mesa
        WHERE session_id = ${Number(sessionId)} AND mesa_id = ${mesaId}
        LIMIT 1;
      `;

      if (rows.length > 0) {
        return reply.send({ success: true, data: rows[0] });
      }

      return reply.send({
        success: true,
        data: {
          session_id: Number(sessionId),
          mesa_id: mesaId,
          shoe_number: 1,
          tie_mode: 'slash',
          history: []
        }
      });
    }

    // Fallback en memoria
    const key = `${sessionId}_${mesaId}`;
    const data = memoryMesaData.get(key) || {
      session_id: Number(sessionId),
      mesa_id: mesaId,
      shoe_number: 1,
      tie_mode: 'slash',
      history: []
    };

    return reply.send({ success: true, data });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ success: false, message: error.message });
  }
}

/**
 * Guardar o actualizar los datos (zapatos, historial de manos, tieMode) de una mesa en una sesión
 */
export async function saveMesaData(req, reply) {
  try {
    const { session_id, mesa_id, shoe_number, tie_mode, history } = req.body || {};

    if (!session_id || !mesa_id) {
      return reply.code(400).send({ success: false, message: 'session_id y mesa_id son requeridos' });
    }

    const sNumber = Math.max(1, Number(shoe_number) || 1);
    const tMode = tie_mode === 'circle' ? 'circle' : 'slash';
    const handsArray = Array.isArray(history) ? history : [];

    if (isPgConnected && sql) {
      const [saved] = await sql`
        INSERT INTO record_libro_score_baccarat_mesa (
          session_id, mesa_id, shoe_number, tie_mode, history, updated_at
        ) VALUES (
          ${Number(session_id)}, ${String(mesa_id)}, ${sNumber}, ${tMode}, ${JSON.stringify(handsArray)}::jsonb, NOW()
        )
        ON CONFLICT (session_id, mesa_id) DO UPDATE SET
          shoe_number = EXCLUDED.shoe_number,
          tie_mode = EXCLUDED.tie_mode,
          history = EXCLUDED.history,
          updated_at = NOW()
        RETURNING id, uuid, session_id, mesa_id, shoe_number, tie_mode, history, updated_at;
      `;

      return reply.send({ success: true, data: saved });
    }

    // Fallback en memoria
    const key = `${session_id}_${mesa_id}`;
    const saved = {
      id: Date.now(),
      uuid: `mem-data-${Date.now()}`,
      session_id: Number(session_id),
      mesa_id: String(mesa_id),
      shoe_number: sNumber,
      tie_mode: tMode,
      history: handsArray,
      updated_at: new Date().toISOString()
    };
    memoryMesaData.set(key, saved);

    return reply.send({ success: true, data: saved });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ success: false, message: error.message });
  }
}
