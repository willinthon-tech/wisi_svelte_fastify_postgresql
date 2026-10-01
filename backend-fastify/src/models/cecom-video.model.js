import { isPgConnected, sql, inMemoryData } from '../config/db.js';

function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

/**
 * Normaliza strings para comparación segura
 */
function cleanStr(val) {
  return typeof val === 'string' ? val.trim() : '';
}

// ====================================================================
// DISPOSITIVOS CÁMARAS (NVR, DVR, CÁMARAS IP)
// ====================================================================

export async function getDispositivosCamarasModel(params = {}) {
  if (!isPgConnected || !sql) {
    return { success: true, data: [] };
  }

  const {
    sala_uuid,
    search,
    active = 1
  } = params;

  const conds = [sql`d.is_deleted = false`];

  if (active !== undefined && active !== 'all') {
    conds.push(sql`d.active = ${Number(active)}`);
  }

  if (sala_uuid) {
    const list = Array.isArray(sala_uuid) ? sala_uuid : [sala_uuid];
    const validUuids = list.filter(isUuid);
    if (validUuids.length > 0) {
      conds.push(sql`d.sala_uuid = ANY(${validUuids}::uuid[])`);
    }
  }

  if (search && cleanStr(search)) {
    const term = `%${cleanStr(search).toLowerCase()}%`;
    conds.push(sql`(LOWER(d.nombre) LIKE ${term} OR LOWER(d.ip_local) LIKE ${term} OR LOWER(d.tipo) LIKE ${term})`);
  }

  const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;

  const rows = await sql`
    SELECT 
      d.uuid, d.uuid AS id,
      d.sala_uuid,
      s.nombre AS sala_nombre,
      d.nombre,
      d.tipo,
      d.ip_local,
      d.usuario,
      d.clave,
      d.puerto_sdk,
      d.puerto_http,
      d.puerto_rtsp,
      d.canales_totales,
      COALESCE(d.metadata_canales, '[]'::jsonb) AS metadata_canales,
      d.active,
      d.created_at,
      d.updated_at,
      COUNT(c.uuid)::int AS canales_activos_db
    FROM dispositivos_camaras d
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    LEFT JOIN camaras c ON c.dispositivo_camara_uuid = d.uuid AND c.is_deleted = false
    ${where}
    GROUP BY d.uuid, s.nombre
    ORDER BY d.created_at DESC
  `;

  return { success: true, data: rows };
}

export async function createDispositivoCamaraModel(data) {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');

  const salaUuid = data.sala_uuid || data.sala_id;
  if (!salaUuid || !isUuid(salaUuid)) throw new Error('Debe especificar una sala válida');

  const nombre = cleanStr(data.nombre);
  if (!nombre) throw new Error('El nombre del dispositivo es obligatorio');

  const tipo = cleanStr(data.tipo).toUpperCase() || 'NVR';
  const ipLocal = cleanStr(data.ip_local);
  if (!ipLocal) throw new Error('La IP local del dispositivo es obligatoria');

  const usuario = cleanStr(data.usuario) || 'admin';
  const clave = cleanStr(data.clave) || '';
  const puertoSdk = Number(data.puerto_sdk) || 8000;
  const puertoHttp = Number(data.puerto_http) || 80;
  const puertoRtsp = Number(data.puerto_rtsp) || 554;
  const canalesTotales = tipo === 'CAMARA_IP' ? 1 : (Number(data.canales_totales) || 16);

  const rows = await sql`
    INSERT INTO dispositivos_camaras (
      sala_uuid, nombre, tipo, ip_local, usuario, clave,
      puerto_sdk, puerto_http, puerto_rtsp, canales_totales,
      metadata_canales, active, is_deleted, created_at, updated_at
    ) VALUES (
      ${salaUuid}::uuid, ${nombre}, ${tipo}, ${ipLocal}, ${usuario}, ${clave},
      ${puertoSdk}, ${puertoHttp}, ${puertoRtsp}, ${canalesTotales},
      ${sql.json(data.metadata_canales || [])}, 1, false, NOW(), NOW()
    )
    RETURNING *, uuid AS id
  `;

  const newDev = rows[0];

  // Si es cámara IP individual, auto-crear su canal 1 de una vez
  if (tipo === 'CAMARA_IP') {
    await sql`
      INSERT INTO camaras (
        dispositivo_camara_uuid, sala_uuid, numero_canal, nombre, tipo,
        ip_origen, audio_habilitado, active, is_deleted, created_at, updated_at
      ) VALUES (
        ${newDev.uuid}::uuid, ${salaUuid}::uuid, 1, ${nombre}, 'IP',
        ${ipLocal}, false, 1, false, NOW(), NOW()
      )
      ON CONFLICT (dispositivo_camara_uuid, numero_canal) 
      DO UPDATE SET nombre = EXCLUDED.nombre, updated_at = NOW()
    `;
  }

  return newDev;
}

