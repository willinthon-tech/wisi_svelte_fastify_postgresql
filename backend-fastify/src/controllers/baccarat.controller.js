import { randomUUID } from 'crypto';
import { sql, isPgConnected } from '../config/db.js';

// In-Memory Fallback cuando la base de datos esté en modo offline/desconectada
let memorySessions = [];
let memoryMesaData = new Map();

export function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

export function safeJsonParse(val, fallback = []) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return parsed; }
      }
      return parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Obtener lista de sesiones para una sala ordenadas cronológicamente
 */
export async function getSessions(req, reply) {
  try {
    const salaUuid = String(req.query?.sala_uuid || req.query?.sala_id || req.params?.sala_id || '').trim();
    if (!salaUuid) {
      return reply.code(400).send({ success: false, message: 'El parámetro sala_uuid es requerido' });
    }

    if (isPgConnected && sql) {
      let sessions = await sql`
        SELECT uuid, sala_uuid, fecha, estado, created_at, updated_at
        FROM record_libro_score_baccarat
        WHERE sala_uuid = ${salaUuid}
        ORDER BY fecha ASC, created_at ASC;
      `;

      // Si no existe ninguna sesión aún, auto-crear la primera con la fecha real de hoy y UUID seguro
      if (sessions.length === 0) {
        const todayStr = getTodayStr();
        const newUuid = randomUUID();
        const [newSession] = await sql`
          INSERT INTO record_libro_score_baccarat (uuid, sala_uuid, fecha, estado)
          VALUES (${newUuid}::uuid, ${salaUuid}, ${todayStr}, 'abierta')
          RETURNING uuid, sala_uuid, fecha, estado, created_at, updated_at;
        `;
        sessions = [newSession];
      }

      // Proporcionar retrocompatibilidad en JSON para clientes antiguos que lean sala_id
      const formatted = sessions.map(s => ({
        ...s,
        sala_id: s.sala_uuid
      }));

      return reply.send({ success: true, data: formatted });
    }

    // Fallback en memoria
    let salaSessions = memorySessions.filter(s => String(s.sala_uuid || s.sala_id) === salaUuid);
    if (salaSessions.length === 0) {
      const todayStr = getTodayStr();
      const newSession = {
        uuid: randomUUID(),
        sala_uuid: salaUuid,
        sala_id: salaUuid,
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
 * Crear una nueva sesión para la sala (Fecha de HOY, sin saltos inventados hacia el futuro)
 */
export async function createSession(req, reply) {
  try {
    const salaUuid = String(req.body?.sala_uuid || req.body?.sala_id || req.query?.sala_uuid || req.query?.sala_id || '').trim();
    if (!salaUuid) {
      return reply.code(400).send({ success: false, message: 'El parámetro sala_uuid es requerido' });
    }

    const clientUuid = req.body?.uuid ? String(req.body.uuid).trim() : null;
    const targetUuid = (clientUuid && isUuid(clientUuid)) ? clientUuid : randomUUID();

    // La fecha de la sesión es SIEMPRE la fecha real actual (hoy) o la enviada explícitamente
    const fecha = req.body?.fecha ? String(req.body.fecha).trim() : getTodayStr();

    if (isPgConnected && sql) {
      const [created] = await sql`
        INSERT INTO record_libro_score_baccarat (uuid, sala_uuid, fecha, estado)
        VALUES (${targetUuid}::uuid, ${salaUuid}, ${fecha}, 'abierta')
        ON CONFLICT (uuid) DO UPDATE SET fecha = EXCLUDED.fecha, updated_at = NOW()
        RETURNING uuid, sala_uuid, fecha, estado, created_at, updated_at;
      `;

      return reply.send({
        success: true,
        data: {
          ...created,
          sala_id: created.sala_uuid
        }
      });
    }

    // Fallback en memoria
    const created = {
      uuid: targetUuid,
      sala_uuid: salaUuid,
      sala_id: salaUuid,
      fecha,
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
    const salaUuid = String(req.body?.sala_uuid || req.body?.sala_id || req.query?.sala_uuid || req.query?.sala_id || '').trim();
    if (!salaUuid) {
      return reply.code(400).send({ success: false, message: 'El parámetro sala_uuid es requerido' });
    }

    if (isPgConnected && sql) {
      const lastSessions = await sql`
        SELECT uuid, sala_uuid, fecha
        FROM record_libro_score_baccarat
        WHERE sala_uuid = ${salaUuid}
        ORDER BY fecha DESC, created_at DESC
        LIMIT 2;
      `;

      if (lastSessions.length === 0) {
        return reply.code(404).send({ success: false, message: 'No existen sesiones para esta sala' });
      }

      const targetToDelete = lastSessions[0];
      const previousSession = lastSessions[1] || null;

      // Borrar registros de mesas asociados a esta sesión usando record_libro_score_baccarat_uuid
      await sql`
        DELETE FROM record_libro_score_baccarat_mesa
        WHERE record_libro_score_baccarat_uuid = ${targetToDelete.uuid}::uuid;
      `;

      await sql`
        DELETE FROM record_libro_score_baccarat
        WHERE uuid = ${targetToDelete.uuid}::uuid;
      `;

      return reply.send({
        success: true,
        deleted: targetToDelete,
        previous: previousSession
      });
    }

    // Fallback en memoria
    const salaSessions = memorySessions.filter(s => String(s.sala_uuid || s.sala_id) === salaUuid);
    if (salaSessions.length === 0) {
      return reply.code(404).send({ success: false, message: 'No existen sesiones para esta sala' });
    }

    const targetToDelete = salaSessions[salaSessions.length - 1];
    const previousSession = salaSessions.length > 1 ? salaSessions[salaSessions.length - 2] : null;

    memorySessions = memorySessions.filter(s => s.uuid !== targetToDelete.uuid);

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
    const sessionUuid = req.query?.record_libro_score_baccarat_uuid || req.query?.session_uuid || req.query?.session_id;
    const mesaUuid = req.query?.mesa_uuid || req.query?.mesa_id;

    if (!sessionUuid || !mesaUuid) {
      return reply.code(400).send({ success: false, message: 'record_libro_score_baccarat_uuid y mesa_uuid son requeridos' });
    }

    const sUuidStr = String(sessionUuid).trim();
    const mUuidStr = String(mesaUuid).trim();
    const isValUuid = isUuid(sUuidStr);

    if (isPgConnected && sql) {
      if (!isValUuid) {
        return reply.send({
          success: true,
          data: {
            uuid: randomUUID(),
            record_libro_score_baccarat_uuid: null,
            session_uuid: null,
            session_id: sUuidStr,
            mesa_uuid: mUuidStr,
            mesa_id: mUuidStr,
            shoe_number: 1,
            tie_mode: 'slash',
            history: [],
            shoes: [{ shoe_number: 1, tie_mode: 'slash', history: [] }]
          }
        });
      }

      const rows = await sql`
        SELECT uuid, 
               record_libro_score_baccarat_uuid,
               mesa_uuid,
               shoe_number, tie_mode, history, shoes, updated_at
        FROM record_libro_score_baccarat_mesa
        WHERE record_libro_score_baccarat_uuid = ${sUuidStr}::uuid
          AND mesa_uuid = ${mUuidStr}
        ORDER BY updated_at DESC
        LIMIT 1;
      `;

      if (rows.length > 0) {
        const row = rows[0];
        const parsedShoes = safeJsonParse(row.shoes, []);
        const parsedHistory = safeJsonParse(row.history, []);

        let shoesList = Array.isArray(parsedShoes) && parsedShoes.length > 0 ? parsedShoes : [];
        if (shoesList.length === 0) {
          const hands = Array.isArray(parsedHistory) ? parsedHistory : [];
          shoesList = [{
            shoe_number: row.shoe_number || 1,
            tie_mode: row.tie_mode || 'slash',
            history: hands
          }];
        } else {
          // Normalizar cada zapato asegurando que history sea un Array real
          shoesList = shoesList.map(s => ({
            ...s,
            shoe_number: Number(s.shoe_number) || 1,
            tie_mode: s.tie_mode || 'slash',
            history: Array.isArray(s.history) ? s.history : safeJsonParse(s.history, [])
          }));
        }

        // Si por alguna razón la lista de zapatos no incluye el zapato 1, añadirlo
        if (!shoesList.some(s => s.shoe_number === 1)) {
          shoesList.unshift({ shoe_number: 1, history: [], tie_mode: 'slash' });
        }
        shoesList.sort((a, b) => a.shoe_number - b.shoe_number);

        // La historia activa es la del último zapato seleccionado
        const activeShoe = shoesList.find(s => s.shoe_number === row.shoe_number) || shoesList[shoesList.length - 1];
        const activeHistory = (activeShoe && Array.isArray(activeShoe.history) && activeShoe.history.length > 0)
          ? activeShoe.history
          : (Array.isArray(parsedHistory) ? parsedHistory : []);

        return reply.send({
          success: true,
          data: {
            ...row,
            record_libro_score_baccarat_uuid: String(row.record_libro_score_baccarat_uuid || sUuidStr),
            session_uuid: String(row.record_libro_score_baccarat_uuid || sUuidStr),
            session_id: String(row.record_libro_score_baccarat_uuid || sUuidStr),
            mesa_uuid: row.mesa_uuid,
            mesa_id: row.mesa_uuid,
            shoe_number: activeShoe?.shoe_number || row.shoe_number || 1,
            tie_mode: activeShoe?.tie_mode || row.tie_mode || 'slash',
            history: activeHistory,
            shoes: shoesList
          }
        });
      }

      // No existe registro para esta sesión y mesa: devolver estado 100% limpio y vacío []
      return reply.send({
        success: true,
        data: {
          uuid: randomUUID(),
          record_libro_score_baccarat_uuid: sUuidStr,
          session_uuid: sUuidStr,
          session_id: sUuidStr,
          mesa_uuid: mUuidStr,
          mesa_id: mUuidStr,
          shoe_number: 1,
          tie_mode: 'slash',
          history: [],
          shoes: [{ shoe_number: 1, tie_mode: 'slash', history: [] }]
        }
      });
    }

    // Fallback en memoria
    const key = `${sUuidStr}_${mUuidStr}`;
    const data = memoryMesaData.get(key) || {
      uuid: randomUUID(),
      record_libro_score_baccarat_uuid: isValUuid ? sUuidStr : null,
      session_uuid: isValUuid ? sUuidStr : null,
      session_id: sUuidStr,
      mesa_uuid: mUuidStr,
      mesa_id: mUuidStr,
      shoe_number: 1,
      tie_mode: 'slash',
      history: [],
      shoes: [{ shoe_number: 1, tie_mode: 'slash', history: [] }]
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
    const sessionUuid = req.body?.record_libro_score_baccarat_uuid || req.body?.session_uuid || req.body?.session_id;
    const mesaUuid = req.body?.mesa_uuid || req.body?.mesa_id;

    if (!sessionUuid || !mesaUuid) {
      return reply.code(400).send({ success: false, message: 'record_libro_score_baccarat_uuid y mesa_uuid son requeridos' });
    }

    const sUuidStr = String(sessionUuid).trim();
    const mUuidStr = String(mesaUuid).trim();
    const isValUuid = isUuid(sUuidStr);
    if (!isValUuid) {
      return reply.code(400).send({ success: false, message: 'record_libro_score_baccarat_uuid debe ser un UUID válido' });
    }

    const mesaDataUuid = (req.body?.uuid && isUuid(req.body.uuid)) ? String(req.body.uuid).trim() : randomUUID();

    const sNumber = Math.max(1, Number(req.body?.shoe_number) || 1);
    const tMode = req.body?.tie_mode === 'circle' ? 'circle' : 'slash';
    
    // Normalizar arrays reales para no guardar cadenas JSON dobles
    const handsArray = Array.isArray(req.body?.history) ? req.body.history : safeJsonParse(req.body?.history, []);
    let parsedShoes = Array.isArray(req.body?.shoes) ? req.body.shoes : safeJsonParse(req.body?.shoes, []);
    let shoesList = Array.isArray(parsedShoes) && parsedShoes.length > 0 ? parsedShoes : [
      { shoe_number: sNumber, tie_mode: tMode, history: handsArray }
    ];

    // Asegurar que el zapato activo esté actualizado dentro de shoesList
    const currIdx = shoesList.findIndex(s => Number(s.shoe_number) === sNumber);
    if (currIdx >= 0) {
      shoesList[currIdx] = { shoe_number: sNumber, history: handsArray, tie_mode: tMode };
    } else {
      shoesList.push({ shoe_number: sNumber, history: handsArray, tie_mode: tMode });
    }
    // Asegurar que exista Zapato 1
    if (!shoesList.some(s => s.shoe_number === 1)) {
      shoesList.unshift({ shoe_number: 1, history: [], tie_mode: 'slash' });
    }
    shoesList.sort((a, b) => a.shoe_number - b.shoe_number);

    if (isPgConnected && sql) {
      // Inserción estricta en las columnas estandarizadas
      const [saved] = await sql`
        INSERT INTO record_libro_score_baccarat_mesa (
          uuid, 
          record_libro_score_baccarat_uuid, 
          mesa_uuid,
          shoe_number, 
          tie_mode, 
          history, 
          shoes, 
          updated_at
        ) VALUES (
          ${mesaDataUuid}::uuid, 
          ${sUuidStr}::uuid, 
          ${mUuidStr},
          ${sNumber}, 
          ${tMode},
          ${JSON.stringify(handsArray)}::jsonb,
          ${JSON.stringify(shoesList)}::jsonb,
          NOW()
        )
        ON CONFLICT (record_libro_score_baccarat_uuid, mesa_uuid) DO UPDATE SET
          shoe_number = EXCLUDED.shoe_number,
          tie_mode = EXCLUDED.tie_mode,
          history = EXCLUDED.history,
          shoes = EXCLUDED.shoes,
          updated_at = NOW()
        RETURNING uuid, 
                  record_libro_score_baccarat_uuid,
                  mesa_uuid,
                  shoe_number, tie_mode, history, shoes, updated_at;
      `;

      return reply.send({
        success: true,
        data: {
          ...saved,
          record_libro_score_baccarat_uuid: String(saved.record_libro_score_baccarat_uuid || sUuidStr),
          session_uuid: String(saved.record_libro_score_baccarat_uuid || sUuidStr),
          session_id: String(saved.record_libro_score_baccarat_uuid || sUuidStr),
          mesa_uuid: saved.mesa_uuid,
          mesa_id: saved.mesa_uuid,
          history: handsArray,
          shoes: shoesList
        }
      });
    }

    // Fallback en memoria
    const key = `${sUuidStr}_${mUuidStr}`;
    const saved = {
      uuid: mesaDataUuid,
      record_libro_score_baccarat_uuid: sUuidStr,
      session_uuid: sUuidStr,
      session_id: sUuidStr,
      mesa_uuid: mUuidStr,
      mesa_id: mUuidStr,
      shoe_number: sNumber,
      tie_mode: tMode,
      history: handsArray,
      shoes: shoesList,
      updated_at: new Date().toISOString()
    };
    memoryMesaData.set(key, saved);

    return reply.send({ success: true, data: saved });
  } catch (error) {
    req.log.error(error);
    return reply.code(500).send({ success: false, message: error.message });
  }
}