export async function updateDispositivoCamaraModel(uuid, data) {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');
  if (!uuid || !isUuid(uuid)) throw new Error('UUID inválido');

  const updates = [];

  if (data.nombre !== undefined) updates.push(sql`nombre = ${cleanStr(data.nombre)}`);
  if (data.tipo !== undefined) updates.push(sql`tipo = ${cleanStr(data.tipo).toUpperCase()}`);
  if (data.ip_local !== undefined) updates.push(sql`ip_local = ${cleanStr(data.ip_local)}`);
  if (data.usuario !== undefined) updates.push(sql`usuario = ${cleanStr(data.usuario)}`);
  if (data.clave !== undefined) updates.push(sql`clave = ${cleanStr(data.clave)}`);
  if (data.puerto_sdk !== undefined) updates.push(sql`puerto_sdk = ${Number(data.puerto_sdk) || 8000}`);
  if (data.puerto_http !== undefined) updates.push(sql`puerto_http = ${Number(data.puerto_http) || 80}`);
  if (data.puerto_rtsp !== undefined) updates.push(sql`puerto_rtsp = ${Number(data.puerto_rtsp) || 554}`);
  if (data.canales_totales !== undefined) updates.push(sql`canales_totales = ${Number(data.canales_totales) || 1}`);
  if (data.metadata_canales !== undefined) updates.push(sql`metadata_canales = ${sql.json(data.metadata_canales)}`);
  if (data.active !== undefined) updates.push(sql`active = ${Number(data.active)}`);
  if (data.sala_uuid !== undefined && isUuid(data.sala_uuid)) updates.push(sql`sala_uuid = ${data.sala_uuid}::uuid`);

  updates.push(sql`updated_at = NOW()`);

  const rows = await sql`
    UPDATE dispositivos_camaras
    SET ${updates.reduce((a, b) => sql`${a}, ${b}`)}
    WHERE uuid = ${uuid}::uuid AND is_deleted = false
    RETURNING *, uuid AS id
  `;

  return rows[0] || null;
}

export async function deleteDispositivoCamaraModel(uuid) {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');
  if (!uuid || !isUuid(uuid)) throw new Error('UUID inválido');

  // Soft delete en cascada lógica
  await sql`
    UPDATE camaras 
    SET is_deleted = true, deleted_at = NOW() 
    WHERE dispositivo_camara_uuid = ${uuid}::uuid
  `;

  const rows = await sql`
    UPDATE dispositivos_camaras
    SET is_deleted = true, deleted_at = NOW()
    WHERE uuid = ${uuid}::uuid
    RETURNING uuid
  `;

  return { success: rows.length > 0 };
}

// ====================================================================
// CANALES Y CÁMARAS AUTO-DESCUBIERTAS
// ====================================================================

export async function syncCanalesDispositivoModel(dispositivoCamaraUuid, canalesList = []) {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');
  if (!dispositivoCamaraUuid || !isUuid(dispositivoCamaraUuid)) throw new Error('UUID de grabador inválido');

  const devRows = await sql`SELECT uuid, sala_uuid FROM dispositivos_camaras WHERE uuid = ${dispositivoCamaraUuid}::uuid`;
  if (devRows.length === 0) throw new Error('Grabador no encontrado');
  const salaUuid = devRows[0].sala_uuid;

  if (!Array.isArray(canalesList) || canalesList.length === 0) {
    return { success: true, count: 0 };
  }

  let syncedCount = 0;
  for (const c of canalesList) {
    const canalNum = parseInt(c.numero_canal || c.id_canal || c.canal);
    if (isNaN(canalNum)) continue;

    const nombre = cleanStr(c.nombre) || `Cámara ${canalNum}`;
    const tipo = cleanStr(c.tipo).toUpperCase() || 'IP';
    const ipOrigen = cleanStr(c.ip_origen || c.ipOrigen);
    const audioHabilitado = Boolean(c.audio_habilitado || (c.Audio && String(c.Audio).toLowerCase().includes('habilitado')));

    await sql`
      INSERT INTO camaras (
        dispositivo_camara_uuid, sala_uuid, numero_canal, nombre, tipo,
        ip_origen, audio_habilitado, active, is_deleted, created_at, updated_at
      ) VALUES (
        ${dispositivoCamaraUuid}::uuid, ${salaUuid}::uuid, ${canalNum}, ${nombre}, ${tipo},
        ${ipOrigen || null}, ${audioHabilitado}, 1, false, NOW(), NOW()
      )
      ON CONFLICT (dispositivo_camara_uuid, numero_canal) 
      DO UPDATE SET
        nombre = EXCLUDED.nombre,
        tipo = EXCLUDED.tipo,
        ip_origen = COALESCE(EXCLUDED.ip_origen, camaras.ip_origen),
        audio_habilitado = EXCLUDED.audio_habilitado,
        is_deleted = false,
        deleted_at = NULL,
        updated_at = NOW()
    `;
    syncedCount++;
  }

  // Actualizar canales totales y metadata en el grabador
  await sql`
    UPDATE dispositivos_camaras
    SET 
      canales_totales = GREATEST(canales_totales, ${syncedCount}),
      metadata_canales = ${sql.json(canalesList)},
      updated_at = NOW()
    WHERE uuid = ${dispositivoCamaraUuid}::uuid
  `;

  return { success: true, count: syncedCount };
}

export async function getCamarasModel(params = {}) {
  if (!isPgConnected || !sql) return { success: true, data: [] };

  const {
    sala_uuid,
    dispositivo_camara_uuid,
    search,
    active = 1
  } = params;

  const conds = [sql`c.is_deleted = false`, sql`d.is_deleted = false`];

  if (active !== undefined && active !== 'all') {
    conds.push(sql`c.active = ${Number(active)}`);
  }

  if (dispositivo_camara_uuid && isUuid(dispositivo_camara_uuid)) {
    conds.push(sql`c.dispositivo_camara_uuid = ${dispositivo_camara_uuid}::uuid`);
  }

  if (sala_uuid) {
    const list = Array.isArray(sala_uuid) ? sala_uuid : [sala_uuid];
    const validUuids = list.filter(isUuid);
    if (validUuids.length > 0) {
      conds.push(sql`c.sala_uuid = ANY(${validUuids}::uuid[])`);
    }
  }

  if (search && cleanStr(search)) {
    const term = `%${cleanStr(search).toLowerCase()}%`;
    conds.push(sql`(LOWER(c.nombre) LIKE ${term} OR LOWER(d.nombre) LIKE ${term})`);
  }

  const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;

  const rows = await sql`
    SELECT 
      c.uuid, c.uuid AS id,
      c.dispositivo_camara_uuid,
      d.nombre AS dispositivo_nombre,
      d.tipo AS dispositivo_tipo,
      d.ip_local AS dispositivo_ip,
      d.usuario AS dispositivo_usuario,
      d.clave AS dispositivo_clave,
      d.puerto_sdk,
      d.puerto_http,
      d.puerto_rtsp,
      c.sala_uuid,
      s.nombre AS sala_nombre,
      c.numero_canal,
      c.nombre,
      c.tipo,
      c.ip_origen,
      c.audio_habilitado,
      c.active,
      c.created_at,
      c.updated_at
    FROM camaras c
    JOIN dispositivos_camaras d ON c.dispositivo_camara_uuid = d.uuid
    LEFT JOIN salas s ON c.sala_uuid = s.uuid
    ${where}
    ORDER BY d.nombre ASC, c.numero_canal ASC
  `;

  return { success: true, data: rows };
}

// ====================================================================
// ASOCIACIÓN MESAS <-> CÁMARAS (IA DE MESAS)
// ====================================================================

export async function getMesasCamarasModel(mesaUuid) {
  if (!isPgConnected || !sql) return { success: true, data: [] };
  if (!mesaUuid || !isUuid(mesaUuid)) throw new Error('UUID de mesa inválido');

  const rows = await sql`
    SELECT 
      mc.uuid, mc.uuid AS id,
      mc.mesa_uuid,
      m.nombre AS mesa_nombre,
      mc.camara_uuid,
      c.nombre AS camara_nombre,
      c.numero_canal,
      d.uuid AS dispositivo_uuid,
      d.nombre AS dispositivo_nombre,
      d.ip_local AS dispositivo_ip,
      d.puerto_rtsp,
      d.usuario AS dispositivo_usuario,
      d.clave AS dispositivo_clave,
      mc.rol,
      mc.active,
      mc.created_at
    FROM mesas_camaras mc
    JOIN mesas m ON mc.mesa_uuid = m.uuid
    JOIN camaras c ON mc.camara_uuid = c.uuid
    JOIN dispositivos_camaras d ON c.dispositivo_camara_uuid = d.uuid
    WHERE mc.mesa_uuid = ${mesaUuid}::uuid 
      AND mc.is_deleted = false
      AND c.is_deleted = false
    ORDER BY mc.created_at ASC
  `;

  return { success: true, data: rows };
}

export async function setMesaCamarasModel(mesaUuid, camarasList = []) {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');
  if (!mesaUuid || !isUuid(mesaUuid)) throw new Error('UUID de mesa inválido');

  const mesaRows = await sql`SELECT uuid, sala_uuid FROM mesas WHERE uuid = ${mesaUuid}::uuid`;
  if (mesaRows.length === 0) throw new Error('Mesa no encontrada');

  // Limpiar asignaciones previas de la mesa
  await sql`DELETE FROM mesas_camaras WHERE mesa_uuid = ${mesaUuid}::uuid`;

  if (!Array.isArray(camarasList) || camarasList.length === 0) {
    return { success: true, data: [] };
  }

  const inserted = [];
  for (const item of camarasList) {
    const camaraUuid = item.camara_uuid || item.id || item.uuid;
    if (!camaraUuid || !isUuid(camaraUuid)) continue;

    const rol = cleanStr(item.rol).toUpperCase() || 'CENITAL_CARTAS';

    const r = await sql`
      INSERT INTO mesas_camaras (
        mesa_uuid, camara_uuid, rol, active, is_deleted, created_at, updated_at
      ) VALUES (
        ${mesaUuid}::uuid, ${camaraUuid}::uuid, ${rol}, 1, false, NOW(), NOW()
      )
      ON CONFLICT (mesa_uuid, camara_uuid)
      DO UPDATE SET rol = EXCLUDED.rol, active = 1, is_deleted = false, updated_at = NOW()
      RETURNING *
    `;
    inserted.push(r[0]);
  }

  return { success: true, data: inserted };
}

// ====================================================================
// EVENTOS IA CECOM (TIEMPO REAL Y NOVEDADES)
// ====================================================================

export async function getCecomIaEventosModel(params = {}) {
  if (!isPgConnected || !sql) return { success: true, data: [] };

  const {
    sala_uuid,
    mesa_uuid,
    juego_nombre,
    tipo_evento,
    es_novedad,
    fecha_desde,
    fecha_hasta,
    search,
    limit = 100
  } = params;

  const conds = [sql`e.is_deleted = false`];

  if (sala_uuid) {
    const list = Array.isArray(sala_uuid) ? sala_uuid : [sala_uuid];
    const valid = list.filter(isUuid);
    if (valid.length > 0) conds.push(sql`e.sala_uuid = ANY(${valid}::uuid[])`);
  }

  if (mesa_uuid && isUuid(String(mesa_uuid).trim())) {
    conds.push(sql`e.mesa_uuid = ${String(mesa_uuid).trim()}::uuid`);
  }

  if (juego_nombre && cleanStr(juego_nombre) && cleanStr(juego_nombre).toLowerCase() !== 'all') {
    conds.push(sql`LOWER(e.juego_nombre) = ${cleanStr(juego_nombre).toLowerCase()}`);
  }

  if (tipo_evento && cleanStr(tipo_evento) && cleanStr(tipo_evento).toLowerCase() !== 'all') {
    conds.push(sql`e.tipo_evento = ${cleanStr(tipo_evento).toUpperCase()}`);
  }

  if (es_novedad !== undefined && es_novedad !== null && es_novedad !== 'all') {
    const boolVal = es_novedad === true || es_novedad === 'true' || es_novedad === 1 || es_novedad === '1';
    conds.push(sql`e.es_novedad = ${boolVal}`);
  }

  if (fecha_desde && cleanStr(fecha_desde)) {
    conds.push(sql`e.created_at >= ${cleanStr(fecha_desde)}::timestamptz`);
  }

  if (fecha_hasta && cleanStr(fecha_hasta)) {
    conds.push(sql`e.created_at <= (${cleanStr(fecha_hasta)}::date + INTERVAL '1 day')::timestamptz`);
  }

  if (search && cleanStr(search)) {
    const term = `%${cleanStr(search).toLowerCase()}%`;
    conds.push(sql`(LOWER(e.descripcion) LIKE ${term} OR LOWER(m.nombre) LIKE ${term} OR LOWER(e.juego_nombre) LIKE ${term})`);
  }

  const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;
  const limitNum = Math.min(Number(limit) || 100, 500);

  const rows = await sql`
    SELECT 
      e.uuid, e.uuid AS id,
      e.sala_uuid,
      s.nombre AS sala_nombre,
      e.mesa_uuid,
      m.nombre AS mesa_nombre,
      e.camara_uuid,
      c.nombre AS camara_nombre,
      c.numero_canal,
      e.juego_nombre,
      e.tipo_evento,
      e.descripcion,
      COALESCE(e.metadata, '{}'::jsonb) AS metadata,
      e.es_novedad,
      e.nivel_alerta,
      e.atendido,
      e.atendido_por,
      e.created_at,
      e.updated_at
    FROM cecom_ia_eventos e
    LEFT JOIN salas s ON e.sala_uuid = s.uuid
    LEFT JOIN mesas m ON e.mesa_uuid = m.uuid
    LEFT JOIN camaras c ON e.camara_uuid = c.uuid
    ${where}
    ORDER BY e.created_at DESC
    LIMIT ${limitNum}
  `;

  return { success: true, data: rows };
}

export async function createCecomIaEventoModel(data = {}) {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');

  const {
    sala_uuid,
    mesa_uuid,
    camara_uuid,
    juego_nombre = '',
    tipo_evento = 'JUGADA',
    descripcion = '',
    metadata = {},
    es_novedad = false,
    nivel_alerta = 'INFO'
  } = data;

  if (!sala_uuid || !isUuid(sala_uuid)) throw new Error('UUID de sala inválido');
  if (!mesa_uuid || !isUuid(mesa_uuid)) throw new Error('UUID de mesa inválido');

  const validCamaraUuid = (camara_uuid && isUuid(camara_uuid)) ? camara_uuid : null;
  const isNov = es_novedad || ['DROP', 'MALDON', 'CAMBIO_BARAJO', 'ANOMALIA'].includes(String(tipo_evento).toUpperCase());

  const rows = await sql`
    INSERT INTO cecom_ia_eventos (
      sala_uuid, mesa_uuid, camara_uuid, juego_nombre, tipo_evento,
      descripcion, metadata, es_novedad, nivel_alerta, created_at, updated_at
    ) VALUES (
      ${sala_uuid}::uuid,
      ${mesa_uuid}::uuid,
      ${validCamaraUuid ? sql`${validCamaraUuid}::uuid` : null},
      ${cleanStr(juego_nombre)},
      ${cleanStr(tipo_evento).toUpperCase()},
      ${cleanStr(descripcion)},
      ${metadata}::jsonb,
      ${isNov},
      ${cleanStr(nivel_alerta).toUpperCase() || 'INFO'},
      NOW(), NOW()
    )
    RETURNING *
  `;

  return { success: true, data: rows[0] };
}

export async function marcarEventoAtendidoModel(uuid, atendido_por = '') {
  if (!isPgConnected || !sql) throw new Error('Base de datos no disponible');
  if (!uuid || !isUuid(uuid)) throw new Error('UUID de evento inválido');

  const rows = await sql`
    UPDATE cecom_ia_eventos
    SET atendido = true, atendido_por = ${cleanStr(atendido_por)}, updated_at = NOW()
    WHERE uuid = ${uuid}::uuid AND is_deleted = false
    RETURNING *
  `;

  return { success: true, data: rows[0] || null };
}

