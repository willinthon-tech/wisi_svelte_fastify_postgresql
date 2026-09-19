function getSalaIdsClause(params, salaAlias = 's.id') {
  if (!params) return '';
  const idsStr = params.sala_ids || params.sala_id || params.salaIds;
  if (!idsStr) return '';
  const ids = String(idsStr)
    .split(',')
    .map(x => Number(x.trim()))
    .filter(n => !isNaN(n) && n > 0);
  if (ids.length === 0) return '';
  return `AND ${salaAlias} IN (${ids.join(',')})`;
}

export function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

export function toUuidArray(arr) {
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : String(arr).split(',');
  return list.map(s => String(s).trim()).filter(s => isUuid(s));
}

export function toIdOrUuid(val) {
  if (!val) return { isUuid: false, value: null, uuid: null, id: null };
  const s = String(val).trim();
  if (isUuid(s)) return { isUuid: true, value: s, uuid: s, id: null };
  const n = Number(s);
  return { isUuid: false, value: isNaN(n) ? s : n, uuid: null, id: isNaN(n) ? null : n };
}

export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '')
    .join(' ');
}

// ============================================================================
// DYNAMIC AUTOMATED POSTGRESQL SYSTEM CATALOG FOREIGN KEY INSPECTOR
// Works automatically for ALL existing tables AND any future tables created!


import { sql, isPgConnected, inMemoryData } from '../config/db.js';
import { attlogEvents } from '../events/attlog.events.js';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const attlogsDir = path.join(__dirname, '../../attlogs');

if (!fs.existsSync(attlogsDir)) {
  try {
    fs.mkdirSync(attlogsDir, { recursive: true, mode: 0o755 });
  } catch (e) {
    console.warn('Warning creating attlogs directory:', e.message);
  }
}


// ============================================================================
// DYNAMIC AUTOMATED POSTGRESQL SYSTEM CATALOG FOREIGN KEY INSPECTOR
// Works automatically for ALL existing tables AND any future tables created!
// ============================================================================

function getHumanLabel(tableName) {
  if (!tableName) return 'Registros';
  const customLabels = {
    attlogs: 'Marcajes (Attlogs)',
    empleado_dispositivos: 'Permisos de Dispositivos',
    user_salas: 'Salas Asignadas',
    user_module_permissions: 'Permisos de Módulos'
  };
  if (customLabels[tableName]) return customLabels[tableName];
  return tableName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function getDynamicTableDependencies(tableName, recordUuid) {
  if (!isPgConnected || !sql || !recordUuid) return [];
  const dependencies = [];
  const visited = new Set();

  async function inspect(currTable, currUuids) {
    if (!currUuids || currUuids.length === 0) return;

    try {
      const fkQuery = await sql`
        SELECT
          tc.table_name AS child_table,
          kcu.column_name AS child_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = ${currTable}
      `;

      for (const fk of fkQuery) {
        const childTable = fk.child_table;
        const childColumn = fk.child_column;
        const keyKey = `${childTable}:${childColumn}`;

        if (visited.has(keyKey)) continue;
        visited.add(keyKey);

        const childRows = await sql.unsafe(
          `SELECT uuid, "${childColumn}" FROM "${childTable}" WHERE "${childColumn}" = ANY($1::uuid[])`,
          [currUuids]
        );

        const count = childRows.length;
        if (count > 0) {
          dependencies.push({ label: getHumanLabel(childTable), count });
          const childUuids = childRows.map(r => r.uuid).filter(Boolean);
          if (childUuids.length > 0) {
            await inspect(childTable, childUuids);
          }
        }
      }
    } catch (err) {
      console.warn(`Error in dynamic FK inspection for ${currTable}:`, err.message);
    }
  }

  await inspect(tableName, [String(recordUuid).trim()]);
  return dependencies;
}

export async function deleteEntityDynamic(tableName, entityTypeLabel, id) {
  if (!id) return { success: false, message: 'Identificador inválido' };
  const strId = String(id).trim();

  let record = null;
  if (isPgConnected && sql) {
    try {
      const rows = isUuid(strId)
        ? await sql.unsafe(`SELECT * FROM "${tableName}" WHERE uuid = $1::uuid LIMIT 1`, [strId])
        : await sql.unsafe(`SELECT * FROM "${tableName}" WHERE uuid::text = $1 LIMIT 1`, [strId]);
      if (rows && rows.length > 0) record = rows[0];
    } catch (e) {}
  }

  const effectiveUuid = record?.uuid || (isUuid(strId) ? strId : null);
  if (!effectiveUuid) {
    return { success: false, message: 'Registro no encontrado o UUID inválido' };
  }

  if (isPgConnected && sql) {
    const name = record?.nombre || record?.title || record?.nombre_apellido || record?.usuario || record?.name || effectiveUuid;
    const dependencies = await getDynamicTableDependencies(tableName, effectiveUuid);
    if (dependencies && dependencies.length > 0) {
      return {
        success: false,
        blocked: true,
        entityType: entityTypeLabel || tableName,
        entityName: name,
        entityId: effectiveUuid,
        message: `No se puede eliminar ${entityTypeLabel || tableName} porque tiene elementos asociados.`,
        dependencies
      };
    }

    try {
      await sql.unsafe(`DELETE FROM "${tableName}" WHERE uuid = $1::uuid`, [effectiveUuid]);
    } catch (err) {
      if (err.code === '23503') { // PostgreSQL foreign_key_violation
        return {
          success: false,
          blocked: true,
          entityType: entityTypeLabel || tableName,
          entityName: name,
          entityId: effectiveUuid,
          message: `No se puede eliminar ${entityTypeLabel || tableName} porque está referenciado en la base de datos.`,
          dependencies: [{ label: 'Registros Vinculados', count: 1 }]
        };
      }
      throw err;
    }
  } else {
    if (inMemoryData[tableName]) {
      inMemoryData[tableName] = inMemoryData[tableName].filter(item => 
        String(item.uuid) !== strId && String(item.id) !== strId
      );
    }
  }
  return { success: true, id: effectiveUuid, uuid: effectiveUuid };
}


// --- USUARIOS ---
export async function getUsuariosModel() {
  if (isPgConnected && sql) {
    return await sql`SELECT uuid, uuid AS id, nombre_apellido, usuario, password FROM usuarios ORDER BY nombre_apellido ASC`;
  }
  return inMemoryData.usuarios;
}

export async function createUsuarioModel(data) {
  const { nombre_apellido, usuario, password } = data || {};
  const cleanUser = (usuario || '').trim();
  const cleanPass = (password || '').trim();
  const cleanName = (nombre_apellido || cleanUser).trim();

  if (!cleanUser || !cleanPass) {
    throw new Error('El usuario y la contraseña son obligatorios');
  }

  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO usuarios (nombre_apellido, usuario, password)
      VALUES (${cleanName}, ${cleanUser}, ${cleanPass})
      RETURNING uuid, uuid AS id, nombre_apellido, usuario, password
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.usuarios.length > 0 ? Math.max(...inMemoryData.usuarios.map(u => u.id)) + 1 : 1;
    const newUser = {
      id: nextId,
      uuid: `user-${Date.now()}`,
      nombre_apellido: cleanName,
      usuario: cleanUser,
      password: cleanPass
    };
    inMemoryData.usuarios.unshift(newUser);
    return newUser;
  }
}

export async function updateUsuarioModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const isU = isUuid(id);
  const { nombre_apellido, usuario, password } = data || {};

  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE usuarios
      SET nombre_apellido = ${nombre_apellido}, usuario = ${usuario}, password = ${password}, updated_at = CURRENT_TIMESTAMP
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`uuid::text = ${String(id)}`}
      RETURNING uuid, uuid AS id, nombre_apellido, usuario, password
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.usuarios.findIndex(u => String(u.uuid) === String(id) || String(u.id) === String(id));
    if (idx !== -1) {
      inMemoryData.usuarios[idx] = { ...inMemoryData.usuarios[idx], ...data };
      return inMemoryData.usuarios[idx];
    }
    return null;
  }
}

export async function deleteUsuarioModel(id) {
  return await deleteEntityDynamic('usuarios', 'usuario', id);
}


// --- SALAS ---
export async function getSalasModel() {
  if (isPgConnected && sql) {
    return await sql`SELECT *, uuid AS id FROM salas ORDER BY nombre ASC`;
  }
  return inMemoryData.salas;
}

export async function createSalaModel(data) {
  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO salas (nombre, nombre_comercial, rif, ubicacion, correo, telefono)
      VALUES (${data.nombre}, ${data.nombre_comercial}, ${data.rif}, ${data.ubicacion}, ${data.correo}, ${data.telefono})
      RETURNING *, uuid AS id
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.salas.length > 0 ? Math.max(...inMemoryData.salas.map(s => s.id)) + 1 : 1;
    const newSala = { id: nextId, uuid: `sala-${Date.now()}`, ...data };
    inMemoryData.salas.unshift(newSala);
    return newSala;
  }
}

export async function updateSalaModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const isU = isUuid(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE salas
      SET nombre = ${data.nombre}, nombre_comercial = ${data.nombre_comercial},
          rif = ${data.rif}, ubicacion = ${data.ubicacion}, correo = ${data.correo}, telefono = ${data.telefono}, updated_at = CURRENT_TIMESTAMP
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`uuid::text = ${String(id)}`}
      RETURNING *, uuid AS id
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.salas.findIndex(s => String(s.uuid) === String(id) || String(s.id) === String(id));
    if (idx !== -1) {
      inMemoryData.salas[idx] = { ...inMemoryData.salas[idx], ...data };
      return inMemoryData.salas[idx];
    }
    return null;
  }
}

export async function deleteSalaModel(id) {
  return await deleteEntityDynamic('salas', 'sala', id);
}


// --- PÁGINAS ---
export async function getPaginasModel() {
  if (isPgConnected && sql) {
    return await sql`SELECT * FROM paginas ORDER BY nombre ASC`;
  }
  return inMemoryData.paginas;
}

export async function createPaginaModel(data) {
  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO paginas (nombre)
      VALUES (${data.nombre})
      RETURNING *
    `;
    return rows[0];
  } else {
    const newPagina = { uuid: `pag-${Date.now()}`, ...data };
    inMemoryData.paginas.push(newPagina);
    return newPagina;
  }
}

export async function updatePaginaModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const isU = isUuid(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE paginas
      SET nombre = ${data.nombre}, updated_at = CURRENT_TIMESTAMP
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`uuid::text = ${String(id)}`}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.paginas.findIndex(p => String(p.uuid) === String(id));
    if (idx !== -1) {
      inMemoryData.paginas[idx] = { ...inMemoryData.paginas[idx], ...data };
      return inMemoryData.paginas[idx];
    }
    return null;
  }
}

export async function deletePaginaModel(id) {
  return await deleteEntityDynamic('paginas', 'página', id);
}


// --- MÓDULOS ---
export async function getModulosModel() {
  if (isPgConnected && sql) {
    return await sql`SELECT * FROM modulos ORDER BY orden ASC, nombre ASC`;
  }
  return [...inMemoryData.modulos].sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

export async function reorderModulosModel(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return { success: true, message: 'No hay elementos para reordenar' };
  }

  if (isPgConnected && sql) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mUuid = item.uuid || (isUuid(item.id) ? item.id : null);
      const newOrder = Number(item.orden !== undefined ? item.orden : (i + 1));
      if (mUuid) {
        await sql`
          UPDATE modulos
          SET orden = ${newOrder}, updated_at = CURRENT_TIMESTAMP
          WHERE uuid = ${mUuid}::uuid
        `;
      }
    }
    const updated = await sql`SELECT * FROM modulos ORDER BY orden ASC, nombre ASC`;
    return { success: true, data: updated };
  } else {
    items.forEach((item, i) => {
      const mUuid = String(item.uuid || item.id);
      const newOrder = Number(item.orden !== undefined ? item.orden : (i + 1));
      const target = inMemoryData.modulos.find(m => String(m.uuid) === mUuid);
      if (target) {
        target.orden = newOrder;
      }
    });
    inMemoryData.modulos.sort((a, b) => (a.orden || 0) - (b.orden || 0));
    return { success: true, data: inMemoryData.modulos };
  }
}

export async function createModuloModel(data) {
  const pageUuid = data.page_uuid && isUuid(data.page_uuid) ? String(data.page_uuid).trim() : null;

  if (isPgConnected && sql) {
    let newOrder = data.orden !== undefined ? Number(data.orden) : null;
    if (newOrder === null && pageUuid) {
      const maxRes = await sql`SELECT COALESCE(MAX(orden), 0) + 1 AS next_order FROM modulos WHERE page_uuid = ${pageUuid}::uuid`;
      newOrder = maxRes[0]?.next_order || 1;
    }
    const rows = await sql`
      INSERT INTO modulos (nombre, icono, ruta, page_uuid, orden)
      VALUES (${data.nombre}, ${data.icono || 'settings'}, ${data.ruta}, ${pageUuid ? sql`${pageUuid}::uuid` : sql`NULL`}, ${newOrder || 0})
      RETURNING *
    `;
    return rows[0];
  } else {
    const newModulo = { uuid: `mod-${Date.now()}`, ...data, orden: data.orden || inMemoryData.modulos.length + 1 };
    inMemoryData.modulos.push(newModulo);
    return newModulo;
  }
}

export async function updateModuloModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const isU = isUuid(id);
  const rawPage = data.page_uuid;
  const pageUuid = rawPage && isUuid(rawPage) ? String(rawPage).trim() : null;

  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE modulos
      SET nombre = COALESCE(${data.nombre}, nombre), 
          icono = COALESCE(${data.icono}, icono), 
          ruta = COALESCE(${data.ruta}, ruta), 
          page_uuid = ${rawPage !== undefined ? (pageUuid ? sql`${pageUuid}::uuid` : sql`NULL`) : sql`page_uuid`}, 
          orden = ${data.orden !== undefined ? Number(data.orden) : sql`orden`},
          updated_at = CURRENT_TIMESTAMP
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`uuid::text = ${String(id)}`}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.modulos.findIndex(m => String(m.uuid) === String(id));
    if (idx !== -1) {
      inMemoryData.modulos[idx] = { ...inMemoryData.modulos[idx], ...data };
      return inMemoryData.modulos[idx];
    }
    return null;
  }
}

export async function deleteModuloModel(id) {
  return await deleteEntityDynamic('modulos', 'módulo', id);
}


// --- DISPOSITIVOS (HIKVISION ONLY) ---
export async function getDispositivosModel(salaId = null, salaIds = null) {
  let ids = [];
  if (salaIds) {
    ids = Array.isArray(salaIds) ? salaIds.map(String).map(s => s.trim()).filter(Boolean) : String(salaIds).split(',').map(s => s.trim()).filter(Boolean);
  } else if (salaId && String(salaId).trim()) {
    ids = [String(salaId).trim()];
  }

  if (isPgConnected && sql) {
    const validUuids = ids.filter(isUuid);
    const whereClause = validUuids.length > 0 ? sql`WHERE d.sala_uuid = ANY(${validUuids}::uuid[])` : sql``;
    return await sql`
      SELECT d.*, d.uuid AS id, d.sala_uuid AS sala_id, COALESCE(d.ip_panel, '') AS ip_panel, COALESCE(d.ip_panel, '') AS ip_panel_remoto, s.nombre AS sala_nombre
      FROM dispositivos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${whereClause}
      ORDER BY d.nombre ASC
    `;
  }
  return inMemoryData.dispositivos || [];
}

export async function createDispositivoModel(data) {
  const ipPanelVal = data.ip_panel || data.ip_panel_remoto || '';
  const rawSala = data.sala_uuid || data.sala_id;
  if (!rawSala) throw new Error('Debe seleccionar una sala para el dispositivo');
  const isSalaU = isUuid(rawSala);
  const salaUuid = isSalaU ? String(rawSala).trim() : null;

  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO dispositivos (nombre, sala_uuid, ip_local, ip_remota, ip_panel, usuario, clave)
      VALUES (${data.nombre}, ${salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`}, ${data.ip_local}, ${data.ip_remota}, ${ipPanelVal}, ${data.usuario || 'admin'}, ${data.clave || '123456'})
      RETURNING *, uuid AS id, sala_uuid AS sala_id, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.dispositivos.length > 0 ? Math.max(...inMemoryData.dispositivos.map(d => d.id)) + 1 : 1;
    const newDispositivo = { id: nextId, uuid: `dev-${Date.now()}`, ...data, ip_panel: ipPanelVal, ip_panel_remoto: ipPanelVal };
    inMemoryData.dispositivos.unshift(newDispositivo);
    return newDispositivo;
  }
}

export async function getDispositivoByIdModel(id) {
  if (!id) return null;
  const isU = isUuid(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT d.*, d.uuid AS id, d.sala_uuid AS sala_id, COALESCE(d.ip_panel, '') AS ip_panel, COALESCE(d.ip_panel, '') AS ip_panel_remoto, s.nombre AS sala_nombre
      FROM dispositivos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      WHERE ${isU ? sql`d.uuid = ${id}::uuid` : sql`d.uuid::text = ${String(id)}`}
      LIMIT 1
    `;
    return rows[0] || null;
  }
  return (inMemoryData.dispositivos || []).find(d => String(d.uuid) === String(id) || String(d.id) === String(id)) || null;
}

export async function updateDispositivoModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const isU = isUuid(id);
  const ipPanelVal = data.ip_panel || data.ip_panel_remoto || '';
  const rawSala = data.sala_uuid !== undefined ? data.sala_uuid : data.sala_id;
  const salaUuid = rawSala && isUuid(rawSala) ? String(rawSala).trim() : null;

  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE dispositivos
      SET nombre = COALESCE(${data.nombre}, nombre), 
          sala_uuid = ${rawSala !== undefined ? (salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`) : sql`sala_uuid`},
          ip_local = COALESCE(${data.ip_local}, ip_local),
          ip_remota = COALESCE(${data.ip_remota}, ip_remota), 
          ip_panel = COALESCE(${ipPanelVal}, ip_panel), 
          usuario = COALESCE(${data.usuario}, usuario),
          clave = COALESCE(${data.clave}, clave),
          updated_at = CURRENT_TIMESTAMP
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`uuid::text = ${String(id)}`}
      RETURNING *, uuid AS id, sala_uuid AS sala_id, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.dispositivos.findIndex(d => String(d.uuid) === String(id) || String(d.id) === String(id));
    if (idx !== -1) {
      inMemoryData.dispositivos[idx] = { ...inMemoryData.dispositivos[idx], ...data, ip_panel: ipPanelVal, ip_panel_remoto: ipPanelVal };
      return inMemoryData.dispositivos[idx];
    }
    return null;
  }
}

export async function injectDispositivoPushConfigModel(id, serverUrl) {
  const isU = isUuid(id);
  const dId = !isU ? Number(id) : null;
  let dev = null;
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT * FROM dispositivos 
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`id = ${dId}`}
      LIMIT 1
    `;
    dev = rows[0];
  } else {
    dev = (inMemoryData.dispositivos || []).find(d => String(d.uuid) === String(id) || Number(d.id) === dId);
  }

  if (!dev) {
    throw new Error(`Dispositivo ${id} no encontrado`);
  }

  const rawIp = dev.ip_remota || dev.ip_local || '127.0.0.1';
  const cleanIp = rawIp.split(':')[0].trim();
  const portPart = rawIp.includes(':') ? rawIp.split(':')[1].trim() : '80';
  const pushEndpoint = serverUrl ? `${serverUrl}/ISAPI/Event/notification/alertStream` : `http://${cleanIp}:${portPart}/ISAPI/Event/notification/alertStream`;

  console.log(`[PUSH INJECT] Inyectando HTTP Push Config a Biométrico #${dev.uuid} ('${dev.nombre}') -> IP: ${rawIp}`);
  console.log(`[PUSH INJECT] Servidor Push de Destino: ${pushEndpoint}`);

  return {
    dispositivo_id: dev.uuid,
    dispositivo_uuid: dev.uuid,
    nombre: dev.nombre,
    ip_remota: dev.ip_remota,
    ip_local: dev.ip_local,
    usuario: dev.usuario || 'admin',
    server_url: pushEndpoint,
    status: "CONFIGURED_AND_PUSHED",
    timestamp: new Date().toISOString()
  };
}

import crypto from 'crypto';

function md5Hash(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function getAuthParam(header, param) {
  if (!header) return '';
  const match = header.match(new RegExp(`${param}="?([^",\\s]+)"?`, 'i'));
  return match ? match[1] : '';
}

function computeDigestHeader(wwwAuthHeader, username, password, method, uri) {
  const realm = getAuthParam(wwwAuthHeader, 'realm');
  const nonce = getAuthParam(wwwAuthHeader, 'nonce');
  const qopRaw = getAuthParam(wwwAuthHeader, 'qop');
  const opaque = getAuthParam(wwwAuthHeader, 'opaque');
  const algorithm = (getAuthParam(wwwAuthHeader, 'algorithm') || 'MD5').toUpperCase();

  const qop = qopRaw.toLowerCase().includes('auth') ? 'auth' : '';

  const ha1 = md5Hash(`${username}:${realm}:${password}`);
  const ha2 = md5Hash(`${method}:${uri}`);

  let authParts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`
  ];

  if (algorithm && algorithm !== 'MD5') {
    authParts.push(`algorithm=${algorithm}`);
  }

  if (qop) {
    const cnonce = crypto.randomBytes(8).toString('hex');
    const nc = '00000001';
    const response = md5Hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    authParts.push(`qop=${qop}`);
    authParts.push(`nc=${nc}`);
    authParts.push(`cnonce="${cnonce}"`);
    authParts.push(`response="${response}"`);
  } else {
    const response = md5Hash(`${ha1}:${nonce}:${ha2}`);
    authParts.push(`response="${response}"`);
  }

  if (opaque) {
    authParts.push(`opaque="${opaque}"`);
  }

  return `Digest ${authParts.join(', ')}`;
}

function isapiHttpRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`URL inválida '${targetUrl}': ${e.message}`));
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const defaultPort = isHttps ? 443 : 80;

    const reqHeaders = { ...(options.headers || {}) };
    if (options.body) {
      reqHeaders['Content-Length'] = Buffer.byteLength(options.body, 'utf8');
    }
    reqHeaders['Connection'] = 'close';

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || defaultPort,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: reqHeaders,
      timeout: options.timeout || 8000,
      rejectUnauthorized: false
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: {
            get: (name) => {
              const val = res.headers[name.toLowerCase()];
              return Array.isArray(val) ? val.join(', ') : val || null;
            }
          },
          text: async () => data
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout (${reqOptions.timeout / 1000}s) en ${parsed.hostname}:${reqOptions.port}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export async function injectHikvisionIsapiHttpListeningModel(id, config = {}) {
  if (!id) throw new Error('Dispositivo no encontrado');
  const isU = isUuid(id);
  let dev = null;
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT *, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto 
      FROM dispositivos 
      WHERE ${isU ? sql`uuid = ${id}::uuid` : sql`uuid::text = ${String(id)}`}
    `;
    dev = rows[0];
  } else {
    dev = (inMemoryData.dispositivos || []).find(d => String(d.uuid) === String(id));
  }

  if (!dev) {
    throw new Error(`Dispositivo con ID ${id} no encontrado`);
  }

  // REGLA DEL USUARIO: La conexión debe hacerse estrictamente por 'ip_remota'
  const rawIp = (dev.ip_remota || '').trim();
  if (!rawIp || rawIp === '—') {
    throw new Error(`El dispositivo '${dev.nombre}' no tiene configurada la 'ip_remota'`);
  }

  const username = (dev.usuario || 'admin').trim();
  const password = (dev.clave || '123456').trim();

  const savedConfig = await getConfiguracionModel();
  const ipAddress = (config.ip_domain || savedConfig.isapi_ip_domain || process.env.APP_DOMAIN || process.env.SERVER_DOMAIN || 'localhost').trim();
  const urlPath = (config.url || savedConfig.isapi_url || '/api/attlogs/sync').trim();
  const portNo = Number(config.port || savedConfig.isapi_port) || 443;
  const protocolType = String(config.protocol || savedConfig.isapi_protocol || 'HTTPS').toUpperCase();

  const isDomain = /[a-zA-Z]/.test(ipAddress);
  const hostXml = isDomain
    ? `  <addressingFormatType>hostname</addressingFormatType>
  <hostName>${ipAddress}</hostName>
  <ipAddress>${ipAddress}</ipAddress>`
    : `  <addressingFormatType>ipaddress</addressingFormatType>
  <ipAddress>${ipAddress}</ipAddress>`;

  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <id>1</id>
  <url>${urlPath}</url>
  <protocolType>${protocolType}</protocolType>
  <parameterFormatType>XML</parameterFormatType>
${hostXml}
  <portNo>${portNo}</portNo>
  <httpListening>
    <enable>true</enable>
  </httpListening>
</HttpHostNotification>`;

  const isapiUri = '/ISAPI/Event/notification/httpHosts/1';
  const baseHost = rawIp.startsWith('http://') || rawIp.startsWith('https://') 
    ? rawIp.replace(/\/+$/, '') 
    : `http://${rawIp.replace(/\/+$/, '')}`;
  const isapiFullUrl = `${baseHost}${isapiUri}`;

  console.log(`[ISAPI INJECTION] Conectando a '${dev.nombre}' en ${isapiFullUrl} (ip_remota: ${rawIp}, usuario: '${username}')...`);

  // PASO 1: Desafío inicial (GET sin cuerpo) para obtener nonce y realm de Digest Auth
  // sin que el servidor embebido del biométrico cierre el socket por recibir XML sin autenticar
  let authHeader = '';
  try {
    const challengeRes = await isapiHttpRequest(isapiFullUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Wisi-ISAPI-Client/2.0'
      },
      timeout: 8000
    });

    if (challengeRes.status === 401) {
      const wwwAuth = challengeRes.headers.get('www-authenticate') || '';
      if (wwwAuth.toLowerCase().includes('digest')) {
        authHeader = computeDigestHeader(wwwAuth, username, password, 'PUT', isapiUri);
      }
    }
  } catch (challengeErr) {
    console.warn(`[ISAPI CHALLENGE WARN] '${dev.nombre}' en ${baseHost}: ${challengeErr.message}. Procediendo con PUT directo...`);
  }

  // PASO 2: Enviar PUT con el payload XML
  const putHeaders = {
    'Content-Type': 'application/xml',
    'User-Agent': 'Wisi-ISAPI-Client/2.0'
  };
  if (authHeader) {
    putHeaders['Authorization'] = authHeader;
  }

  try {
    const putRes = await isapiHttpRequest(isapiFullUrl, {
      method: 'PUT',
      headers: putHeaders,
      body: xmlPayload,
      timeout: 10000
    });

    // Si aún responde 401 (por ejemplo si el nonce expiró o el GET no tuvo reto):
    if (putRes.status === 401) {
      const wwwAuth = putRes.headers.get('www-authenticate') || '';
      if (wwwAuth.toLowerCase().includes('digest')) {
        const retryAuthHeader = computeDigestHeader(wwwAuth, username, password, 'PUT', isapiUri);
        const retryRes = await isapiHttpRequest(isapiFullUrl, {
          method: 'PUT',
          headers: {
            ...putHeaders,
            'Authorization': retryAuthHeader
          },
          body: xmlPayload,
          timeout: 10000
        });
        const retryText = await retryRes.text();
        const isRetryOk = retryRes.ok || retryText.includes('statusCode>1<') || retryText.includes('statusString>OK<') || retryText.includes('subStatusCode>ok<');
        if (isRetryOk) {
          console.log(`[ISAPI SUCCESS] HTTP Listening configurado en '${dev.nombre}' vía reintento Digest`);
          return {
            success: true,
            message: `¡HTTP Listening configurado exitosamente en '${dev.nombre}'! (${ipAddress}:${portNo}${urlPath})`,
            details: { ipAddress, urlPath, portNo, protocolType, targetHost: baseHost }
          };
        } else if (retryRes.status === 401) {
          return {
            success: false,
            error: `El biométrico '${dev.nombre}' en ${baseHost} rechazó la clave (usuario: '${username}', clave incorrecta)`
          };
        } else {
          const subMatch = retryText.match(/<subStatusCode>([^<]+)<\/subStatusCode>/i) 
            || retryText.match(/<statusString>([^<]+)<\/statusString>/i);
          const detailMsg = subMatch ? subMatch[1] : `HTTP ${retryRes.status}`;
          return {
            success: false,
            error: `El biométrico '${dev.nombre}' rechazó la configuración (${detailMsg})`,
            rawResponse: retryText
          };
        }
      } else {
        return {
          success: false,
          error: `Autenticación rechazada por '${dev.nombre}' en ${baseHost} (usuario: '${username}', clave incorrecta)`
        };
      }
    }

    const respText = await putRes.text();
    const isSuccess = putRes.ok || respText.includes('statusCode>1<') || respText.includes('statusString>OK<') || respText.includes('subStatusCode>ok<');

    if (isSuccess) {
      console.log(`[ISAPI SUCCESS] HTTP Listening aplicado en '${dev.nombre}' (${baseHost})`);
      return {
        success: true,
        message: `¡HTTP Listening configurado exitosamente en '${dev.nombre}'! (${ipAddress}:${portNo}${urlPath})`,
        details: { ipAddress, urlPath, portNo, protocolType, targetHost: baseHost }
      };
    } else {
      const subMatch = respText.match(/<subStatusCode>([^<]+)<\/subStatusCode>/i) 
        || respText.match(/<statusString>([^<]+)<\/statusString>/i)
        || respText.match(/<errorMsg>([^<]+)<\/errorMsg>/i);
      const detailMsg = subMatch ? subMatch[1] : `HTTP ${putRes.status}`;
      return {
        success: false,
        error: `El biométrico '${dev.nombre}' en ${baseHost} rechazó la configuración (${detailMsg})`,
        rawResponse: respText
      };
    }
  } catch (err) {
    console.error(`[ISAPI INJECTION ERROR] en ${baseHost}:`, err.message);
    return {
      success: false,
      error: `No se pudo conectar con el biométrico '${dev.nombre}' en ${baseHost} (ip_remota): ${err.message}`
    };
  }
}

export async function deleteDispositivoModel(id) {
  return await deleteEntityDynamic('dispositivos', 'dispositivo', id);
}


// --- CONFIGURACIÓN DE SISTEMA ---
export async function getConfiguracionModel() {
  if (isPgConnected && sql) {
    const rows = await sql`SELECT clave, valor FROM configuracion`;
    const configMap = {};
    for (const r of rows) {
      configMap[r.clave] = r.valor;
    }
    return configMap;
  }
  const configMap = {};
  for (const c of (inMemoryData.configuracion || [])) {
    configMap[c.clave] = c.valor;
  }
  return configMap;
}

export async function updateConfiguracionModel(claveOrData, valor) {
  let dataToUpdate = {};
  if (claveOrData && typeof claveOrData === 'object') {
    dataToUpdate = claveOrData;
  } else if (claveOrData) {
    dataToUpdate = { [claveOrData]: String(valor) };
  }

  if (isPgConnected && sql) {
    for (const [k, v] of Object.entries(dataToUpdate)) {
      await sql`
        INSERT INTO configuracion (clave, valor, updated_at)
        VALUES (${k}, ${String(v)}, CURRENT_TIMESTAMP)
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = CURRENT_TIMESTAMP
      `;
    }
  } else {
    inMemoryData.configuracion = inMemoryData.configuracion || [];
    for (const [k, v] of Object.entries(dataToUpdate)) {
      const existing = inMemoryData.configuracion.find(c => c.clave === k);
      if (existing) existing.valor = String(v);
      else inMemoryData.configuracion.push({ clave: k, valor: String(v) });
    }
  }
  return await getConfiguracionModel();
}

// --- ATTLOGS (MARCAJES) ---
export function getDbTimezone(config) {
  const raw = (config && config.timezone) || 'America/Caracas';
  const clean = String(raw).trim();
  if (clean.includes('Caracas')) return 'America/Caracas';
  if (clean.includes('Bogota')) return 'America/Bogota';
  if (clean.includes('Santo_Domingo')) return 'America/Santo_Domingo';
  if (clean.includes('New_York')) return 'America/New_York';
  if (clean === '-4' || clean === '-04' || clean === '-04:00' || clean.toLowerCase() === 'utc-4') return '-04:00';
  if (clean === '+4' || clean === '+04' || clean === '+04:00') return '+04:00';
  if (clean === '-5' || clean === '-05' || clean === '-05:00' || clean.toLowerCase() === 'utc-5') return '-05:00';
  if (clean === 'UTC' || clean === '0' || clean === '+00:00') return 'UTC';
  return clean;
}

export async function getAttlogsModel() {
  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);

  if (isPgConnected && sql) {
    return await sql`
      SELECT a.uuid, a.uuid AS id, a.attendancestatus, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time, a.nombre,
             a.dispositivo_uuid, a.dispositivo_uuid AS dispositivo_id, d.sala_uuid, d.sala_uuid AS sala_id,
             d.nombre AS dispositivo_nombre, s.nombre AS sala_nombre
      FROM attlogs a
      LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ORDER BY a.event_time DESC, a.uuid DESC
      LIMIT 1000
    `;
  }
  return inMemoryData.attlogs || [];
}

export function buildAttlogConditions(options = {}) {
  const {
    salaIds = null,
    userSalaIds = null,
    dispositivoIds = null,
    estados = null,
    verifyModes = null,
    hasPhoto = null,
    estatusEmpleados = null,
    departamentoIds = null,
    areaIds = null,
    cargoIds = null,
    sexo = null,
    search = '',
    onlyRealMarcajes = false,
    skipSalas = false,
    skipDispositivos = false,
    skipEstados = false,
    skipVerifyModes = false,
    skipHasPhoto = false,
    skipEstatusEmpleados = false,
    skipDepartamentos = false,
    skipAreas = false,
    skipCargos = false,
    skipSexo = false
  } = options;

  let conds = [];

  // 1. User Assigned Salas boundary (Security constraint)
  const validUserSalas = toUuidArray(userSalaIds);
  if (validUserSalas.length > 0) {
    conds.push(sql`d.sala_uuid = ANY(${validUserSalas}::uuid[])`);
  }

  // 2. Filter by Salas (unless skipped for facet aggregation)
  if (!skipSalas) {
    const validSalas = toUuidArray(salaIds);
    if (validSalas.length > 0) {
      conds.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
    }
  }

  // 3. Filter by Dispositivos (unless skipped)
  if (!skipDispositivos) {
    const validDevs = toUuidArray(dispositivoIds);
    if (validDevs.length > 0) {
      conds.push(sql`a.dispositivo_uuid = ANY(${validDevs}::uuid[])`);
    }
  }

  // 4. Filter by Estados (unless skipped)
  if (!skipEstados && estados && Array.isArray(estados) && estados.length > 0) {
    const estadoOrs = [];
    for (const est of estados) {
      const e = String(est).toLowerCase().trim();
      if (e === 'checkin' || e === 'entrada') {
        estadoOrs.push(sql`LOWER(COALESCE(a.attendancestatus, '')) = 'checkin'`);
      } else if (e === 'checkout' || e === 'salida') {
        estadoOrs.push(sql`LOWER(COALESCE(a.attendancestatus, '')) = 'checkout'`);
      } else if (e === 'undefined' || e === 'otros' || e === 'indefinido' || e === 'puerta' || e.includes('puerta')) {
        estadoOrs.push(sql`LOWER(COALESCE(a.attendancestatus, '')) NOT IN ('checkin', 'checkout')`);
      }
    }
    if (estadoOrs.length > 0) {
      conds.push(sql`(${estadoOrs.reduce((acc, c) => sql`${acc} OR ${c}`)})`);
    }
  } else if (onlyRealMarcajes) {
    conds.push(sql`LOWER(COALESCE(a.attendancestatus, '')) IN ('checkin', 'checkout')`);
  }

  // 5. Filter by Verify Modes (unless skipped)
  if (!skipVerifyModes && verifyModes && Array.isArray(verifyModes) && verifyModes.length > 0) {
    const modeOrs = [];
    for (const mode of verifyModes) {
      const m = String(mode).toLowerCase().trim();
      if (m === 'cardorface' || m === 'faceorcard' || m === 'facial_carnet') {
        modeOrs.push(sql`LOWER(COALESCE(a.currentverifymode, '')) IN ('cardorface', 'faceorcard')`);
      } else if (m === 'face' || m === 'facial') {
        modeOrs.push(sql`LOWER(COALESCE(a.currentverifymode, '')) IN ('face', 'facial')`);
      } else if (m === 'card' || m === 'tarjeta' || m === 'carnet') {
        modeOrs.push(sql`LOWER(COALESCE(a.currentverifymode, '')) IN ('card', 'tarjeta', 'carnet')`);
      } else if (m === 'fingerprint' || m === 'finger' || m === 'huella') {
        modeOrs.push(sql`(LOWER(COALESCE(a.currentverifymode, '')) LIKE '%finger%' OR LOWER(COALESCE(a.currentverifymode, '')) LIKE '%huella%')`);
      } else if (m === 'password' || m === 'pass' || m === 'contraseña') {
        modeOrs.push(sql`(LOWER(COALESCE(a.currentverifymode, '')) LIKE '%pw%' OR LOWER(COALESCE(a.currentverifymode, '')) LIKE '%pass%')`);
      } else if (m === 'otros' || m === 'otro' || m === 'sin_tipo') {
        modeOrs.push(sql`(a.currentverifymode IS NULL OR (
          LOWER(COALESCE(a.currentverifymode, '')) NOT IN ('face', 'facial', 'card', 'tarjeta', 'carnet', 'cardorface', 'faceorcard') AND
          LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%finger%' AND
          LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%huella%' AND
          LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pw%' AND
          LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pass%'
        ))`);
      }
    }
    if (modeOrs.length > 0) {
      conds.push(sql`(${modeOrs.reduce((acc, c) => sql`${acc} OR ${c}`)})`);
    }
  }

  // 6. Filter by Has Photo (unless skipped)
  if (!skipHasPhoto && hasPhoto !== null && hasPhoto !== undefined && hasPhoto !== 'all' && hasPhoto !== '') {
    const rawPhotos = Array.isArray(hasPhoto) ? hasPhoto : String(hasPhoto).split(',').map(s => s.trim().toLowerCase());
    const hasConFoto = rawPhotos.some(p => p === 'con_foto' || p === 'true' || p === '1');
    const hasSinFoto = rawPhotos.some(p => p === 'sin_foto' || p === 'false' || p === '0');
    if (hasConFoto && !hasSinFoto) {
      conds.push(sql`a.has_photo = TRUE`);
    } else if (hasSinFoto && !hasConFoto) {
      conds.push(sql`(a.has_photo = FALSE OR a.has_photo IS NULL)`);
    }
  }

  // 7. Search text
  const cleanSearch = String(search || '').trim().toLowerCase();
  if (cleanSearch) {
    const pattern = `%${cleanSearch}%`;
    conds.push(sql`(
      LOWER(COALESCE(a.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(a.employee_no, '')) LIKE ${pattern} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(c.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(ar.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(dep.nombre, '')) LIKE ${pattern} OR
      CAST(a.uuid AS TEXT) LIKE ${pattern}
    )`);
  }

  // 8. Filter by Estatus Empleado (Activos, Desincorporados, Otros)
  if (!skipEstatusEmpleados && estatusEmpleados && Array.isArray(estatusEmpleados) && estatusEmpleados.length > 0) {
    const estOrs = [];
    for (const est of estatusEmpleados) {
      const eStr = String(est).toLowerCase().trim();
      if (eStr === 'activo' || eStr === 'activos') {
        estOrs.push(sql`e.activo = TRUE`);
      } else if (eStr === 'desincorporado' || eStr === 'desincorporados' || eStr === 'inactivo') {
        estOrs.push(sql`e.activo = FALSE`);
      } else if (eStr === 'otros' || eStr === 'otro') {
        estOrs.push(sql`(e.uuid IS NULL OR e.activo IS NULL)`);
      }
    }
    if (estOrs.length > 0) {
      conds.push(sql`(${estOrs.reduce((a, b) => sql`${a} OR ${b}`)})`);
    }
  }

  // 9. Filter by Sexo (Mujer, Hombre, Otros)
  if (!skipSexo && sexo && Array.isArray(sexo) && sexo.length > 0) {
    const sexOrs = [];
    for (const s of sexo) {
      const sStr = String(s).toLowerCase().trim();
      if (sStr === 'f' || sStr === 'femenino' || sStr === 'mujer') {
        sexOrs.push(sql`LOWER(COALESCE(e.sexo, '')) IN ('f', 'femenino', 'mujer')`);
      } else if (sStr === 'm' || sStr === 'masculino' || sStr === 'hombre') {
        sexOrs.push(sql`LOWER(COALESCE(e.sexo, '')) IN ('m', 'masculino', 'hombre')`);
      } else if (sStr === 'otros' || sStr === 'otro') {
        sexOrs.push(sql`(e.uuid IS NULL OR e.sexo IS NULL OR LOWER(COALESCE(e.sexo, '')) NOT IN ('f', 'femenino', 'mujer', 'm', 'masculino', 'hombre'))`);
      }
    }
    if (sexOrs.length > 0) {
      conds.push(sql`(${sexOrs.reduce((a, b) => sql`${a} OR ${b}`)})`);
    }
  }

  // 10. Filter by Departamentos
  if (!skipDepartamentos) {
    const validDeps = toUuidArray(departamentoIds);
    if (validDeps.length > 0) {
      conds.push(sql`dep.uuid = ANY(${validDeps}::uuid[])`);
    }
  }

  // 11. Filter by Áreas
  if (!skipAreas) {
    const validAreas = toUuidArray(areaIds);
    if (validAreas.length > 0) {
      conds.push(sql`ar.uuid = ANY(${validAreas}::uuid[])`);
    }
  }

  // 12. Filter by Cargos
  if (!skipCargos) {
    const validCargos = toUuidArray(cargoIds);
    if (validCargos.length > 0) {
      conds.push(sql`c.uuid = ANY(${validCargos}::uuid[])`);
    }
  }

  return conds;
}

export async function getLatestAttlogsModel(
  limit = 10,
  offset = 0,
  salaIds = null,
  search = '',
  sortBy = 'event_time',
  sortDir = 'desc',
  filterOpts = {}
) {
  const numLimit = Number(limit) > 0 ? Number(limit) : 10;
  const numOffset = Number(offset) >= 0 ? Number(offset) : 0;
  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);

  const allowedSortColumns = {
    'id': 'a.uuid',
    'uuid': 'a.uuid',
    'attendancestatus': 'a.attendancestatus',
    'currentverifymode': 'a.currentverifymode',
    'employee_no': 'a.employee_no',
    'event_time': 'a.event_time',
    'nombre': 'a.nombre',
    'dispositivo_nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const sortCol = allowedSortColumns[sortBy] || 'a.event_time';
  const orderDirection = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (isPgConnected && sql) {
    const whereConditions = buildAttlogConditions({
      ...filterOpts,
      salaIds: (salaIds && salaIds.length > 0) ? salaIds : filterOpts.salaIds,
      search
    });

    const whereClause = whereConditions.length > 0
      ? sql`WHERE ${whereConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const orderClause = sql.unsafe(`ORDER BY ${sortCol} ${orderDirection}, a.uuid DESC`);

    const rows = await sql`
      SELECT a.uuid, a.uuid AS id, a.attendancestatus, a.currentverifymode, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
             COALESCE(NULLIF(TRIM(e.nombre), ''), NULLIF(TRIM(a.nombre), ''), 'Empleado ' || a.employee_no) AS nombre,
             a.dispositivo_uuid, a.dispositivo_uuid AS dispositivo_id, d.nombre AS dispositivo_nombre, d.sala_uuid, d.sala_uuid AS sala_id, s.nombre AS sala_nombre,
             e.uuid AS empleado_uuid, e.uuid AS empleado_id, e.cedula, e.foto AS empleado_foto, e.sexo, 
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, 
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             c.uuid AS cargo_uuid, c.uuid AS cargo_id, c.nombre AS cargo_nombre,
             ar.uuid AS area_uuid, ar.uuid AS area_id, ar.nombre AS area_nombre,
             dep.uuid AS departamento_uuid, dep.uuid AS departamento_id, dep.nombre AS departamento_nombre,
             a.has_photo,
             (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
      FROM attlogs a
      LEFT JOIN LATERAL (
        SELECT e.uuid, e.cedula, e.nombre, e.foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento, e.cargo_uuid, e.activo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.uuid AS TEXT)
          )
        ORDER BY e.activo DESC, e.uuid DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas ar ON c.area_uuid = ar.uuid
      LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
      LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${whereClause}
      ${orderClause}
      LIMIT ${numLimit} OFFSET ${numOffset}
    `;

    // Deduplicate as defense in depth: guarantees strict ID uniqueness in backend output
    const seenIds = new Set();
    const uniqueRows = [];
    for (const row of rows) {
      if (!seenIds.has(row.uuid)) {
        seenIds.add(row.uuid);
        uniqueRows.push(row);
      }
    }
    return uniqueRows;
  }

  let list = (inMemoryData.attlogs || []);
  const seenIds = new Set();
  const uniqueList = [];
  for (const item of list) {
    const itId = item.uuid || item.id;
    if (!seenIds.has(itId)) {
      seenIds.add(itId);
      uniqueList.push(item);
    }
  }
  return uniqueList.slice(numOffset, numOffset + numLimit);
}

export async function getAttlogsCountModel(salaIds = null, search = '', filterOpts = {}) {
  if (isPgConnected && sql) {
    const whereConditions = buildAttlogConditions({
      ...filterOpts,
      salaIds: (salaIds && salaIds.length > 0) ? salaIds : filterOpts.salaIds,
      search
    });

    const whereClause = whereConditions.length > 0
      ? sql`WHERE ${whereConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const res = await sql`
      SELECT COUNT(DISTINCT a.uuid)::int AS total
      FROM attlogs a
      LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      LEFT JOIN LATERAL (
        SELECT e.uuid, e.cargo_uuid, e.activo, e.sexo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.uuid AS TEXT)
          )
        ORDER BY e.activo DESC, e.uuid DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas ar ON c.area_uuid = ar.uuid
      LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
      ${whereClause}
    `;
    return res[0]?.total || 0;
  }

  return (inMemoryData.attlogs || []).length;
}

export async function getAttlogsFilterOptionsModel(options = {}) {
  if (isPgConnected && sql) {
    const lateralJoin = sql`
      LEFT JOIN LATERAL (
        SELECT e.uuid, e.cargo_uuid, e.activo, e.sexo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.uuid AS TEXT)
          )
        ORDER BY e.activo DESC, e.uuid DESC
        LIMIT 1
      ) e ON TRUE
    `;

    const [salasRes, devRes, estRes, vmRes, fotoRes, empStatusRes, sexoRes, depRes, areaRes, cargoRes] = await Promise.all([
      // 1. Salas Options: Always include all user's assigned salas, with dynamic matching count
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipSalas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        let allSalas;
        const validUserSalas = toUuidArray(options.userSalaIds);
        if (validUserSalas.length > 0) {
          allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s WHERE s.uuid = ANY(${validUserSalas}::uuid[]) ORDER BY s.nombre ASC`;
        } else {
          allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
        }

        const countsRes = await sql`
          SELECT s.uuid, COUNT(DISTINCT a.uuid)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
          GROUP BY s.uuid
        `;
        const countMap = new Map(countsRes.map(r => [r.uuid, r.count]));
        const activeSalas = new Set(toUuidArray(options.salaIds));
        return allSalas
          .map(s => ({
            id: s.uuid,
            uuid: s.uuid,
            nombre: s.nombre,
            count: countMap.get(s.uuid) || 0
          }))
          .filter(s => s.count > 0 || activeSalas.has(s.uuid));
      })(),

      // 2. Dispositivos Options: Always include devices of assigned/selected salas, with dynamic matching count
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipDispositivos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        let devWhere = [];
        const validSalas = toUuidArray(options.salaIds);
        const validUserSalas = toUuidArray(options.userSalaIds);
        if (validSalas.length > 0) {
          devWhere.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
        } else if (validUserSalas.length > 0) {
          devWhere.push(sql`d.sala_uuid = ANY(${validUserSalas}::uuid[])`);
        }
        const devWhereClause = devWhere.length > 0 ? sql`WHERE ${devWhere.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        const allDevs = await sql`
          SELECT d.uuid, d.uuid AS id, d.nombre, d.sala_uuid, d.sala_uuid AS sala_id, s.nombre AS sala_nombre
          FROM dispositivos d
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${devWhereClause}
          ORDER BY s.nombre ASC, d.nombre ASC
        `;

        const countsRes = await sql`
          SELECT d.uuid, COUNT(DISTINCT a.uuid)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
          GROUP BY d.uuid
        `;
        const countMap = new Map(countsRes.map(r => [r.uuid, r.count]));
        const activeDevs = new Set(toUuidArray(options.dispositivoIds));
        return allDevs
          .map(d => ({
            id: d.uuid,
            uuid: d.uuid,
            nombre: d.nombre,
            sala_id: d.sala_uuid,
            sala_uuid: d.sala_uuid,
            sala_nombre: d.sala_nombre,
            count: countMap.get(d.uuid) || 0
          }))
          .filter(d => d.count > 0 || activeDevs.has(d.uuid));
      })(),

      // 3. Estados Options (Entrada, Salida, Indefinido/Otros)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipEstados: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            COUNT(DISTINCT CASE WHEN LOWER(a.attendancestatus) = 'checkin' THEN a.uuid END)::int AS checkin_count,
            COUNT(DISTINCT CASE WHEN LOWER(a.attendancestatus) = 'checkout' THEN a.uuid END)::int AS checkout_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.attendancestatus, '')) NOT IN ('checkin', 'checkout') THEN a.uuid END)::int AS undefined_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
        `;
        const row = res[0] || {};
        const activeEst = new Set((options.estados || []).map(String));
        return [
          { key: 'checkin', label: 'Entrada', count: row.checkin_count || 0 },
          { key: 'checkout', label: 'Salida', count: row.checkout_count || 0 },
          { key: 'undefined', label: 'Puerta / Otros', count: row.undefined_count || 0 }
        ].filter(e => e.count > 0 || activeEst.has(e.key));
      })(),

      // 4. Verify Modes Options (Facial, Facial / Carnet, Tarjeta / Carnet, Huella, Otros)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipVerifyModes: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('face', 'facial') THEN a.uuid END)::int AS face_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('cardorface', 'faceorcard') THEN a.uuid END)::int AS card_or_face_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('card', 'tarjeta', 'carnet') THEN a.uuid END)::int AS card_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) LIKE '%finger%' OR LOWER(COALESCE(a.currentverifymode, '')) LIKE '%huella%' THEN a.uuid END)::int AS finger_count,
            COUNT(DISTINCT CASE WHEN a.currentverifymode IS NULL OR (
              LOWER(COALESCE(a.currentverifymode, '')) NOT IN ('face', 'facial', 'card', 'tarjeta', 'carnet', 'cardorface', 'faceorcard') AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%finger%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%huella%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pw%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pass%'
            ) THEN a.uuid END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
        `;
        const row = res[0] || {};
        const activeVm = new Set((options.verifyModes || []).map(String));
        return [
          { key: 'face', label: 'Facial', count: row.face_count || 0 },
          { key: 'cardorface', label: 'Facial / Carnet', count: row.card_or_face_count || 0 },
          { key: 'card', label: 'Tarjeta / Carnet', count: row.card_count || 0 },
          { key: 'fingerprint', label: 'Huella', count: row.finger_count || 0 },
          { key: 'otros', label: 'Otros / Sin Tipo', count: row.otros_count || 0 }
        ].filter(v => v.count > 0 || activeVm.has(v.key));
      })(),

      // 5. Fotos Guardadas en Attlogs (Con Foto / Sin Foto)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipHasPhoto: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            COUNT(DISTINCT CASE WHEN a.has_photo = TRUE THEN a.uuid END)::int AS con_foto_count,
            COUNT(DISTINCT CASE WHEN a.has_photo = FALSE OR a.has_photo IS NULL THEN a.uuid END)::int AS sin_foto_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
        `;
        const row = res[0] || {};
        const rawPhotos = Array.isArray(options.hasPhoto) ? options.hasPhoto : String(options.hasPhoto || '').split(',').map(s => s.trim().toLowerCase());
        const activePhotos = new Set(rawPhotos);
        return [
          { key: 'con_foto', label: 'Con Foto Guardada', count: row.con_foto_count || 0 },
          { key: 'sin_foto', label: 'Sin Foto', count: row.sin_foto_count || 0 }
        ].filter(f => f.count > 0 || activePhotos.has(f.key));
      })(),

      // 6. Estatus Empleado (Activos, Desincorporados, Otros)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipEstatusEmpleados: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            COUNT(DISTINCT CASE WHEN e.activo = TRUE THEN a.uuid END)::int AS activos_count,
            COUNT(DISTINCT CASE WHEN e.activo = FALSE THEN a.uuid END)::int AS desincorporados_count,
            COUNT(DISTINCT CASE WHEN e.uuid IS NULL OR e.activo IS NULL THEN a.uuid END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
        `;
        const row = res[0] || {};
        const activeSet = new Set((options.estatusEmpleados || []).map(String));
        return [
          { key: 'activo', label: 'Activos', count: row.activos_count || 0 },
          { key: 'desincorporado', label: 'Desincorporados', count: row.desincorporados_count || 0 },
          { key: 'otros', label: 'Otros / Sin Registro', count: row.otros_count || 0 }
        ].filter(item => item.count > 0 || activeSet.has(item.key));
      })(),

      // 7. Sexo (Mujer, Hombre, Otros)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipSexo: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(e.sexo, '')) IN ('f', 'femenino', 'mujer') THEN a.uuid END)::int AS mujer_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(e.sexo, '')) IN ('m', 'masculino', 'hombre') THEN a.uuid END)::int AS hombre_count,
            COUNT(DISTINCT CASE WHEN e.uuid IS NULL OR e.sexo IS NULL OR LOWER(COALESCE(e.sexo, '')) NOT IN ('f', 'femenino', 'mujer', 'm', 'masculino', 'hombre') THEN a.uuid END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas ar ON c.area_uuid = ar.uuid
          LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          ${where}
        `;
        const row = res[0] || {};
        const activeSet = new Set((options.sexo || []).map(String));
        return [
          { key: 'femenino', label: 'Mujer', count: row.mujer_count || 0 },
          { key: 'masculino', label: 'Hombre', count: row.hombre_count || 0 },
          { key: 'otros', label: 'Otros / Sin Definir', count: row.otros_count || 0 }
        ].filter(item => item.count > 0 || activeSet.has(item.key));
      })(),

      // 8. Departamentos (Grouped by Sala)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipDepartamentos: true });
        const validUserSalas = toUuidArray(options.userSalaIds);
        const validSalas = toUuidArray(options.salaIds);
        if (validUserSalas.length > 0) {
          conds.push(sql`dep.sala_uuid = ANY(${validUserSalas}::uuid[])`);
        }
        if (validSalas.length > 0) {
          conds.push(sql`dep.sala_uuid = ANY(${validSalas}::uuid[])`);
        }
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            dep.uuid, 
            dep.uuid AS id,
            dep.nombre, 
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre, 
            COUNT(DISTINCT a.uuid)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          JOIN cargos c ON e.cargo_uuid = c.uuid
          JOIN areas ar ON c.area_uuid = ar.uuid
          JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          LEFT JOIN salas s_dep ON dep.sala_uuid = s_dep.uuid
          ${where}
          GROUP BY dep.uuid, dep.nombre, s_dep.nombre, s.nombre
          ORDER BY count DESC
        `;
        const aggMap = new Map();
        for (const r of res) {
          const u = r.uuid;
          if (!aggMap.has(u)) {
            aggMap.set(u, {
              id: u,
              uuid: u,
              nombre: r.nombre,
              sala_nombre: r.sala_nombre,
              count: 0
            });
          }
          aggMap.get(u).count += Number(r.count) || 0;
        }
        const activeSet = new Set(toUuidArray(options.departamentoIds));
        return Array.from(aggMap.values())
          .filter(r => r.count > 0 || activeSet.has(r.uuid))
          .sort((a, b) => b.count - a.count);
      })(),

      // 9. Áreas (Grouped by Departamento and Sala)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipAreas: true });
        const validUserSalas = toUuidArray(options.userSalaIds);
        const validSalas = toUuidArray(options.salaIds);
        if (validUserSalas.length > 0) {
          conds.push(sql`dep.sala_uuid = ANY(${validUserSalas}::uuid[])`);
        }
        if (validSalas.length > 0) {
          conds.push(sql`dep.sala_uuid = ANY(${validSalas}::uuid[])`);
        }
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            ar.uuid, 
            ar.uuid AS id,
            ar.nombre, 
            COALESCE(dep.nombre, 'Sin Departamento') AS departamento_nombre, 
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre,
            COUNT(DISTINCT a.uuid)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          JOIN cargos c ON e.cargo_uuid = c.uuid
          JOIN areas ar ON c.area_uuid = ar.uuid
          JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          LEFT JOIN salas s_dep ON dep.sala_uuid = s_dep.uuid
          ${where}
          GROUP BY ar.uuid, ar.nombre, dep.nombre, s_dep.nombre, s.nombre
          ORDER BY count DESC
        `;
        const aggMap = new Map();
        for (const r of res) {
          const u = r.uuid;
          if (!aggMap.has(u)) {
            aggMap.set(u, {
              id: u,
              uuid: u,
              nombre: r.nombre,
              departamento_nombre: r.departamento_nombre,
              sala_nombre: r.sala_nombre,
              count: 0
            });
          }
          aggMap.get(u).count += Number(r.count) || 0;
        }
        const activeSet = new Set(toUuidArray(options.areaIds));
        return Array.from(aggMap.values())
          .filter(r => r.count > 0 || activeSet.has(r.uuid))
          .sort((a, b) => b.count - a.count);
      })(),

      // 10. Cargos (Grouped by Área, Departamento and Sala)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipCargos: true });
        const validUserSalas = toUuidArray(options.userSalaIds);
        const validSalas = toUuidArray(options.salaIds);
        if (validUserSalas.length > 0) {
          conds.push(sql`dep.sala_uuid = ANY(${validUserSalas}::uuid[])`);
        }
        if (validSalas.length > 0) {
          conds.push(sql`dep.sala_uuid = ANY(${validSalas}::uuid[])`);
        }
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            c.uuid, 
            c.uuid AS id,
            c.nombre, 
            COALESCE(ar.nombre, 'Sin Área') AS area_nombre, 
            COALESCE(dep.nombre, 'Sin Departamento') AS departamento_nombre,
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre,
            COUNT(DISTINCT a.uuid)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
          LEFT JOIN salas s ON d.sala_uuid = s.uuid
          ${lateralJoin}
          JOIN cargos c ON e.cargo_uuid = c.uuid
          JOIN areas ar ON c.area_uuid = ar.uuid
          JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
          LEFT JOIN salas s_dep ON dep.sala_uuid = s_dep.uuid
          ${where}
          GROUP BY c.uuid, c.nombre, ar.nombre, dep.nombre, s_dep.nombre, s.nombre
          ORDER BY count DESC
        `;
        const aggMap = new Map();
        for (const r of res) {
          const u = r.uuid;
          if (!aggMap.has(u)) {
            aggMap.set(u, {
              id: u,
              uuid: u,
              nombre: r.nombre,
              area_nombre: r.area_nombre,
              departamento_nombre: r.departamento_nombre,
              sala_nombre: r.sala_nombre,
              count: 0
            });
          }
          aggMap.get(u).count += Number(r.count) || 0;
        }
        const activeSet = new Set(toUuidArray(options.cargoIds));
        return Array.from(aggMap.values())
          .filter(r => r.count > 0 || activeSet.has(r.uuid))
          .sort((a, b) => b.count - a.count);
      })()
    ]);

    return {
      salas: salasRes,
      dispositivos: devRes,
      estados: estRes,
      verifyModes: vmRes,
      fotos: fotoRes,
      estatusEmpleados: empStatusRes,
      departamentos: depRes,
      areas: areaRes,
      cargos: cargoRes,
      sexo: sexoRes
    };
  }

  return {
    salas: [],
    dispositivos: [],
    estados: [],
    verifyModes: [],
    fotos: [],
    estatusEmpleados: [],
    departamentos: [],
    areas: [],
    cargos: [],
    sexo: []
  };
}

export async function getAttlogPositionModel(id, salaIds = null, estados = null) {
  if (!isPgConnected || !sql) return { id, uuid: id, globalIndex: 0, position: 1 };
  const isU = isUuid(id);
  if (!isU) return null;

  const target = await sql`
    SELECT uuid, uuid AS id, event_time, attendancestatus, employee_no
    FROM attlogs
    WHERE uuid = ${id}::uuid
    LIMIT 1
  `;
  if (!target || target.length === 0) return null;
  const rec = target[0];

  let whereConditions = [];
  if (estados && Array.isArray(estados) && estados.length > 0) {
    whereConditions.push(sql`LOWER(COALESCE(a.attendancestatus, '')) = ANY(${estados.map(e => String(e).toLowerCase())})`);
  }
  const validSalas = toUuidArray(salaIds);
  if (validSalas.length > 0) {
    whereConditions.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
  }
  whereConditions.push(sql`(a.event_time > ${rec.event_time} OR (a.event_time = ${rec.event_time} AND a.uuid > ${rec.uuid}))`);

  const whereClause = sql`WHERE ${whereConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`;

  const res = await sql`
    SELECT count(*)::int AS total
    FROM attlogs a
    LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
    ${whereClause}
  `;

  const globalIndex = res[0]?.total || 0;
  return {
    id: rec.uuid,
    uuid: rec.uuid,
    globalIndex,
    position: globalIndex + 1
  };
}

export async function getAttlogDetailModel(id) {
  if (!isPgConnected || !sql) return null;
  const isU = isUuid(id);
  if (!isU) return null;

  try {
    const config = await getConfiguracionModel();
    const tz = getDbTimezone(config);

    const rows = await sql`
      SELECT a.uuid,
             a.uuid AS id,
             a.dispositivo_uuid,
             a.dispositivo_uuid AS dispositivo_id,
             a.employee_no,
             a.attendancestatus,
             a.currentverifymode,
             a.has_photo,
             a.created_at,
             a.updated_at,
             to_char(a.event_time AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
             to_char(a.event_time AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS fecha,
             to_char(a.event_time AT TIME ZONE 'UTC' AT TIME ZONE ${tz}, 'HH24:MI:SS') AS hora,
             COALESCE(e.nombre, a.nombre) AS nombre,
             e.uuid AS empleado_uuid,
             e.uuid AS empleado_id,
             e.cedula,
             e.foto AS empleado_foto,
             e.foto,
             c.uuid AS cargo_uuid,
             c.uuid AS cargo_id,
             c.nombre AS cargo_nombre,
             c.nombre AS cargo,
             ar.uuid AS area_uuid,
             ar.uuid AS area_id,
             ar.nombre AS area_nombre,
             dep.uuid AS departamento_uuid,
             dep.uuid AS departamento_id,
             dep.nombre AS departamento_nombre,
             s.uuid AS sala_uuid,
             s.uuid AS sala_id,
             s.nombre AS sala_nombre,
             d.nombre AS dispositivo_nombre,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             e.sexo,
             (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
      FROM attlogs a
      LEFT JOIN LATERAL (
        SELECT e.uuid, e.cedula, e.nombre, e.foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento, e.cargo_uuid, e.activo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.uuid AS TEXT)
          )
        ORDER BY e.activo DESC, e.uuid DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas ar ON c.area_uuid = ar.uuid
      LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
      LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      WHERE a.uuid = ${id}::uuid
      LIMIT 1
    `;

    if (!rows || rows.length === 0) return null;
    const record = rows[0];
    const pos = await getAttlogPositionModel(record.uuid);

    return {
      record,
      position: pos
    };
  } catch (err) {
    console.error('Error in getAttlogDetailModel:', err);
    return null;
  }
}


export async function syncAttlogsModel(data) {
  const { dispositivo_id, attlogs } = data || {};
  if (!Array.isArray(attlogs) || attlogs.length === 0) {
    return { success: true, count: 0 };
  }

  let count = 0;
  if (isPgConnected && sql) {
    for (const log of attlogs) {
      if (!log.employee_no || !log.event_time) continue;
      const verifyMode = log.currentVerifyMode || log.currentverifymode || log.verifyMode || log.verifymode || null;
      const hasPhoto = Boolean(log.foto_base64 && String(log.foto_base64).trim().length > 0);
      const normEmp = String(log.employee_no).trim().toUpperCase().replace(/V|-/g, '');
      const dispUuid = data.dispositivo_uuid || data.dispositivo_id || dispositivo_id;

      // 1. Evitar crear marcaje duplicado si ya existe un evento para el mismo empleado en el mismo segundo
      const existingAtt = await sql`
        SELECT uuid, has_photo FROM attlogs
        WHERE REPLACE(REPLACE(UPPER(COALESCE(employee_no, '')), 'V', ''), '-', '') = ${normEmp}
          AND event_time = ${log.event_time}::timestamp
        LIMIT 1
      `;

      let attlogUuid;
      if (existingAtt.length > 0) {
        attlogUuid = existingAtt[0].uuid;
        console.log(`[ATTLOG] Marcaje duplicado detectado (uuid: ${attlogUuid}) para emp: ${log.employee_no} @ ${log.event_time} - se actualiza pero NO se emite evento`);
        await sql`
          UPDATE attlogs
          SET updated_at = CURRENT_TIMESTAMP,
              currentverifymode = COALESCE(${verifyMode}, currentverifymode),
              attendancestatus = COALESCE(${log.attendanceStatus || null}, attendancestatus),
              has_photo = CASE WHEN ${hasPhoto} = TRUE THEN TRUE ELSE has_photo END
          WHERE uuid = ${attlogUuid}
        `;
      } else {
        const rows = await sql`
          INSERT INTO attlogs (dispositivo_uuid, employee_no, event_time, nombre, attendancestatus, currentverifymode, has_photo)
          VALUES (${dispUuid}, ${String(log.employee_no)}, ${log.event_time}, ${log.nombre || null}, ${log.attendanceStatus || null}, ${verifyMode}, ${hasPhoto})
          ON CONFLICT (dispositivo_uuid, employee_no, event_time)
          DO UPDATE SET updated_at = CURRENT_TIMESTAMP,
                        currentverifymode = COALESCE(EXCLUDED.currentverifymode, attlogs.currentverifymode),
                        has_photo = CASE WHEN EXCLUDED.has_photo = TRUE THEN TRUE ELSE attlogs.has_photo END
          RETURNING uuid, uuid AS id
        `;
        attlogUuid = rows[0]?.uuid;
      }
      if (attlogUuid && log.foto_base64) {
        await saveAttlogPhoto(attlogUuid, log.foto_base64);
      }
      if (attlogUuid) {
        let fullRecord = null;
        try {
          const config = await getConfiguracionModel();
          const tz = getDbTimezone(config);
          const fullRows = await sql`
            SELECT a.uuid, a.uuid AS id, a.attendancestatus, a.currentverifymode, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
                   COALESCE(NULLIF(TRIM(e.nombre), ''), NULLIF(TRIM(a.nombre), ''), 'Empleado ' || a.employee_no) AS nombre,
                   a.dispositivo_uuid, a.dispositivo_uuid AS dispositivo_id, d.nombre AS dispositivo_nombre, d.sala_uuid, d.sala_uuid AS sala_id, s.nombre AS sala_nombre,
                   e.uuid AS empleado_uuid, e.uuid AS empleado_id, e.cedula, e.foto AS empleado_foto, e.sexo, 
                   to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, 
                   to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
                   c.nombre AS cargo_nombre, ar.nombre AS area_nombre, dep.nombre AS departamento_nombre,
                   a.has_photo,
                   (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
            FROM attlogs a
            LEFT JOIN LATERAL (
              SELECT e.uuid, e.cedula, e.nombre, e.foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento, e.cargo_uuid, e.activo
              FROM empleados e
              WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
                AND (
                  REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
                  OR a.employee_no = CAST(e.uuid AS TEXT)
                )
              ORDER BY e.activo DESC, e.uuid DESC
              LIMIT 1
            ) e ON TRUE
            LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
            LEFT JOIN areas ar ON c.area_uuid = ar.uuid
            LEFT JOIN departamentos dep ON ar.departamento_uuid = dep.uuid
            LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
            LEFT JOIN salas s ON d.sala_uuid = s.uuid
            WHERE a.uuid = ${attlogUuid}
          `;
          if (fullRows && fullRows.length > 0) {
            fullRecord = {
              ...fullRows[0],
              has_photo: Boolean(fullRows[0].has_photo || hasPhoto),
              currentverifymode: fullRows[0].currentverifymode || verifyMode || null,
              currentverifymode_status: fullRows[0].currentverifymode || verifyMode || null
            };
          }
        } catch (e) {
          console.warn('Error enriqueciendo evento de nuevo marcaje:', e);
        }

        attlogEvents.emit('new_attlog', fullRecord || {
          uuid: attlogUuid,
          id: attlogUuid,
          has_photo: hasPhoto,
          dispositivo_uuid: dispUuid,
          dispositivo_id: dispUuid,
          sala_uuid: data.sala_uuid || data.sala_id || null,
          sala_id: data.sala_uuid || data.sala_id || null,
          employee_no: String(log.employee_no),
          event_time: log.event_time,
          nombre: log.nombre,
          attendancestatus: log.attendanceStatus || null,
          currentverifymode: verifyMode,
          currentverifymode_status: verifyMode,
          sala_nombre: data.sala_nombre,
          dispositivo_nombre: data.dispositivo_nombre
        });
        const empName = fullRecord?.nombre || log.nombre || log.employee_no;
        console.log(`[ATTLOG] Evento emitido | emp: ${empName} | sala: ${fullRecord?.sala_nombre || data.sala_nombre} | status: ${fullRecord?.attendancestatus || log.attendanceStatus} | uuid: ${attlogUuid}`);
      }
      count++;
    }
    //console.log(data)
    //console.log('willinthon')
    /* if (data.dispositivo_id == 39) {
      console.log(data)
    } */
  } else {
    inMemoryData.attlogs = inMemoryData.attlogs || [];
    for (const log of attlogs) {
      if (!log.employee_no || !log.event_time) continue;
      const existingLog = inMemoryData.attlogs.find(
        a => Number(a.dispositivo_id) === Number(dispositivo_id) && String(a.employee_no) === String(log.employee_no) && a.event_time === log.event_time
      );
      let targetId;
      if (!existingLog) {
        targetId = inMemoryData.attlogs.length > 0 ? Math.max(...inMemoryData.attlogs.map(a => a.id)) + 1 : 1;
        const newLog = {
          id: targetId,
          dispositivo_id: Number(dispositivo_id),
          employee_no: String(log.employee_no),
          event_time: log.event_time,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          nombre: log.nombre || null
        };
        inMemoryData.attlogs.unshift(newLog);
      } else {
        targetId = existingLog.id;
      }
      if (targetId && log.foto_base64) {
        saveAttlogPhoto(targetId, log.foto_base64);
      }
      count++;
    }
  }
  /* if (count > 0) {
    attlogEvents.emit('new_attlog', { count, dispositivo_id });
  } */
  return { success: true, count };
}

export async function getLastAttlogEventTimeModel(dispositivoId = null) {
  const isU = dispositivoId ? isUuid(dispositivoId) : false;
  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);
  if (isPgConnected && sql) {
    let rows;
    if (isU) {
      rows = await sql`
        SELECT to_char(max(event_time) AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') as last_event_time 
        FROM attlogs 
        WHERE dispositivo_uuid = ${dispositivoId}::uuid AND LOWER(COALESCE(attendancestatus, '')) IN ('checkin', 'checkout')
      `;
    } else {
      rows = await sql`
        SELECT to_char(max(event_time) AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') as last_event_time 
        FROM attlogs 
        WHERE LOWER(COALESCE(attendancestatus, '')) IN ('checkin', 'checkout')
      `;
    }
    return rows[0]?.last_event_time || null;
  } else {
    inMemoryData.attlogs = inMemoryData.attlogs || [];
    let devLogs = inMemoryData.attlogs.filter(a =>
      ['checkin', 'checkout'].includes((a.attendancestatus || '').toLowerCase())
    );
    if (dispositivoId) devLogs = devLogs.filter(a => String(a.dispositivo_uuid || a.dispositivo_id) === String(dispositivoId));
    if (devLogs.length === 0) return null;
    devLogs.sort((a, b) => new Date(b.event_time) - new Date(a.event_time));
    return devLogs[0].event_time;
  }
}

async function saveAttlogPhoto(attlogId, base64Data) {
  try {
    let cleanBase64 = String(base64Data).trim();
    if (cleanBase64.startsWith('data:image/')) {
      const commaIndex = cleanBase64.indexOf(',');
      if (commaIndex !== -1) {
        cleanBase64 = cleanBase64.substring(commaIndex + 1);
      }
    }
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer && buffer.length > 0) {
      const filePath = path.join(attlogsDir, `${attlogId}.jpg`);
      fs.writeFileSync(filePath, buffer);
      if (isPgConnected && sql) {
        await sql`UPDATE attlogs SET has_photo = TRUE WHERE uuid::text = ${String(attlogId)}`;
      }
    }
  } catch (err) {
    console.error(`Error guardando foto para marcaje attlog (${attlogId}):`, err.message);
  }
}

export async function getAttlogsStatsModel(salaIds = null, startDate = null, endDate = null) {
  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);

  let slots10 = new Array(144).fill(0);
  let totalAttlogs = 0;

  if (isPgConnected && sql) {
    const whereConds = [
      sql`LOWER(COALESCE(a.attendancestatus, '')) IN ('checkin', 'checkout')`
    ];

    const validSalas = toUuidArray(salaIds);
    if (validSalas.length > 0) {
      whereConds.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
    }

    if (startDate && String(startDate).trim().length > 0) {
      const sDateStr = String(startDate).trim().replace('T', ' ');
      whereConds.push(sql`(a.event_time AT TIME ZONE ${tz}) >= ${sDateStr}::timestamp`);
    }

    if (endDate && String(endDate).trim().length > 0) {
      const eDateStr = String(endDate).trim().replace('T', ' ');
      whereConds.push(sql`(a.event_time AT TIME ZONE ${tz}) <= ${eDateStr}::timestamp`);
    }

    const whereClause = sql`WHERE ${whereConds.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`;

    const slotsRes = await sql`
      SELECT 
        (EXTRACT(HOUR FROM (a.event_time AT TIME ZONE ${tz})) * 6 + FLOOR(EXTRACT(MINUTE FROM (a.event_time AT TIME ZONE ${tz})) / 10))::int AS slot,
        COUNT(*)::int AS count
      FROM attlogs a
      LEFT JOIN dispositivos d ON a.dispositivo_uuid = d.uuid
      ${whereClause}
      GROUP BY slot
    `;

    for (const r of slotsRes) {
      if (r.slot >= 0 && r.slot < 144) {
        slots10[r.slot] = Number(r.count) || 0;
        totalAttlogs += Number(r.count) || 0;
      }
    }
  } else {
    let list = (inMemoryData.attlogs || []).filter(a =>
      ['checkin', 'checkout'].includes((a.attendancestatus || '').toLowerCase())
    );
    if (startDate) {
      const sTime = new Date(startDate).getTime();
      if (!isNaN(sTime)) list = list.filter(a => new Date(a.event_time).getTime() >= sTime);
    }
    if (endDate) {
      const eTime = new Date(endDate).getTime();
      if (!isNaN(eTime)) list = list.filter(a => new Date(a.event_time).getTime() <= eTime);
    }
    totalAttlogs = list.length;
    for (const item of list) {
      if (item.event_time) {
        const date = new Date(item.event_time);
        const h = date.getHours();
        const m = date.getMinutes();
        const slotIdx = h * 6 + Math.floor(m / 10);
        if (slotIdx >= 0 && slotIdx < 144) {
          slots10[slotIdx]++;
        }
      }
    }
  }

  // Calculate 8 blocks of 3 hours each (00-03h, 03-06h, ..., 21-24h)
  const blocks = [];
  let peakBlockIdx = 0;
  let maxBlockTotal = -1;

  for (let bIdx = 0; bIdx < 8; bIdx++) {
    const startHour = bIdx * 3;
    const endHour = (bIdx + 1) * 3;
    const label = `${String(startHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`;
    const shortLabel = `${String(startHour).padStart(2, '0')}-${String(endHour).padStart(2, '0')}h`;

    let blockCount = 0;
    const hours = [];
    let blockPeak10 = null;
    let blockPeakHour = startHour;
    let maxHourCount = -1;

    for (let i = 0; i < 3; i++) {
      const h = startHour + i;
      const slotStart = h * 6;
      let hourCount = 0;
      const slots = [];
      let hourPeak10 = null;

      for (let sIdx = 0; sIdx < 6; sIdx++) {
        const s = slotStart + sIdx;
        const count = slots10[s] || 0;
        hourCount += count;

        const startM = sIdx * 10;
        const endM = (sIdx + 1) * 10;
        const timeStr = `${String(h).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
        const endH = (endM === 60) ? (h + 1) % 24 : h;
        const endMStr = (endM === 60) ? '00' : String(endM);
        const rangeStr = `${timeStr} - ${String(endH).padStart(2, '0')}:${endMStr}`;

        const slotObj = {
          slot: s,
          hour: h,
          indexInHour: sIdx,
          time: timeStr,
          range: rangeStr,
          count
        };
        slots.push(slotObj);

        if (!hourPeak10 || count > hourPeak10.count) {
          hourPeak10 = slotObj;
        }
        if (!blockPeak10 || count > blockPeak10.count) {
          blockPeak10 = slotObj;
        }
      }

      hours.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        count: hourCount,
        slots10: slots,
        peak10Slot: hourPeak10
      });

      blockCount += hourCount;
      if (hourCount > maxHourCount) {
        maxHourCount = hourCount;
        blockPeakHour = h;
      }
    }

    const targetHourObj = hours.find(hr => hr.hour === (blockPeak10?.hour ?? blockPeakHour)) || hours[0];

    blocks.push({
      index: bIdx,
      startHour,
      endHour,
      label,
      shortLabel,
      count: blockCount,
      hours,
      allSlots10: hours.flatMap(hr => hr.slots10),
      peakHour: targetHourObj.hour,
      peakHourLabel: targetHourObj.label,
      slots10: targetHourObj.slots10,
      peak10Slot: blockPeak10
    });

    if (blockCount > maxBlockTotal) {
      maxBlockTotal = blockCount;
      peakBlockIdx = bIdx;
    }
  }

  const peakBlock = blocks[peakBlockIdx] || blocks[0];

  return {
    total: totalAttlogs,
    blocks, // 8 blocks of 3 hours
    peakBlockIdx,
    peakBlock,
    peakSlot: peakBlock?.peak10Slot
  };
}

export async function getUserSalasMapModel() {
  if (isPgConnected && sql) {
    const rows = await sql`SELECT user_uuid, sala_uuid FROM user_salas`;
    const map = {};
    for (const r of rows) {
      if (!map[r.user_uuid]) map[r.user_uuid] = [];
      map[r.user_uuid].push(r.sala_uuid);
    }
    return map;
  }
  return inMemoryData.user_salas || {};
}

export async function updateUserSalasModel(userId, salaIds) {
  const isU = isUuid(userId);
  if (!isU) return { success: false, error: 'Invalid user uuid' };
  const validSalas = toUuidArray(salaIds);

  if (isPgConnected && sql) {
    await sql`DELETE FROM user_salas WHERE user_uuid = ${userId}::uuid`;
    for (const sUuid of validSalas) {
      await sql`INSERT INTO user_salas (user_uuid, sala_uuid) VALUES (${userId}::uuid, ${sUuid}::uuid) ON CONFLICT DO NOTHING`;
    }
  }
  inMemoryData.user_salas = inMemoryData.user_salas || {};
  inMemoryData.user_salas[userId] = validSalas;
  return { success: true, user_uuid: userId, user_id: userId, salas: validSalas };
}

export async function getUserPermissionsMapModel() {
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT ump.user_uuid, ump.module_uuid, p.nombre as perm_name
      FROM user_module_permissions ump
      INNER JOIN permissions p ON ump.permission_uuid = p.uuid
    `;
    const map = {};
    for (const r of rows) {
      if (!map[r.user_uuid]) map[r.user_uuid] = {};
      if (!map[r.user_uuid][r.module_uuid]) map[r.user_uuid][r.module_uuid] = [];
      if (!map[r.user_uuid][r.module_uuid].includes(r.perm_name)) {
        map[r.user_uuid][r.module_uuid].push(r.perm_name);
      }
    }
    return map;
  }
  return inMemoryData.user_module_permissions || {};
}

export async function updateUserPermissionsModel(userId, permissionsMap) {
  const isU = isUuid(userId);
  if (!isU) return { success: false, error: 'Invalid user uuid' };
  const modMap = permissionsMap || {};

  if (isPgConnected && sql) {
    const permRows = await sql`SELECT uuid, UPPER(TRIM(nombre)) as nombre FROM permissions`;
    const permMap = {};
    for (const p of permRows) {
      permMap[p.nombre] = p.uuid;
    }
    permMap['BORRAR'] = permMap['ELIMINAR'];

    await sql`DELETE FROM user_module_permissions WHERE user_uuid = ${userId}::uuid`;
    for (const [modUuid, perms] of Object.entries(modMap)) {
      if (!isUuid(modUuid) || !Array.isArray(perms)) continue;
      for (const pName of perms) {
        const pUuid = permMap[String(pName).toUpperCase().trim()];
        if (pUuid) {
          await sql`
            INSERT INTO user_module_permissions (user_uuid, module_uuid, permission_uuid)
            VALUES (${userId}::uuid, ${modUuid}::uuid, ${pUuid}::uuid)
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }
  }
  inMemoryData.user_module_permissions = inMemoryData.user_module_permissions || {};
  inMemoryData.user_module_permissions[userId] = modMap;
  return { success: true, user_uuid: userId, user_id: userId, permissions: modMap };
}



// --- DEPARTAMENTOS ---
export function buildDepartamentoConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  const validUserSalas = toUuidArray(options.userSalaIds);
  if (validUserSalas.length > 0) {
    conds.push(sql`d.sala_uuid = ANY(${validUserSalas}::uuid[])`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas) {
    const validSalas = toUuidArray(options.salaIds);
    if (validSalas.length > 0) {
      conds.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
    }
  }

  // 3. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(d.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getDepartamentosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [] }
    };
  }

  const conds = buildDepartamentoConditions({ ...options, skipSalas: true });
  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  let allSalas;
  const validUserSalas = toUuidArray(options.userSalaIds);
  if (validUserSalas.length > 0) {
    allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s WHERE s.uuid = ANY(${validUserSalas}::uuid[]) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
  }

  const countsRes = await sql`
    SELECT d.sala_uuid AS uuid, COUNT(d.uuid)::int AS count
    FROM departamentos d
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    ${where}
    GROUP BY d.sala_uuid
  `;
  const countMap = new Map(countsRes.map(r => [r.uuid, r.count]));
  const activeSalas = new Set(toUuidArray(options.salaIds));

  const salas = allSalas
    .map(s => ({
      id: s.uuid,
      uuid: s.uuid,
      nombre: s.nombre,
      count: countMap.get(s.uuid) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(s.uuid))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    data: {
      salas
    }
  };
}

export async function getDepartamentosModel(params = {}) {
  if (!isPgConnected || !sql) return { success: true, data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'uuid';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const userSalaIds = toUuidArray(params.user_sala_ids);
  const salaIds = toUuidArray(params.sala_ids);

  const conds = buildDepartamentoConditions({
    userSalaIds,
    salaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'd.created_at',
    'uuid': 'd.created_at',
    'created_at': 'd.created_at',
    'nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'd.created_at';

  const countRes = await sql`
    SELECT COUNT(d.uuid)::int AS total
    FROM departamentos d
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, d.created_at DESC, d.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT d.*, d.uuid AS id, d.sala_uuid AS sala_id, s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT d.*, d.uuid AS id, d.sala_uuid AS sala_id, s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
    `;
  }

  data = data.map(r => ({ ...r, nombre: toTitleCase(r.nombre) }));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function createDepartamentoModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del departamento es obligatorio');
  const rawSala = data.sala_uuid || data.sala_id;
  if (!rawSala || !isUuid(rawSala)) throw new Error('Debe seleccionar una sala válida para el departamento');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM departamentos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
        AND sala_uuid = ${rawSala}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un departamento registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO departamentos (nombre, sala_uuid)
      VALUES (${cleanName}, ${rawSala}::uuid)
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return rows[0];
  }
  return null;
}

export async function updateDepartamentoModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del departamento es obligatorio');
  const rawSala = data.sala_uuid || data.sala_id;

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM departamentos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND uuid != ${id}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otro departamento registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      UPDATE departamentos
      SET nombre = ${cleanName},
          sala_uuid = ${rawSala && isUuid(rawSala) ? sql`${rawSala}::uuid` : sql`sala_uuid`},
          updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return rows[0];
  }
  return null;
}

export async function deleteDepartamentoModel(id) {
  return await deleteEntityDynamic('departamentos', 'departamento', id);
}


// --- ÁREAS ---
export function buildAreaConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  const validUserSalas = toUuidArray(options.userSalaIds);
  if (validUserSalas.length > 0) {
    conds.push(sql`d.sala_uuid = ANY(${validUserSalas}::uuid[])`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas) {
    const validSalas = toUuidArray(options.salaIds);
    if (validSalas.length > 0) {
      conds.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
    }
  }

  // 3. Departamentos seleccionados
  if (!options.skipDepartamentos) {
    const validDeps = toUuidArray(options.departamentoIds);
    if (validDeps.length > 0) {
      conds.push(sql`d.uuid = ANY(${validDeps}::uuid[])`);
    }
  }

  // 4. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(a.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(a.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getAreasFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [], departamentos: [] }
    };
  }

  const [salas, departamentos] = await Promise.all([
    // 1. Salas
    (async () => {
      const conds = buildAreaConditions({ ...options, skipSalas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

      let allSalas;
      const validUserSalas = toUuidArray(options.userSalaIds);
      if (validUserSalas.length > 0) {
        allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s WHERE s.uuid = ANY(${validUserSalas}::uuid[]) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT s.uuid, COUNT(a.uuid)::int AS count
        FROM areas a
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY s.uuid
      `;
      const countMap = new Map(countsRes.map(r => [r.uuid, r.count]));
      const activeSalas = new Set(toUuidArray(options.salaIds));
      return allSalas
        .map(s => ({
          id: s.uuid,
          uuid: s.uuid,
          nombre: s.nombre,
          count: countMap.get(s.uuid) || 0
        }))
        .filter(s => s.count > 0 || activeSalas.has(s.uuid))
        .sort((a, b) => b.count - a.count);
    })(),

    // 2. Departamentos (Grouped by Sala)
    (async () => {
      const conds = buildAreaConditions({ ...options, skipDepartamentos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          d.uuid, 
          d.uuid AS id,
          d.nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre, 
          COUNT(a.uuid)::int AS count
        FROM areas a
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        LEFT JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY d.uuid, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set(toUuidArray(options.departamentoIds));
      return res
        .map(r => ({
          id: r.uuid,
          uuid: r.uuid,
          nombre: r.nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(r.uuid));
    })()
  ]);

  return {
    success: true,
    data: {
      salas,
      departamentos
    }
  };
}

export async function getAreasModel(params = {}) {
  if (!isPgConnected || !sql) return { success: true, data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'uuid';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const userSalaIds = toUuidArray(params.user_sala_ids);
  const salaIds = toUuidArray(params.sala_ids);
  const departamentoIds = toUuidArray(params.departamento_ids);

  const conds = buildAreaConditions({
    userSalaIds,
    salaIds,
    departamentoIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'a.created_at',
    'uuid': 'a.created_at',
    'created_at': 'a.created_at',
    'nombre': 'a.nombre',
    'departamento_nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'a.created_at';

  const countRes = await sql`
    SELECT COUNT(a.uuid)::int AS total
    FROM areas a
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, a.created_at DESC, a.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT a.*, a.uuid AS id, a.departamento_uuid AS departamento_id, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_uuid AS sala_id, d.sala_uuid
      FROM areas a
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT a.*, a.uuid AS id, a.departamento_uuid AS departamento_id, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_uuid AS sala_id, d.sala_uuid
      FROM areas a
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
    `;
  }

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function createAreaModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del área es obligatorio');

  const rawDep = data.departamento_uuid || data.departamento_id;
  if (!rawDep || !isUuid(rawDep)) throw new Error('Debe seleccionar un departamento válido para el área');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM areas 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
        AND departamento_uuid = ${rawDep}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un área registrada con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO areas (nombre, departamento_uuid)
      VALUES (${cleanName}, ${rawDep}::uuid)
      RETURNING *, uuid AS id, departamento_uuid AS departamento_id
    `;
    return rows[0];
  }
  return null;
}

export async function updateAreaModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del área es obligatorio');

  const rawDep = data.departamento_uuid !== undefined ? data.departamento_uuid : data.departamento_id;
  const isDepU = rawDep && isUuid(rawDep);

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM areas 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND uuid != ${id}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otra área registrada con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      UPDATE areas
      SET nombre = ${cleanName}, 
          departamento_uuid = ${isDepU ? sql`${rawDep}::uuid` : sql`departamento_uuid`},
          updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id, departamento_uuid AS departamento_id
    `;
    return rows[0];
  }
  return null;
}

export async function deleteAreaModel(id) {
  return await deleteEntityDynamic('areas', 'área', id);
}


// --- CARGOS ---
export function buildCargoConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  const validUserSalas = toUuidArray(options.userSalaIds);
  if (validUserSalas.length > 0) {
    conds.push(sql`d.sala_uuid = ANY(${validUserSalas}::uuid[])`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas) {
    const validSalas = toUuidArray(options.salaIds);
    if (validSalas.length > 0) {
      conds.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
    }
  }

  // 3. Departamentos seleccionados
  if (!options.skipDepartamentos) {
    const validDeps = toUuidArray(options.departamentoIds);
    if (validDeps.length > 0) {
      conds.push(sql`d.uuid = ANY(${validDeps}::uuid[])`);
    }
  }

  // 4. Áreas seleccionadas
  if (!options.skipAreas) {
    const validAreas = toUuidArray(options.areaIds);
    if (validAreas.length > 0) {
      conds.push(sql`a.uuid = ANY(${validAreas}::uuid[])`);
    }
  }

  // 5. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(c.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(a.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(c.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getCargosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [], departamentos: [], areas: [] }
    };
  }

  const [salas, departamentos, areas] = await Promise.all([
    // 1. Salas
    (async () => {
      const conds = buildCargoConditions({ ...options, skipSalas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

      let allSalas;
      const validUserSalas = toUuidArray(options.userSalaIds);
      if (validUserSalas.length > 0) {
        allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s WHERE s.uuid = ANY(${validUserSalas}::uuid[]) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT s.uuid, COUNT(c.uuid)::int AS count
        FROM cargos c
        JOIN areas a ON c.area_uuid = a.uuid
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY s.uuid
      `;
      const countMap = new Map(countsRes.map(r => [r.uuid, r.count]));
      const activeSalas = new Set(toUuidArray(options.salaIds));
      return allSalas
        .map(s => ({
          id: s.uuid,
          uuid: s.uuid,
          nombre: s.nombre,
          count: countMap.get(s.uuid) || 0
        }))
        .filter(s => s.count > 0 || activeSalas.has(s.uuid))
        .sort((a, b) => b.count - a.count);
    })(),

    // 2. Departamentos (Grouped by Sala)
    (async () => {
      const conds = buildCargoConditions({ ...options, skipDepartamentos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          d.uuid, 
          d.uuid AS id,
          d.nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre, 
          COUNT(c.uuid)::int AS count
        FROM cargos c
        JOIN areas a ON c.area_uuid = a.uuid
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        LEFT JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY d.uuid, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set(toUuidArray(options.departamentoIds));
      return res
        .map(r => ({
          id: r.uuid,
          uuid: r.uuid,
          nombre: r.nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(r.uuid));
    })(),

    // 3. Áreas (Grouped by Departamento and Sala)
    (async () => {
      const conds = buildCargoConditions({ ...options, skipAreas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          a.uuid, 
          a.uuid AS id,
          a.nombre, 
          COALESCE(d.nombre, 'Sin Departamento') AS departamento_nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
          COUNT(c.uuid)::int AS count
        FROM cargos c
        JOIN areas a ON c.area_uuid = a.uuid
        LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
        LEFT JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY a.uuid, a.nombre, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set(toUuidArray(options.areaIds));
      return res
        .map(r => ({
          id: r.uuid,
          uuid: r.uuid,
          nombre: r.nombre,
          departamento_nombre: r.departamento_nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(r.uuid));
    })()
  ]);

  return {
    success: true,
    data: {
      salas,
      departamentos,
      areas
    }
  };
}

export async function getCargosModel(params = {}) {
  if (!isPgConnected || !sql) return { success: true, data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'uuid';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const userSalaIds = toUuidArray(params.user_sala_ids);
  const salaIds = toUuidArray(params.sala_ids);
  const departamentoIds = toUuidArray(params.departamento_ids);
  const areaIds = toUuidArray(params.area_ids);

  const conds = buildCargoConditions({
    userSalaIds,
    salaIds,
    departamentoIds,
    areaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'c.created_at',
    'uuid': 'c.created_at',
    'created_at': 'c.created_at',
    'nombre': 'c.nombre',
    'area_nombre': 'a.nombre',
    'departamento_nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'c.created_at';

  const countRes = await sql`
    SELECT COUNT(c.uuid)::int AS total
    FROM cargos c
    LEFT JOIN areas a ON c.area_uuid = a.uuid
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, c.created_at DESC, c.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT c.*, c.uuid AS id, c.area_uuid AS area_id, a.nombre AS area_nombre, d.uuid AS departamento_id, d.uuid AS departamento_uuid, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_uuid AS sala_id, d.sala_uuid
      FROM cargos c
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT c.*, c.uuid AS id, c.area_uuid AS area_id, a.nombre AS area_nombre, d.uuid AS departamento_id, d.uuid AS departamento_uuid, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_uuid AS sala_id, d.sala_uuid
      FROM cargos c
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
    `;
  }

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function createCargoModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del cargo es obligatorio');
  const rawArea = data.area_uuid || data.area_id;
  if (!rawArea || !isUuid(rawArea)) throw new Error('Debe seleccionar un área válida para el cargo');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM cargos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
        AND area_uuid = ${rawArea}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un cargo registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO cargos (nombre, area_uuid)
      VALUES (${cleanName}, ${rawArea}::uuid)
      RETURNING *, uuid AS id, area_uuid AS area_id
    `;
    return rows[0];
  }
  return null;
}

export async function updateCargoModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del cargo es obligatorio');

  const rawArea = data.area_uuid !== undefined ? data.area_uuid : data.area_id;
  const isAreaU = rawArea && isUuid(rawArea);

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM cargos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND uuid != ${id}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otro cargo registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      UPDATE cargos
      SET nombre = ${cleanName}, 
          area_uuid = ${isAreaU ? sql`${rawArea}::uuid` : sql`area_uuid`},
          updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id, area_uuid AS area_id
    `;
    return rows[0];
  }
  return null;
}

export async function deleteCargoModel(id) {
  return await deleteEntityDynamic('cargos', 'cargo', id);
}



// --- EMPLEADOS ---
export function buildEmpleadoConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  const validUserSalas = toUuidArray(options.userSalaIds);
  if (validUserSalas.length > 0) {
    conds.push(sql`d.sala_uuid = ANY(${validUserSalas}::uuid[])`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas) {
    const validSalas = toUuidArray(options.salaIds);
    if (validSalas.length > 0) {
      conds.push(sql`d.sala_uuid = ANY(${validSalas}::uuid[])`);
    }
  }

  // 3. Departamentos seleccionados
  if (!options.skipDepartamentos) {
    const validDeps = toUuidArray(options.departamentoIds);
    if (validDeps.length > 0) {
      conds.push(sql`d.uuid = ANY(${validDeps}::uuid[])`);
    }
  }

  // 4. Áreas seleccionadas
  if (!options.skipAreas) {
    const validAreas = toUuidArray(options.areaIds);
    if (validAreas.length > 0) {
      conds.push(sql`a.uuid = ANY(${validAreas}::uuid[])`);
    }
  }

  // 5. Cargos seleccionados
  if (!options.skipCargos) {
    const validCargos = toUuidArray(options.cargoIds);
    if (validCargos.length > 0) {
      conds.push(sql`c.uuid = ANY(${validCargos}::uuid[])`);
    }
  }

  // 6. Sexo seleccionado
  if (!options.skipSexo && options.sexo && options.sexo.length > 0) {
    const sexoConds = [];
    const lower = options.sexo.map(s => String(s).toLowerCase());
    if (lower.includes('femenino') || lower.includes('mujer')) {
      sexoConds.push(sql`LOWER(e.sexo) IN ('femenino', 'f', 'mujer')`);
    }
    if (lower.includes('masculino') || lower.includes('hombre')) {
      sexoConds.push(sql`LOWER(e.sexo) IN ('masculino', 'm', 'hombre')`);
    }
    if (lower.includes('otros') || lower.includes('otro')) {
      sexoConds.push(sql`(e.sexo IS NULL OR LOWER(e.sexo) NOT IN ('femenino', 'f', 'mujer', 'masculino', 'm', 'hombre'))`);
    }
    if (sexoConds.length > 0) {
      conds.push(sql`(${sexoConds.reduce((acc, c) => sql`${acc} OR ${c}`)})`);
    }
  }

  // 7. Estatus activo
  if (options.activo !== undefined && options.activo !== null && options.activo !== '') {
    const isActivo = String(options.activo) === 'true' || String(options.activo) === '1';
    conds.push(isActivo ? sql`(e.activo = true OR e.activo IS NULL)` : sql`e.activo = false`);
  }

  // 8. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(e.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(e.cedula, '')) LIKE ${term} OR
      LOWER(COALESCE(c.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(a.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(e.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getEmpleadosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [], departamentos: [], areas: [], cargos: [], sexo: [] }
    };
  }

  const [salas, departamentos, areas, cargos, sexoRes] = await Promise.all([
    // 1. Salas
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipSalas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

      let allSalas;
      const validUserSalas = toUuidArray(options.userSalaIds);
      if (validUserSalas.length > 0) {
        allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s WHERE s.uuid = ANY(${validUserSalas}::uuid[]) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT s.uuid, COUNT(e.uuid)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY s.uuid
      `;
      const countMap = new Map(countsRes.map(r => [r.uuid, r.count]));
      const activeSalas = new Set(toUuidArray(options.salaIds));
      return allSalas
        .map(s => ({
          id: s.uuid,
          uuid: s.uuid,
          nombre: s.nombre,
          count: countMap.get(s.uuid) || 0
        }))
        .filter(s => s.count > 0 || activeSalas.has(s.uuid))
        .sort((a, b) => b.count - a.count);
    })(),

    // 2. Departamentos (Grouped by Sala)
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipDepartamentos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          d.uuid, 
          d.uuid AS id,
          d.nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre, 
          COUNT(e.uuid)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        LEFT JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY d.uuid, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set(toUuidArray(options.departamentoIds));
      return res
        .map(r => ({
          id: r.uuid,
          uuid: r.uuid,
          nombre: r.nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(r.uuid));
    })(),

    // 3. Áreas (Grouped by Departamento and Sala)
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipAreas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          a.uuid, 
          a.uuid AS id,
          a.nombre, 
          COALESCE(d.nombre, 'Sin Departamento') AS departamento_nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
          COUNT(e.uuid)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
        LEFT JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY a.uuid, a.nombre, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set(toUuidArray(options.areaIds));
      return res
        .map(r => ({
          id: r.uuid,
          uuid: r.uuid,
          nombre: r.nombre,
          departamento_nombre: r.departamento_nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(r.uuid));
    })(),

    // 4. Cargos (Grouped by Área, Departamento and Sala)
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipCargos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          c.uuid, 
          c.uuid AS id,
          c.nombre, 
          COALESCE(a.nombre, 'Sin Área') AS area_nombre, 
          COALESCE(d.nombre, 'Sin Departamento') AS departamento_nombre,
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
          COUNT(e.uuid)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        LEFT JOIN areas a ON c.area_uuid = a.uuid
        LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
        LEFT JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
        GROUP BY c.uuid, c.nombre, a.nombre, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set(toUuidArray(options.cargoIds));
      return res
        .map(r => ({
          id: r.uuid,
          uuid: r.uuid,
          nombre: r.nombre,
          area_nombre: r.area_nombre,
          departamento_nombre: r.departamento_nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(r.uuid));
    })(),

    // 5. Sexo
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipSexo: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          SUM(CASE WHEN LOWER(e.sexo) IN ('femenino', 'f', 'mujer') THEN 1 ELSE 0 END)::int AS mujer_count,
          SUM(CASE WHEN LOWER(e.sexo) IN ('masculino', 'm', 'hombre') THEN 1 ELSE 0 END)::int AS hombre_count,
          SUM(CASE WHEN e.sexo IS NULL OR LOWER(e.sexo) NOT IN ('femenino', 'f', 'mujer', 'masculino', 'm', 'hombre') THEN 1 ELSE 0 END)::int AS otros_count
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        JOIN departamentos d ON a.departamento_uuid = d.uuid
        JOIN salas s ON d.sala_uuid = s.uuid
        ${where}
      `;
      const row = res[0] || {};
      const activeSexo = new Set((options.sexo || []).map(String));
      return [
        { key: 'femenino', label: 'Mujer', count: row.mujer_count || 0 },
        { key: 'masculino', label: 'Hombre', count: row.hombre_count || 0 },
        { key: 'otros', label: 'Otros', count: row.otros_count || 0 }
      ].filter(s => s.count > 0 || activeSexo.has(s.key));
    })()
  ]);

  return {
    success: true,
    data: {
      salas,
      departamentos,
      areas,
      cargos,
      sexo: sexoRes
    }
  };
}

export async function getEmpleadosModel(params = {}) {
  if (!isPgConnected || !sql) return { success: true, data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'uuid';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const userSalaIds = toUuidArray(params.user_sala_ids);
  const salaIds = toUuidArray(params.sala_ids);
  const departamentoIds = toUuidArray(params.departamento_ids);
  const areaIds = toUuidArray(params.area_ids);
  const cargoIds = toUuidArray(params.cargo_ids);
  let sexo = null;
  if (params.sexo) {
    sexo = String(params.sexo).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  const conds = buildEmpleadoConditions({
    userSalaIds,
    salaIds,
    departamentoIds,
    areaIds,
    cargoIds,
    sexo,
    activo: params.activo,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'e.created_at',
    'uuid': 'e.created_at',
    'created_at': 'e.created_at',
    'nombre': 'e.nombre',
    'cedula': 'e.cedula',
    'sexo': 'e.sexo',
    'fecha_nacimiento': 'e.fecha_nacimiento',
    'fecha_ingreso': 'e.fecha_ingreso',
    'cargo_nombre': 'c.nombre',
    'area_nombre': 'a.nombre',
    'departamento_nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'e.created_at';

  const countRes = await sql`
    SELECT COUNT(e.uuid)::int AS total
    FROM empleados e
    LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
    LEFT JOIN areas a ON c.area_uuid = a.uuid
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, e.created_at DESC, e.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT e.uuid, e.uuid AS id, e.foto, e.nombre, e.cedula, e.sexo, e.cargo_uuid, e.cargo_uuid AS cargo_id, e.activo, e.motivo_desincorporacion,
             e.created_at, e.updated_at,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.uuid AS sala_id, s.uuid AS sala_uuid, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT e.uuid, e.uuid AS id, e.foto, e.nombre, e.cedula, e.sexo, e.cargo_uuid, e.cargo_uuid AS cargo_id, e.activo, e.motivo_desincorporacion,
             e.created_at, e.updated_at,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.uuid AS sala_id, s.uuid AS sala_uuid, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ${orderClause}
    `;
  }

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function checkEmpleadoCedulaModel(cedula, excludeId = null) {
  if (!isPgConnected || !sql || !cedula) return { exists: false };
  const clean = String(cedula).trim();
  const normCedula = clean.toUpperCase().replace(/V|-/g, '');
  if (!normCedula) return { exists: false };
  const isExcU = excludeId && isUuid(excludeId);

  const rows = await sql`
    SELECT 
      e.uuid, 
      e.uuid AS id, 
      e.nombre, 
      e.cedula, 
      e.activo, 
      s.nombre AS sala_nombre
    FROM empleados e
    LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
    LEFT JOIN areas a ON c.area_uuid = a.uuid
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    LEFT JOIN salas s ON d.sala_uuid = s.uuid
    WHERE REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '') = ${normCedula}
      ${isExcU ? sql`AND e.uuid != ${excludeId}::uuid` : sql``}
    LIMIT 1
  `;

  if (rows.length > 0) {
    return {
      exists: true,
      empleado: {
        id: rows[0].uuid,
        uuid: rows[0].uuid,
        nombre: rows[0].nombre,
        cedula: rows[0].cedula,
        activo: rows[0].activo,
        sala_nombre: rows[0].sala_nombre || 'Sin sala asignada'
      }
    };
  }
  return { exists: false };
}

export async function getEmpleadoDispositivosModel(empleadoId) {
  if (!isPgConnected || !sql || !empleadoId) return [];
  const isU = isUuid(empleadoId);
  const rows = await sql`
    SELECT COALESCE(dispositivo_uuid::text, '') AS dispositivo_uuid
    FROM empleado_dispositivos 
    WHERE ${isU ? sql`empleado_uuid = ${empleadoId}::uuid` : sql`empleado_uuid::text = ${String(empleadoId)}`}
  `;
  return rows.map(r => r.dispositivo_uuid).filter(Boolean);
}

function cleanDateOnly(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  if (s.includes('T')) {
    return s.split('T')[0];
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function resolveEmpleadosDir() {
  const candidates = [
    path.join(process.cwd(), 'empleados'),
    path.join(process.cwd(), 'backend-fastify', 'empleados'),
    path.resolve(__dirname, '../../empleados'),
    path.resolve(__dirname, '../empleados'),
    '/var/www/wisi/backend-fastify/empleados',
    '/var/www/wisi/empleados'
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const fallback = path.join(process.cwd(), 'empleados');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch (e) {}
  return fallback;
}

function removeEmpleadoPhysicalPhotos(eId) {
  if (!eId) return;
  try {
    const candidates = [
      path.join(process.cwd(), 'empleados'),
      path.join(process.cwd(), 'backend-fastify', 'empleados'),
      path.resolve(__dirname, '../../empleados'),
      path.resolve(__dirname, '../empleados'),
      '/var/www/wisi/backend-fastify/empleados',
      '/var/www/wisi/empleados'
    ];
    const extensions = ['.webp', '.jpg', '.jpeg', '.png'];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        for (const ext of extensions) {
          const p = path.join(dir, `${eId}${ext}`);
          if (fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
          }
        }
      }
    }
  } catch (e) {}
}

function invalidateEmpleadoThumbnails(eId) {
  if (!eId) return;
  try {
    const candidateCacheDirs = [
      path.join(process.cwd(), 'cache', 'thumbs'),
      path.join(process.cwd(), 'backend-fastify', 'cache', 'thumbs'),
      '/var/www/wisi/backend-fastify/cache/thumbs',
      '/var/www/wisi/cache/thumbs'
    ];
    for (const cDir of candidateCacheDirs) {
      if (fs.existsSync(cDir)) {
        const files = fs.readdirSync(cDir);
        for (const file of files) {
          if (file.startsWith(`empleado_${eId}_`) || file.startsWith(`${eId}_`)) {
            try { fs.unlinkSync(path.join(cDir, file)); } catch (e) {}
          }
        }
      }
    }
  } catch (e) {}
}

export async function createEmpleadoModel(data) {
  if (isPgConnected && sql) {
    if (data.cedula && String(data.cedula).trim()) {
      const normCedula = String(data.cedula).trim().toUpperCase().replace(/V|-/g, '');
      const existing = await sql`
        SELECT uuid, nombre, cedula
        FROM empleados
        WHERE REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') = ${normCedula}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe un empleado registrado con la cédula ${data.cedula} (${existing[0].nombre})`);
      }
    }

    const { randomUUID } = await import('crypto');
    const empUuid = data.uuid && isUuid(data.uuid) ? data.uuid : randomUUID();
    let foto = data.foto || null;

    // Guardar foto en disco si viene en base64
    if (data.fotoBase64) {
      try {
        const isWebp = (data.fotoBase64 || '').startsWith('data:image/webp');
        const photoExt = isWebp ? '.webp' : '.jpg';
        const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const dir = resolveEmpleadosDir();
        removeEmpleadoPhysicalPhotos(empUuid);
        fs.writeFileSync(path.join(dir, `${empUuid}${photoExt}`), buffer);
        foto = `/empleados/${empUuid}${photoExt}`;
        invalidateEmpleadoThumbnails(empUuid);
      } catch (e) {
        console.error('Error guardando foto de empleado:', e);
      }
    }

    const fIngreso = cleanDateOnly(data.fecha_ingreso);
    const fNacimiento = cleanDateOnly(data.fecha_nacimiento);
    const rawCargo = data.cargo_uuid || data.cargo_id;
    const isCargoU = rawCargo && isUuid(rawCargo);

    const rows = await sql`
      INSERT INTO empleados (uuid, foto, nombre, cedula, fecha_ingreso, fecha_nacimiento, sexo, cargo_uuid, activo, motivo_desincorporacion)
      VALUES (
        ${empUuid}::uuid, 
        ${foto}, 
        ${data.nombre}, 
        ${data.cedula}, 
        ${fIngreso ? sql`${fIngreso}::date` : sql`NULL`}, 
        ${fNacimiento ? sql`${fNacimiento}::date` : sql`NULL`}, 
        ${data.sexo || 'Masculino'}, 
        ${isCargoU ? sql`${rawCargo}::uuid` : sql`NULL`}, 
        ${data.activo ?? true}, 
        ${data.motivo_desincorporacion || null}
      )
      RETURNING *, uuid AS id, cargo_uuid AS cargo_id
    `;
    const emp = rows[0];

    // Sincronizar dispositivos seleccionados
    const rawDevs = data.dispositivo_uuids || data.dispositivo_ids;
    const validDevs = toUuidArray(rawDevs);
    if (validDevs.length > 0) {
      for (const devUuid of validDevs) {
        await sql`
          INSERT INTO empleado_dispositivos (uuid, empleado_uuid, dispositivo_uuid)
          VALUES (gen_random_uuid(), ${empUuid}::uuid, ${devUuid}::uuid)
          ON CONFLICT DO NOTHING
        `;
      }
    }

    return emp;
  }
  return null;
}

export async function updateEmpleadoModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  if (isPgConnected && sql) {
    // 1. Fetch current employee record to preserve fields not included in partial update
    const currentRows = await sql`
      SELECT * FROM empleados 
      WHERE uuid = ${id}::uuid
    `;
    if (currentRows.length === 0) throw new Error('Empleado no encontrado');
    const existing = currentRows[0];
    const eUuid = existing.uuid;

    // Validar cédula única si se está actualizando
    const cedula = data.cedula !== undefined ? data.cedula : existing.cedula;
    if (cedula && String(cedula).trim()) {
      const normCedula = String(cedula).trim().toUpperCase().replace(/V|-/g, '');
      const existingWithCedula = await sql`
        SELECT uuid, nombre, cedula
        FROM empleados
        WHERE REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') = ${normCedula}
          AND uuid != ${eUuid}::uuid
        LIMIT 1
      `;
      if (existingWithCedula.length > 0) {
        throw new Error(`Ya existe otro empleado registrado con la cédula ${cedula} (${existingWithCedula[0].nombre})`);
      }
    }

    // Gestion de Fotografía (Crear nueva, Reemplazar o Eliminar)
    const isRemoveFoto = Boolean(data.removeFoto || data.foto === null);
    let foto = data.foto !== undefined ? data.foto : existing.foto;

    if (data.fotoBase64) {
      try {
        const isWebp = (data.fotoBase64 || '').startsWith('data:image/webp');
        const photoExt = isWebp ? '.webp' : '.jpg';
        const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const dir = resolveEmpleadosDir();
        removeEmpleadoPhysicalPhotos(eUuid);
        if (existing.foto) {
          const oldBase = path.basename(existing.foto).replace(/\.[^/.]+$/, "");
          removeEmpleadoPhysicalPhotos(oldBase);
          invalidateEmpleadoThumbnails(oldBase);
        }
        if (existing.cedula) {
          const cleanCed = String(existing.cedula).replace(/V|-/g, '');
          removeEmpleadoPhysicalPhotos(cleanCed);
          invalidateEmpleadoThumbnails(cleanCed);
        }
        fs.writeFileSync(path.join(dir, `${eUuid}${photoExt}`), buffer);
        foto = `/empleados/${eUuid}${photoExt}`;
        invalidateEmpleadoThumbnails(eUuid);
      } catch (e) {
        console.error('Error actualizando foto de empleado:', e);
      }
    } else if (isRemoveFoto) {
      foto = null;
      removeEmpleadoPhysicalPhotos(eUuid);
      if (existing.foto) {
        const oldBase = path.basename(existing.foto).replace(/\.[^/.]+$/, "");
        removeEmpleadoPhysicalPhotos(oldBase);
        invalidateEmpleadoThumbnails(oldBase);
      }
      if (existing.cedula) {
        const cleanCed = String(existing.cedula).replace(/V|-/g, '');
        removeEmpleadoPhysicalPhotos(cleanCed);
        invalidateEmpleadoThumbnails(cleanCed);
      }
      invalidateEmpleadoThumbnails(eUuid);
    }

    const nombre = data.nombre !== undefined ? data.nombre : existing.nombre;
    const rawIngreso = data.fecha_ingreso !== undefined ? data.fecha_ingreso : existing.fecha_ingreso;
    const fecha_ingreso = cleanDateOnly(rawIngreso);
    const rawNac = data.fecha_nacimiento !== undefined ? data.fecha_nacimiento : existing.fecha_nacimiento;
    const fecha_nacimiento = cleanDateOnly(rawNac);
    const sexo = data.sexo !== undefined ? data.sexo : existing.sexo;

    const rawCargo = data.cargo_uuid !== undefined ? data.cargo_uuid : data.cargo_id;
    const isCargoU = rawCargo && isUuid(rawCargo);

    const activo = data.activo !== undefined ? Boolean(data.activo) : existing.activo;
    const motivo_desincorporacion = data.motivo_desincorporacion !== undefined ? data.motivo_desincorporacion : existing.motivo_desincorporacion;

    const rows = await sql`
      UPDATE empleados
      SET foto = ${foto},
          nombre = ${nombre},
          cedula = ${cedula},
          fecha_ingreso = ${fecha_ingreso ? sql`${fecha_ingreso}::date` : sql`NULL`},
          fecha_nacimiento = ${fecha_nacimiento ? sql`${fecha_nacimiento}::date` : sql`NULL`},
          sexo = ${sexo},
          cargo_uuid = ${isCargoU ? sql`${rawCargo}::uuid` : sql`cargo_uuid`},
          activo = ${activo},
          motivo_desincorporacion = ${motivo_desincorporacion},
          updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${eUuid}::uuid
      RETURNING *, uuid AS id, cargo_uuid AS cargo_id
    `;
    const updatedEmp = rows[0];

    // Sincronizar dispositivos seleccionados si se enviaron
    const rawDevs = data.dispositivo_uuids !== undefined ? data.dispositivo_uuids : data.dispositivo_ids;
    if (Array.isArray(rawDevs)) {
      await sql`DELETE FROM empleado_dispositivos WHERE empleado_uuid = ${eUuid}::uuid`;
      const validDevs = toUuidArray(rawDevs);
      if (validDevs.length > 0) {
        for (const devUuid of validDevs) {
          await sql`
            INSERT INTO empleado_dispositivos (uuid, empleado_uuid, dispositivo_uuid)
            VALUES (gen_random_uuid(), ${eUuid}::uuid, ${devUuid}::uuid)
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }

    const fullRows = await sql`
      SELECT e.uuid, e.uuid AS id, e.foto, e.nombre, e.cedula, e.sexo, e.cargo_uuid, e.cargo_uuid AS cargo_id, e.activo, e.motivo_desincorporacion,
             e.created_at, e.updated_at,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.uuid AS sala_id, s.uuid AS sala_uuid, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      WHERE e.uuid = ${eUuid}::uuid
      LIMIT 1
    `;
    return fullRows[0] || updatedEmp;
  }
  return null;
}

export async function deleteEmpleadoModel(id) {
  const result = await deleteEntityDynamic('empleados', 'empleado', id);
  if (result && (result.success || result.id || result.uuid)) {
    const targetUuid = result.uuid || (isUuid(id) ? id : null);
    if (targetUuid) {
      removeEmpleadoPhysicalPhotos(targetUuid);
      invalidateEmpleadoThumbnails(targetUuid);
    }
  }
  return result;
}




// --- PLANTILLAS HORARIOS ---
export function buildPlantillasHorariosConditions(options = {}) {
  const conds = [];

  // Excluir excepciones y plantillas sin horas asignadas (esta tabla es exclusivamente para Horarios de trabajo)
  conds.push(sql`p.hora_entrada IS NOT NULL AND p.hora_salida IS NOT NULL AND COALESCE(p.codigo, '') NOT IN ('L', 'U')`);

  // Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(p.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(p.codigo, '')) LIKE ${term} OR
      CAST(p.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getPlantillasHorariosFilterOptionsModel(options = {}) {
  return {
    success: true,
    data: {
      salas: []
    }
  };
}

export async function getPlantillasHorariosModel(params = {}) {
  const isLimitAll = params.limit === 'all' || params.limit === '1000' || params.limit === 1000;
  const page = isLimitAll ? 1 : (Number(params.page) || 1);
  const limit = isLimitAll ? 1000 : (Number(params.limit) || 10);
  const offset = (page - 1) * limit;
  const search = params.search ? String(params.search).trim() : '';
  const sortBy = params.sortBy || params.sort_by || 'codigo';
  const sortDir = String(params.sortDir || params.sort_order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const allowedSortColumns = {
    'id': 'p.created_at',
    'uuid': 'p.created_at',
    'created_at': 'p.created_at',
    'codigo': "CASE WHEN p.codigo ~ '^[0-9]+$' THEN LPAD(p.codigo, 10, '0') ELSE UPPER(p.codigo) END",
    'nombre': 'UPPER(p.nombre)',
    'horas_trabajo': 'p.hora_entrada',
    'hora_entrada': 'p.hora_entrada',
    'hora_salida': 'p.hora_salida',
    'descanso': 'p.descanso',
    'jornada': "COALESCE(p.hora_salida, '00:00:00') - COALESCE(p.hora_entrada, '00:00:00')",
    'color': 'p.color'
  };

  const sortSql = allowedSortColumns[sortBy] || allowedSortColumns['codigo'];
  const orderClause = sql.unsafe("ORDER BY " + sortSql + " " + sortDir + ", p.created_at DESC, p.uuid DESC");

  if (isPgConnected && sql) {
    const conds = buildPlantillasHorariosConditions({
      search
    });

    const whereClause = conds.length > 0
      ? sql`WHERE ${conds.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const countRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM horarios p
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT p.*, p.uuid AS id
      FROM horarios p
      ${whereClause}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalPages = Math.ceil(total / limit) || 1;
    return { success: true, data: dataRes, total, page, limit, totalPages };
  }

  return { success: true, data: [], total: 0, page: 1, limit: 10, totalPages: 1 };
}

export async function createPlantillaHorarioModel(data) {
  if (isPgConnected && sql) {
    const codigo = (data.codigo !== null && data.codigo !== undefined) ? String(data.codigo).trim().toUpperCase() : '';
    const nombre = (data.nombre || '').trim();

    if (!codigo) {
      throw new Error('El código del horario es obligatorio.');
    }
    if (!nombre) {
      throw new Error('La descripción o nombre del horario es obligatorio.');
    }

    // 1. Validar unicidad global contra excepciones
    const [excConflict] = await sql`
      SELECT uuid, uuid AS id, codigo, descripcion 
      FROM excepciones 
      WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (excConflict) {
      throw new Error(`El código "${codigo}" no puede usarse porque pertenece a la excepción global "${excConflict.descripcion}".`);
    }

    // 2. Validar unicidad global de código en horarios
    const [horConflict] = await sql`
      SELECT h.uuid, h.uuid AS id, h.codigo, h.nombre 
      FROM horarios h 
      WHERE LOWER(TRIM(h.codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (horConflict) {
      throw new Error(`El código "${codigo}" ya pertenece al horario "${horConflict.nombre}".`);
    }

    const rows = await sql`
      INSERT INTO horarios (
        nombre, codigo, hora_entrada, hora_salida, descanso, color
      )
      VALUES (
        ${nombre}, ${codigo}, 
        ${data.hora_entrada || null}, ${data.hora_salida || null}, 
        ${data.descanso || '00:00:00'},
        ${data.color || '#FFFF99'}
      )
      RETURNING *, uuid AS id
    `;
    return rows[0];
  }
  return null;
}

export async function updatePlantillaHorarioModel(id, data) {
  if (!id) throw new Error('ID inválido');
  if (isPgConnected && sql) {
    const [current] = await sql`
      SELECT uuid, codigo, nombre, descanso 
      FROM horarios 
      WHERE uuid = ${id}::uuid
    `;
    if (!current) {
      throw new Error(`El horario con ID ${id} no existe.`);
    }

    const pUuid = current.uuid;

    const finalCodigo = (data.codigo !== undefined && data.codigo !== null)
      ? String(data.codigo).trim().toUpperCase()
      : (current.codigo ? String(current.codigo).trim().toUpperCase() : null);

    if (finalCodigo) {
      // 1. Validar contra excepciones globales
      const [excConflict] = await sql`
        SELECT uuid, codigo, descripcion 
        FROM excepciones 
        WHERE LOWER(TRIM(codigo)) = LOWER(${finalCodigo}) 
        LIMIT 1
      `;
      if (excConflict) {
        throw new Error(`El código "${finalCodigo}" no puede usarse porque pertenece a la excepción global "${excConflict.descripcion}".`);
      }

      // 2. Validar contra horarios globales excluyendo el actual
      const [horConflict] = await sql`
        SELECT h.uuid, h.codigo, h.nombre 
        FROM horarios h 
        WHERE LOWER(TRIM(h.codigo)) = LOWER(${finalCodigo}) 
          AND h.uuid != ${pUuid}::uuid
        LIMIT 1
      `;
      if (horConflict) {
        throw new Error(`El código "${finalCodigo}" ya pertenece al horario "${horConflict.nombre}".`);
      }
    }

    const nombre = data.nombre !== undefined ? data.nombre : current.nombre;
    const horaEntrada = data.hora_entrada !== undefined ? data.hora_entrada : null;
    const horaSalida = data.hora_salida !== undefined ? data.hora_salida : null;
    const descanso = data.descanso !== undefined ? data.descanso : (current.descanso || '00:00:00');
    const color = data.color !== undefined ? data.color : '#FFFF99';

    const rows = await sql`
      UPDATE horarios
      SET nombre = ${nombre},
          codigo = ${finalCodigo},
          hora_entrada = ${horaEntrada},
          hora_salida = ${horaSalida},
          descanso = ${descanso},
          color = ${color},
          updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${pUuid}::uuid
      RETURNING *, uuid AS id
    `;
    return rows[0];
  }
  return null;
}

export async function deletePlantillaHorarioModel(id) {
  return await deleteEntityDynamic('horarios', 'horario', id);
}

export async function getDepartamentosCiclosFilterOptionsModel(options = {}) {
  return await getDepartamentosFilterOptionsModel(options);
}

export async function getDepartamentosCiclosModel(params = {}) {
  const isLimitAll = params.limit === 'all' || params.limit === '1000' || params.limit === 1000;
  const page = isLimitAll ? 1 : (Number(params.page) || 1);
  const limit = isLimitAll ? 1000 : (Number(params.limit) || 10);
  const offset = (page - 1) * limit;
  const search = params.search ? String(params.search).trim() : '';

  const sortBy = params.sort_by || 'id';
  const sortOrder = params.sort_order && String(params.sort_order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  let orderBySql = sql`ORDER BY d.nombre ASC`;

  if (sortBy === 'departamento_nombre') {
    orderBySql = sortOrder === 'DESC'
      ? sql`ORDER BY LOWER(d.nombre) DESC, d.uuid DESC`
      : sql`ORDER BY LOWER(d.nombre) ASC, d.uuid ASC`;
  } else if (sortBy === 'sala_nombre') {
    orderBySql = sortOrder === 'DESC'
      ? sql`ORDER BY LOWER(s.nombre) DESC, d.nombre DESC`
      : sql`ORDER BY LOWER(s.nombre) ASC, d.nombre ASC`;
  } else if (sortBy === 'id' || sortBy === 'uuid' || sortBy === 'created_at') {
    orderBySql = sortOrder === 'DESC'
      ? sql`ORDER BY d.created_at DESC, d.uuid DESC`
      : sql`ORDER BY d.created_at ASC, d.uuid ASC`;
  }

  const userSalaUuids = toUuidArray(params.user_sala_ids);
  const filterSalaUuids = toUuidArray(params.sala_ids);

  try {
    let whereConditions = [];

    if (userSalaUuids.length > 0) {
      whereConditions.push(sql`d.sala_uuid = ANY(${userSalaUuids}::uuid[])`);
    }

    if (filterSalaUuids.length > 0) {
      whereConditions.push(sql`d.sala_uuid = ANY(${filterSalaUuids}::uuid[])`);
    }

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      whereConditions.push(sql`(
        LOWER(COALESCE(d.nombre, '')) LIKE ${pattern} OR
        LOWER(COALESCE(s.nombre, '')) LIKE ${pattern} OR
        CAST(d.uuid AS TEXT) LIKE ${pattern}
      )`);
    }

    const whereClause = whereConditions.length > 0
      ? sql`WHERE ${whereConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const countRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT 
        d.uuid AS id,
        d.uuid,
        d.nombre AS departamento_nombre,
        d.sala_uuid AS sala_id,
        d.sala_uuid,
        s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${whereClause}
      ${orderBySql}
      LIMIT ${limit} OFFSET ${offset}
    `;

    for (const item of dataRes) {
      // Get total active employees in this department
      const empCountRes = await sql`
        SELECT COUNT(e.uuid)::int AS total
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        WHERE a.departamento_uuid = ${item.uuid}::uuid AND e.activo = TRUE
      `;
      item.total_empleados = empCountRes[0]?.total || 0;

      // Get all distinct assigned shift horarios for active employees in this department
      const horariosRes = await sql`
        SELECT DISTINCT ph.uuid AS id, ph.uuid, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color
        FROM empleados_horarios eph
        JOIN empleados e ON eph.empleado_uuid = e.uuid
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        JOIN horarios ph ON eph.horario_uuid = ph.uuid
        WHERE a.departamento_uuid = ${item.uuid}::uuid AND e.activo = TRUE
        ORDER BY ph.codigo ASC
      `;
      item.horarios_asignados = horariosRes || [];
      item.ciclos = [];
    }

    const totalPages = Math.ceil(total / limit) || 1;
    return { success: true, data: dataRes, total, page, limit, totalPages };
  } catch (err) {
    console.error('Error in getDepartamentosCiclosModel:', err);
    return { success: false, error: err.message || 'Error de base de datos' };
  }
}

export async function getDepartamentoEmpleadosCiclosModel(deptId, search = '') {
  if (!deptId) return { success: false, error: 'ID de departamento inválido' };

  try {
    const [dept] = await sql`
      SELECT d.uuid AS id, d.uuid, d.nombre AS departamento_nombre, d.sala_uuid AS sala_id, d.sala_uuid, s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      WHERE d.uuid = ${deptId}::uuid
    `;

    if (!dept) return { success: false, error: 'Departamento no encontrado' };

    // Get all shift horarios globally
    const plantillasSala = await sql`
      SELECT uuid AS id, uuid, codigo, nombre, hora_entrada, hora_salida, color
      FROM horarios
      ORDER BY codigo ASC, uuid ASC
    `;

    // Get employees of this department
    const cleanSearch = String(search || '').trim().toLowerCase();
    let searchCondition = sql``;
    if (cleanSearch) {
      const pattern = `%${cleanSearch}%`;
      searchCondition = sql`AND (
        LOWER(COALESCE(e.nombre, '')) LIKE ${pattern} OR
        LOWER(COALESCE(e.cedula, '')) LIKE ${pattern} OR
        CAST(e.uuid AS TEXT) LIKE ${pattern} OR
        LOWER(COALESCE(c.nombre, '')) LIKE ${pattern}
      )`;
    }

    const empleados = await sql`
      SELECT 
        e.uuid AS id,
        e.uuid AS empleado_id,
        e.uuid,
        e.nombre AS empleado_nombre,
        e.cedula,
        e.foto,
        c.nombre AS cargo_nombre,
        a.nombre AS area_nombre
      FROM empleados e
      JOIN cargos c ON e.cargo_uuid = c.uuid
      JOIN areas a ON c.area_uuid = a.uuid
      WHERE a.departamento_uuid = ${deptId}::uuid AND e.activo = TRUE
      ${searchCondition}
      ORDER BY e.nombre ASC
    `;

    for (const emp of empleados) {
      const empHorarios = await sql`
        SELECT ph.uuid AS id, ph.uuid, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color
        FROM empleados_horarios eph
        JOIN horarios ph ON eph.horario_uuid = ph.uuid
        WHERE eph.empleado_uuid = ${emp.empleado_id}::uuid
        ORDER BY ph.codigo ASC, ph.uuid ASC
      `;
      emp.horarios = empHorarios || [];
    }

    return {
      success: true,
      departamento: dept,
      plantillas_sala: plantillasSala,
      empleados
    };
  } catch (err) {
    console.error('Error in getDepartamentoEmpleadosCiclosModel:', err);
    return { success: false, error: err.message || 'Error de base de datos' };
  }
}

export async function updateDepartamentoEmpleadosCiclosModel(deptId, payload = {}) {
  if (!deptId) return { success: false, error: 'ID de departamento inválido' };

  try {
    const action = payload.action;
    const rawPlantilla = payload.plantilla_uuid || payload.plantilla_id || payload.horario_uuid || payload.horario_id;
    const plantillaUuid = rawPlantilla && isUuid(rawPlantilla) ? String(rawPlantilla).trim() : null;
    const rawEmp = payload.empleado_uuid || payload.empleado_id;
    const empUuid = rawEmp && isUuid(rawEmp) ? String(rawEmp).trim() : null;

    if (action === 'bulk_add' && plantillaUuid) {
      await sql`
        INSERT INTO empleados_horarios (empleado_uuid, horario_uuid)
        SELECT e.uuid, ${plantillaUuid}::uuid
        FROM empleados e
        JOIN cargos c ON e.cargo_uuid = c.uuid
        JOIN areas a ON c.area_uuid = a.uuid
        WHERE a.departamento_uuid = ${deptId}::uuid AND e.activo = TRUE
        ON CONFLICT DO NOTHING;
      `;
      return { success: true, message: 'Horario asignado a todos los empleados del departamento' };
    }

    if (action === 'bulk_remove_all') {
      // Remove ALL horarios from ALL employees in this department
      await sql`
        DELETE FROM empleados_horarios
        WHERE empleado_uuid IN (
          SELECT e.uuid
          FROM empleados e
          JOIN cargos c ON e.cargo_uuid = c.uuid
          JOIN areas a ON c.area_uuid = a.uuid
          WHERE a.departamento_uuid = ${deptId}::uuid AND e.activo = TRUE
        );
      `;
      return { success: true, message: 'Todos los horarios han sido quitados de los empleados del departamento' };
    }

    if (action === 'toggle' && empUuid && plantillaUuid) {
      const existing = await sql`
        SELECT uuid FROM empleados_horarios 
        WHERE empleado_uuid = ${empUuid}::uuid AND horario_uuid = ${plantillaUuid}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        await sql`
          DELETE FROM empleados_horarios 
          WHERE empleado_uuid = ${empUuid}::uuid AND horario_uuid = ${plantillaUuid}::uuid
        `;
        return { success: true, action: 'removed' };
      } else {
        await sql`
          INSERT INTO empleados_horarios (empleado_uuid, horario_uuid)
          VALUES (${empUuid}::uuid, ${plantillaUuid}::uuid)
          ON CONFLICT DO NOTHING;
        `;
        return { success: true, action: 'added' };
      }
    }

    if (action === 'remove' && empUuid && plantillaUuid) {
      await sql`
        DELETE FROM empleados_horarios 
        WHERE empleado_uuid = ${empUuid}::uuid AND horario_uuid = ${plantillaUuid}::uuid
      `;
      return { success: true };
    }

    if (Array.isArray(payload.assignments)) {
      for (const item of payload.assignments) {
        const rawE = item.empleado_uuid || item.empleado_id;
        if (!rawE || !isUuid(rawE)) continue;
        const eUuid = String(rawE).trim();

        const rawP = Array.isArray(item.plantilla_uuids) ? item.plantilla_uuids
          : (Array.isArray(item.plantilla_ids) ? item.plantilla_ids
          : (Array.isArray(item.horario_uuids) ? item.horario_uuids
          : (Array.isArray(item.horario_ids) ? item.horario_ids : [])));

        const pUuids = toUuidArray(rawP);

        await sql`
          DELETE FROM empleados_horarios 
          WHERE empleado_uuid = ${eUuid}::uuid
        `;
        for (const pUuid of pUuids) {
          await sql`
            INSERT INTO empleados_horarios (empleado_uuid, horario_uuid)
            VALUES (${eUuid}::uuid, ${pUuid}::uuid)
            ON CONFLICT DO NOTHING;
          `;
        }
      }
      return { success: true, message: 'Horarios actualizados exitosamente' };
    }
    return { success: true };
  } catch (err) {
    console.error('Error in updateDepartamentoEmpleadosCiclosModel:', err);
    return { success: false, error: err.message || 'Error al actualizar base de datos' };
  }
}

// ==========================================
// MODELOS DE FERIADOS / CALENDARIO
// ==========================================

const MESES_MAP = {
  1: 'Enero',
  2: 'Febrero',
  3: 'Marzo',
  4: 'Abril',
  5: 'Mayo',
  6: 'Junio',
  7: 'Julio',
  8: 'Agosto',
  9: 'Septiembre',
  10: 'Octubre',
  11: 'Noviembre',
  12: 'Diciembre'
};

function buildFeriadosConditions(options = {}) {
  const conds = [];
  const { userSalaIds, salaIds, search } = options;

  const userSalaUuids = toUuidArray(userSalaIds);
  if (userSalaUuids.length > 0) {
    conds.push(sql`f.sala_uuid = ANY(${userSalaUuids}::uuid[])`);
  }

  const filterSalaUuids = toUuidArray(salaIds);
  if (filterSalaUuids.length > 0) {
    conds.push(sql`f.sala_uuid = ANY(${filterSalaUuids}::uuid[])`);
  }

  // Búsqueda libre
  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    conds.push(sql`(
      f.nombre ILIKE ${term} OR 
      s.nombre ILIKE ${term} OR
      CAST(f.dia AS TEXT) = ${search.trim()} OR
      CAST(f.mes AS TEXT) = ${search.trim()}
    )`);
  }

  return conds;
}

export async function getFeriadosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return { success: true, data: { salas: [] } };
  }

  const userSalaIds = options.userSalaIds || [];
  const conds = buildFeriadosConditions({ userSalaIds });
  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const userSalaUuids = toUuidArray(userSalaIds);
  let allSalas = [];
  if (userSalaUuids.length > 0) {
    allSalas = await sql`SELECT s.uuid AS id, s.uuid, s.nombre FROM salas s WHERE s.uuid = ANY(${userSalaUuids}::uuid[]) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.uuid AS id, s.uuid, s.nombre FROM salas s ORDER BY s.nombre ASC`;
  }

  const countsRes = await sql`
    SELECT f.sala_uuid AS id, COUNT(f.uuid)::int AS count
    FROM feriados f
    LEFT JOIN salas s ON f.sala_uuid = s.uuid
    ${where}
    GROUP BY f.sala_uuid
  `;
  const countMap = new Map(countsRes.map(r => [r.id, r.count]));
  const activeSalas = new Set(toUuidArray(options.salaIds));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(s.id))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    data: { salas }
  };
}

export async function getFeriadosModel(params = {}) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.max(1, parseInt(params.limit) || 10);
  const offset = (page - 1) * limit;
  const search = (params.search || '').trim();
  const sortBy = params.sort_by || params.sortBy || 'mes';
  const sortDir = (params.sort_order || params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const userSalaIds = params.user_sala_ids ? params.user_sala_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
  const salaIds = params.sala_ids ? params.sala_ids.split(',').map(s => s.trim()).filter(Boolean) : [];

  const allowedSortColumns = {
    'id': 'f.created_at ' + sortDir,
    'uuid': 'f.created_at ' + sortDir,
    'created_at': 'f.created_at ' + sortDir,
    'nombre': 'UPPER(f.nombre) ' + sortDir,
    'sala_nombre': 'UPPER(s.nombre) ' + sortDir,
    'mes': 'f.mes ' + sortDir + ', f.dia ' + sortDir,
    'mes_nombre': 'f.mes ' + sortDir + ', f.dia ' + sortDir,
    'dia': 'f.dia ' + sortDir + ', f.mes ' + sortDir,
    'fecha': 'f.mes ' + sortDir + ', f.dia ' + sortDir
  };

  const sortSql = allowedSortColumns[sortBy] || ('f.mes ' + sortDir + ', f.dia ' + sortDir);
  const orderClause = sql.unsafe("ORDER BY " + sortSql + ", f.uuid ASC");

  if (isPgConnected && sql) {
    const conds = buildFeriadosConditions({
      userSalaIds,
      salaIds,
      search
    });

    const whereClause = conds.length > 0
      ? sql`WHERE ${conds.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const countRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM feriados f
      LEFT JOIN salas s ON f.sala_uuid = s.uuid
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT f.*, f.uuid AS id, f.sala_uuid AS sala_id, s.nombre AS sala_nombre
      FROM feriados f
      LEFT JOIN salas s ON f.sala_uuid = s.uuid
      ${whereClause}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;

    const mapped = dataRes.map(r => ({
      ...r,
      mes_nombre: MESES_MAP[r.mes] || `Mes ${r.mes}`
    }));

    const totalPages = Math.ceil(total / limit) || 1;
    return { success: true, data: mapped, total, page, limit, totalPages };
  }

  return { success: true, data: [], total: 0, page: 1, limit: 10, totalPages: 1 };
}

export async function createFeriadoModel(data) {
  const nombre = (data.nombre || '').trim();
  const rawSala = data.sala_uuid || data.sala_id;
  const salaUuid = rawSala && isUuid(rawSala) ? String(rawSala).trim() : null;
  const mes = Math.min(12, Math.max(1, parseInt(data.mes) || 1));
  const dia = Math.min(31, Math.max(1, parseInt(data.dia) || 1));

  if (!nombre) throw new Error('El nombre de la fecha patria o feriado es obligatorio');
  if (!salaUuid) throw new Error('Debe seleccionar una sala válida');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT f.uuid, f.nombre, s.nombre as sala_nombre
      FROM feriados f
      LEFT JOIN salas s ON f.sala_uuid = s.uuid
      WHERE f.sala_uuid = ${salaUuid}::uuid AND f.mes = ${mes} AND f.dia = ${dia}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un feriado ("${existing[0].nombre}") para esta sala en la fecha ${dia}/${mes}`);
    }
    const rows = await sql`
      INSERT INTO feriados (nombre, sala_uuid, mes, dia)
      VALUES (
        ${nombre},
        ${salaUuid}::uuid,
        ${mes},
        ${dia}
      )
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    const row = rows[0];
    if (row) {
      const sala = await sql`SELECT nombre FROM salas WHERE uuid = ${row.sala_uuid}::uuid`;
      return {
        ...row,
        sala_nombre: sala[0]?.nombre || 'Sin Sala',
        mes_nombre: MESES_MAP[row.mes] || `Mes ${row.mes}`
      };
    }
    return row;
  }
  return null;
}

export async function updateFeriadoModel(id, data) {
  if (!id) throw new Error('ID inválido');
  if (isPgConnected && sql) {
    const current = await sql`
      SELECT * FROM feriados 
      WHERE uuid = ${id}::uuid
    `;
    if (current.length === 0) throw new Error('Feriado no encontrado');

    const rawSala = data.sala_uuid || data.sala_id;
    const targetSalaUuid = rawSala && isUuid(rawSala) ? String(rawSala).trim() : current[0].sala_uuid;
    const targetMes = data.mes ? Math.min(12, Math.max(1, parseInt(data.mes))) : current[0].mes;
    const targetDia = data.dia ? Math.min(31, Math.max(1, parseInt(data.dia))) : current[0].dia;

    const existing = await sql`
      SELECT f.uuid, f.nombre 
      FROM feriados f
      WHERE f.sala_uuid = ${targetSalaUuid}::uuid
        AND f.mes = ${targetMes} AND f.dia = ${targetDia} AND f.uuid != ${id}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otro feriado ("${existing[0].nombre}") para esta sala en la fecha ${targetDia}/${targetMes}`);
    }

    const rows = await sql`
      UPDATE feriados
      SET nombre = ${data.nombre ? data.nombre.trim() : sql`nombre`},
          sala_uuid = ${targetSalaUuid ? sql`${targetSalaUuid}::uuid` : sql`sala_uuid`},
          mes = ${targetMes},
          dia = ${targetDia},
          updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    const row = rows[0];
    if (row) {
      const sala = await sql`SELECT nombre FROM salas WHERE uuid = ${row.sala_uuid}::uuid`;
      return {
        ...row,
        sala_nombre: sala[0]?.nombre || 'Sin Sala',
        mes_nombre: MESES_MAP[row.mes] || `Mes ${row.mes}`
      };
    }
    return row;
  }
  return null;
}

export async function deleteFeriadoModel(id) {
  return await deleteEntityDynamic('feriados', 'feriado', id);
}

// --- CUMPLEAÑOS DE EMPLEADOS PARA CALENDARIO ---
export async function getCumpleanosModel(params = {}) {
  const { mes, sala_ids, user_sala_ids } = params;
  if (isPgConnected && sql) {
    const conds = [sql`e.fecha_nacimiento IS NOT NULL`, sql`e.activo = true`];

    const mesesParam = params.meses || params.mes;
    if (mesesParam) {
      const mList = String(mesesParam).split(',').map(Number).filter(n => !isNaN(n) && n >= 1 && n <= 12);
      if (mList.length === 1) {
        conds.push(sql`EXTRACT(MONTH FROM e.fecha_nacimiento) = ${mList[0]}`);
      } else if (mList.length > 1) {
        conds.push(sql`EXTRACT(MONTH FROM e.fecha_nacimiento) IN ${sql(mList)}`);
      }
    }

    const sUuids = toUuidArray(sala_ids);
    const uUuids = toUuidArray(user_sala_ids);
    if (sUuids.length > 0) {
      conds.push(sql`s.uuid = ANY(${sUuids}::uuid[])`);
    } else if (uUuids.length > 0) {
      conds.push(sql`s.uuid = ANY(${uUuids}::uuid[])`);
    }

    const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const rows = await sql`
      SELECT 
        e.uuid AS id, 
        e.uuid,
        e.nombre, 
        e.cedula,
        e.fecha_nacimiento, 
        e.fecha_ingreso,
        e.foto,
        EXTRACT(DAY FROM e.fecha_nacimiento)::int AS dia,
        EXTRACT(MONTH FROM e.fecha_nacimiento)::int AS mes,
        EXTRACT(YEAR FROM e.fecha_nacimiento)::int AS anio_nacimiento,
        s.uuid AS sala_id, 
        s.uuid AS sala_uuid,
        COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
        c.nombre AS cargo_nombre,
        COALESCE(d.nombre, 'General') AS departamento_nombre,
        COALESCE(a.nombre, '') AS area_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ORDER BY dia ASC, e.nombre ASC
    `;

    return rows.map(r => ({
      ...r,
      foto: r.foto || `/empleados/${r.uuid || r.id}.jpg`
    }));
  }

  return [];
}

// --- CARNETS DE EMPLEADOS ---
export async function getCarnetsModel(params = {}) {
  const { sala_ids, user_sala_ids, search } = params;
  if (isPgConnected && sql) {
    const conds = [sql`e.activo = true`];

    const sUuids = toUuidArray(sala_ids);
    const uUuids = toUuidArray(user_sala_ids);
    if (sUuids.length > 0) {
      conds.push(sql`s.uuid = ANY(${sUuids}::uuid[])`);
    } else if (uUuids.length > 0) {
      conds.push(sql`s.uuid = ANY(${uUuids}::uuid[])`);
    }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      conds.push(sql`(e.nombre ILIKE ${term} OR e.cedula ILIKE ${term} OR c.nombre ILIKE ${term})`);
    }

    const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const rows = await sql`
      SELECT 
        e.uuid AS id, 
        e.uuid,
        e.nombre, 
        e.cedula,
        e.fecha_nacimiento, 
        e.fecha_ingreso,
        e.foto,
        s.uuid AS sala_id, 
        s.uuid AS sala_uuid,
        COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
        COALESCE(s.nombre_comercial, s.nombre, 'Casino') AS sala_nombre_comercial,
        COALESCE(s.rif, '') AS sala_rif,
        COALESCE(s.ubicacion, '') AS sala_ubicacion,
        COALESCE(s.correo, '') AS sala_correo,
        COALESCE(s.telefono, '') AS sala_telefono,
        COALESCE(c.nombre, 'Personal') AS cargo_nombre,
        COALESCE(d.nombre, 'General') AS departamento_nombre,
        COALESCE(a.nombre, '') AS area_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      ${where}
      ORDER BY s.nombre ASC, e.nombre ASC
    `;

    return rows.map(r => ({
      ...r,
      foto: r.foto || `/empleados/${r.uuid || r.id}.jpg`,
      sala_logo: `/salas/${r.sala_uuid || r.sala_id}.svg`
    }));
  }

  return [];
}

// ==========================================
// HISTÓRICOS DE CORTES DE ASISTENCIA
// ==========================================

export async function getCortesModel(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const hasLimit = options.limit !== undefined && String(options.limit).toLowerCase() !== 'all' && Number(options.limit) > 0;
  const limit = hasLimit ? Number(options.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = options.search ? String(options.search).trim().toLowerCase() : '';
  const validSorts = ['id', 'uuid', 'fecha_desde', 'fecha_hasta', 'total_empleados', 'created_at', 'updated_at'];
  const sortBy = validSorts.includes(options.sortBy) ? options.sortBy : 'created_at';
  const sortDir = (options.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (isPgConnected && sql) {
    try {
      const conds = [];
      // Filtrar solo cortes con visible = TRUE (o NULL como TRUE para compatibilidad)
      conds.push(sql`COALESCE(cortes.visible, TRUE) = TRUE`);

      const userSalaUuids = toUuidArray(options.userSalaIds);
      if (userSalaUuids.length > 0) {
        conds.push(sql`(cortes.salas_uuids IS NOT NULL AND cortes.salas_uuids && ${userSalaUuids}::uuid[])`);
      }

      const salaUuids = toUuidArray(options.salaIds);
      if (salaUuids.length > 0) {
        conds.push(sql`cortes.salas_uuids && ${salaUuids}::uuid[]`);
      }

      if (search) {
        const term = `%${search}%`;
        conds.push(sql`(
          CAST(cortes.uuid AS TEXT) LIKE ${term} OR
          EXISTS (
            SELECT 1 FROM salas s 
            WHERE s.uuid = ANY(cortes.salas_uuids) 
              AND (LOWER(COALESCE(s.nombre, '')) LIKE ${term})
          )
        )`);
      }

      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const sortColumn = (sortBy === 'id' || sortBy === 'uuid' || sortBy === 'created_at' || !sortBy) ? 'created_at' : sortBy;
      const order = sql.unsafe(`ORDER BY cortes.${sortColumn} ${sortDir}, cortes.created_at DESC, cortes.uuid DESC`);
      const limitClause = limit > 0 ? sql`LIMIT ${limit} OFFSET ${offset}` : sql``;

      const [countResult, rows] = await Promise.all([
        sql`SELECT COUNT(*)::int AS total FROM cortes ${where}`,
        sql`
          SELECT 
            cortes.uuid AS id, 
            cortes.uuid,
            cortes.salas_uuids, 
            cortes.salas_uuids AS salas_ids,
            cortes.fecha_desde, 
            cortes.fecha_hasta, 
            cortes.total_empleados, 
            cortes.created_at, 
            cortes.updated_at,
            (
              SELECT ARRAY_AGG(COALESCE(s.nombre, 'Sala'))
              FROM salas s
              WHERE s.uuid = ANY(cortes.salas_uuids)
            ) AS salas_nombres
          FROM cortes 
          ${where}
          ${order}
          ${limitClause}
        `
      ]);

      return {
        success: true,
        data: rows,
        total: countResult[0]?.total || 0,
        page,
        limit: limit > 0 ? limit : (countResult[0]?.total || 0)
      };
    } catch (err) {
      console.error('Error getCortesModel en PG:', err);
    }
  }

  // Fallback in-memory
  let items = [...(inMemoryData.cortes || [])].filter(c => c.visible !== false && c.visible !== 0);
  const userSalaUuids = toUuidArray(options.userSalaIds);
  if (userSalaUuids.length > 0) {
    items = items.filter(c => Array.isArray(c.salas_uuids) && c.salas_uuids.some(id => userSalaUuids.includes(id)));
  }
  const salaUuids = toUuidArray(options.salaIds);
  if (salaUuids.length > 0) {
    items = items.filter(c => Array.isArray(c.salas_uuids) && c.salas_uuids.some(id => salaUuids.includes(id)));
  }
  if (search) {
    items = items.filter(c => 
      String(c.uuid || c.id).includes(search) ||
      (c.salas_nombres || []).some(n => String(n).toLowerCase().includes(search))
    );
  }
  items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const total = items.length;
  const paged = (limit > 0 ? items.slice(offset, offset + limit) : items).map(c => {
    const { data, ...rest } = c;
    return rest;
  });

  return {
    success: true,
    data: paged,
    total,
    page,
    limit: limit > 0 ? limit : total
  };
}

export async function getCorteByIdModel(id) {
  if (!id) return { success: false, error: 'ID inválido' };
  if (isPgConnected && sql) {
    try {
      const rows = await sql`SELECT *, uuid AS id, salas_uuids AS salas_ids FROM cortes WHERE uuid = ${id}::uuid LIMIT 1`;
      if (rows && rows.length > 0) {
        let corteData = rows[0].data;
        if (typeof corteData === 'string') {
          if (corteData.startsWith('gzip:') || corteData.startsWith('H4sI')) {
            try {
              const cleanBase64 = corteData.replace(/^gzip:/, '');
              const buf = Buffer.from(cleanBase64, 'base64');
              corteData = JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
            } catch (e) {
              console.warn('Error gunzip in getCorteByIdModel:', e);
            }
          } else {
            try {
              corteData = JSON.parse(corteData);
              if (typeof corteData === 'string') {
                corteData = JSON.parse(corteData);
              }
            } catch (e) {}
          }
        }

        let salasNombres = [];
        if (rows[0].salas_uuids && rows[0].salas_uuids.length > 0) {
          try {
            const salasRows = await sql`SELECT uuid, nombre FROM salas WHERE uuid = ANY(${rows[0].salas_uuids}::uuid[])`;
            salasNombres = (rows[0].salas_uuids || []).map(sid => {
              const found = salasRows.find(s => s.uuid === sid);
              return found ? found.nombre : `Sala ${sid}`;
            });
          } catch (e) {}
        }
        const resolvedSalaNombre = salasNombres.length === 1 
          ? salasNombres[0] 
          : (salasNombres.length > 1 ? `${salasNombres.length} Salas` : (rows[0].sala_nombre || 'General'));

        return { 
          success: true, 
          data: { 
            ...rows[0], 
            data: corteData,
            salas_nombres: salasNombres,
            sala_nombre: resolvedSalaNombre
          } 
        };
      }
      return { success: false, error: 'Corte no encontrado' };
    } catch (err) {
      console.error('Error getCorteByIdModel en PG:', err);
    }
  }

  const found = (inMemoryData.cortes || []).find(c => c.uuid === id || String(c.id) === String(id));
  if (found) {
    let corteData = found.data;
    if (typeof corteData === 'string') {
      if (corteData.startsWith('gzip:') || corteData.startsWith('H4sI')) {
        try {
          const cleanBase64 = corteData.replace(/^gzip:/, '');
          const buf = Buffer.from(cleanBase64, 'base64');
          corteData = JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
        } catch (e) {}
      } else {
        try {
          corteData = JSON.parse(corteData);
        } catch (e) {}
      }
    }
    return { success: true, data: { ...found, data: corteData } };
  }
  return { success: false, error: 'Corte no encontrado' };
}

export async function createCorteModel(payload = {}) {
  const {
    salas_uuids,
    salas_ids,
    sala_uuid,
    sala_id,
    fecha_desde,
    fecha_hasta,
    total_empleados,
    data
  } = payload;

  const isVisible = (payload.visible === false || payload.visible === 0 || payload.visible === '0' || payload.visible === 'false') ? false : true;

  // Descomprimir payload si viene en formato gzip base64
  let parsedData = data;
  if (typeof parsedData === 'string' && (parsedData.startsWith('gzip:') || parsedData.startsWith('H4sI'))) {
    try {
      const cleanBase64 = parsedData.replace(/^gzip:/, '');
      const buf = Buffer.from(cleanBase64, 'base64');
      const decompressed = zlib.gunzipSync(buf);
      parsedData = JSON.parse(decompressed.toString('utf-8'));
    } catch (errDecomp) {
      console.error('Error descomprimiendo corte data en backend:', errDecomp);
    }
  }

  // Extraer salas_uuids limpios
  let cleanSalasUuids = toUuidArray(salas_uuids || salas_ids);
  if (cleanSalasUuids.length === 0 && (sala_uuid || sala_id)) {
    cleanSalasUuids = toUuidArray([sala_uuid || sala_id]);
  }

  // Si no vinieron salas explícitas, extraer de los empleados en data
  if (cleanSalasUuids.length === 0 && parsedData) {
    const emps = parsedData.empleados || (parsedData.reportData && parsedData.reportData.empleados) || [];
    if (Array.isArray(emps) && emps.length > 0) {
      const ids = emps.map(e => e.sala_uuid || e.sala_id).filter(Boolean);
      cleanSalasUuids = toUuidArray(ids);
    }
  }

  const jsonStr = typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData || {});

  if (isPgConnected && sql) {
    try {
      const rows = await sql`
        INSERT INTO cortes (
          salas_uuids, 
          fecha_desde, 
          fecha_hasta, 
          total_empleados, 
          data,
          visible
        ) VALUES (
          ${cleanSalasUuids}::uuid[],
          ${fecha_desde},
          ${fecha_hasta},
          ${total_empleados ? Number(total_empleados) : 0},
          CAST(${jsonStr} AS JSONB),
          ${isVisible}
        )
        RETURNING uuid AS id, uuid, salas_uuids, salas_uuids AS salas_ids, fecha_desde, fecha_hasta, total_empleados, visible, created_at, updated_at
      `;

      if (rows && rows.length > 0) {
        const created = rows[0];
        if (!inMemoryData.cortes) inMemoryData.cortes = [];
        inMemoryData.cortes.unshift({ ...created, data: parsedData });
        return { success: true, data: created };
      }
    } catch (err) {
      console.error('Error createCorteModel en PG:', err);
      throw err;
    }
  }

  // Fallback in-memory
  if (!inMemoryData.cortes) inMemoryData.cortes = [];
  const nextUuid = `corte-${Date.now()}`;
  const newCorte = {
    id: nextUuid,
    uuid: nextUuid,
    salas_uuids: cleanSalasUuids,
    salas_ids: cleanSalasUuids,
    fecha_desde,
    fecha_hasta,
    total_empleados: total_empleados ? Number(total_empleados) : 0,
    data: parsedData,
    visible: isVisible,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  inMemoryData.cortes.unshift(newCorte);
  const { data: _d, ...createdWithoutData } = newCorte;
  return { success: true, data: createdWithoutData };
}

export async function deleteCorteModel(id) {
  if (!id) throw new Error('ID de corte requerido');
  return await deleteEntityDynamic('cortes', 'Corte', id);
}

export async function getCortesFilterOptionsModel(options = {}) {
  const salasMap = new Map();

  if (isPgConnected && sql) {
    try {
      const userSalaUuids = toUuidArray(options.userSalaIds);
      let rows;
      if (userSalaUuids.length > 0) {
        rows = await sql`SELECT uuid AS id, uuid, nombre, nombre_comercial FROM salas WHERE uuid = ANY(${userSalaUuids}::uuid[]) ORDER BY nombre ASC`;
      } else {
        rows = await sql`SELECT uuid AS id, uuid, nombre, nombre_comercial FROM salas ORDER BY nombre ASC`;
      }
      rows.forEach(s => {
        salasMap.set(s.uuid, { id: s.uuid, uuid: s.uuid, nombre: s.nombre || 'Sala' });
      });
      return {
        success: true,
        data: {
          salas: Array.from(salasMap.values())
        }
      };
    } catch (err) {
      console.error('Error getCortesFilterOptionsModel en PG:', err);
    }
  }

  (inMemoryData.salas || []).forEach(s => {
    const sUuid = s.uuid || s.id;
    salasMap.set(sUuid, { id: sUuid, uuid: sUuid, nombre: s.nombre || 'Sala' });
  });

  return {
    success: true,
    data: {
      salas: Array.from(salasMap.values())
    }
  };
}

// ==================== DESCARGAS MODEL ====================

export async function getDescargasModel() {
  if (isPgConnected && sql) {
    try {
      const rows = await sql`
        SELECT *, uuid AS id FROM descargas 
        ORDER BY fecha DESC, created_at DESC
      `;
      return { success: true, data: rows };
    } catch (err) {
      console.error('Error getDescargasModel:', err);
      throw err;
    }
  }
  return { success: true, data: inMemoryData.descargas || [] };
}

export async function getLatestDescargasModel() {
  if (isPgConnected && sql) {
    try {
      const androidRows = await sql`
        SELECT *, uuid AS id FROM descargas 
        WHERE plataforma = 'android' 
        ORDER BY fecha DESC, created_at DESC LIMIT 1
      `;
      const windowsRows = await sql`
        SELECT *, uuid AS id FROM descargas 
        WHERE plataforma = 'windows' 
        ORDER BY fecha DESC, created_at DESC LIMIT 1
      `;
      return {
        success: true,
        data: {
          android: androidRows[0] || null,
          windows: windowsRows[0] || null
        }
      };
    } catch (err) {
      console.error('Error getLatestDescargasModel:', err);
      throw err;
    }
  }

  const list = inMemoryData.descargas || [];
  const android = list.filter(d => d.plataforma === 'android').slice(-1)[0] || null;
  const windows = list.filter(d => d.plataforma === 'windows').slice(-1)[0] || null;
  return { success: true, data: { android, windows } };
}

export async function createDescargaUploadModel({ fileBase64, filename, size, sizeText }) {
  const fs = await import('fs');
  const path = await import('path');

  if (!fileBase64) {
    throw new Error('No se recibió el contenido del archivo');
  }

  // 1. Detect extension and format
  const ext = path.extname(filename || '').toLowerCase().replace('.', '');
  let formato = ext;
  let plataforma = 'windows';

  if (ext === 'apk') {
    plataforma = 'android';
    formato = 'apk';
  } else if (ext === 'exe' || ext === 'msi') {
    plataforma = 'windows';
    formato = ext;
  } else {
    throw new Error(`Formato .${ext} no soportado. Debe ser .apk (Android) o .exe / .msi (Windows)`);
  }

  // 2. Decode file buffer and calculate real size
  const cleanBase64 = String(fileBase64).replace(/^data:.*?;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  const pesoBytes = buffer.length;

  let pesoFormateado = sizeText;
  if (!pesoFormateado) {
    if (pesoBytes >= 1024 * 1024) {
      pesoFormateado = `${(pesoBytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      pesoFormateado = `${(pesoBytes / 1024).toFixed(1)} KB`;
    }
  }

  // 3. Calculate sequential version count for this platform
  let versionNum = 1;
  if (isPgConnected && sql) {
    const countRes = await sql`
      SELECT COUNT(*)::int AS count 
      FROM descargas 
      WHERE plataforma = ${plataforma}
    `;
    versionNum = (countRes[0]?.count || 0) + 1;

    // 4. Insert initial record to get generated UUID
    const inserted = await sql`
      INSERT INTO descargas (plataforma, formato, archivo, peso, peso_bytes, version_num, fecha)
      VALUES (${plataforma}, ${formato}, 'temp', ${pesoFormateado}, ${pesoBytes}, ${versionNum}, CURRENT_TIMESTAMP)
      RETURNING uuid, uuid AS id, fecha
    `;
    const recordUuid = inserted[0].uuid;

    // 5. Generate official filename: app-wisi-{plataforma}-v{conteo}-{uuid_corta}.{formato}
    const shortUuid = recordUuid.slice(0, 8);
    const finalFilename = `app-wisi-${plataforma}-v${versionNum}-${shortUuid}.${formato}`;

    // 6. Write file to disk in candidate downloads directories
    const { fileURLToPath } = await import('url');
    const targetDirs = [
      path.join(process.cwd(), 'downloads'),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'downloads'),
      '/var/www/wisi/backend-fastify/downloads',
      '/var/www/wisi/downloads'
    ];
    for (const d of targetDirs) {
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, finalFilename), buffer);
      } catch (e) {}
    }

    // 7. Update row with final filename
    const updated = await sql`
      UPDATE descargas 
      SET archivo = ${finalFilename} 
      WHERE uuid = ${recordUuid}::uuid
      RETURNING *, uuid AS id
    `;

    return { success: true, data: updated[0] };
  }

  // Fallback in-memory
  if (!inMemoryData.descargas) inMemoryData.descargas = [];
  versionNum = inMemoryData.descargas.filter(d => d.plataforma === plataforma).length + 1;
  const nextUuid = `descarga-${Date.now()}`;
  const finalFilename = `app-wisi-${plataforma}-v${versionNum}-${nextUuid.slice(0, 8)}.${formato}`;

  const downloadsDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(downloadsDir, finalFilename), buffer);

  const newDescarga = {
    id: nextUuid,
    uuid: nextUuid,
    plataforma,
    formato,
    archivo: finalFilename,
    peso: pesoFormateado,
    peso_bytes: pesoBytes,
    version_num: versionNum,
    fecha: new Date().toISOString()
  };
  inMemoryData.descargas.unshift(newDescarga);
  return { success: true, data: newDescarga };
}

export async function deleteDescargaModel(id) {
  if (!id) throw new Error('ID de descarga requerido');
  const fs = await import('fs');
  const path = await import('path');

  if (isPgConnected && sql) {
    const existing = await sql`SELECT uuid, archivo FROM descargas WHERE uuid = ${id}::uuid LIMIT 1`;
    if (existing.length > 0 && existing[0].archivo) {
      const filePath = path.join(process.cwd(), 'downloads', existing[0].archivo);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    await sql`DELETE FROM descargas WHERE uuid = ${id}::uuid`;
    return { success: true };
  }

  if (inMemoryData.descargas) {
    inMemoryData.descargas = inMemoryData.descargas.filter(d => d.uuid !== id && String(d.id) !== String(id));
  }
  return { success: true };
}


// ==========================================
// --- JUEGOS (MESAS EN VIVO) ---
// ==========================================

export function buildJuegoConditions(options = {}) {
  const conds = [];

  // Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(j.nombre, '')) LIKE ${term} OR
      CAST(j.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getJuegosFilterOptionsModel(options = {}) {
  return {
    success: true,
    data: {}
  };
}

export async function getJuegosModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.juegos || [];
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'nombre';
  const sortDir = (params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const conds = buildJuegoConditions({ search });
  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'j.created_at',
    'uuid': 'j.created_at',
    'created_at': 'j.created_at',
    'nombre': 'j.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'j.created_at';

  const countRes = await sql`
    SELECT COUNT(j.uuid)::int AS total
    FROM juegos j
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, j.created_at DESC, j.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT j.*, j.uuid AS id
      FROM juegos j
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT j.*, j.uuid AS id
      FROM juegos j
      ${where}
      ${orderClause}
    `;
  }

  data = data.map(r => ({ ...r, nombre: toTitleCase(r.nombre) }));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function createJuegoModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del juego es obligatorio');
  const juegoUuid = data.uuid && isUuid(data.uuid) ? data.uuid : null;

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM juegos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un juego registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO juegos (
        ${juegoUuid ? sql`uuid,` : sql``}
        nombre
      )
      VALUES (
        ${juegoUuid ? sql`${juegoUuid}::uuid,` : sql``}
        ${cleanName}
      )
      RETURNING *, uuid AS id
    `;
    return rows[0];
  } else {
    const cleanLower = cleanName.toLowerCase();
    const existing = (inMemoryData.juegos || []).find(j => (j.nombre || '').trim().toLowerCase() === cleanLower);
    if (existing) {
      throw new Error(`Ya existe un juego registrado con el nombre "${toTitleCase(cleanName)}"`);
    }
    const nextId = (inMemoryData.juegos?.length || 0) > 0 ? Math.max(...inMemoryData.juegos.map(j => j.id)) + 1 : 1;
    const newJuego = {
      id: nextId,
      uuid: juegoUuid || `juego-${Date.now()}`,
      nombre: cleanName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.juegos = inMemoryData.juegos || [];
    inMemoryData.juegos.unshift(newJuego);
    return newJuego;
  }
}

export async function updateJuegoModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const isU = isUuid(id);
  if (!isU) throw new Error('ID inválido');
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;

  if (isPgConnected && sql) {
    if (cleanName) {
      const existing = await sql`
        SELECT uuid FROM juegos 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND uuid != ${id}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otro juego registrado con el nombre "${toTitleCase(cleanName)}"`);
      }
    }

    const rows = await sql`
      UPDATE juegos
      SET 
        nombre = COALESCE(${cleanName}, nombre),
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.juegos || []).findIndex(j => j.uuid === id || j.id === id);
    if (idx !== -1) {
      inMemoryData.juegos[idx] = { ...inMemoryData.juegos[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.juegos[idx];
    }
    return null;
  }
}

export async function deleteJuegoModel(id) {
  if (!id) throw new Error('ID de juego requerido');
  return await deleteEntityDynamic('juegos', 'Juego', id);
}


// ==========================================
// --- MESAS (MESAS EN VIVO: ACTIVAS Y BORRADAS) ---
// ==========================================

export function buildMesaConditions(options = {}) {
  const conds = [];

  // 1. Estado activo (1 = mesas activas, 0 = mesas borradas)
  if (options.active !== undefined && options.active !== null && options.active !== '') {
    conds.push(sql`m.active = ${Number(options.active)}`);
  }

  // 2. Restricción por salas asignadas al usuario logueado
  const userSalas = toUuidArray(options.userSalaUuids || options.userSalaIds);
  if (userSalas.length > 0) {
    conds.push(sql`m.sala_uuid = ANY(${userSalas}::uuid[])`);
  }

  // 3. Salas seleccionadas en el filtro
  if (!options.skipSalas) {
    const salas = toUuidArray(options.salaUuids || options.salaIds);
    if (salas.length > 0) {
      conds.push(sql`m.sala_uuid = ANY(${salas}::uuid[])`);
    }
  }

  // 4. Juegos seleccionados en el filtro
  if (!options.skipJuegos) {
    const juegos = toUuidArray(options.juegoUuids || options.juegoIds);
    if (juegos.length > 0) {
      conds.push(sql`m.juego_uuid = ANY(${juegos}::uuid[])`);
    }
  }

  // 5. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(m.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(j.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(m.uuid AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getMesasFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [], juegos: [] }
    };
  }

  const active = options.active !== undefined ? Number(options.active) : 1;

  // Filtro de Salas
  const condsSalas = buildMesaConditions({ ...options, skipSalas: true, active });
  const whereSalas = condsSalas.length > 0 ? sql`WHERE ${condsSalas.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  let allSalas;
  const userSalas = toUuidArray(options.userSalaUuids || options.userSalaIds);
  if (userSalas.length > 0) {
    allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s WHERE s.uuid = ANY(${userSalas}::uuid[]) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.uuid, s.uuid AS id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
  }

  const countsSalasRes = await sql`
    SELECT m.sala_uuid AS id, COUNT(m.uuid)::int AS count
    FROM mesas m
    LEFT JOIN salas s ON m.sala_uuid = s.uuid
    LEFT JOIN juegos j ON m.juego_uuid = j.uuid
    ${whereSalas}
    GROUP BY m.sala_uuid
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.id, r.count]));
  const activeSalas = new Set(toUuidArray(options.salaUuids || options.salaIds));

  const salas = allSalas
    .map(s => ({
      id: s.uuid,
      uuid: s.uuid,
      nombre: s.nombre,
      count: countSalasMap.get(s.uuid) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(s.uuid))
    .sort((a, b) => b.count - a.count);

  // Filtro de Juegos
  const condsJuegos = buildMesaConditions({ ...options, skipJuegos: true, active });
  const whereJuegos = condsJuegos.length > 0 ? sql`WHERE ${condsJuegos.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allJuegos = await sql`SELECT j.uuid, j.uuid AS id, j.nombre FROM juegos j ORDER BY j.nombre ASC`;

  const countsJuegosRes = await sql`
    SELECT m.juego_uuid AS id, COUNT(m.uuid)::int AS count
    FROM mesas m
    LEFT JOIN salas s ON m.sala_uuid = s.uuid
    LEFT JOIN juegos j ON m.juego_uuid = j.uuid
    ${whereJuegos}
    GROUP BY m.juego_uuid
  `;
  const countJuegosMap = new Map(countsJuegosRes.map(r => [r.id, r.count]));
  const activeJuegos = new Set(toUuidArray(options.juegoUuids || options.juegoIds));

  const juegos = allJuegos
    .map(j => ({
      id: j.uuid,
      uuid: j.uuid,
      nombre: j.nombre,
      count: countJuegosMap.get(j.uuid) || 0
    }))
    .filter(j => j.count > 0 || activeJuegos.has(j.uuid))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    data: {
      salas,
      juegos
    }
  };
}

export async function getMesasModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.mesas || [];
    const active = params.active !== undefined ? Number(params.active) : 1;
    list = list.filter(m => (m.active ?? 1) === active);
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'nombre';
  const sortDir = (params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const active = params.active !== undefined ? Number(params.active) : 1;

  // Parse filters
  const userSalaIds = toUuidArray(params.user_sala_ids || params.userSalaIds);
  const salaIds = toUuidArray(params.sala_ids || params.salaIds);
  const juegoIds = toUuidArray(params.juego_ids || params.juegoIds);

  const conds = buildMesaConditions({
    active,
    userSalaIds,
    salaIds,
    juegoIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'm.created_at',
    'uuid': 'm.created_at',
    'created_at': 'm.created_at',
    'nombre': 'm.nombre',
    'juego_nombre': 'j.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'm.created_at';

  const countRes = await sql`
    SELECT COUNT(m.uuid)::int AS total
    FROM mesas m
    LEFT JOIN salas s ON m.sala_uuid = s.uuid
    JOIN juegos j ON m.juego_uuid = j.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, m.created_at DESC, m.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT m.*, m.uuid AS id, m.sala_uuid AS sala_id, m.juego_uuid AS juego_id,
             j.nombre AS juego_nombre, s.uuid AS sala_id, s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM mesas m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      JOIN juegos j ON m.juego_uuid = j.uuid
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT m.*, m.uuid AS id, m.sala_uuid AS sala_id, m.juego_uuid AS juego_id,
             j.nombre AS juego_nombre, s.uuid AS sala_id, s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM mesas m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      JOIN juegos j ON m.juego_uuid = j.uuid
      ${where}
      ${orderClause}
    `;
  }

  data = data.map(r => ({ ...r, nombre: toTitleCase(r.nombre), juego_nombre: toTitleCase(r.juego_nombre) }));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function createMesaModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre de la mesa es obligatorio');
  const rawJuego = data.juego_uuid || data.juego_id;
  if (!rawJuego || !isUuid(rawJuego)) throw new Error('Debe seleccionar un juego válido para la mesa');
  const rawSala = data.sala_uuid || data.sala_id;
  if (!rawSala || !isUuid(rawSala)) throw new Error('Debe seleccionar una sala válida para la mesa');

  const mesaUuid = data.uuid && isUuid(data.uuid) ? data.uuid : null;

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM mesas 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND sala_uuid = ${rawSala}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe una mesa registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }

    const rows = await sql`
      INSERT INTO mesas (
        ${mesaUuid ? sql`uuid,` : sql``}
        nombre, 
        juego_uuid, 
        sala_uuid, 
        active
      )
      VALUES (
        ${mesaUuid ? sql`${mesaUuid}::uuid,` : sql``}
        ${cleanName}, 
        ${rawJuego}::uuid, 
        ${rawSala}::uuid, 
        1
      )
      RETURNING *, uuid AS id, sala_uuid AS sala_id, juego_uuid AS juego_id
    `;
    return rows[0];
  } else {
    const cleanLower = cleanName.toLowerCase();
    const existing = (inMemoryData.mesas || []).find(m => (m.nombre || '').trim().toLowerCase() === cleanLower && (m.sala_uuid === rawSala || m.sala_id === rawSala));
    if (existing) {
      throw new Error(`Ya existe una mesa registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }
    const nextId = (inMemoryData.mesas?.length || 0) > 0 ? Math.max(...inMemoryData.mesas.map(m => m.id)) + 1 : 1;
    const newMesa = {
      id: nextId,
      uuid: mesaUuid || `mesa-${Date.now()}`,
      nombre: cleanName,
      juego_id: rawJuego,
      juego_uuid: rawJuego,
      sala_id: rawSala,
      sala_uuid: rawSala,
      active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.mesas = inMemoryData.mesas || [];
    inMemoryData.mesas.unshift(newMesa);
    return newMesa;
  }
}

export async function updateMesaModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
  const rawJuego = data.juego_uuid !== undefined ? data.juego_uuid : data.juego_id;
  const rawSala = data.sala_uuid !== undefined ? data.sala_uuid : data.sala_id;
  const active = data.active !== undefined ? Number(data.active) : null;

  if (isPgConnected && sql) {
    let currentSalaUuid = null;
    if (rawSala && isUuid(rawSala)) {
      currentSalaUuid = rawSala;
    } else if (cleanName) {
      const cur = await sql`SELECT sala_uuid FROM mesas WHERE uuid = ${id}::uuid LIMIT 1`;
      if (cur.length > 0) {
        currentSalaUuid = cur[0].sala_uuid;
      }
    }

    if (cleanName) {
      const salaMatch = currentSalaUuid 
        ? sql`sala_uuid = ${currentSalaUuid}::uuid` 
        : sql`1=1`;

      const existing = await sql`
        SELECT uuid FROM mesas 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND ${salaMatch}
          AND uuid != ${id}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otra mesa registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
      }
    }

    const juegoUuid = rawJuego && isUuid(rawJuego) ? String(rawJuego).trim() : null;
    const salaUuid = rawSala && isUuid(rawSala) ? String(rawSala).trim() : null;

    const rows = await sql`
      UPDATE mesas
      SET 
        nombre = COALESCE(${cleanName}, nombre),
        juego_uuid = ${rawJuego !== undefined ? (juegoUuid ? sql`${juegoUuid}::uuid` : sql`NULL`) : sql`juego_uuid`},
        sala_uuid = ${rawSala !== undefined ? (salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`) : sql`sala_uuid`},
        active = COALESCE(${active}, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id, sala_uuid AS sala_id, juego_uuid AS juego_id
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.mesas || []).findIndex(m => m.uuid === id || m.id === id);
    if (idx !== -1) {
      inMemoryData.mesas[idx] = { ...inMemoryData.mesas[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.mesas[idx];
    }
    return null;
  }
}

// Soft delete: Marca active = 0 (envía a Mesas Borradas)
export async function softDeleteMesaModel(id) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE mesas 
      SET active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE uuid = ${id}::uuid 
      RETURNING *, uuid AS id, sala_uuid AS sala_id, juego_uuid AS juego_id
    `;
    return { success: true, id, mesa: rows[0] };
  } else {
    const mesa = (inMemoryData.mesas || []).find(m => m.uuid === id || m.id === id);
    if (mesa) mesa.active = 0;
    return { success: true, id };
  }
}

// Restore: Marca active = 1 (restaura de Mesas Borradas a Mesas)
export async function restoreMesaModel(id) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE mesas 
      SET active = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE uuid = ${id}::uuid 
      RETURNING *, uuid AS id, sala_uuid AS sala_id, juego_uuid AS juego_id
    `;
    return { success: true, id, mesa: rows[0] };
  } else {
    const mesa = (inMemoryData.mesas || []).find(m => m.uuid === id || m.id === id);
    if (mesa) mesa.active = 1;
    return { success: true, id };
  }
}

// Purge: Eliminación física definitiva desde Mesas Borradas
export async function purgeMesaModel(id) {
  return await deleteEntityDynamic('mesas', 'mesa', id);
}

// =========================================================================
// MODELOS PARA CONFIGURACIÓN DE MÁQUINAS (CONF.M: MAQUINAS)
// =========================================================================

function buildSimpleConfigCrud(tableName, entityLabel, memKey = tableName) {
  return {
    get: async function(params = {}) {
      if (!isPgConnected || !sql) {
        let list = inMemoryData[memKey] || [];
        const search = String(params.search || '').trim().toLowerCase();
        if (search) {
          list = list.filter(i => (i.nombre || '').toLowerCase().includes(search));
        }
        return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
      }

      const page = Math.max(1, Number(params.page) || 1);
      const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
      const limit = hasLimit ? Number(params.limit) : 0;
      const offset = hasLimit ? (page - 1) * limit : 0;
      const search = String(params.search || '').trim().toLowerCase();
      const sortBy = (params.sortBy === 'nombre') 
        ? 'nombre' 
        : (params.sortBy === 'color' ? 'color' : 'created_at');
      const sortDir = (params.sortDir || (sortBy === 'created_at' ? 'desc' : 'asc')).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

      const searchPattern = `%${search}%`;
      const whereClause = search
        ? sql`WHERE LOWER(nombre) LIKE ${searchPattern} OR uuid::text LIKE ${searchPattern}`
        : sql``;

      const countRes = await sql`
        SELECT COUNT(uuid)::int AS total
        FROM ${sql(tableName)}
        ${whereClause}
      `;
      const total = countRes[0]?.total || 0;

      const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, created_at DESC, uuid DESC`);

      let data;
      if (limit > 0) {
        data = await sql`
          SELECT *, uuid AS id
          FROM ${sql(tableName)}
          ${whereClause}
          ${orderClause}
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        data = await sql`
          SELECT *, uuid AS id
          FROM ${sql(tableName)}
          ${whereClause}
          ${orderClause}
        `;
      }

      data = data.map(r => ({ ...r, nombre: toTitleCase(r.nombre) }));
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

      return { success: true, data, total, page, limit, totalPages };
    },

    create: async function(data) {
      const cleanName = (data.nombre || '').trim();
      if (!cleanName) throw new Error(`El nombre de ${entityLabel} es obligatorio`);
      const cleanColor = data.color !== undefined ? (String(data.color).trim() || '#3B82F6') : undefined;
      const itemUuid = data.uuid && isUuid(data.uuid) ? data.uuid : null;

      if (isPgConnected && sql) {
        const existing = await sql`
          SELECT uuid FROM ${sql(tableName)} 
          WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
          LIMIT 1
        `;
        if (existing.length > 0) {
          throw new Error(`Ya existe un registro de ${entityLabel} con el nombre "${toTitleCase(cleanName)}"`);
        }

        let rows;
        if (cleanColor !== undefined) {
          rows = await sql`
            INSERT INTO ${sql(tableName)} (
              ${itemUuid ? sql`uuid,` : sql``}
              nombre, color
            )
            VALUES (
              ${itemUuid ? sql`${itemUuid}::uuid,` : sql``}
              ${cleanName}, ${cleanColor}
            )
            RETURNING *, uuid AS id
          `;
        } else {
          rows = await sql`
            INSERT INTO ${sql(tableName)} (
              ${itemUuid ? sql`uuid,` : sql``}
              nombre
            )
            VALUES (
              ${itemUuid ? sql`${itemUuid}::uuid,` : sql``}
              ${cleanName}
            )
            RETURNING *, uuid AS id
          `;
        }
        return { ...rows[0], nombre: toTitleCase(rows[0].nombre) };
      } else {
        const list = inMemoryData[memKey] || [];
        const cleanLower = cleanName.toLowerCase();
        if (list.some(i => (i.nombre || '').trim().toLowerCase() === cleanLower)) {
          throw new Error(`Ya existe un registro de ${entityLabel} con el nombre "${toTitleCase(cleanName)}"`);
        }
        const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
        const newItem = {
          id: nextId,
          uuid: itemUuid || `item-${Date.now()}`,
          nombre: toTitleCase(cleanName),
          ...(cleanColor !== undefined ? { color: cleanColor } : {}),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        inMemoryData[memKey] = [newItem, ...list];
        return newItem;
      }
    },

    update: async function(id, data) {
      if (!id || !isUuid(id)) throw new Error('ID inválido');
      const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
      const cleanColor = data.color !== undefined ? String(data.color).trim() : null;

      if (isPgConnected && sql) {
        if (cleanName) {
          const existing = await sql`
            SELECT uuid FROM ${sql(tableName)} 
            WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
              AND uuid != ${id}::uuid
            LIMIT 1
          `;
          if (existing.length > 0) {
            throw new Error(`Ya existe otro registro de ${entityLabel} con el nombre "${toTitleCase(cleanName)}"`);
          }
        }

        let rows;
        if (cleanColor !== null) {
          rows = await sql`
            UPDATE ${sql(tableName)}
            SET 
              nombre = COALESCE(${cleanName}, nombre),
              color = ${cleanColor},
              updated_at = CURRENT_TIMESTAMP
            WHERE uuid = ${id}::uuid
            RETURNING *, uuid AS id
          `;
        } else {
          rows = await sql`
            UPDATE ${sql(tableName)}
            SET 
              nombre = COALESCE(${cleanName}, nombre),
              updated_at = CURRENT_TIMESTAMP
            WHERE uuid = ${id}::uuid
            RETURNING *, uuid AS id
          `;
        }
        return rows[0] ? { ...rows[0], nombre: toTitleCase(rows[0].nombre) } : null;
      } else {
        const list = inMemoryData[memKey] || [];
        const idx = list.findIndex(i => String(i.uuid) === String(id) || String(i.id) === String(id));
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...data, updated_at: new Date().toISOString() };
          if (cleanName) list[idx].nombre = toTitleCase(cleanName);
          if (cleanColor) list[idx].color = cleanColor;
          return list[idx];
        }
        return null;
      }
    },

    delete: async function(id) {
      return await deleteEntityDynamic(tableName, entityLabel, id);
    }
  };
}

// 1. ESTADOS
const estadosCrud = buildSimpleConfigCrud('estados', 'estado');
export const getEstadosModel = estadosCrud.get;
export const createEstadoModel = estadosCrud.create;
export const updateEstadoModel = estadosCrud.update;
export const deleteEstadoModel = estadosCrud.delete;

// 1.1. TIPO CLIENTES
const tipoClientesCrud = buildSimpleConfigCrud('tipo_clientes', 'tipo de cliente', 'tipo_clientes');
export const getTipoClientesModel = tipoClientesCrud.get;
export const createTipoClienteModel = tipoClientesCrud.create;
export const updateTipoClienteModel = tipoClientesCrud.update;
export const deleteTipoClienteModel = tipoClientesCrud.delete;

// 1.2. MÉTODOS DE PAGO
const metodosPagoCrud = buildSimpleConfigCrud('metodos_pago', 'método de pago', 'metodos_pago');
export const getMetodosPagoModel = metodosPagoCrud.get;
export const createMetodoPagoModel = metodosPagoCrud.create;
export const updateMetodoPagoModel = metodosPagoCrud.update;
export const deleteMetodoPagoModel = metodosPagoCrud.delete;

// 1.3. TIPOS DE INCIDENCIA (CONF.M: CECOM)
const tipoIncidenciasCrud = buildSimpleConfigCrud('tipo_incidencias', 'tipo de incidencia', 'tipo_incidencias');
export const getTipoIncidenciasModel = tipoIncidenciasCrud.get;
export const createTipoIncidenciaModel = tipoIncidenciasCrud.create;
export const updateTipoIncidenciaModel = tipoIncidenciasCrud.update;
export const deleteTipoIncidenciaModel = tipoIncidenciasCrud.delete;

// 1.4. RANGOS (CONF.M: MAQUINAS)
const rangosCrud = buildSimpleConfigCrud('rangos', 'rango', 'rangos');
export const getRangosModel = rangosCrud.get;
export const createRangoModel = rangosCrud.create;
export const updateRangoModel = rangosCrud.update;
export const deleteRangoModel = rangosCrud.delete;

// 2. SOCIEDADES
const sociedadesCrud = buildSimpleConfigCrud('sociedades', 'sociedad');
export const getSociedadesModel = sociedadesCrud.get;
export const createSociedadModel = sociedadesCrud.create;
export const updateSociedadModel = sociedadesCrud.update;
export const deleteSociedadModel = sociedadesCrud.delete;

// 3. VALORES
const valoresCrud = buildSimpleConfigCrud('valores', 'valor');
export const getValoresModel = valoresCrud.get;
export const createValorModel = valoresCrud.create;
export const updateValorModel = valoresCrud.update;
export const deleteValorModel = valoresCrud.delete;

// 4. JUEGOS MÁQUINAS
const juegosMaquinasCrud = buildSimpleConfigCrud('juegos_maquinas', 'juego de máquinas', 'juegos_maquinas');
export const getJuegosMaquinasModel = juegosMaquinasCrud.get;
export const createJuegoMaquinaModel = juegosMaquinasCrud.create;
export const updateJuegoMaquinaModel = juegosMaquinasCrud.update;
export const deleteJuegoMaquinaModel = juegosMaquinasCrud.delete;

// 5. MARCAS (Con validación de dependencia en modelos)
const marcasCrud = buildSimpleConfigCrud('marcas', 'marca');
export const getMarcasModel = marcasCrud.get;
export const createMarcaModel = marcasCrud.create;
export const updateMarcaModel = marcasCrud.update;
export async function deleteMarcaModel(id) {
  if (!id) throw new Error('ID de marca requerido');
  if (isPgConnected && sql) {
    const isU = isUuid(id);
    if (isU) {
      const modelosCount = await sql`SELECT count(*)::int AS count FROM modelos WHERE marca_uuid = ${id}::uuid`;
      if (modelosCount[0]?.count > 0) {
        const row = await sql`SELECT nombre FROM marcas WHERE uuid = ${id}::uuid`;
        return {
          success: false,
          blocked: true,
          entityType: 'marca',
          entityName: row[0]?.nombre || `UUID: ${id}`,
          entityId: id,
          message: `No se puede eliminar la marca porque tiene ${modelosCount[0].count} modelo(s) asociado(s). Elimine o reasigne primero los modelos vinculados.`,
          dependencies: [{ label: 'Modelos Vinculados', count: modelosCount[0].count }]
        };
      }
    }
  }
  return await deleteEntityDynamic('marcas', 'marca', id);
}

// 6. MODELOS (Con marca_uuid y JOIN a marcas)
export async function getModelosModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.modelos || [];
    const search = String(params.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(m => (m.nombre || '').toLowerCase().includes(search) || (m.marca_nombre || '').toLowerCase().includes(search));
    }
    const marcas = toUuidArray(params.marcaUuids || params.marcaIds);
    if (marcas.length > 0) {
      list = list.filter(m => marcas.includes(String(m.marca_uuid || m.marca_id)));
    }
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy === 'nombre' ? 'm.nombre' : (params.sortBy === 'marca_nombre' ? 'ma.nombre' : 'm.uuid');
  const sortDir = (params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const conds = [];
  const marcas = toUuidArray(params.marcaUuids || params.marcaIds);
  if (marcas.length > 0) {
    conds.push(sql`m.marca_uuid = ANY(${marcas}::uuid[])`);
  }
  if (search) {
    const searchPattern = `%${search}%`;
    conds.push(sql`(LOWER(m.nombre) LIKE ${searchPattern} OR LOWER(ma.nombre) LIKE ${searchPattern} OR m.uuid::text LIKE ${searchPattern})`);
  }

  const whereClause = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const countRes = await sql`
    SELECT COUNT(m.uuid)::int AS total
    FROM modelos m
    LEFT JOIN marcas ma ON m.marca_uuid = ma.uuid
    ${whereClause}
  `;
  const total = countRes[0]?.total || 0;

  const validSortCols = {
    'id': 'm.created_at',
    'uuid': 'm.created_at',
    'created_at': 'm.created_at',
    'nombre': 'm.nombre',
    'marca_nombre': 'ma.nombre'
  };
  const orderCol = validSortCols[sortBy] || 'm.created_at';
  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, m.created_at DESC, m.uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT m.*, m.uuid AS id, m.marca_uuid AS marca_id, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_uuid = ma.uuid
      ${whereClause}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT m.*, m.uuid AS id, m.marca_uuid AS marca_id, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_uuid = ma.uuid
      ${whereClause}
      ${orderClause}
    `;
  }

  data = data.map(r => ({
    ...r,
    nombre: toTitleCase(r.nombre),
    marca_nombre: r.marca_nombre ? toTitleCase(r.marca_nombre) : 'Sin Marca'
  }));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function getModelosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return { success: true, data: { marcas: inMemoryData.marcas || [] } };
  }
  try {
    const conds = [];
    const search = String(options.search || '').trim().toLowerCase();
    if (search) {
      const searchPattern = `%${search}%`;
      conds.push(sql`(LOWER(m.nombre) LIKE ${searchPattern} OR LOWER(ma.nombre) LIKE ${searchPattern} OR m.uuid::text LIKE ${searchPattern})`);
    }
    const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

    const res = await sql`
      SELECT ma.uuid, ma.uuid AS id, ma.nombre, COUNT(DISTINCT m.uuid)::int AS count
      FROM modelos m
      JOIN marcas ma ON m.marca_uuid = ma.uuid
      ${where}
      GROUP BY ma.uuid, ma.nombre
      ORDER BY ma.nombre ASC
    `.catch(() => []);
    const active = new Set(toUuidArray(options.marcaUuids || options.marcaIds));
    const marcas = (res || [])
      .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
      .filter(r => r.count > 0 || active.has(r.uuid));

    return { success: true, data: { marcas } };
  } catch (err) {
    return { success: true, data: { marcas: [] } };
  }
}

export async function createModeloModel(data) {
  const cleanName = (data.nombre || '').trim();
  const rawMarca = data.marca_uuid || data.marca_id;
  if (!rawMarca || !isUuid(rawMarca)) throw new Error('Debe seleccionar una marca válida');
  const marcaUuid = String(rawMarca).trim();
  const modeloUuid = data.uuid && isUuid(data.uuid) ? data.uuid : null;

  if (!cleanName) throw new Error('El nombre del modelo es obligatorio');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM modelos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND marca_uuid = ${marcaUuid}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un modelo con el nombre "${toTitleCase(cleanName)}" para esta marca`);
    }

    const rows = await sql`
      INSERT INTO modelos (
        ${modeloUuid ? sql`uuid,` : sql``}
        nombre, marca_uuid
      )
      VALUES (
        ${modeloUuid ? sql`${modeloUuid}::uuid,` : sql``}
        ${cleanName}, 
        ${marcaUuid}::uuid
      )
      RETURNING *, uuid AS id, marca_uuid AS marca_id
    `;
    const full = await sql`
      SELECT m.*, m.uuid AS id, m.marca_uuid AS marca_id, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_uuid = ma.uuid
      WHERE m.uuid = ${rows[0].uuid}::uuid
    `;
    return {
      ...full[0],
      nombre: toTitleCase(full[0].nombre),
      marca_nombre: full[0].marca_nombre ? toTitleCase(full[0].marca_nombre) : 'Sin Marca'
    };
  } else {
    const list = inMemoryData.modelos || [];
    const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
    const marca = (inMemoryData.marcas || []).find(ma => ma.uuid === rawMarca || ma.id === rawMarca);
    const newModelo = {
      id: nextId,
      uuid: modeloUuid || `modelo-${Date.now()}`,
      nombre: toTitleCase(cleanName),
      marca_id: rawMarca,
      marca_uuid: marcaUuid,
      marca_nombre: marca ? toTitleCase(marca.nombre) : 'Sin Marca',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.modelos = [newModelo, ...list];
    return newModelo;
  }
}

export async function updateModeloModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
  const rawMarca = data.marca_uuid !== undefined ? data.marca_uuid : data.marca_id;
  const marcaUuid = rawMarca !== undefined ? (rawMarca && isUuid(rawMarca) ? String(rawMarca).trim() : null) : undefined;

  if (isPgConnected && sql) {
    let currentMarcaUuid = marcaUuid;
    if (currentMarcaUuid === undefined && cleanName) {
      const cur = await sql`SELECT marca_uuid FROM modelos WHERE uuid = ${id}::uuid LIMIT 1`;
      if (cur.length > 0) {
        currentMarcaUuid = cur[0].marca_uuid;
      }
    }

    if (cleanName) {
      const marcaCond = currentMarcaUuid
        ? sql`marca_uuid = ${currentMarcaUuid}::uuid`
        : sql`marca_uuid IS NULL`;

      const existing = await sql`
        SELECT uuid FROM modelos 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND uuid != ${id}::uuid
          AND ${marcaCond}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otro modelo con el nombre "${toTitleCase(cleanName)}" para esta marca`);
      }
    }

    await sql`
      UPDATE modelos
      SET 
        nombre = COALESCE(${cleanName}, nombre),
        marca_uuid = ${marcaUuid !== undefined ? (marcaUuid ? sql`${marcaUuid}::uuid` : sql`NULL`) : sql`marca_uuid`},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
    `;

    const full = await sql`
      SELECT m.*, m.uuid AS id, m.marca_uuid AS marca_id, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_uuid = ma.uuid
      WHERE m.uuid = ${id}::uuid
    `;
    return full[0] ? {
      ...full[0],
      nombre: toTitleCase(full[0].nombre),
      marca_nombre: full[0].marca_nombre ? toTitleCase(full[0].marca_nombre) : 'Sin Marca'
    } : null;
  } else {
    const list = inMemoryData.modelos || [];
    const idx = list.findIndex(i => i.uuid === id || i.id === id);
    if (idx !== -1) {
      if (cleanName) list[idx].nombre = toTitleCase(cleanName);
      if (rawMarca !== undefined) {
        list[idx].marca_id = rawMarca;
        list[idx].marca_uuid = marcaUuid;
        const marca = (inMemoryData.marcas || []).find(ma => ma.uuid === rawMarca || ma.id === rawMarca);
        list[idx].marca_nombre = marca ? toTitleCase(marca.nombre) : 'Sin Marca';
      }
      list[idx].updated_at = new Date().toISOString();
      return list[idx];
    }
    return null;
  }
}

export async function deleteModeloModel(id) {
  return await deleteEntityDynamic('modelos', 'modelo', id);
}

// 7. TIPOS
const tiposCrud = buildSimpleConfigCrud('tipos', 'tipo');
export const getTiposModel = tiposCrud.get;
export const createTipoModel = tiposCrud.create;
export const updateTipoModel = tiposCrud.update;
export const deleteTipoModel = tiposCrud.delete;

// 8. MODOS
const modosCrud = buildSimpleConfigCrud('modos', 'modo');
export const getModosModel = modosCrud.get;
export const createModoModel = modosCrud.create;
export const updateModoModel = modosCrud.update;
export const deleteModoModel = modosCrud.delete;

// 9. LEGAL
const legalCrud = buildSimpleConfigCrud('legal', 'legal');
export const getLegalModel = legalCrud.get;
export const createLegalModel = legalCrud.create;
export const updateLegalModel = legalCrud.update;
export const deleteLegalModel = legalCrud.delete;

// 10. EXCEPCIONES (CONF.M: RRHH)
export async function getExcepcionesModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.excepciones || [];
    const search = String(params.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(i => 
        (i.codigo || '').toLowerCase().includes(search) || 
        (i.descripcion || '').toLowerCase().includes(search) ||
        (i.tipo || '').toLowerCase().includes(search)
      );
    }
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const validSorts = ['codigo', 'descripcion', 'color', 'tipo', 'id', 'uuid', 'created_at'];
  const sortBy = validSorts.includes(params.sortBy) ? (params.sortBy === 'id' || params.sortBy === 'uuid' ? 'created_at' : params.sortBy) : 'created_at';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const searchPattern = `%${search}%`;
  const whereClause = search
    ? sql`WHERE LOWER(codigo) LIKE ${searchPattern} OR LOWER(descripcion) LIKE ${searchPattern} OR LOWER(tipo) LIKE ${searchPattern} OR uuid::text LIKE ${searchPattern}`
    : sql``;

  const countRes = await sql`SELECT COUNT(uuid)::int AS total FROM excepciones ${whereClause}`;
  const total = countRes[0]?.total || 0;
  const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, created_at DESC, uuid DESC`);

  let data;
  if (limit > 0) {
    data = await sql`SELECT *, uuid AS id FROM excepciones ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
  } else {
    data = await sql`SELECT *, uuid AS id FROM excepciones ${whereClause} ${orderClause}`;
  }
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
  return { success: true, data, total, page, limit, totalPages };
}

export async function createExcepcionModel(data) {
  const codigo = (data.codigo || '').trim().toUpperCase();
  const descripcion = (data.descripcion || '').trim();
  const color = (data.color || '#3B82F6').trim();
  const tipo = (data.tipo || 'Asignable').trim();
  const excUuid = data.uuid && isUuid(data.uuid) ? data.uuid : null;

  if (!codigo || !descripcion) {
    throw new Error('El código y la descripción de la excepción son obligatorios.');
  }

  if (isPgConnected && sql) {
    // 1. Validar unicidad dentro de la tabla de excepciones
    const [existingExc] = await sql`
      SELECT uuid, codigo, descripcion 
      FROM excepciones 
      WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (existingExc) {
      throw new Error(`El código "${codigo}" ya está registrado en la excepción "${existingExc.descripcion}".`);
    }

    // 2. Validar que no pertenezca a ningún horario en la tabla horarios
    const [existingHor] = await sql`
      SELECT uuid, codigo, nombre 
      FROM horarios 
      WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (existingHor) {
      throw new Error(`El código "${codigo}" no puede usarse porque ya pertenece al horario "${existingHor.nombre}".`);
    }

    const rows = await sql`
      INSERT INTO excepciones (
        ${excUuid ? sql`uuid,` : sql``}
        codigo, descripcion, color, tipo
      )
      VALUES (
        ${excUuid ? sql`${excUuid}::uuid,` : sql``}
        ${codigo}, ${descripcion}, ${color}, ${tipo}
      )
      RETURNING *, uuid AS id
    `;
    return rows[0];
  } else {
    const list = inMemoryData.excepciones || [];
    const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
    const newItem = { 
      id: nextId, 
      uuid: excUuid || `exc-${Date.now()}`,
      codigo, 
      descripcion, 
      color, 
      tipo, 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString() 
    };
    inMemoryData.excepciones = [newItem, ...list];
    return newItem;
  }
}

export async function updateExcepcionModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const codigo = data.codigo !== undefined && data.codigo !== null ? String(data.codigo).trim().toUpperCase() : null;
  const descripcion = data.descripcion !== undefined && data.descripcion !== null ? String(data.descripcion).trim() : null;
  const color = data.color !== undefined && data.color !== null ? String(data.color).trim() : null;
  const tipo = data.tipo !== undefined && data.tipo !== null ? String(data.tipo).trim() : null;

  if (isPgConnected && sql) {
    if (codigo) {
      // 1. Validar que no exista en otra excepción
      const [existingExc] = await sql`
        SELECT uuid, codigo, descripcion 
        FROM excepciones 
        WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
          AND uuid != ${id}::uuid 
        LIMIT 1
      `;
      if (existingExc) {
        throw new Error(`El código "${codigo}" ya está registrado en la excepción "${existingExc.descripcion}".`);
      }

      // 2. Validar que no pertenezca a ningún horario en la tabla horarios
      const [existingHor] = await sql`
        SELECT uuid, codigo, nombre 
        FROM horarios 
        WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
        LIMIT 1
      `;
      if (existingHor) {
        throw new Error(`El código "${codigo}" no puede usarse porque ya pertenece al horario "${existingHor.nombre}".`);
      }
    }
    const rows = await sql`
      UPDATE excepciones
      SET
        codigo = COALESCE(${codigo}, codigo),
        descripcion = COALESCE(${descripcion}, descripcion),
        color = COALESCE(${color}, color),
        tipo = COALESCE(${tipo}, tipo),
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id
    `;
    return rows[0] || null;
  } else {
    const list = inMemoryData.excepciones || [];
    const idx = list.findIndex(i => i.uuid === id || i.id === id);
    if (idx !== -1) {
      if (codigo) list[idx].codigo = codigo;
      if (descripcion) list[idx].descripcion = descripcion;
      if (color) list[idx].color = color;
      if (tipo) list[idx].tipo = tipo;
      list[idx].updated_at = new Date().toISOString();
      return list[idx];
    }
    return null;
  }
}

export async function deleteExcepcionModel(id) {
  return await deleteEntityDynamic('excepciones', 'excepción', id);
}

// 11. FECHAS PATRIAS (CONF.M: RRHH)
export async function getFechasPatriasModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.fechas_patrias || [];
    const search = String(params.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(i => (i.descripcion || '').toLowerCase().includes(search));
    }
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const validSorts = ['descripcion', 'dia', 'mes', 'id', 'uuid', 'created_at'];
  const sortBy = validSorts.includes(params.sortBy) ? (params.sortBy === 'id' || params.sortBy === 'uuid' ? 'created_at' : params.sortBy) : 'mes, dia';
  const sortDir = (params.sortDir || (sortBy === 'created_at' ? 'desc' : 'asc')).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const searchPattern = `%${search}%`;
  const whereClause = search
    ? sql`WHERE LOWER(descripcion) LIKE ${searchPattern} OR dia::text LIKE ${searchPattern} OR mes::text LIKE ${searchPattern} OR uuid::text LIKE ${searchPattern}`
    : sql``;

  const countRes = await sql`SELECT COUNT(uuid)::int AS total FROM fechas_patrias ${whereClause}`;
  const total = countRes[0]?.total || 0;
  const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, created_at DESC, uuid ASC`);

  let data;
  if (limit > 0) {
    data = await sql`SELECT *, uuid AS id FROM fechas_patrias ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
  } else {
    data = await sql`SELECT *, uuid AS id FROM fechas_patrias ${whereClause} ${orderClause}`;
  }
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
  return { success: true, data, total, page, limit, totalPages };
}

export async function createFechaPatriaModel(data) {
  const descripcion = (data.descripcion || '').trim();
  const dia = Number(data.dia);
  const mes = Number(data.mes);
  const fechaUuid = data.uuid && isUuid(data.uuid) ? data.uuid : null;

  if (!descripcion) throw new Error('La descripción de la fecha patria es obligatoria');
  if (isNaN(dia) || dia < 1 || dia > 31) throw new Error('El día debe ser un número entre 1 y 31');
  if (isNaN(mes) || mes < 1 || mes > 12) throw new Error('El mes debe ser un número entre 1 y 12');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid, descripcion FROM fechas_patrias 
      WHERE dia = ${dia} AND mes = ${mes}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe una fecha patria registrada para el ${dia}/${mes} ("${existing[0].descripcion}")`);
    }
    const rows = await sql`
      INSERT INTO fechas_patrias (
        ${fechaUuid ? sql`uuid,` : sql``}
        descripcion, dia, mes
      )
      VALUES (
        ${fechaUuid ? sql`${fechaUuid}::uuid,` : sql``}
        ${descripcion}, ${dia}, ${mes}
      )
      RETURNING *, uuid AS id
    `;
    return rows[0];
  } else {
    const list = inMemoryData.fechas_patrias || [];
    if (list.some(i => Number(i.dia) === dia && Number(i.mes) === mes)) {
      throw new Error(`Ya existe una fecha patria registrada para el ${dia}/${mes}`);
    }
    const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
    const newItem = { 
      id: nextId, 
      uuid: fechaUuid || `fp-${Date.now()}`,
      descripcion, 
      dia, 
      mes, 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString() 
    };
    inMemoryData.fechas_patrias = [newItem, ...list];
    return newItem;
  }
}

export async function updateFechaPatriaModel(id, data) {
  if (!id || !isUuid(id)) throw new Error('ID inválido');
  const descripcion = data.descripcion !== undefined ? String(data.descripcion).trim() : null;
  const dia = data.dia !== undefined ? Number(data.dia) : null;
  const mes = data.mes !== undefined ? Number(data.mes) : null;

  if (dia !== null && (isNaN(dia) || dia < 1 || dia > 31)) throw new Error('El día debe ser un número entre 1 y 31');
  if (mes !== null && (isNaN(mes) || mes < 1 || mes > 12)) throw new Error('El mes debe ser un número entre 1 y 12');

  if (isPgConnected && sql) {
    const current = await sql`SELECT * FROM fechas_patrias WHERE uuid = ${id}::uuid LIMIT 1`;
    if (current.length === 0) throw new Error('Fecha patria no encontrada');

    const targetDia = dia !== null ? dia : current[0].dia;
    const targetMes = mes !== null ? mes : current[0].mes;

    const existing = await sql`
      SELECT uuid, descripcion FROM fechas_patrias 
      WHERE dia = ${targetDia} AND mes = ${targetMes} 
        AND uuid != ${id}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otra fecha patria registrada para el ${targetDia}/${targetMes} ("${existing[0].descripcion}")`);
    }

    const rows = await sql`
      UPDATE fechas_patrias
      SET
        descripcion = COALESCE(${descripcion}, descripcion),
        dia = COALESCE(${dia}, dia),
        mes = COALESCE(${mes}, mes),
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${id}::uuid
      RETURNING *, uuid AS id
    `;
    return rows[0] || null;
  } else {
    const list = inMemoryData.fechas_patrias || [];
    const idx = list.findIndex(i => i.uuid === id || i.id === id);
    if (idx !== -1) {
      const targetDia = dia !== null ? dia : list[idx].dia;
      const targetMes = mes !== null ? mes : list[idx].mes;
      if (list.some(i => Number(i.dia) === Number(targetDia) && Number(i.mes) === Number(targetMes) && i.uuid !== id)) {
        throw new Error(`Ya existe otra fecha patria registrada para el ${targetDia}/${targetMes}`);
      }
      if (descripcion !== null) list[idx].descripcion = descripcion;
      if (dia !== null) list[idx].dia = dia;
      if (mes !== null) list[idx].mes = mes;
      return list[idx];
    }
    return null;
  }
}

export async function deleteFechaPatriaModel(id) {
  return await deleteEntityDynamic('fechas_patrias', 'fecha patria', id);
}

// ==========================================
// 12. MÁQUINAS (CRUD PRINCIPAL)
// ==========================================

export function buildMaquinasConditions(params = {}) {
  const conds = [];

  const uSalas = toUuidArray(params.userSalaIds || params.userSalaUuids);
  if (uSalas.length > 0) {
    conds.push(sql`m.sala_uuid = ANY(${uSalas})`);
  }
  if (!params.skipSalas) {
    const sUuids = toUuidArray(params.salaIds || params.salaUuids);
    if (sUuids.length > 0) conds.push(sql`m.sala_uuid = ANY(${sUuids})`);
  }
  if (!params.skipGrupos) {
    const gUuids = toUuidArray(params.grupoIds || params.grupoUuids);
    if (gUuids.length > 0) conds.push(sql`s.grupo_uuid = ANY(${gUuids})`);
  }
  if (!params.skipMarcas) {
    const mUuids = toUuidArray(params.marcaIds || params.marcaUuids);
    if (mUuids.length > 0) conds.push(sql`mod.marca_uuid = ANY(${mUuids})`);
  }
  if (!params.skipModelos) {
    const moUuids = toUuidArray(params.modeloIds || params.modeloUuids);
    if (moUuids.length > 0) conds.push(sql`m.modelo_uuid = ANY(${moUuids})`);
  }
  if (!params.skipJuegos) {
    const jUuids = toUuidArray(params.juegoIds || params.juegoUuids);
    if (jUuids.length > 0) conds.push(sql`m.juego_uuid = ANY(${jUuids})`);
  }
  if (!params.skipEstados) {
    const eUuids = toUuidArray(params.estadoIds || params.estadoUuids);
    if (eUuids.length > 0) conds.push(sql`m.estado_uuid = ANY(${eUuids})`);
  }
  if (!params.skipSociedades) {
    const socUuids = toUuidArray(params.sociedadIds || params.sociedadUuids);
    if (socUuids.length > 0) conds.push(sql`m.sociedad_uuid = ANY(${socUuids})`);
  }
  if (!params.skipValores) {
    const vUuids = toUuidArray(params.valorIds || params.valorUuids);
    if (vUuids.length > 0) conds.push(sql`m.valor_uuid = ANY(${vUuids})`);
  }
  if (!params.skipTipos) {
    const tUuids = toUuidArray(params.tipoIds || params.tipoUuids);
    if (tUuids.length > 0) conds.push(sql`m.tipo_uuid = ANY(${tUuids})`);
  }
  if (!params.skipModos) {
    const moUuids = toUuidArray(params.modoIds || params.modoUuids);
    if (moUuids.length > 0) conds.push(sql`m.modo_uuid = ANY(${moUuids})`);
  }
  if (!params.skipLegales) {
    const lUuids = toUuidArray(params.legalIds || params.legalUuids);
    if (lUuids.length > 0) conds.push(sql`m.legal_uuid = ANY(${lUuids})`);
  }
  if (!params.skipRangos) {
    const rUuids = toUuidArray(params.rangoIds || params.rangoUuids);
    if (rUuids.length > 0) conds.push(sql`m.rango_uuid = ANY(${rUuids})`);
  }

  conds.push(sql`COALESCE(m.is_deleted, false) = false`);

  const searchNombre = String(params.searchNombre || params.search_nombre || '').trim().toLowerCase();
  if (searchNombre) {
    const termNombre = `%${searchNombre}%`;
    conds.push(sql`LOWER(COALESCE(m.nombre, '')) LIKE ${termNombre}`);
  }

  const searchSerial = String(params.searchSerial || params.search_serial || '').trim().toLowerCase();
  if (searchSerial) {
    const termSerial = `%${searchSerial}%`;
    conds.push(sql`LOWER(COALESCE(m.serial, '')) LIKE ${termSerial}`);
  }

  const search = String(params.search || '').trim().toLowerCase();
  if (search) {
    const term = `%${search}%`;
    conds.push(sql`(
      LOWER(COALESCE(m.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(m.serial, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre_comercial, '')) LIKE ${term} OR
      LOWER(COALESCE(gs.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(j.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(mod.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(mar.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(r.nombre, '')) LIKE ${term} OR
      m.uuid::text LIKE ${term}
    )`);
  }

  return conds;
}

export async function getMaquinasModel(params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 10;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const searchNombre = String(params.searchNombre || params.search_nombre || '').trim().toLowerCase();
  const searchSerial = String(params.searchSerial || params.search_serial || '').trim().toLowerCase();

  if (!isPgConnected || !sql) {
    let list = (inMemoryData.maquinas || []).filter(m => !m.is_deleted);
    if (search) {
      list = list.filter(m =>
        (m.nombre || '').toLowerCase().includes(search) ||
        (m.serial || '').toLowerCase().includes(search) ||
        (m.sala_nombre || '').toLowerCase().includes(search) ||
        String(m.uuid || m.id).includes(search)
      );
    }
    if (searchNombre) {
      list = list.filter(m => (m.nombre || '').toLowerCase().includes(searchNombre));
    }
    if (searchSerial) {
      list = list.filter(m => (m.serial || '').toLowerCase().includes(searchSerial));
    }
    const uSalas = toUuidArray(params.userSalaIds || params.userSalaUuids);
    if (uSalas.length > 0) {
      list = list.filter(m => uSalas.includes(m.sala_uuid || m.sala_id));
    }
    const sUuids = toUuidArray(params.salaIds || params.salaUuids);
    if (sUuids.length > 0) {
      list = list.filter(m => sUuids.includes(m.sala_uuid || m.sala_id));
    }
    const total = list.length;
    const paged = list.slice(offset, offset + limit);
    return { success: true, data: paged, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  try {
    const conds = buildMaquinasConditions(params);
    const whereClause = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

    const validSortCols = {
      id: 'm.created_at',
      uuid: 'm.created_at',
      created_at: 'm.created_at',
      nombre: 'm.nombre',
      serial: 'm.serial',
      puestos: 'm.puestos',
      sala_id: 's.nombre',
      sala_uuid: 's.nombre',
      sala_nombre: 's.nombre',
      grupo_sala_nombre: 'gs.nombre',
      marca_nombre: 'mar.nombre',
      juego_nombre: 'j.nombre',
      estado_nombre: 'e.nombre',
      sociedad_nombre: 'soc.nombre',
      valor_nombre: 'v.nombre',
      modelo_nombre: 'mod.nombre',
      tipo_nombre: 't.nombre',
      modo_nombre: 'mo.nombre',
      legal_nombre: 'l.nombre',
      rango_nombre: 'r.nombre',
      rango_uuid: 'r.nombre',
      rango_id: 'r.nombre',
      contador_entrada_inicial: 'm.contador_entrada_inicial',
      contador_salida_inicial: 'm.contador_salida_inicial',
      contador_jackpot_inicial: 'm.contador_jackpot_inicial'
    };

    const sortCol = validSortCols[params.sortBy] || 'm.created_at';
    const sortDir = (params.sortDir || (sortCol === 'm.created_at' ? 'desc' : 'asc')).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const orderClause = sql.unsafe(`ORDER BY ${sortCol} ${sortDir}, m.created_at DESC, m.uuid DESC`);

    const fromJoin = sql`
      FROM maquinas m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      LEFT JOIN juegos_maquinas j ON m.juego_uuid = j.uuid
      LEFT JOIN estados e ON m.estado_uuid = e.uuid
      LEFT JOIN sociedades soc ON m.sociedad_uuid = soc.uuid
      LEFT JOIN valores v ON m.valor_uuid = v.uuid
      LEFT JOIN modelos mod ON m.modelo_uuid = mod.uuid
      LEFT JOIN marcas mar ON mod.marca_uuid = mar.uuid
      LEFT JOIN tipos t ON m.tipo_uuid = t.uuid
      LEFT JOIN modos mo ON m.modo_uuid = mo.uuid
      LEFT JOIN legal l ON m.legal_uuid = l.uuid
      LEFT JOIN rangos r ON m.rango_uuid = r.uuid
    `;

    const countRes = await sql`SELECT COUNT(m.uuid)::int AS total ${fromJoin} ${whereClause}`;
    const total = countRes[0]?.total || 0;

    const selectCols = sql`
      SELECT 
        m.uuid,
        m.uuid AS id,
        m.nombre,
        m.serial,
        m.puestos,
        m.sala_uuid,
        m.sala_uuid AS sala_id,
        s.nombre AS sala_nombre,
        s.nombre_comercial AS sala_nombre_comercial,
        s.grupo_uuid AS grupo_sala_id,
        s.grupo_uuid AS grupo_sala_uuid,
        gs.nombre AS grupo_sala_nombre,
        m.juego_uuid,
        m.juego_uuid AS juego_id,
        j.nombre AS juego_nombre,
        m.estado_uuid,
        m.estado_uuid AS estado_id,
        e.nombre AS estado_nombre,
        m.sociedad_uuid,
        m.sociedad_uuid AS sociedad_id,
        soc.nombre AS sociedad_nombre,
        m.valor_uuid,
        m.valor_uuid AS valor_id,
        v.nombre AS valor_nombre,
        m.modelo_uuid,
        m.modelo_uuid AS modelo_id,
        mod.nombre AS modelo_nombre,
        mod.marca_uuid,
        mod.marca_uuid AS marca_id,
        mar.nombre AS marca_nombre,
        m.tipo_uuid,
        m.tipo_uuid AS tipo_id,
        t.nombre AS tipo_nombre,
        m.modo_uuid,
        m.modo_uuid AS modo_id,
        mo.nombre AS modo_nombre,
        m.legal_uuid,
        m.legal_uuid AS legal_id,
        l.nombre AS legal_nombre,
        m.rango_uuid,
        m.rango_uuid AS rango_id,
        r.nombre AS rango_nombre,
        COALESCE(m.contador_entrada_inicial, 0) AS contador_entrada_inicial,
        COALESCE(m.contador_salida_inicial, 0) AS contador_salida_inicial,
        COALESCE(m.contador_jackpot_inicial, 0) AS contador_jackpot_inicial,
        m.is_deleted,
        m.created_at,
        m.updated_at
    `;

    let data;
    if (hasLimit) {
      data = await sql`${selectCols} ${fromJoin} ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
    } else {
      data = await sql`${selectCols} ${fromJoin} ${whereClause} ${orderClause}`;
    }

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    return { success: true, data, total, page, limit, totalPages };
  } catch (err) {
    console.error('Error getMaquinasModel en PG:', err);
    return { success: true, data: [], total: 0, page, limit, totalPages: 1 };
  }
}

export async function getMaquinasFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: {
        grupos: [],
        salas: inMemoryData.salas || [],
        marcas: inMemoryData.marcas || [],
        juegos: inMemoryData.juegos_maquinas || [],
        estados: inMemoryData.estados || [],
        sociedades: inMemoryData.sociedades || [],
        valores: inMemoryData.valores || [],
        modelos: inMemoryData.modelos || [],
        tipos: inMemoryData.tipos || [],
        modos: inMemoryData.modos || [],
        legales: inMemoryData.legal || [],
        rangos: inMemoryData.rangos || []
      }
    };
  }

  try {
    const fromJoin = sql`
      FROM maquinas m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      LEFT JOIN juegos_maquinas j ON m.juego_uuid = j.uuid
      LEFT JOIN estados e ON m.estado_uuid = e.uuid
      LEFT JOIN sociedades soc ON m.sociedad_uuid = soc.uuid
      LEFT JOIN valores v ON m.valor_uuid = v.uuid
      LEFT JOIN modelos mod ON m.modelo_uuid = mod.uuid
      LEFT JOIN marcas mar ON mod.marca_uuid = mar.uuid
      LEFT JOIN tipos t ON m.tipo_uuid = t.uuid
      LEFT JOIN modos mo ON m.modo_uuid = mo.uuid
      LEFT JOIN legal l ON m.legal_uuid = l.uuid
      LEFT JOIN rangos r ON m.rango_uuid = r.uuid
    `;

    const [sociedadesRes, legalesRes, marcasRes, modelosRes, juegosRes, gruposRes, salasRes, estadosRes, valoresRes, tiposRes, modosRes, rangosRes] = await Promise.all([
      // 1. Sociedades
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipSociedades: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT soc.uuid, soc.uuid AS id, soc.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND soc.uuid IS NOT NULL
          GROUP BY soc.uuid, soc.nombre
          ORDER BY soc.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.sociedadIds || options.sociedadUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 2. Legal
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipLegales: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT l.uuid, l.uuid AS id, l.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND l.uuid IS NOT NULL
          GROUP BY l.uuid, l.nombre
          ORDER BY l.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.legalIds || options.legalUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 3. Marcas
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipMarcas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT mar.uuid, mar.uuid AS id, mar.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND mar.uuid IS NOT NULL
          GROUP BY mar.uuid, mar.nombre
          ORDER BY mar.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.marcaIds || options.marcaUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 4. Modelos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipModelos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT mod.uuid, mod.uuid AS id, mod.nombre, mod.marca_uuid, mod.marca_uuid AS marca_id, mar.nombre AS marca_nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND mod.uuid IS NOT NULL
          GROUP BY mod.uuid, mod.nombre, mod.marca_uuid, mar.nombre
          ORDER BY mar.nombre ASC, mod.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.modeloIds || options.modeloUuids));
        return (res || [])
          .map(r => ({ 
            id: r.uuid, 
            uuid: r.uuid, 
            nombre: toTitleCase(r.nombre), 
            marca_id: r.marca_uuid,
            marca_uuid: r.marca_uuid,
            subgroup_label: r.marca_nombre ? toTitleCase(r.marca_nombre) : 'Sin Marca',
            count: r.count 
          }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 5. Juegos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipJuegos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT j.uuid, j.uuid AS id, j.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND j.uuid IS NOT NULL
          GROUP BY j.uuid, j.nombre
          ORDER BY j.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.juegoIds || options.juegoUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 6. Grupos de Sala
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipGrupos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT gs.uuid, gs.uuid AS id, gs.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND gs.uuid IS NOT NULL
          GROUP BY gs.uuid, gs.nombre
          ORDER BY gs.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.grupoIds || options.grupoUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 7. Salas
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipSalas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT s.uuid, s.uuid AS id, s.nombre, s.nombre_comercial, s.grupo_uuid, s.grupo_uuid AS grupo_id, gs.nombre AS grupo_nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND s.uuid IS NOT NULL
          GROUP BY s.uuid, s.nombre, s.nombre_comercial, s.grupo_uuid, gs.nombre
          ORDER BY s.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.salaIds || options.salaUuids));
        return (res || [])
          .map(r => ({ 
            id: r.uuid, 
            uuid: r.uuid, 
            nombre: r.nombre, 
            grupo_id: r.grupo_uuid,
            grupo_uuid: r.grupo_uuid,
            subgroup_label: r.grupo_nombre ? toTitleCase(r.grupo_nombre) : 'Sin Grupo',
            count: r.count 
          }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 8. Estados
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipEstados: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT e.uuid, e.uuid AS id, e.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND e.uuid IS NOT NULL
          GROUP BY e.uuid, e.nombre
          ORDER BY e.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.estadoIds || options.estadoUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 9. Valores
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipValores: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT v.uuid, v.uuid AS id, v.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND v.uuid IS NOT NULL
          GROUP BY v.uuid, v.nombre
          ORDER BY v.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.valorIds || options.valorUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 10. Tipos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipTipos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT t.uuid, t.uuid AS id, t.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND t.uuid IS NOT NULL
          GROUP BY t.uuid, t.nombre
          ORDER BY t.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.tipoIds || options.tipoUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 11. Modos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipModos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT mo.uuid, mo.uuid AS id, mo.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND mo.uuid IS NOT NULL
          GROUP BY mo.uuid, mo.nombre
          ORDER BY mo.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.modoIds || options.modoUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })(),

      // 12. Rangos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipRangos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT r.uuid, r.uuid AS id, r.nombre, COUNT(DISTINCT m.uuid)::int AS count
          ${fromJoin}
          ${where}
          AND r.uuid IS NOT NULL
          GROUP BY r.uuid, r.nombre
          ORDER BY r.nombre ASC
        `.catch(() => []);
        const active = new Set(toUuidArray(options.rangoIds || options.rangoUuids));
        return (res || [])
          .map(r => ({ id: r.uuid, uuid: r.uuid, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(r.uuid));
      })()
    ]);

    return {
      success: true,
      data: {
        sociedades: sociedadesRes || [],
        legales: legalesRes || [],
        marcas: marcasRes || [],
        modelos: modelosRes || [],
        juegos: juegosRes || [],
        grupos: gruposRes || [],
        salas: salasRes || [],
        estados: estadosRes || [],
        valores: valoresRes || [],
        tipos: tiposRes || [],
        modos: modosRes || [],
        rangos: rangosRes || []
      }
    };
  } catch (err) {
    console.error('Error getMaquinasFilterOptionsModel:', err);
    return {
      success: true,
      data: {
        grupos: [],
        salas: [],
        marcas: [],
        juegos: [],
        estados: [],
        sociedades: [],
        valores: [],
        modelos: [],
        tipos: [],
        modos: [],
        legales: [],
        rangos: []
      }
    };
  }
}

export async function getMaquinaByIdModel(id) {
  if (!id) return null;
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) return null;

  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT 
        m.uuid,
        m.uuid AS id,
        m.nombre,
        m.serial,
        m.puestos,
        m.sala_uuid,
        m.sala_uuid AS sala_id,
        s.nombre AS sala_nombre,
        s.nombre_comercial AS sala_nombre_comercial,
        s.grupo_uuid AS grupo_sala_id,
        s.grupo_uuid AS grupo_sala_uuid,
        gs.nombre AS grupo_sala_nombre,
        m.juego_uuid,
        m.juego_uuid AS juego_id,
        j.nombre AS juego_nombre,
        m.estado_uuid,
        m.estado_uuid AS estado_id,
        e.nombre AS estado_nombre,
        m.sociedad_uuid,
        m.sociedad_uuid AS sociedad_id,
        soc.nombre AS sociedad_nombre,
        m.valor_uuid,
        m.valor_uuid AS valor_id,
        v.nombre AS valor_nombre,
        m.modelo_uuid,
        m.modelo_uuid AS modelo_id,
        mod.nombre AS modelo_nombre,
        mod.marca_uuid,
        mod.marca_uuid AS marca_id,
        mar.nombre AS marca_nombre,
        m.tipo_uuid,
        m.tipo_uuid AS tipo_id,
        t.nombre AS tipo_nombre,
        m.modo_uuid,
        m.modo_uuid AS modo_id,
        mo.nombre AS modo_nombre,
        m.legal_uuid,
        m.legal_uuid AS legal_id,
        l.nombre AS legal_nombre,
        m.rango_uuid,
        m.rango_uuid AS rango_id,
        r.nombre AS rango_nombre,
        COALESCE(m.contador_entrada_inicial, 0) AS contador_entrada_inicial,
        COALESCE(m.contador_salida_inicial, 0) AS contador_salida_inicial,
        COALESCE(m.contador_jackpot_inicial, 0) AS contador_jackpot_inicial,
        m.is_deleted,
        m.created_at,
        m.updated_at
      FROM maquinas m
      LEFT JOIN salas s ON m.sala_uuid = s.uuid
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      LEFT JOIN juegos_maquinas j ON m.juego_uuid = j.uuid
      LEFT JOIN estados e ON m.estado_uuid = e.uuid
      LEFT JOIN sociedades soc ON m.sociedad_uuid = soc.uuid
      LEFT JOIN valores v ON m.valor_uuid = v.uuid
      LEFT JOIN modelos mod ON m.modelo_uuid = mod.uuid
      LEFT JOIN marcas mar ON mod.marca_uuid = mar.uuid
      LEFT JOIN tipos t ON m.tipo_uuid = t.uuid
      LEFT JOIN modos mo ON m.modo_uuid = mo.uuid
      LEFT JOIN legal l ON m.legal_uuid = l.uuid
      LEFT JOIN rangos r ON m.rango_uuid = r.uuid
      WHERE m.uuid = ${targetUuid}::uuid
      LIMIT 1
    `;
    return rows[0] || null;
  } else {
    return (inMemoryData.maquinas || []).find(m => m.uuid === targetUuid) || null;
  }
}

export async function createMaquinaModel(data) {
  const rawNombre = (data.nombre !== undefined && data.nombre !== null) ? String(data.nombre).trim() : '';
  const nombre = rawNombre || 'N/A';
  const rawSerial = (data.serial !== undefined && data.serial !== null) ? String(data.serial).trim() : '';
  const serial = rawSerial || 'N/A';
  const puestos = Number(data.puestos) > 0 ? Number(data.puestos) : 1;
  const maquinaUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  const rawSala = data.sala_uuid || data.sala_id;
  const sala_uuid = rawSala && isUuid(rawSala) ? String(rawSala).trim() : null;

  const rawJuego = data.juego_uuid || data.juego_id;
  const juego_uuid = rawJuego && isUuid(rawJuego) ? String(rawJuego).trim() : null;

  const rawEstado = data.estado_uuid || data.estado_id;
  const estado_uuid = rawEstado && isUuid(rawEstado) ? String(rawEstado).trim() : null;

  const rawSociedad = data.sociedad_uuid || data.sociedad_id;
  const sociedad_uuid = rawSociedad && isUuid(rawSociedad) ? String(rawSociedad).trim() : null;

  const rawValor = data.valor_uuid || data.valor_id;
  const valor_uuid = rawValor && isUuid(rawValor) ? String(rawValor).trim() : null;

  const rawModelo = data.modelo_uuid || data.modelo_id;
  const modelo_uuid = rawModelo && isUuid(rawModelo) ? String(rawModelo).trim() : null;

  const rawTipo = data.tipo_uuid || data.tipo_id;
  const tipo_uuid = rawTipo && isUuid(rawTipo) ? String(rawTipo).trim() : null;

  const rawModo = data.modo_uuid || data.modo_id;
  const modo_uuid = rawModo && isUuid(rawModo) ? String(rawModo).trim() : null;

  const rawLegal = data.legal_uuid || data.legal_id;
  const legal_uuid = rawLegal && isUuid(rawLegal) ? String(rawLegal).trim() : null;

  const rawRango = data.rango_uuid || data.rango_id;
  const rango_uuid = rawRango && isUuid(rawRango) ? String(rawRango).trim() : null;

  const contador_entrada_inicial = (data.contador_entrada_inicial !== undefined && data.contador_entrada_inicial !== null && data.contador_entrada_inicial !== '') ? Number(data.contador_entrada_inicial) : 0;
  const contador_salida_inicial = (data.contador_salida_inicial !== undefined && data.contador_salida_inicial !== null && data.contador_salida_inicial !== '') ? Number(data.contador_salida_inicial) : 0;
  const contador_jackpot_inicial = (data.contador_jackpot_inicial !== undefined && data.contador_jackpot_inicial !== null && data.contador_jackpot_inicial !== '') ? Number(data.contador_jackpot_inicial) : 0;

  if (isPgConnected && sql) {
    if (serial.toUpperCase() !== 'N/A') {
      const existing = await sql`
        SELECT uuid, nombre, serial FROM maquinas 
        WHERE LOWER(TRIM(serial)) = LOWER(${serial}) AND UPPER(TRIM(serial)) != 'N/A'
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe una máquina registrada con el serial "${serial}" (${existing[0].nombre})`);
      }
    }

    const rows = await sql`
      INSERT INTO maquinas (
        uuid,
        nombre, serial, puestos, 
        sala_uuid, 
        juego_uuid, 
        estado_uuid,
        sociedad_uuid, 
        valor_uuid, 
        modelo_uuid, 
        tipo_uuid, 
        modo_uuid, 
        legal_uuid,
        rango_uuid,
        contador_entrada_inicial,
        contador_salida_inicial,
        contador_jackpot_inicial
      ) VALUES (
        ${maquinaUuid}::uuid,
        ${nombre}, ${serial}, ${puestos}, 
        ${sala_uuid ? sql`${sala_uuid}::uuid` : sql`NULL`}, 
        ${juego_uuid ? sql`${juego_uuid}::uuid` : sql`NULL`}, 
        ${estado_uuid ? sql`${estado_uuid}::uuid` : sql`NULL`},
        ${sociedad_uuid ? sql`${sociedad_uuid}::uuid` : sql`NULL`}, 
        ${valor_uuid ? sql`${valor_uuid}::uuid` : sql`NULL`}, 
        ${modelo_uuid ? sql`${modelo_uuid}::uuid` : sql`NULL`}, 
        ${tipo_uuid ? sql`${tipo_uuid}::uuid` : sql`NULL`}, 
        ${modo_uuid ? sql`${modo_uuid}::uuid` : sql`NULL`}, 
        ${legal_uuid ? sql`${legal_uuid}::uuid` : sql`NULL`},
        ${rango_uuid ? sql`${rango_uuid}::uuid` : sql`NULL`},
        ${contador_entrada_inicial},
        ${contador_salida_inicial},
        ${contador_jackpot_inicial}
      )
      RETURNING *, uuid AS id, sala_uuid AS sala_id, juego_uuid AS juego_id, estado_uuid AS estado_id,
        sociedad_uuid AS sociedad_id, valor_uuid AS valor_id, modelo_uuid AS modelo_id, tipo_uuid AS tipo_id,
        modo_uuid AS modo_id, legal_uuid AS legal_id, rango_uuid AS rango_id
    `;
    return rows[0];
  } else {
    if (!inMemoryData.maquinas) inMemoryData.maquinas = [];
    if (serial.toUpperCase() !== 'N/A') {
      const exists = inMemoryData.maquinas.find(m => (m.serial || '').trim().toLowerCase() === serial.toLowerCase() && (m.serial || '').trim().toUpperCase() !== 'N/A');
      if (exists) {
        throw new Error(`Ya existe una máquina registrada con el serial "${serial}" (${exists.nombre})`);
      }
    }
    const item = {
      id: maquinaUuid,
      uuid: maquinaUuid,
      nombre,
      serial,
      puestos,
      sala_uuid,
      sala_id: sala_uuid,
      juego_uuid,
      juego_id: juego_uuid,
      estado_uuid,
      estado_id: estado_uuid,
      sociedad_uuid,
      sociedad_id: sociedad_uuid,
      valor_uuid,
      valor_id: valor_uuid,
      modelo_uuid,
      modelo_id: modelo_uuid,
      tipo_uuid,
      tipo_id: tipo_uuid,
      modo_uuid,
      modo_id: modo_uuid,
      legal_uuid,
      legal_id: legal_uuid,
      rango_uuid,
      rango_id: rango_uuid,
      contador_entrada_inicial,
      contador_salida_inicial,
      contador_jackpot_inicial,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.maquinas.unshift(item);
    return item;
  }
}

export async function updateMaquinaModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const nombre = data.nombre !== undefined ? (String(data.nombre).trim() || 'N/A') : undefined;
  const serial = data.serial !== undefined ? (String(data.serial).trim() || 'N/A') : undefined;
  const puestos = data.puestos !== undefined ? (Number(data.puestos) > 0 ? Number(data.puestos) : 1) : undefined;

  const rawSala = data.sala_uuid !== undefined ? data.sala_uuid : data.sala_id;
  const sala_uuid = rawSala !== undefined ? (rawSala && isUuid(rawSala) ? String(rawSala).trim() : null) : undefined;

  const rawJuego = data.juego_uuid !== undefined ? data.juego_uuid : data.juego_id;
  const juego_uuid = rawJuego !== undefined ? (rawJuego && isUuid(rawJuego) ? String(rawJuego).trim() : null) : undefined;

  const rawEstado = data.estado_uuid !== undefined ? data.estado_uuid : data.estado_id;
  const estado_uuid = rawEstado !== undefined ? (rawEstado && isUuid(rawEstado) ? String(rawEstado).trim() : null) : undefined;

  const rawSociedad = data.sociedad_uuid !== undefined ? data.sociedad_uuid : data.sociedad_id;
  const sociedad_uuid = rawSociedad !== undefined ? (rawSociedad && isUuid(rawSociedad) ? String(rawSociedad).trim() : null) : undefined;

  const rawValor = data.valor_uuid !== undefined ? data.valor_uuid : data.valor_id;
  const valor_uuid = rawValor !== undefined ? (rawValor && isUuid(rawValor) ? String(rawValor).trim() : null) : undefined;

  const rawModelo = data.modelo_uuid !== undefined ? data.modelo_uuid : data.modelo_id;
  const modelo_uuid = rawModelo !== undefined ? (rawModelo && isUuid(rawModelo) ? String(rawModelo).trim() : null) : undefined;

  const rawTipo = data.tipo_uuid !== undefined ? data.tipo_uuid : data.tipo_id;
  const tipo_uuid = rawTipo !== undefined ? (rawTipo && isUuid(rawTipo) ? String(rawTipo).trim() : null) : undefined;

  const rawModo = data.modo_uuid !== undefined ? data.modo_uuid : data.modo_id;
  const modo_uuid = rawModo !== undefined ? (rawModo && isUuid(rawModo) ? String(rawModo).trim() : null) : undefined;

  const rawLegal = data.legal_uuid !== undefined ? data.legal_uuid : data.legal_id;
  const legal_uuid = rawLegal !== undefined ? (rawLegal && isUuid(rawLegal) ? String(rawLegal).trim() : null) : undefined;

  const rawRango = data.rango_uuid !== undefined ? data.rango_uuid : data.rango_id;
  const rango_uuid = rawRango !== undefined ? (rawRango && isUuid(rawRango) ? String(rawRango).trim() : null) : undefined;

  const contador_entrada_inicial = (data.contador_entrada_inicial !== undefined && data.contador_entrada_inicial !== null && data.contador_entrada_inicial !== '') ? Number(data.contador_entrada_inicial) : (data.contador_entrada_inicial === '' ? 0 : undefined);
  const contador_salida_inicial = (data.contador_salida_inicial !== undefined && data.contador_salida_inicial !== null && data.contador_salida_inicial !== '') ? Number(data.contador_salida_inicial) : (data.contador_salida_inicial === '' ? 0 : undefined);
  const contador_jackpot_inicial = (data.contador_jackpot_inicial !== undefined && data.contador_jackpot_inicial !== null && data.contador_jackpot_inicial !== '') ? Number(data.contador_jackpot_inicial) : (data.contador_jackpot_inicial === '' ? 0 : undefined);

  if (isPgConnected && sql) {
    if (serial !== undefined && serial.toUpperCase() !== 'N/A') {
      const existing = await sql`
        SELECT uuid, nombre, serial FROM maquinas 
        WHERE uuid != ${targetUuid}::uuid
          AND LOWER(TRIM(serial)) = LOWER(${serial}) AND UPPER(TRIM(serial)) != 'N/A'
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otra máquina registrada con el serial "${serial}" (${existing[0].nombre})`);
      }
    }

    const rows = await sql`
      UPDATE maquinas
      SET
        nombre = ${nombre !== undefined ? nombre : sql`nombre`},
        serial = ${serial !== undefined ? serial : sql`serial`},
        puestos = ${puestos !== undefined ? puestos : sql`puestos`},
        sala_uuid = ${sala_uuid !== undefined ? (sala_uuid ? sql`${sala_uuid}::uuid` : sql`NULL`) : sql`sala_uuid`},
        juego_uuid = ${juego_uuid !== undefined ? (juego_uuid ? sql`${juego_uuid}::uuid` : sql`NULL`) : sql`juego_uuid`},
        estado_uuid = ${estado_uuid !== undefined ? (estado_uuid ? sql`${estado_uuid}::uuid` : sql`NULL`) : sql`estado_uuid`},
        sociedad_uuid = ${sociedad_uuid !== undefined ? (sociedad_uuid ? sql`${sociedad_uuid}::uuid` : sql`NULL`) : sql`sociedad_uuid`},
        valor_uuid = ${valor_uuid !== undefined ? (valor_uuid ? sql`${valor_uuid}::uuid` : sql`NULL`) : sql`valor_uuid`},
        modelo_uuid = ${modelo_uuid !== undefined ? (modelo_uuid ? sql`${modelo_uuid}::uuid` : sql`NULL`) : sql`modelo_uuid`},
        tipo_uuid = ${tipo_uuid !== undefined ? (tipo_uuid ? sql`${tipo_uuid}::uuid` : sql`NULL`) : sql`tipo_uuid`},
        modo_uuid = ${modo_uuid !== undefined ? (modo_uuid ? sql`${modo_uuid}::uuid` : sql`NULL`) : sql`modo_uuid`},
        legal_uuid = ${legal_uuid !== undefined ? (legal_uuid ? sql`${legal_uuid}::uuid` : sql`NULL`) : sql`legal_uuid`},
        rango_uuid = ${rango_uuid !== undefined ? (rango_uuid ? sql`${rango_uuid}::uuid` : sql`NULL`) : sql`rango_uuid`},
        contador_entrada_inicial = ${contador_entrada_inicial !== undefined ? contador_entrada_inicial : sql`contador_entrada_inicial`},
        contador_salida_inicial = ${contador_salida_inicial !== undefined ? contador_salida_inicial : sql`contador_salida_inicial`},
        contador_jackpot_inicial = ${contador_jackpot_inicial !== undefined ? contador_jackpot_inicial : sql`contador_jackpot_inicial`},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${targetUuid}::uuid
      RETURNING *, uuid AS id, sala_uuid AS sala_id, juego_uuid AS juego_id, estado_uuid AS estado_id,
        sociedad_uuid AS sociedad_id, valor_uuid AS valor_id, modelo_uuid AS modelo_id, tipo_uuid AS tipo_id,
        modo_uuid AS modo_id, legal_uuid AS legal_id, rango_uuid AS rango_id
    `;
    return rows[0] || null;
  } else {
    const list = inMemoryData.maquinas || [];
    const idx = list.findIndex(m => m.uuid === targetUuid);
    if (idx !== -1) {
      if (serial !== undefined && serial.toUpperCase() !== 'N/A') {
        const exists = list.find(m => m.uuid !== targetUuid && (m.serial || '').trim().toLowerCase() === serial.toLowerCase() && (m.serial || '').trim().toUpperCase() !== 'N/A');
        if (exists) {
          throw new Error(`Ya existe otra máquina registrada con el serial "${serial}" (${exists.nombre})`);
        }
      }
      if (nombre !== undefined) list[idx].nombre = nombre;
      if (serial !== undefined) list[idx].serial = serial;
      if (puestos !== undefined) list[idx].puestos = puestos;
      if (sala_uuid !== undefined) {
        list[idx].sala_uuid = sala_uuid;
        list[idx].sala_id = sala_uuid;
      }
      if (juego_uuid !== undefined) {
        list[idx].juego_uuid = juego_uuid;
        list[idx].juego_id = juego_uuid;
      }
      if (estado_uuid !== undefined) {
        list[idx].estado_uuid = estado_uuid;
        list[idx].estado_id = estado_uuid;
      }
      if (sociedad_uuid !== undefined) {
        list[idx].sociedad_uuid = sociedad_uuid;
        list[idx].sociedad_id = sociedad_uuid;
      }
      if (valor_uuid !== undefined) {
        list[idx].valor_uuid = valor_uuid;
        list[idx].valor_id = valor_uuid;
      }
      if (modelo_uuid !== undefined) {
        list[idx].modelo_uuid = modelo_uuid;
        list[idx].modelo_id = modelo_uuid;
      }
      if (tipo_uuid !== undefined) {
        list[idx].tipo_uuid = tipo_uuid;
        list[idx].tipo_id = tipo_uuid;
      }
      if (modo_uuid !== undefined) {
        list[idx].modo_uuid = modo_uuid;
        list[idx].modo_id = modo_uuid;
      }
      if (legal_uuid !== undefined) {
        list[idx].legal_uuid = legal_uuid;
        list[idx].legal_id = legal_uuid;
      }
      if (rango_uuid !== undefined) {
        list[idx].rango_uuid = rango_uuid;
        list[idx].rango_id = rango_uuid;
      }
      if (contador_entrada_inicial !== undefined) list[idx].contador_entrada_inicial = contador_entrada_inicial;
      if (contador_salida_inicial !== undefined) list[idx].contador_salida_inicial = contador_salida_inicial;
      if (contador_jackpot_inicial !== undefined) list[idx].contador_jackpot_inicial = contador_jackpot_inicial;
      list[idx].updated_at = new Date().toISOString();
      return list[idx];
    }
    return null;
  }
}

export async function deleteMaquinaModel(id) {
  return await deleteEntityDynamic('maquinas', 'máquina', id);
}


// ==========================================
// --- LLAVES (CECOM: ACTIVAS Y BORRADAS) ---
// ==========================================

export function buildLlaveConditions(options = {}) {
  const conds = [];

  // 1. Estado activo (1 = llaves activas, 0 = llaves borradas)
  if (options.active !== undefined && options.active !== null && options.active !== '') {
    conds.push(sql`l.active = ${Number(options.active)}`);
  }

  // 2. Restricción por salas asignadas al usuario logueado
  const uSalas = toUuidArray(options.userSalaIds || options.userSalaUuids);
  if (uSalas.length > 0) {
    conds.push(sql`l.sala_uuid = ANY(${uSalas})`);
  }

  // 3. Salas seleccionadas en el filtro
  if (!options.skipSalas) {
    const sUuids = toUuidArray(options.salaIds || options.salaUuids);
    if (sUuids.length > 0) conds.push(sql`l.sala_uuid = ANY(${sUuids})`);
  }

  // 4. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(l.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      l.uuid::text LIKE ${term}
    )`);
  }

  return conds;
}

export async function getLlavesFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [] }
    };
  }

  const active = options.active !== undefined ? Number(options.active) : 1;

  // Filtro de Salas (Excluyendo galpones)
  const condsSalas = buildLlaveConditions({ ...options, skipSalas: true, active });
  const whereSalas = condsSalas.length > 0 ? sql`WHERE ${condsSalas.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const uSalas = toUuidArray(options.userSalaIds || options.userSalaUuids);
  let allSalas;
  if (uSalas.length > 0) {
    allSalas = await sql`
      SELECT s.uuid, s.uuid AS id, s.nombre 
      FROM salas s 
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      WHERE s.uuid = ANY(${uSalas}) AND (gs.nombre IS NULL OR LOWER(gs.nombre) NOT LIKE '%galp%')
      ORDER BY s.nombre ASC
    `;
  } else {
    allSalas = await sql`
      SELECT s.uuid, s.uuid AS id, s.nombre 
      FROM salas s 
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      WHERE (gs.nombre IS NULL OR LOWER(gs.nombre) NOT LIKE '%galp%')
      ORDER BY s.nombre ASC
    `;
  }

  const countsSalasRes = await sql`
    SELECT l.sala_uuid AS id, l.sala_uuid AS uuid, COUNT(l.uuid)::int AS count
    FROM llaves l
    LEFT JOIN salas s ON l.sala_uuid = s.uuid
    ${whereSalas}
    GROUP BY l.sala_uuid
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.uuid, r.count]));
  const activeSalas = new Set(toUuidArray(options.salaIds || options.salaUuids));

  const salas = allSalas
    .map(s => ({
      id: s.uuid,
      uuid: s.uuid,
      nombre: s.nombre,
      count: countSalasMap.get(s.uuid) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(s.uuid))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    data: {
      salas
    }
  };
}

export async function getLlavesModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.llaves || [];
    const active = params.active !== undefined ? Number(params.active) : 1;
    list = list.filter(m => (m.active ?? 1) === active);
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'nombre';
  const sortDir = (params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const active = params.active !== undefined ? Number(params.active) : 1;

  const userSalaIds = toUuidArray(params.user_sala_ids || params.user_sala_uuids || params.userSalaIds);
  const salaIds = toUuidArray(params.sala_ids || params.sala_uuids || params.salaIds);

  const conds = buildLlaveConditions({
    active,
    userSalaIds,
    salaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'l.created_at',
    'uuid': 'l.created_at',
    'created_at': 'l.created_at',
    'nombre': 'l.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'l.created_at';

  const countRes = await sql`
    SELECT COUNT(l.uuid)::int AS total
    FROM llaves l
    LEFT JOIN salas s ON l.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, l.created_at DESC, l.uuid DESC`);

  const selectCols = sql`
    SELECT 
      l.uuid,
      l.uuid AS id,
      l.nombre,
      l.active,
      l.sala_uuid,
      l.sala_uuid AS sala_id,
      s.nombre AS sala_nombre,
      l.created_at,
      l.updated_at
    FROM llaves l
    LEFT JOIN salas s ON l.sala_uuid = s.uuid
  `;

  let data;
  if (limit > 0) {
    data = await sql`
      ${selectCols}
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      ${selectCols}
      ${where}
      ${orderClause}
    `;
  }

  data = data.map(r => ({ ...r, nombre: toTitleCase(r.nombre) }));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function getLlaveByIdModel(id) {
  if (!id) return null;
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) return null;

  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT 
        l.uuid,
        l.uuid AS id,
        l.nombre,
        l.active,
        l.sala_uuid,
        l.sala_uuid AS sala_id,
        s.nombre AS sala_nombre,
        l.created_at,
        l.updated_at
      FROM llaves l
      LEFT JOIN salas s ON l.sala_uuid = s.uuid
      WHERE l.uuid = ${targetUuid}::uuid
      LIMIT 1
    `;
    return rows[0] || null;
  } else {
    return (inMemoryData.llaves || []).find(m => m.uuid === targetUuid) || null;
  }
}

export async function createLlaveModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre de la llave es obligatorio');
  const rawSala = data.sala_uuid || data.sala_id;
  if (!rawSala) throw new Error('Debe seleccionar una sala para la llave');

  const targetSalaUuid = String(rawSala).trim();
  if (!isUuid(targetSalaUuid)) throw new Error('UUID de sala inválido');
  const llaveUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT uuid FROM llaves 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND sala_uuid = ${targetSalaUuid}::uuid
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe una llave registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }

    const rows = await sql`
      INSERT INTO llaves (
        uuid,
        nombre, sala_uuid, active
      )
      VALUES (
        ${llaveUuid}::uuid,
        ${cleanName}, 
        ${targetSalaUuid}::uuid, 
        1
      )
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return rows[0];
  } else {
    const cleanLower = cleanName.toLowerCase();
    const existing = (inMemoryData.llaves || []).find(m => (m.nombre || '').trim().toLowerCase() === cleanLower && m.sala_uuid === targetSalaUuid);
    if (existing) {
      throw new Error(`Ya existe una llave registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }
    const newLlave = {
      id: llaveUuid,
      uuid: llaveUuid,
      nombre: cleanName,
      sala_id: targetSalaUuid,
      sala_uuid: targetSalaUuid,
      active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.llaves = inMemoryData.llaves || [];
    inMemoryData.llaves.unshift(newLlave);
    return newLlave;
  }
}

export async function updateLlaveModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
  const rawSala = data.sala_uuid !== undefined ? data.sala_uuid : data.sala_id;
  const targetSalaUuid = (rawSala !== undefined && rawSala && isUuid(rawSala)) ? String(rawSala).trim() : null;
  const active = data.active !== undefined ? Number(data.active) : null;

  if (isPgConnected && sql) {
    let currentSalaUuid = targetSalaUuid;
    if (!currentSalaUuid && cleanName) {
      const cur = await sql`SELECT sala_uuid FROM llaves WHERE uuid = ${targetUuid}::uuid LIMIT 1`;
      if (cur.length > 0) {
        currentSalaUuid = cur[0].sala_uuid;
      }
    }

    if (cleanName && currentSalaUuid) {
      const existing = await sql`
        SELECT uuid FROM llaves 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND sala_uuid = ${currentSalaUuid}::uuid
          AND uuid != ${targetUuid}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otra llave registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
      }
    }

    const rows = await sql`
      UPDATE llaves
      SET 
        nombre = COALESCE(${cleanName}, nombre),
        sala_uuid = ${targetSalaUuid !== null ? sql`${targetSalaUuid}::uuid` : sql`sala_uuid`},
        active = COALESCE(${active}, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${targetUuid}::uuid
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.llaves || []).findIndex(m => m.uuid === targetUuid);
    if (idx !== -1) {
      inMemoryData.llaves[idx] = { ...inMemoryData.llaves[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.llaves[idx];
    }
    return null;
  }
}

// Soft delete: Marca active = 0 (envía a Llaves Borradas)
export async function softDeleteLlaveModel(id) {
  if (!id) throw new Error('ID inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE llaves 
      SET active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE uuid = ${targetUuid}::uuid 
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return { success: true, id: targetUuid, uuid: targetUuid, llave: rows[0] };
  } else {
    const llave = (inMemoryData.llaves || []).find(m => m.uuid === targetUuid);
    if (llave) llave.active = 0;
    return { success: true, id: targetUuid, uuid: targetUuid };
  }
}

// Restore: Marca active = 1 (restaura de Llaves Borradas a Llaves)
export async function restoreLlaveModel(id) {
  if (!id) throw new Error('ID inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE llaves 
      SET active = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE uuid = ${targetUuid}::uuid 
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return { success: true, id: targetUuid, uuid: targetUuid, llave: rows[0] };
  } else {
    const llave = (inMemoryData.llaves || []).find(m => m.uuid === targetUuid);
    if (llave) llave.active = 1;
    return { success: true, id: targetUuid, uuid: targetUuid };
  }
}

// Purge: Eliminación definitiva física de la base de datos
export async function purgeLlaveModel(id) {
  return await deleteEntityDynamic('llaves', 'llave', id);
}

// ==========================================
// --- LIBROS (CECOM: LIBRO) ---
// ==========================================

export function buildLibroConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  const uSalas = toUuidArray(options.userSalaIds || options.userSalaUuids);
  if (uSalas.length > 0) {
    conds.push(sql`l.sala_uuid = ANY(${uSalas})`);
  }

  // 2. Salas seleccionadas en el filtro
  if (!options.skipSalas) {
    const sUuids = toUuidArray(options.salaIds || options.salaUuids);
    if (sUuids.length > 0) conds.push(sql`l.sala_uuid = ANY(${sUuids})`);
  }

  // 3. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(l.descripcion, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      l.uuid::text LIKE ${term}
    )`);
  }

  return conds;
}

export async function getLibrosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [] }
    };
  }

  // Filtro de Salas (Excluyendo galpones)
  const condsSalas = buildLibroConditions({ ...options, skipSalas: true });
  const whereSalas = condsSalas.length > 0 ? sql`WHERE ${condsSalas.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const uSalas = toUuidArray(options.userSalaIds || options.userSalaUuids);
  let allSalas;
  if (uSalas.length > 0) {
    allSalas = await sql`
      SELECT s.uuid, s.uuid AS id, s.nombre 
      FROM salas s 
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      WHERE s.uuid = ANY(${uSalas}) AND (gs.nombre IS NULL OR LOWER(gs.nombre) NOT LIKE '%galp%')
      ORDER BY s.nombre ASC
    `;
  } else {
    allSalas = await sql`
      SELECT s.uuid, s.uuid AS id, s.nombre 
      FROM salas s 
      LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
      WHERE (gs.nombre IS NULL OR LOWER(gs.nombre) NOT LIKE '%galp%')
      ORDER BY s.nombre ASC
    `;
  }

  const countsSalasRes = await sql`
    SELECT l.sala_uuid AS id, l.sala_uuid AS uuid, COUNT(l.uuid)::int AS count
    FROM libros l
    LEFT JOIN salas s ON l.sala_uuid = s.uuid
    ${whereSalas}
    GROUP BY l.sala_uuid
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.uuid, r.count]));
  const activeSalas = new Set(toUuidArray(options.salaIds || options.salaUuids));

  const salas = allSalas
    .map(s => ({
      id: s.uuid,
      uuid: s.uuid,
      nombre: s.nombre,
      count: countSalasMap.get(s.uuid) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(s.uuid))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    data: {
      salas
    }
  };
}

export async function getLibrosModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.libros || [];
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }
  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'descripcion';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const userSalaIds = toUuidArray(params.user_sala_ids || params.user_sala_uuids || params.userSalaIds);
  const salaIds = toUuidArray(params.sala_ids || params.sala_uuids || params.salaIds);

  const conds = buildLibroConditions({
    userSalaIds,
    salaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'l.created_at',
    'uuid': 'l.created_at',
    'created_at': 'l.created_at',
    'descripcion': 'l.descripcion',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'l.created_at';

  const countRes = await sql`
    SELECT COUNT(l.uuid)::int AS total
    FROM libros l
    LEFT JOIN salas s ON l.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, l.created_at DESC, l.uuid DESC`);

  const selectCols = sql`
    SELECT 
      l.uuid,
      l.uuid AS id,
      l.descripcion,
      1 AS active,
      l.sala_uuid,
      l.sala_uuid AS sala_id,
      s.nombre AS sala_nombre,
      s.nombre_comercial AS sala_nombre_comercial,
      l.created_at,
      l.updated_at
    FROM libros l
    LEFT JOIN salas s ON l.sala_uuid = s.uuid
  `;

  let data;
  if (limit > 0) {
    data = await sql`
      ${selectCols}
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      ${selectCols}
      ${where}
      ${orderClause}
    `;
  }

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
  return { success: true, data, total, page, limit, totalPages };
}

export async function getLibroByIdModel(id) {
  if (!id) return { success: false, error: 'ID de libro inválido' };
  const target = String(id).trim();

  if (isPgConnected && sql) {
    if (isUuid(target)) {
      const rows = await sql`
        SELECT 
          l.uuid,
          l.uuid AS id,
          l.descripcion,
          1 AS active,
          l.sala_uuid,
          l.sala_uuid AS sala_id,
          s.nombre AS sala_nombre,
          s.nombre_comercial AS sala_nombre_comercial,
          l.created_at,
          l.updated_at
        FROM libros l
        LEFT JOIN salas s ON l.sala_uuid = s.uuid
        WHERE l.uuid = ${target}::uuid
        LIMIT 1
      `;
      if (rows && rows.length > 0) {
        return { success: true, data: rows[0] };
      }
    } else {
      // Fallback para ID numérico antiguo (ej. 17)
      try {
        const rows = await sql`
          SELECT 
            l.uuid,
            l.uuid AS id,
            l.descripcion,
            1 AS active,
            l.sala_uuid,
            l.sala_uuid AS sala_id,
            s.nombre AS sala_nombre,
            s.nombre_comercial AS sala_nombre_comercial,
            l.created_at,
            l.updated_at
          FROM libros l
          LEFT JOIN salas s ON l.sala_uuid = s.uuid
          WHERE l.id = ${Number(target)}
          LIMIT 1
        `;
        if (rows && rows.length > 0) {
          return { success: true, data: rows[0] };
        }
      } catch {}
    }
  } else {
    const found = (inMemoryData.libros || []).find(l => String(l.uuid) === target || String(l.id) === target);
    if (found) {
      return { success: true, data: found };
    }
  }
  return { success: false, error: 'Libro no encontrado' };
}

export async function createLibroModel(data) {
  const cleanDesc = (data.descripcion || '').trim();
  if (!cleanDesc) throw new Error('La fecha del libro es obligatoria');
  const salaIdRaw = data.sala_uuid || data.sala_id;
  if (!salaIdRaw) throw new Error('Debe seleccionar una sala para el libro');

  const targetSalaUuid = String(salaIdRaw).trim();
  if (!isUuid(targetSalaUuid)) throw new Error('UUID de sala inválido');
  const libroUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT *, uuid AS id, sala_uuid AS sala_id FROM libros 
      WHERE (uuid = ${libroUuid}::uuid)
         OR (LOWER(TRIM(descripcion)) = LOWER(${cleanDesc}) AND sala_uuid = ${targetSalaUuid}::uuid)
      LIMIT 1
    `;
    if (existing.length > 0) {
      return existing[0];
    }

    const rows = await sql`
      INSERT INTO libros (
        uuid,
        descripcion, sala_uuid
      )
      VALUES (
        ${libroUuid}::uuid,
        ${cleanDesc}, 
        ${targetSalaUuid}::uuid
      )
      ON CONFLICT (uuid) DO UPDATE SET
        descripcion = EXCLUDED.descripcion,
        updated_at = NOW()
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return rows[0];
  } else {
    const cleanLower = cleanDesc.toLowerCase();
    const existing = (inMemoryData.libros || []).find(m => 
      (m.descripcion || '').trim().toLowerCase() === cleanLower && 
      m.sala_uuid === targetSalaUuid
    );
    if (existing) {
      throw new Error(`Ya existe un libro registrado con la fecha "${cleanDesc}" en esta sala`);
    }
    const newLibro = {
      id: libroUuid,
      uuid: libroUuid,
      descripcion: cleanDesc,
      sala_id: targetSalaUuid,
      sala_uuid: targetSalaUuid,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libros = inMemoryData.libros || [];
    inMemoryData.libros.unshift(newLibro);
    return newLibro;
  }
}

export async function updateLibroModel(id, data) {
  if (!id) throw new Error('ID inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const cleanDesc = data.descripcion !== undefined ? String(data.descripcion).trim() : null;
  const salaIdRaw = data.sala_uuid !== undefined ? data.sala_uuid : data.sala_id;
  const targetSalaUuid = (salaIdRaw !== undefined && salaIdRaw && isUuid(salaIdRaw)) ? String(salaIdRaw).trim() : null;

  if (isPgConnected && sql) {
    let currentSalaUuid = targetSalaUuid;
    if (!currentSalaUuid && cleanDesc) {
      const cur = await sql`
        SELECT sala_uuid FROM libros 
        WHERE uuid = ${targetUuid}::uuid 
        LIMIT 1
      `;
      if (cur.length > 0) {
        currentSalaUuid = cur[0].sala_uuid;
      }
    }

    if (cleanDesc && currentSalaUuid) {
      const existing = await sql`
        SELECT uuid FROM libros 
        WHERE LOWER(TRIM(descripcion)) = LOWER(${cleanDesc}) 
          AND sala_uuid = ${currentSalaUuid}::uuid
          AND uuid != ${targetUuid}::uuid
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otro libro registrado con la fecha "${cleanDesc}" en esta sala`);
      }
    }

    const rows = await sql`
      UPDATE libros
      SET 
        descripcion = COALESCE(${cleanDesc}, descripcion),
        sala_uuid = ${targetSalaUuid !== null ? sql`${targetSalaUuid}::uuid` : sql`sala_uuid`},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${targetUuid}::uuid
      RETURNING *, uuid AS id, sala_uuid AS sala_id
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.libros || []).findIndex(m => m.uuid === targetUuid);
    if (idx !== -1) {
      inMemoryData.libros[idx] = { ...inMemoryData.libros[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.libros[idx];
    }
    return null;
  }
}

export async function deleteLibroModel(id) {
  return await deleteEntityDynamic('libros', 'libro', id);
}

// --- DROP DE MESAS (CECOM: LIBRO DROP) ---
export async function getLibroDropMesasModel(libroId) {
  if (!libroId) return [];
  const targetLibroUuid = String(libroId).trim();
  if (!isUuid(targetLibroUuid)) return [];

  if (!isPgConnected || !sql) {
    const list = inMemoryData.libro_drop_mesas || [];
    return list.filter(d => String(d.libro_uuid || d.libro_id) === targetLibroUuid);
  }

  const rows = await sql`
    SELECT 
      d.uuid,
      d.uuid AS id,
      d.libro_uuid,
      d.libro_uuid AS libro_id,
      d.mesa_uuid,
      d.mesa_uuid AS mesa_id,
      d.denominacion_100,
      d.denominacion_50,
      d.denominacion_20,
      d.denominacion_10,
      d.denominacion_5,
      d.denominacion_1,
      d.denominacion_100 AS b100,
      d.denominacion_50 AS b50,
      d.denominacion_20 AS b20,
      d.denominacion_10 AS b10,
      d.denominacion_5 AS b5,
      d.denominacion_1 AS b1,
      d.total,
      d.created_at,
      d.updated_at,
      m.nombre AS mesa_nombre,
      j.nombre AS juego_nombre,
      s.nombre AS sala_nombre,
      s.nombre_comercial AS sala_nombre_comercial
    FROM libro_drop_mesas d
    JOIN mesas m ON d.mesa_uuid = m.uuid
    LEFT JOIN juegos j ON m.juego_uuid = j.uuid
    LEFT JOIN salas s ON m.sala_uuid = s.uuid
    WHERE d.libro_uuid = ${targetLibroUuid}::uuid
    ORDER BY d.created_at ASC, d.uuid ASC
  `;

  return rows.map(r => ({
    ...r,
    mesa_nombre: r.mesa_nombre ? toTitleCase(r.mesa_nombre) : '',
    juego_nombre: r.juego_nombre ? toTitleCase(r.juego_nombre) : ''
  }));
}

export async function createLibroDropMesaModel(data) {
  const rawLibro = data.libro_uuid || data.libro_id;
  const rawMesa = data.mesa_uuid || data.mesa_id;
  if (!rawLibro) throw new Error('El ID del libro es obligatorio');
  if (!rawMesa) throw new Error('Debe seleccionar una mesa');

  const libroUuid = String(rawLibro).trim();
  const mesaUuid = String(rawMesa).trim();
  if (!isUuid(libroUuid)) throw new Error('UUID de libro inválido');
  if (!isUuid(mesaUuid)) throw new Error('UUID de mesa inválido');

  const b100 = Math.max(0, parseInt(data.denominacion_100 ?? data.b100 ?? 0, 10) || 0);
  const b50 = Math.max(0, parseInt(data.denominacion_50 ?? data.b50 ?? 0, 10) || 0);
  const b20 = Math.max(0, parseInt(data.denominacion_20 ?? data.b20 ?? 0, 10) || 0);
  const b10 = Math.max(0, parseInt(data.denominacion_10 ?? data.b10 ?? 0, 10) || 0);
  const b5 = Math.max(0, parseInt(data.denominacion_5 ?? data.b5 ?? 0, 10) || 0);
  const b1 = Math.max(0, parseInt(data.denominacion_1 ?? data.b1 ?? 0, 10) || 0);

  const total = (b100 * 100) + (b50 * 50) + (b20 * 20) + (b10 * 10) + (b5 * 5) + (b1 * 1);
  const dropUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    inMemoryData.libro_drop_mesas = inMemoryData.libro_drop_mesas || [];
    const existingIdx = (inMemoryData.libro_drop_mesas || []).findIndex(
      d => String(d.libro_uuid || d.libro_id) === libroUuid &&
           String(d.mesa_uuid || d.mesa_id) === mesaUuid
    );

    const mesa = (inMemoryData.mesas || []).find(m => String(m.uuid || m.id) === mesaUuid) || {};

    if (existingIdx !== -1) {
      inMemoryData.libro_drop_mesas[existingIdx] = {
        ...inMemoryData.libro_drop_mesas[existingIdx],
        denominacion_100: b100,
        denominacion_50: b50,
        denominacion_20: b20,
        denominacion_10: b10,
        denominacion_5: b5,
        denominacion_1: b1,
        b100, b50, b20, b10, b5, b1,
        total,
        updated_at: new Date().toISOString()
      };
      return inMemoryData.libro_drop_mesas[existingIdx];
    }

    const newDrop = {
      id: dropUuid,
      uuid: dropUuid,
      libro_id: libroUuid,
      libro_uuid: libroUuid,
      mesa_id: mesaUuid,
      mesa_uuid: mesaUuid,
      denominacion_100: b100,
      denominacion_50: b50,
      denominacion_20: b20,
      denominacion_10: b10,
      denominacion_5: b5,
      denominacion_1: b1,
      b100, b50, b20, b10, b5, b1,
      total,
      mesa_nombre: mesa.nombre || `Mesa #${mesaUuid}`,
      juego_nombre: mesa.juego_nombre || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_drop_mesas.push(newDrop);
    return newDrop;
  }

  const existingRow = await sql`
    SELECT uuid FROM libro_drop_mesas
    WHERE libro_uuid = ${libroUuid}::uuid AND mesa_uuid = ${mesaUuid}::uuid
    LIMIT 1
  `;

  let insertedUuid = null;
  if (existingRow.length > 0) {
    const updated = await sql`
      UPDATE libro_drop_mesas SET
        denominacion_100 = ${b100},
        denominacion_50 = ${b50},
        denominacion_20 = ${b20},
        denominacion_10 = ${b10},
        denominacion_5 = ${b5},
        denominacion_1 = ${b1},
        total = ${total},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${existingRow[0].uuid}::uuid
      RETURNING uuid
    `;
    insertedUuid = updated[0].uuid;
  } else {
    const res = await sql`
      INSERT INTO libro_drop_mesas (
        uuid, libro_uuid, mesa_uuid,
        denominacion_100, denominacion_50, denominacion_20, denominacion_10, denominacion_5, denominacion_1, 
        total
      )
      VALUES (
        ${dropUuid}::uuid,
        ${libroUuid}::uuid,
        ${mesaUuid}::uuid,
        ${b100}, ${b50}, ${b20}, ${b10}, ${b5}, ${b1}, 
        ${total}
      )
      RETURNING uuid
    `;
    insertedUuid = res[0].uuid;
  }

  const details = await sql`
    SELECT 
      d.uuid,
      d.uuid AS id,
      d.libro_uuid,
      d.libro_uuid AS libro_id,
      d.mesa_uuid,
      d.mesa_uuid AS mesa_id,
      d.denominacion_100,
      d.denominacion_50,
      d.denominacion_20,
      d.denominacion_10,
      d.denominacion_5,
      d.denominacion_1,
      d.denominacion_100 AS b100,
      d.denominacion_50 AS b50,
      d.denominacion_20 AS b20,
      d.denominacion_10 AS b10,
      d.denominacion_5 AS b5,
      d.denominacion_1 AS b1,
      d.total,
      d.created_at,
      d.updated_at,
      m.nombre AS mesa_nombre,
      j.nombre AS juego_nombre,
      s.nombre AS sala_nombre,
      s.nombre_comercial AS sala_nombre_comercial
    FROM libro_drop_mesas d
    JOIN mesas m ON d.mesa_uuid = m.uuid
    LEFT JOIN juegos j ON m.juego_uuid = j.uuid
    LEFT JOIN salas s ON m.sala_uuid = s.uuid
    WHERE d.uuid = ${insertedUuid}::uuid
    LIMIT 1
  `;

  const finalRow = details[0] || { uuid: insertedUuid, id: insertedUuid };
  return {
    ...finalRow,
    b100: finalRow.denominacion_100,
    b50: finalRow.denominacion_50,
    b20: finalRow.denominacion_20,
    b10: finalRow.denominacion_10,
    b5: finalRow.denominacion_5,
    b1: finalRow.denominacion_1,
    mesa_nombre: finalRow.mesa_nombre ? toTitleCase(finalRow.mesa_nombre) : '',
    juego_nombre: finalRow.juego_nombre ? toTitleCase(finalRow.juego_nombre) : ''
  };
}

export async function deleteLibroDropMesaModel(id, libroId) {
  if (!id) throw new Error('ID de registro de drop inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_drop_mesas = inMemoryData.libro_drop_mesas || [];
    inMemoryData.libro_drop_mesas = inMemoryData.libro_drop_mesas.filter(d => 
      String(d.uuid || d.id) !== targetUuid
    );
    return { success: true, id: targetUuid, uuid: targetUuid };
  }

  await sql`
    DELETE FROM libro_drop_mesas
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
  `;

  return { success: true, id: targetUuid, uuid: targetUuid };
}

// --- CONTROL DE LLAVES (CECOM: LIBRO CONTROL DE LLAVES) ---
export async function getLibroControlLlavesModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const targetLibroUuid = String(libroId).trim();
  if (!isUuid(targetLibroUuid)) return [];

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    const list = inMemoryData.libro_control_llaves.filter(c => 
      String(c.libro_uuid || c.libro_id) === targetLibroUuid
    );
    return list.map(c => {
      const uKeys = toUuidArray(c.llaves_uuids || c.llaves_ids);
      const llavesList = (inMemoryData.llaves || []).filter(l => uKeys.includes(l.uuid || l.id));
      return {
        ...c,
        llaves_detalle: llavesList.map(l => ({ id: l.uuid, uuid: l.uuid, nombre: l.nombre }))
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const rows = await sql`
    SELECT 
      cl.uuid,
      cl.uuid AS id,
      cl.libro_uuid,
      cl.libro_uuid AS libro_id,
      cl.descripcion,
      cl.hora_salida,
      cl.hora_recepcion,
      cl.llaves_uuids,
      cl.llaves_uuids AS llaves_ids,
      cl.created_at,
      cl.updated_at,
      COALESCE(
        (
          SELECT json_agg(json_build_object('id', l.uuid, 'uuid', l.uuid, 'nombre', l.nombre) ORDER BY l.nombre)
          FROM llaves l
          WHERE l.uuid = ANY(cl.llaves_uuids)
        ), '[]'::json
      ) AS llaves_detalle
    FROM libro_control_llaves cl
    WHERE cl.libro_uuid = ${targetLibroUuid}::uuid
    ORDER BY cl.created_at DESC, cl.uuid DESC
  `;

  return rows;
}

export async function createLibroControlLlavesModel(data) {
  const rawLibro = data.libro_uuid || data.libro_id;
  if (!rawLibro) throw new Error('ID de libro inválido');
  const libroUuid = String(rawLibro).trim();
  if (!isUuid(libroUuid)) throw new Error('UUID de libro inválido');

  const llavesUuids = toUuidArray(data.llaves_uuids || data.llaves_ids);
  if (llavesUuids.length === 0) {
    throw new Error('Debe seleccionar al menos una llave');
  }

  const descripcion = (data.descripcion || '').trim() || 'General';
  
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const horaSalida = (data.hora_salida || '').trim() || currentHHMM;
  const horaRecepcion = (data.hora_recepcion || '').trim() || null;
  const controlUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    const llavesList = (inMemoryData.llaves || []).filter(l => llavesUuids.includes(l.uuid || l.id));
    const newRecord = {
      id: controlUuid,
      uuid: controlUuid,
      libro_id: libroUuid,
      libro_uuid: libroUuid,
      llaves_ids: llavesUuids,
      llaves_uuids: llavesUuids,
      descripcion,
      hora_salida: horaSalida,
      hora_recepcion: horaRecepcion,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      llaves_detalle: llavesList.map(l => ({ id: l.uuid, uuid: l.uuid, nombre: l.nombre }))
    };
    inMemoryData.libro_control_llaves.push(newRecord);
    return newRecord;
  }

  const res = await sql`
    INSERT INTO libro_control_llaves (
      uuid, libro_uuid, llaves_uuids, descripcion, hora_salida, hora_recepcion
    )
    VALUES (
      ${controlUuid}::uuid,
      ${libroUuid}::uuid,
      ${llavesUuids}::uuid[],
      ${descripcion},
      ${horaSalida},
      ${horaRecepcion}
    )
    RETURNING uuid
  `;

  const insertedUuid = res[0].uuid;

  const rows = await sql`
    SELECT 
      cl.uuid,
      cl.uuid AS id,
      cl.libro_uuid,
      cl.libro_uuid AS libro_id,
      cl.descripcion,
      cl.hora_salida,
      cl.hora_recepcion,
      cl.llaves_uuids,
      cl.llaves_uuids AS llaves_ids,
      cl.created_at,
      cl.updated_at,
      COALESCE(
        (
          SELECT json_agg(json_build_object('id', l.uuid, 'uuid', l.uuid, 'nombre', l.nombre) ORDER BY l.nombre)
          FROM llaves l
          WHERE l.uuid = ANY(cl.llaves_uuids)
        ), '[]'::json
      ) AS llaves_detalle
    FROM libro_control_llaves cl
    WHERE cl.uuid = ${insertedUuid}::uuid
    LIMIT 1
  `;

  return rows[0];
}

export async function updateLibroControlLlavesHorasModel(controlId, libroId, data) {
  if (!controlId) throw new Error('ID de registro de control de llaves inválido');
  const targetUuid = String(controlId).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  const horaSalida = (data.hora_salida || '').trim() || null;
  const horaRecepcion = (data.hora_recepcion || '').trim() || null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    const idx = inMemoryData.libro_control_llaves.findIndex(c => 
      String(c.uuid || c.id) === targetUuid
    );
    if (idx !== -1) {
      if (horaSalida) inMemoryData.libro_control_llaves[idx].hora_salida = horaSalida;
      inMemoryData.libro_control_llaves[idx].hora_recepcion = horaRecepcion;
      inMemoryData.libro_control_llaves[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_control_llaves[idx];
    }
    throw new Error('Registro no encontrado');
  }

  await sql`
    UPDATE libro_control_llaves
    SET 
      hora_salida = COALESCE(${horaSalida}, hora_salida),
      hora_recepcion = ${horaRecepcion},
      updated_at = CURRENT_TIMESTAMP
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
  `;

  const rows = await sql`
    SELECT 
      cl.uuid,
      cl.uuid AS id,
      cl.libro_uuid,
      cl.libro_uuid AS libro_id,
      cl.descripcion,
      cl.hora_salida,
      cl.hora_recepcion,
      cl.llaves_uuids,
      cl.llaves_uuids AS llaves_ids,
      cl.created_at,
      cl.updated_at,
      COALESCE(
        (
          SELECT json_agg(json_build_object('id', l.uuid, 'uuid', l.uuid, 'nombre', l.nombre) ORDER BY l.nombre)
          FROM llaves l
          WHERE l.uuid = ANY(cl.llaves_uuids)
        ), '[]'::json
      ) AS llaves_detalle
    FROM libro_control_llaves cl
    WHERE cl.uuid = ${targetUuid}::uuid
    LIMIT 1
  `;

  return rows[0];
}

export async function deleteLibroControlLlavesModel(id, libroId) {
  if (!id) throw new Error('ID de registro de control de llaves inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves.filter(c => 
      String(c.uuid || c.id) !== targetUuid
    );
    return { success: true, id: targetUuid, uuid: targetUuid };
  }

  await sql`
    DELETE FROM libro_control_llaves
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
  `;

  return { success: true, id: targetUuid, uuid: targetUuid };
}

// --- APORTES DE LIBRO (CECOM: LIBRO APORTES) ---
export async function getLibroAportesModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const targetLibroUuid = String(libroId).trim();
  if (!isUuid(targetLibroUuid)) return [];

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    return inMemoryData.libro_aportes
      .filter(a => String(a.libro_uuid || a.libro_id) === targetLibroUuid)
      .map(a => ({ ...a, tipo: a.tipo || 'Aporte' }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const rows = await sql`
    SELECT 
      la.uuid,
      la.uuid AS id,
      la.libro_uuid,
      la.libro_uuid AS libro_id,
      la.empleado_uuid,
      la.empleado_uuid AS empleado_id,
      la.rango_uuid,
      la.rango_uuid AS rango_id,
      la.monto,
      COALESCE(la.tipo, 'Aporte') AS tipo,
      la.created_at,
      la.updated_at,
      e.nombre AS empleado_nombre,
      e.cedula AS empleado_cedula,
      e.foto AS empleado_foto,
      c.nombre AS cargo_nombre,
      d.nombre AS departamento_nombre,
      r.nombre AS rango_nombre
    FROM libro_aportes la
    JOIN empleados e ON la.empleado_uuid = e.uuid
    LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
    LEFT JOIN areas a ON c.area_uuid = a.uuid
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    JOIN rangos r ON la.rango_uuid = r.uuid
    WHERE la.libro_uuid = ${targetLibroUuid}::uuid
    ORDER BY la.created_at DESC, la.uuid DESC
  `;

  return rows;
}

export async function createLibroAporteModel(data) {
  const rawLibro = data.libro_uuid || data.libro_id;
  const rawEmp = data.empleado_uuid || data.empleado_id;
  const rawRango = data.rango_uuid || data.rango_id;

  if (!rawLibro) throw new Error('ID de libro inválido');
  if (!rawEmp) throw new Error('Debe seleccionar un empleado');
  if (!rawRango) throw new Error('Debe seleccionar un rango');

  const libroUuid = String(rawLibro).trim();
  const empleadoUuid = String(rawEmp).trim();
  const rangoUuid = String(rawRango).trim();

  if (!isUuid(libroUuid)) throw new Error('UUID de libro inválido');
  if (!isUuid(empleadoUuid)) throw new Error('UUID de empleado inválido');
  if (!isUuid(rangoUuid)) throw new Error('UUID de rango inválido');

  const monto = Number(data.monto) || 0;
  const tipo = (data.tipo || '').trim() || 'Aporte';
  const aporteUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    const newRecord = {
      id: aporteUuid,
      uuid: aporteUuid,
      libro_id: libroUuid,
      libro_uuid: libroUuid,
      empleado_id: empleadoUuid,
      empleado_uuid: empleadoUuid,
      rango_id: rangoUuid,
      rango_uuid: rangoUuid,
      monto,
      tipo,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_aportes.push(newRecord);
    return newRecord;
  }

  const res = await sql`
    INSERT INTO libro_aportes (
      uuid, libro_uuid, empleado_uuid, rango_uuid, monto, tipo
    )
    VALUES (
      ${aporteUuid}::uuid,
      ${libroUuid}::uuid,
      ${empleadoUuid}::uuid,
      ${rangoUuid}::uuid,
      ${monto}, ${tipo}
    )
    ON CONFLICT (uuid) DO UPDATE SET
      monto = EXCLUDED.monto,
      tipo = EXCLUDED.tipo,
      updated_at = NOW()
    RETURNING uuid
  `;

  const insertedUuid = res[0].uuid;

  const rows = await sql`
    SELECT 
      la.uuid,
      la.uuid AS id,
      la.libro_uuid,
      la.libro_uuid AS libro_id,
      la.empleado_uuid,
      la.empleado_uuid AS empleado_id,
      la.rango_uuid,
      la.rango_uuid AS rango_id,
      la.monto,
      COALESCE(la.tipo, 'Aporte') AS tipo,
      la.created_at,
      la.updated_at,
      e.nombre AS empleado_nombre,
      e.cedula AS empleado_cedula,
      e.foto AS empleado_foto,
      c.nombre AS cargo_nombre,
      d.nombre AS departamento_nombre,
      r.nombre AS rango_nombre
    FROM libro_aportes la
    JOIN empleados e ON la.empleado_uuid = e.uuid
    LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
    LEFT JOIN areas a ON c.area_uuid = a.uuid
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    JOIN rangos r ON la.rango_uuid = r.uuid
    WHERE la.uuid = ${insertedUuid}::uuid
  `;

  return rows[0];
}

export async function updateLibroAporteModel(id, libroId, data) {
  if (!id) throw new Error('ID de aporte inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  const rawEmp = data.empleado_uuid !== undefined ? data.empleado_uuid : data.empleado_id;
  const empleadoUuid = (rawEmp !== undefined && rawEmp && isUuid(rawEmp)) ? String(rawEmp).trim() : null;

  const rawRango = data.rango_uuid !== undefined ? data.rango_uuid : data.rango_id;
  const rangoUuid = (rawRango !== undefined && rawRango && isUuid(rawRango)) ? String(rawRango).trim() : null;

  const monto = data.monto !== undefined ? Number(data.monto) : null;
  const tipo = data.tipo !== undefined ? (String(data.tipo).trim() || 'Aporte') : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    const idx = inMemoryData.libro_aportes.findIndex(a => String(a.uuid || a.id) === targetUuid);
    if (idx !== -1) {
      if (empleadoUuid) {
        inMemoryData.libro_aportes[idx].empleado_uuid = empleadoUuid;
        inMemoryData.libro_aportes[idx].empleado_id = empleadoUuid;
      }
      if (rangoUuid) {
        inMemoryData.libro_aportes[idx].rango_uuid = rangoUuid;
        inMemoryData.libro_aportes[idx].rango_id = rangoUuid;
      }
      if (monto !== null) inMemoryData.libro_aportes[idx].monto = monto;
      if (tipo !== null) inMemoryData.libro_aportes[idx].tipo = tipo;
      inMemoryData.libro_aportes[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_aportes[idx];
    }
    return null;
  }

  await sql`
    UPDATE libro_aportes
    SET
      empleado_uuid = COALESCE(${empleadoUuid ? sql`${empleadoUuid}::uuid` : sql`NULL`}, empleado_uuid),
      rango_uuid = COALESCE(${rangoUuid ? sql`${rangoUuid}::uuid` : sql`NULL`}, rango_uuid),
      monto = COALESCE(${monto}, monto),
      tipo = COALESCE(${tipo}, tipo),
      updated_at = CURRENT_TIMESTAMP
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
  `;

  const rows = await sql`
    SELECT 
      la.uuid,
      la.uuid AS id,
      la.libro_uuid,
      la.libro_uuid AS libro_id,
      la.empleado_uuid,
      la.empleado_uuid AS empleado_id,
      la.rango_uuid,
      la.rango_uuid AS rango_id,
      la.monto,
      COALESCE(la.tipo, 'Aporte') AS tipo,
      la.created_at,
      la.updated_at,
      e.nombre AS empleado_nombre,
      e.cedula AS empleado_cedula,
      e.foto AS empleado_foto,
      c.nombre AS cargo_nombre,
      d.nombre AS departamento_nombre,
      r.nombre AS rango_nombre
    FROM libro_aportes la
    JOIN empleados e ON la.empleado_uuid = e.uuid
    LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
    LEFT JOIN areas a ON c.area_uuid = a.uuid
    LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
    JOIN rangos r ON la.rango_uuid = r.uuid
    WHERE la.uuid = ${targetUuid}::uuid
    LIMIT 1
  `;

  return rows[0] || null;
}

export async function deleteLibroAporteModel(id, libroId) {
  if (!id) throw new Error('ID de aporte inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    inMemoryData.libro_aportes = inMemoryData.libro_aportes.filter(a => 
      String(a.uuid || a.id) !== targetUuid
    );
    return { success: true, id: targetUuid, uuid: targetUuid };
  }

  await sql`
    DELETE FROM libro_aportes 
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
  `;
  return { success: true, id: targetUuid, uuid: targetUuid };
}

// --- INCIDENCIAS GENERALES (CECOM: LIBRO INCIDENCIAS GENERALES) ---
export async function getLibroIncidenciasGeneralesModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const targetLibroUuid = String(libroId).trim();
  if (!isUuid(targetLibroUuid)) return [];

  if (!isPgConnected || !sql) {
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    return inMemoryData.libro_incidencias_generales
      .filter(c => String(c.libro_uuid || c.libro_id) === targetLibroUuid)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  const rows = await sql`
    SELECT 
      lig.uuid,
      lig.uuid AS id, 
      lig.libro_uuid, 
      lig.libro_uuid AS libro_id, 
      lig.tipo_incidencia_uuid,
      lig.tipo_incidencia_uuid AS tipo_incidencia_id,
      lig.descripcion, 
      COALESCE(ti.nombre, lig.tipo, 'General') AS tipo, 
      COALESCE(ti.nombre, lig.tipo, 'General') AS tipo_incidencia_nombre,
      lig.hora, 
      lig.created_at, 
      lig.updated_at
    FROM libro_incidencias_generales lig
    LEFT JOIN tipo_incidencias ti ON lig.tipo_incidencia_uuid = ti.uuid
    WHERE lig.libro_uuid = ${targetLibroUuid}::uuid
    ORDER BY lig.created_at DESC, lig.uuid DESC
  `;

  return rows;
}

export async function createLibroIncidenciaGeneralModel(data) {
  const rawLibro = data.libro_uuid || data.libro_id;
  if (!rawLibro) throw new Error('ID de libro inválido');
  const libroUuid = String(rawLibro).trim();
  if (!isUuid(libroUuid)) throw new Error('UUID de libro inválido');

  const descripcion = (data.descripcion || '').trim();
  if (!descripcion) {
    throw new Error('La descripción de la incidencia es obligatoria');
  }

  const rawTipoInc = data.tipo_incidencia_uuid || data.tipo_incidencia_id;
  let tipoIncidenciaUuid = (rawTipoInc && isUuid(rawTipoInc)) ? String(rawTipoInc).trim() : null;
  let tipo = (data.tipo || '').trim();

  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hora = (data.hora || '').trim() || currentHHMM;
  const incUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    if (!tipo) tipo = 'General';
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    const newRecord = {
      id: incUuid,
      uuid: incUuid,
      libro_id: libroUuid,
      libro_uuid: libroUuid,
      tipo_incidencia_id: tipoIncidenciaUuid,
      tipo_incidencia_uuid: tipoIncidenciaUuid,
      descripcion,
      tipo,
      hora,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_incidencias_generales.push(newRecord);
    return newRecord;
  }

  if (tipoIncidenciaUuid) {
    const match = await sql`SELECT uuid, nombre FROM tipo_incidencias WHERE uuid = ${tipoIncidenciaUuid}::uuid LIMIT 1`;
    if (match.length > 0) {
      tipo = match[0].nombre;
    }
  } else if (tipo) {
    const match = await sql`SELECT uuid, nombre FROM tipo_incidencias WHERE LOWER(TRIM(nombre)) = LOWER(${tipo}) LIMIT 1`;
    if (match.length > 0) {
      tipoIncidenciaUuid = match[0].uuid;
      tipo = match[0].nombre;
    }
  }

  if (!tipoIncidenciaUuid) {
    const defaultTi = await sql`SELECT uuid, nombre FROM tipo_incidencias ORDER BY nombre ASC LIMIT 1`;
    if (defaultTi.length > 0) {
      tipoIncidenciaUuid = defaultTi[0].uuid;
      if (!tipo) tipo = defaultTi[0].nombre;
    }
  }

  const res = await sql`
    INSERT INTO libro_incidencias_generales (
      uuid, libro_uuid, tipo_incidencia_uuid, descripcion, tipo, hora
    )
    VALUES (
      ${incUuid}::uuid,
      ${libroUuid}::uuid,
      ${tipoIncidenciaUuid ? sql`${tipoIncidenciaUuid}::uuid` : sql`NULL`},
      ${descripcion}, ${tipo || 'General'}, ${hora}
    )
    RETURNING uuid, libro_uuid, tipo_incidencia_uuid, descripcion, tipo, hora, created_at, updated_at
  `;

  return {
    ...res[0],
    id: res[0].uuid,
    libro_id: res[0].libro_uuid,
    tipo_incidencia_id: res[0].tipo_incidencia_uuid
  };
}

export async function updateLibroIncidenciaGeneralModel(incidenciaId, libroId, data) {
  if (!incidenciaId) throw new Error('ID de incidencia inválido');
  const targetUuid = String(incidenciaId).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID de incidencia inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  const descripcion = data.descripcion !== undefined ? (data.descripcion || '').trim() : null;
  const rawTipoInc = data.tipo_incidencia_uuid !== undefined ? data.tipo_incidencia_uuid : data.tipo_incidencia_id;
  const tipoIncidenciaUuid = (rawTipoInc !== undefined && rawTipoInc && isUuid(rawTipoInc)) ? String(rawTipoInc).trim() : null;

  let tipo = data.tipo !== undefined ? (data.tipo || 'General').trim() : null;
  const hora = data.hora !== undefined ? (data.hora || '').trim() : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    const idx = inMemoryData.libro_incidencias_generales.findIndex(c => 
      String(c.uuid || c.id) === targetUuid
    );
    if (idx !== -1) {
      if (descripcion !== null) inMemoryData.libro_incidencias_generales[idx].descripcion = descripcion;
      if (tipoIncidenciaUuid !== null) {
        inMemoryData.libro_incidencias_generales[idx].tipo_incidencia_uuid = tipoIncidenciaUuid;
        inMemoryData.libro_incidencias_generales[idx].tipo_incidencia_id = tipoIncidenciaUuid;
      }
      if (tipo !== null) inMemoryData.libro_incidencias_generales[idx].tipo = tipo;
      if (hora !== null) inMemoryData.libro_incidencias_generales[idx].hora = hora;
      inMemoryData.libro_incidencias_generales[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_incidencias_generales[idx];
    }
    throw new Error('Incidencia no encontrada');
  }

  const rows = await sql`
    UPDATE libro_incidencias_generales
    SET 
      descripcion = COALESCE(${descripcion}, descripcion),
      tipo_incidencia_uuid = COALESCE(${tipoIncidenciaUuid ? sql`${tipoIncidenciaUuid}::uuid` : sql`NULL`}, tipo_incidencia_uuid),
      tipo = COALESCE(${tipo}, tipo),
      hora = COALESCE(${hora}, hora),
      updated_at = CURRENT_TIMESTAMP
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
    RETURNING uuid, libro_uuid, tipo_incidencia_uuid, descripcion, tipo, hora, created_at, updated_at
  `;

  return {
    ...rows[0],
    id: rows[0].uuid,
    libro_id: rows[0].libro_uuid,
    tipo_incidencia_id: rows[0].tipo_incidencia_uuid
  };
}

export const updateLibroIncidenciaGeneralHoraModel = updateLibroIncidenciaGeneralModel;

export async function deleteLibroIncidenciaGeneralModel(id, libroId) {
  if (!id) throw new Error('ID de incidencia inválido');
  const targetUuid = String(id).trim();
  if (!isUuid(targetUuid)) throw new Error('UUID inválido');

  const rawLibro = libroId ? String(libroId).trim() : null;
  const libroUuid = rawLibro && isUuid(rawLibro) ? rawLibro : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales.filter(c => 
      String(c.uuid || c.id) !== targetUuid
    );
    return { success: true, id: targetUuid, uuid: targetUuid };
  }

  await sql`
    DELETE FROM libro_incidencias_generales
    WHERE uuid = ${targetUuid}::uuid
      ${libroUuid ? sql`AND libro_uuid = ${libroUuid}::uuid` : sql``}
  `;

  return { success: true, id: targetUuid, uuid: targetUuid };
}

// --- CONTROL DE CLIENTES (CECOM: LIBRO CONTROL DE CLIENTES) ---
export async function getLibroControlClientesModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const isU = isUuid(libroId);
  const targetLibroUuid = isU ? String(libroId).trim() : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    const list = inMemoryData.libro_control_clientes.filter(c => 
      String(c.libro_uuid) === String(libroId) || String(c.libro_id) === String(libroId)
    );
    return list.sort((a, b) => String(b.created_at || b.uuid).localeCompare(String(a.created_at || a.uuid)));
  }

  let resolvedLibroUuid = targetLibroUuid;
  if (!resolvedLibroUuid) {
    const lRow = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroId)} LIMIT 1`;
    if (lRow.length > 0) resolvedLibroUuid = lRow[0].uuid;
  }
  if (!resolvedLibroUuid) return [];

  const rows = await sql`
    SELECT 
      lcc.uuid,
      lcc.uuid AS id,
      lcc.libro_uuid,
      lcc.libro_uuid AS libro_id,
      lcc.cliente_uuid,
      lcc.cliente_uuid AS cliente_id,
      COALESCE(c.nombre, '') AS cliente, 
      lcc.tipo, 
      lcc.monto, 
      lcc.metodo_pago_uuid,
      lcc.metodo_pago_uuid AS metodo_pago_id,
      COALESCE(mp.nombre, 'General') AS metodo,
      COALESCE(mp.color, '#3B82F6') AS metodo_color,
      lcc.hora, 
      COALESCE(lcc.nota, '') AS nota,
      lcc.created_at, 
      lcc.updated_at,
      COALESCE(tc.nombre, 'General') AS tipo_cliente_nombre,
      c.tipo_cliente_uuid,
      c.tipo_cliente_uuid AS tipo_cliente_id
    FROM libro_control_clientes lcc
    LEFT JOIN clientes c ON lcc.cliente_uuid = c.uuid
    LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
    LEFT JOIN metodos_pago mp ON lcc.metodo_pago_uuid = mp.uuid
    WHERE lcc.libro_uuid = ${resolvedLibroUuid}::uuid
      AND (lcc.is_deleted IS FALSE OR lcc.is_deleted IS NULL)
    ORDER BY lcc.created_at DESC, lcc.uuid DESC
  `;

  return rows;
}

export async function getClientesSugerenciasModel(query = '', options = {}) {
  const cleanQ = (query || '').trim().toLowerCase();
  const salaIdRaw = options.salaId || options.sala_id || options.sala_uuid;
  const libroIdRaw = options.libroId || options.libro_id || options.libro_uuid;

  if (!isPgConnected || !sql) {
    inMemoryData.clientes = inMemoryData.clientes || [];
    let all = inMemoryData.clientes.map(c => ({
      id: c.uuid || c.id,
      uuid: c.uuid,
      nombre: c.nombre,
      tipo_cliente_nombre: '',
      sala_id: c.sala_uuid || c.sala_id,
      sala_uuid: c.sala_uuid
    }));
    if (salaIdRaw) all = all.filter(c => String(c.sala_uuid) === String(salaIdRaw) || String(c.sala_id) === String(salaIdRaw));
    if (cleanQ) all = all.filter(c => c.nombre.toLowerCase().includes(cleanQ));
    return all.slice(0, 30);
  }

  let resolvedSalaUuid = null;
  if (salaIdRaw && isUuid(salaIdRaw)) {
    resolvedSalaUuid = String(salaIdRaw).trim();
  } else if (libroIdRaw && isUuid(libroIdRaw)) {
    const lib = await sql`
      SELECT sala_uuid FROM libros 
      WHERE uuid = ${libroIdRaw}::uuid 
      LIMIT 1
    `;
    if (lib.length > 0) {
      resolvedSalaUuid = lib[0].sala_uuid;
    }
  }

  let rows;
  if (resolvedSalaUuid) {
    rows = await sql`
      SELECT c.uuid, c.uuid AS id, c.nombre, c.sala_uuid, c.sala_uuid AS sala_id, c.tipo_cliente_uuid, c.tipo_cliente_uuid AS tipo_cliente_id, COALESCE(tc.nombre, 'General') AS tipo_cliente_nombre
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
      WHERE c.sala_uuid = ${resolvedSalaUuid}::uuid
        AND (c.is_deleted IS FALSE OR c.is_deleted IS NULL)
        ${cleanQ ? sql`AND (LOWER(c.nombre) LIKE ${`%${cleanQ}%`} OR LOWER(COALESCE(tc.nombre, '')) LIKE ${`%${cleanQ}%`})` : sql``}
      ORDER BY c.nombre ASC
      LIMIT 30
    `;
  } else {
    rows = await sql`
      SELECT c.uuid, c.uuid AS id, c.nombre, c.sala_uuid, c.sala_uuid AS sala_id, c.tipo_cliente_uuid, c.tipo_cliente_uuid AS tipo_cliente_id, COALESCE(tc.nombre, 'General') AS tipo_cliente_nombre
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
      WHERE (c.is_deleted IS FALSE OR c.is_deleted IS NULL)
        ${cleanQ ? sql`AND (LOWER(c.nombre) LIKE ${`%${cleanQ}%`} OR LOWER(COALESCE(tc.nombre, '')) LIKE ${`%${cleanQ}%`})` : sql``}
      ORDER BY c.nombre ASC
      LIMIT 30
    `;
  }

  return rows.map(r => ({
    id: r.uuid,
    uuid: r.uuid,
    nombre: r.nombre,
    tipo_cliente_id: r.tipo_cliente_uuid,
    tipo_cliente_uuid: r.tipo_cliente_uuid,
    tipo_cliente_nombre: r.tipo_cliente_nombre || 'General',
    sala_id: r.sala_uuid,
    sala_uuid: r.sala_uuid
  }));
}

export async function createLibroControlClienteModel(data) {
  const libroIdRaw = data.libro_uuid || data.libro_id;
  if (!libroIdRaw) throw new Error('ID de libro inválido');

  const isLibU = isUuid(libroIdRaw);
  let libroUuid = isLibU ? String(libroIdRaw).trim() : null;

  if (!libroUuid && sql && isPgConnected) {
    const lRow = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroIdRaw)} LIMIT 1`;
    if (lRow.length > 0) libroUuid = lRow[0].uuid;
  }
  if (!libroUuid) throw new Error('Libro no encontrado');

  const clienteNombre = (data.cliente || '').trim();
  const clienteIdRaw = data.cliente_uuid || data.cliente_id;
  const isCliU = isUuid(clienteIdRaw);
  let clienteUuid = isCliU ? String(clienteIdRaw).trim() : null;

  if (!clienteUuid && !clienteNombre) {
    throw new Error('El nombre del cliente es obligatorio');
  }

  // Resolver salaUuid del libro
  let resolvedSalaUuid = null;
  if (sql && isPgConnected) {
    const lib = await sql`
      SELECT uuid, sala_uuid FROM libros 
      WHERE uuid = ${libroUuid}::uuid 
      LIMIT 1
    `;
    if (lib.length > 0) {
      resolvedSalaUuid = lib[0].sala_uuid;
    }
  }

  // Si no viene clienteUuid pero viene clienteNombre, buscar si existe o crearlo automáticamente
  if (!clienteUuid && clienteNombre && sql && isPgConnected) {
    const existing = await sql`
      SELECT uuid FROM clientes 
      WHERE LOWER(TRIM(nombre)) = LOWER(${clienteNombre}) 
        ${resolvedSalaUuid ? sql`AND sala_uuid = ${resolvedSalaUuid}::uuid` : sql``}
        AND (is_deleted IS FALSE OR is_deleted IS NULL)
      LIMIT 1
    `;
    if (existing.length > 0) {
      clienteUuid = existing[0].uuid;
    } else {
      const defTipo = await sql`SELECT uuid FROM tipo_clientes WHERE is_deleted IS FALSE OR is_deleted IS NULL ORDER BY nombre ASC LIMIT 1`;
      const defTipoUuid = defTipo.length > 0 ? defTipo[0].uuid : null;
      const newClientUuid = crypto.randomUUID();
      const newClient = await sql`
        INSERT INTO clientes (uuid, nombre, tipo_cliente_uuid, sala_uuid)
        VALUES (
          ${newClientUuid}::uuid,
          ${clienteNombre},
          ${defTipoUuid ? sql`${defTipoUuid}::uuid` : sql`NULL`},
          ${resolvedSalaUuid ? sql`${resolvedSalaUuid}::uuid` : sql`NULL`}
        )
        RETURNING uuid
      `;
      clienteUuid = newClient[0].uuid;
    }
  }

  const tipo = (data.tipo || 'Compra').trim();
  const monto = parseFloat(data.monto) || 0;
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0');

  // Resolver metodo_pago_uuid
  const metodoPagoRaw = data.metodo_pago_uuid || data.metodo_pago_id;
  const isMetU = isUuid(metodoPagoRaw);
  let metodoPagoUuid = isMetU ? String(metodoPagoRaw).trim() : null;
  const metodoNombre = (data.metodo || '').trim();

  if (!metodoPagoUuid && metodoNombre && sql && isPgConnected) {
    const mRow = await sql`
      SELECT uuid FROM metodos_pago 
      WHERE LOWER(TRIM(nombre)) = LOWER(${metodoNombre}) 
      LIMIT 1
    `;
    if (mRow.length > 0) {
      metodoPagoUuid = mRow[0].uuid;
    }
  }
  if (!metodoPagoUuid && sql && isPgConnected) {
    const firstM = await sql`SELECT uuid FROM metodos_pago WHERE is_deleted IS FALSE OR is_deleted IS NULL ORDER BY nombre ASC LIMIT 1`;
    if (firstM.length > 0) {
      metodoPagoUuid = firstM[0].uuid;
    }
  }

  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hora = (data.hora || '').trim() || currentHHMM;
  const nota = (data.nota || '').trim();
  const lccUuid = (data.uuid && isUuid(data.uuid)) ? data.uuid : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    const newRecord = {
      id: lccUuid,
      uuid: lccUuid,
      libro_id: libroUuid,
      libro_uuid: libroUuid,
      cliente_id: clienteUuid,
      cliente_uuid: clienteUuid,
      cliente: clienteNombre,
      tipo,
      monto,
      metodo_pago_id: metodoPagoUuid,
      metodo_pago_uuid: metodoPagoUuid,
      metodo: metodoNombre || 'General',
      hora,
      nota,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_control_clientes.unshift(newRecord);
    return newRecord;
  }

  const res = await sql`
    INSERT INTO libro_control_clientes (
      uuid,
      libro_uuid,
      cliente_uuid,
      tipo,
      monto,
      metodo_pago_uuid,
      hora,
      nota
    )
    VALUES (
      ${lccUuid}::uuid,
      ${libroUuid}::uuid,
      ${clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`},
      ${tipo},
      ${monto},
      ${metodoPagoUuid ? sql`${metodoPagoUuid}::uuid` : sql`NULL`},
      ${hora},
      ${nota}
    )
    RETURNING 
      uuid, uuid AS id, 
      libro_uuid, libro_uuid AS libro_id, 
      cliente_uuid, cliente_uuid AS cliente_id, 
      tipo, monto, 
      metodo_pago_uuid, metodo_pago_uuid AS metodo_pago_id, 
      hora, nota, created_at, updated_at
  `;

  let clientInfo = null;
  if (clienteUuid) {
    const cRows = await sql`
      SELECT c.nombre AS cliente, tc.nombre AS tipo_cliente_nombre, c.tipo_cliente_uuid, c.tipo_cliente_uuid AS tipo_cliente_id
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
      WHERE c.uuid = ${clienteUuid}::uuid
      LIMIT 1
    `;
    if (cRows.length > 0) clientInfo = cRows[0];
  }

  let metodoInfo = null;
  if (metodoPagoUuid) {
    const mRows = await sql`
      SELECT nombre, COALESCE(color, '#3B82F6') AS color 
      FROM metodos_pago 
      WHERE uuid = ${metodoPagoUuid}::uuid
      LIMIT 1
    `;
    if (mRows.length > 0) metodoInfo = mRows[0];
  }

  return {
    ...res[0],
    cliente: clientInfo ? clientInfo.cliente : clienteNombre,
    tipo_cliente_nombre: clientInfo ? clientInfo.tipo_cliente_nombre : 'General',
    tipo_cliente_id: clientInfo ? clientInfo.tipo_cliente_uuid : null,
    tipo_cliente_uuid: clientInfo ? clientInfo.tipo_cliente_uuid : null,
    metodo: metodoInfo ? metodoInfo.nombre : (metodoNombre || 'General'),
    metodo_color: metodoInfo ? metodoInfo.color : '#3B82F6',
    metodo_pago_id: metodoPagoUuid,
    metodo_pago_uuid: metodoPagoUuid
  };
}

export async function updateLibroControlClienteModel(controlId, libroId, data) {
  if (!controlId) throw new Error('ID de registro inválido');
  const isCtrlU = isUuid(controlId);
  const targetControlUuid = isCtrlU ? String(controlId).trim() : null;
  const isLibU = isUuid(libroId);
  const targetLibroUuid = isLibU ? String(libroId).trim() : null;

  if (!targetControlUuid) throw new Error('ID de registro debe ser UUID válido');

  const hora = (data.hora || '').trim();
  if (!hora) throw new Error('La hora es obligatoria');

  const metodoPagoRaw = data.metodo_pago_uuid || data.metodo_pago_id;
  const isMetU = isUuid(metodoPagoRaw);
  let metodoPagoUuid = isMetU ? String(metodoPagoRaw).trim() : (metodoPagoRaw === null ? null : undefined);
  const metodoNombre = data.metodo !== undefined ? String(data.metodo).trim() : undefined;

  if (metodoPagoUuid === undefined && metodoNombre && sql && isPgConnected) {
    const mRow = await sql`
      SELECT uuid FROM metodos_pago 
      WHERE LOWER(TRIM(nombre)) = LOWER(${metodoNombre}) 
      LIMIT 1
    `;
    if (mRow.length > 0) {
      metodoPagoUuid = mRow[0].uuid;
    }
  }

  const clienteIdRaw = data.cliente_uuid || data.cliente_id;
  const isCliU = isUuid(clienteIdRaw);
  let clienteUuid = isCliU ? String(clienteIdRaw).trim() : (clienteIdRaw === null ? null : undefined);
  const clienteNombre = data.cliente !== undefined ? String(data.cliente).trim() : undefined;

  // Si clienteNombre viene pero no clienteUuid, resolver o crear
  if (clienteNombre && !clienteUuid && sql && isPgConnected) {
    let resolvedSalaUuid = null;
    if (targetLibroUuid) {
      const lib = await sql`
        SELECT sala_uuid FROM libros 
        WHERE uuid = ${targetLibroUuid}::uuid 
        LIMIT 1
      `;
      if (lib.length > 0) {
        resolvedSalaUuid = lib[0].sala_uuid;
      }
    }
    const existing = await sql`
      SELECT uuid FROM clientes 
      WHERE LOWER(TRIM(nombre)) = LOWER(${clienteNombre}) 
        ${resolvedSalaUuid ? sql`AND sala_uuid = ${resolvedSalaUuid}::uuid` : sql``}
        AND (is_deleted IS FALSE OR is_deleted IS NULL)
      LIMIT 1
    `;
    if (existing.length > 0) {
      clienteUuid = existing[0].uuid;
    } else {
      const defTipo = await sql`SELECT uuid FROM tipo_clientes WHERE is_deleted IS FALSE OR is_deleted IS NULL ORDER BY nombre ASC LIMIT 1`;
      const defTipoUuid = defTipo.length > 0 ? defTipo[0].uuid : null;
      const newClientUuid = crypto.randomUUID();
      const newClient = await sql`
        INSERT INTO clientes (uuid, nombre, tipo_cliente_uuid, sala_uuid)
        VALUES (
          ${newClientUuid}::uuid,
          ${clienteNombre},
          ${defTipoUuid ? sql`${defTipoUuid}::uuid` : sql`NULL`},
          ${resolvedSalaUuid ? sql`${resolvedSalaUuid}::uuid` : sql`NULL`}
        )
        RETURNING uuid
      `;
      clienteUuid = newClient[0].uuid;
    }
  }

  const nota = data.nota !== undefined ? String(data.nota).trim() : undefined;
  const tipo = data.tipo !== undefined ? (String(data.tipo).trim() || 'Compra') : undefined;
  const monto = data.monto !== undefined && data.monto !== '' ? Number(data.monto) : undefined;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    const idx = inMemoryData.libro_control_clientes.findIndex(c => 
      String(c.uuid) === String(controlId) || String(c.id) === String(controlId)
    );
    if (idx !== -1) {
      inMemoryData.libro_control_clientes[idx].hora = hora;
      if (metodoPagoUuid !== undefined) {
        inMemoryData.libro_control_clientes[idx].metodo_pago_uuid = metodoPagoUuid;
        inMemoryData.libro_control_clientes[idx].metodo_pago_id = metodoPagoUuid;
      }
      if (metodoNombre !== undefined) inMemoryData.libro_control_clientes[idx].metodo = metodoNombre;
      if (clienteUuid !== undefined) {
        inMemoryData.libro_control_clientes[idx].cliente_uuid = clienteUuid;
        inMemoryData.libro_control_clientes[idx].cliente_id = clienteUuid;
      }
      if (clienteNombre !== undefined) inMemoryData.libro_control_clientes[idx].cliente = clienteNombre;
      if (tipo !== undefined) inMemoryData.libro_control_clientes[idx].tipo = tipo;
      if (monto !== undefined && !isNaN(monto)) inMemoryData.libro_control_clientes[idx].monto = monto;
      if (nota !== undefined) inMemoryData.libro_control_clientes[idx].nota = nota;
      inMemoryData.libro_control_clientes[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_control_clientes[idx];
    }
    throw new Error('Registro no encontrado');
  }

  const rows = await sql`
    UPDATE libro_control_clientes
    SET 
      hora = ${hora},
      metodo_pago_uuid = ${metodoPagoUuid !== undefined ? (metodoPagoUuid ? sql`${metodoPagoUuid}::uuid` : sql`NULL`) : sql`metodo_pago_uuid`},
      cliente_uuid = ${clienteUuid !== undefined ? (clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`) : sql`cliente_uuid`},
      tipo = ${tipo !== undefined ? tipo : sql`tipo`},
      monto = ${monto !== undefined && !isNaN(monto) ? monto : sql`monto`},
      nota = ${nota !== undefined ? nota : sql`nota`},
      updated_at = CURRENT_TIMESTAMP
    WHERE uuid = ${targetControlUuid}::uuid
      ${targetLibroUuid ? sql`AND libro_uuid = ${targetLibroUuid}::uuid` : sql``}
    RETURNING 
      uuid, uuid AS id, 
      libro_uuid, libro_uuid AS libro_id, 
      cliente_uuid, cliente_uuid AS cliente_id, 
      tipo, monto, 
      metodo_pago_uuid, metodo_pago_uuid AS metodo_pago_id, 
      hora, nota, created_at, updated_at
  `;

  if (!rows || rows.length === 0) {
    throw new Error('Registro no encontrado');
  }

  const updatedRecord = rows[0];
  let clientInfo = null;
  if (updatedRecord.cliente_uuid) {
    const cRows = await sql`
      SELECT c.nombre AS cliente, tc.nombre AS tipo_cliente_nombre, c.tipo_cliente_uuid, c.tipo_cliente_uuid AS tipo_cliente_id
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
      WHERE c.uuid = ${updatedRecord.cliente_uuid}::uuid
      LIMIT 1
    `;
    if (cRows.length > 0) clientInfo = cRows[0];
  }

  let metodoInfo = null;
  if (updatedRecord.metodo_pago_uuid) {
    const mRows = await sql`
      SELECT nombre, COALESCE(color, '#3B82F6') AS color 
      FROM metodos_pago 
      WHERE uuid = ${updatedRecord.metodo_pago_uuid}::uuid
      LIMIT 1
    `;
    if (mRows.length > 0) metodoInfo = mRows[0];
  }

  return {
    ...updatedRecord,
    cliente: clientInfo ? clientInfo.cliente : (clienteNombre || ''),
    tipo_cliente_nombre: clientInfo ? clientInfo.tipo_cliente_nombre : '',
    tipo_cliente_id: clientInfo ? clientInfo.tipo_cliente_uuid : null,
    tipo_cliente_uuid: clientInfo ? clientInfo.tipo_cliente_uuid : null,
    metodo: metodoInfo ? metodoInfo.nombre : (metodoNombre || 'General'),
    metodo_color: metodoInfo ? metodoInfo.color : '#3B82F6',
    metodo_pago_id: updatedRecord.metodo_pago_uuid,
    metodo_pago_uuid: updatedRecord.metodo_pago_uuid
  };
}

export async function deleteLibroControlClienteModel(id, libroId) {
  if (!id) throw new Error('ID de registro inválido');
  const isU = isUuid(id);
  const targetUuid = isU ? String(id).trim() : null;
  const isLibU = isUuid(libroId);
  const targetLibroUuid = isLibU ? String(libroId).trim() : null;

  if (!targetUuid) throw new Error('ID de registro debe ser UUID válido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes.filter(c => 
      String(c.uuid) !== String(id) && String(c.id) !== String(id)
    );
    return { success: true, id, uuid: id };
  }

  await sql`
    DELETE FROM libro_control_clientes
    WHERE uuid = ${targetUuid}::uuid
      ${targetLibroUuid ? sql`AND libro_uuid = ${targetLibroUuid}::uuid` : sql``}
  `;

  return { success: true, id: targetUuid, uuid: targetUuid };
}


// --- CLIENTES (CECOM / GESTIÓN DE CLIENTES) ---
export function buildClienteConditions(options = {}) {
  const conds = [];

  if (options.userSalaIds && options.userSalaIds.length > 0) {
    const uuidIds = options.userSalaIds.filter(x => isUuid(x));
    if (uuidIds.length > 0) {
      conds.push(sql`c.sala_uuid = ANY(${uuidIds}::uuid[])`);
    }
  }

  if (options.salaIds && options.salaIds.length > 0) {
    const uuidIds = options.salaIds.filter(x => isUuid(x));
    if (uuidIds.length > 0) {
      conds.push(sql`c.sala_uuid = ANY(${uuidIds}::uuid[])`);
    }
  }

  if (options.tipoClienteIds && options.tipoClienteIds.length > 0) {
    const uuidIds = options.tipoClienteIds.filter(x => isUuid(x));
    if (uuidIds.length > 0) {
      conds.push(sql`c.tipo_cliente_uuid = ANY(${uuidIds}::uuid[])`);
    }
  }

  if (options.search) {
    const s = `%${options.search}%`;
    conds.push(sql`(
      LOWER(c.nombre) LIKE ${s} OR 
      LOWER(COALESCE(c.descripcion, '')) LIKE ${s} OR 
      LOWER(COALESCE(tc.nombre, '')) LIKE ${s} OR 
      LOWER(COALESCE(s.nombre, '')) LIKE ${s} OR 
      c.uuid::text LIKE ${s}
    )`);
  }

  conds.push(sql`(c.is_deleted IS FALSE OR c.is_deleted IS NULL)`);

  return conds;
}

export async function getClientesModel(params = {}) {
  if (!isPgConnected || !sql) {
    inMemoryData.clientes = inMemoryData.clientes || [];
    return { success: true, data: inMemoryData.clientes, total: inMemoryData.clientes.length, page: 1, limit: 10, totalPages: 1 };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy || 'nombre';
  const sortDir = (params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => s.trim()).filter(Boolean);
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => s.trim()).filter(Boolean);
  }
  let tipoClienteIds = null;
  if (params.tipo_cliente_ids) {
    tipoClienteIds = String(params.tipo_cliente_ids).split(',').map(s => s.trim()).filter(Boolean);
  }

  const conds = buildClienteConditions({
    userSalaIds,
    salaIds,
    tipoClienteIds,
    active: params.active,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'c.created_at',
    'uuid': 'c.created_at',
    'created_at': 'c.created_at',
    'nombre': 'c.nombre',
    'tipo_cliente_nombre': 'tc.nombre',
    'sala_nombre': 's.nombre',
    'descripcion': 'c.descripcion'
  };
  const orderCol = allowedSortColumns[sortBy] || 'c.created_at';
  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, c.created_at DESC, c.uuid DESC`);

  const countRes = await sql`
    SELECT COUNT(c.uuid)::int AS total
    FROM clientes c
    LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
    LEFT JOIN salas s ON c.sala_uuid = s.uuid
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT c.uuid, c.uuid AS id, c.nombre, c.tipo_cliente_uuid, c.tipo_cliente_uuid AS tipo_cliente_id, c.sala_uuid, c.sala_uuid AS sala_id, c.foto, c.descripcion,
             to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
             to_char(COALESCE(c.updated_at, c.created_at), 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
             tc.nombre AS tipo_cliente_nombre,
             s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
      LEFT JOIN salas s ON c.sala_uuid = s.uuid
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT c.uuid, c.uuid AS id, c.nombre, c.tipo_cliente_uuid, c.tipo_cliente_uuid AS tipo_cliente_id, c.sala_uuid, c.sala_uuid AS sala_id, c.foto, c.descripcion,
             to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
             to_char(COALESCE(c.updated_at, c.created_at), 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
             tc.nombre AS tipo_cliente_nombre,
             s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_uuid = tc.uuid
      LEFT JOIN salas s ON c.sala_uuid = s.uuid
      ${where}
      ${orderClause}
    `;
  }

  return {
    success: true,
    data,
    total,
    page,
    limit: limit > 0 ? limit : total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 1
  };
}

export async function getClientesFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return { success: true, data: { salas: [], tipo_clientes: [] } };
  }

  const userSalaIds = options.userSalaIds || [];
  let allSalas;
  if (userSalaIds.length > 0) {
    const uuidIds = userSalaIds.filter(x => isUuid(x));
    if (uuidIds.length > 0) {
      allSalas = await sql`SELECT uuid, uuid AS id, nombre FROM salas WHERE uuid = ANY(${uuidIds}::uuid[]) ORDER BY nombre ASC`;
    } else {
      allSalas = await sql`SELECT uuid, uuid AS id, nombre FROM salas ORDER BY nombre ASC`;
    }
  } else {
    allSalas = await sql`SELECT uuid, uuid AS id, nombre FROM salas ORDER BY nombre ASC`;
  }

  const countsSalasRes = await sql`
    SELECT c.sala_uuid AS uuid, COUNT(c.uuid)::int AS count
    FROM clientes c
    WHERE c.sala_uuid IS NOT NULL AND (c.is_deleted IS FALSE OR c.is_deleted IS NULL)
    GROUP BY c.sala_uuid
  `;
  const countSalasMap = new Map();
  countsSalasRes.forEach(r => {
    if (r.uuid) countSalasMap.set(String(r.uuid), r.count);
  });
  const salas = allSalas.map(s => ({
    id: s.uuid,
    uuid: s.uuid,
    nombre: s.nombre,
    count: countSalasMap.get(String(s.uuid)) || 0
  }));

  const allTipos = await sql`SELECT uuid, uuid AS id, nombre FROM tipo_clientes WHERE (is_deleted IS FALSE OR is_deleted IS NULL) ORDER BY nombre ASC`;
  const countsTiposRes = await sql`
    SELECT c.tipo_cliente_uuid AS uuid, COUNT(c.uuid)::int AS count
    FROM clientes c
    WHERE c.tipo_cliente_uuid IS NOT NULL AND (c.is_deleted IS FALSE OR c.is_deleted IS NULL)
    GROUP BY c.tipo_cliente_uuid
  `;
  const countTiposMap = new Map();
  countsTiposRes.forEach(r => {
    if (r.uuid) countTiposMap.set(String(r.uuid), r.count);
  });
  const tipo_clientes = allTipos.map(t => ({
    id: t.uuid,
    uuid: t.uuid,
    nombre: t.nombre,
    count: countTiposMap.get(String(t.uuid)) || 0
  }));

  return {
    success: true,
    data: {
      salas,
      tipo_clientes
    }
  };
}

function resolveClientesDir() {
  const candidates = [
    path.join(process.cwd(), 'clientes'),
    path.join(process.cwd(), 'backend-fastify', 'clientes'),
    path.resolve(__dirname, '../../clientes'),
    path.resolve(__dirname, '../clientes'),
    '/var/www/wisi/backend-fastify/clientes',
    '/var/www/wisi/clientes'
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const fallback = path.join(process.cwd(), 'clientes');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch (e) {}
  return fallback;
}

function invalidateClienteThumbnails(cId) {
  if (!cId) return;
  try {
    const candidateCacheDirs = [
      path.join(process.cwd(), 'cache', 'thumbs'),
      path.join(process.cwd(), 'backend-fastify', 'cache', 'thumbs'),
      '/var/www/wisi/backend-fastify/cache/thumbs',
      '/var/www/wisi/cache/thumbs'
    ];
    for (const cDir of candidateCacheDirs) {
      if (fs.existsSync(cDir)) {
        const files = fs.readdirSync(cDir);
        for (const file of files) {
          if (file.startsWith(`cliente_${cId}_`) || file.startsWith(`${cId}_`)) {
            try { fs.unlinkSync(path.join(cDir, file)); } catch (e) {}
          }
        }
      }
    }
  } catch (e) {}
}

export async function createClienteModel(data) {
  const nombre = (data.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del cliente es obligatorio');

  const tipoClienteRaw = data.tipo_cliente_uuid || data.tipo_cliente_id;
  const tipoClienteUuid = (tipoClienteRaw && isUuid(tipoClienteRaw)) ? String(tipoClienteRaw).trim() : null;

  const salaRaw = data.sala_uuid || data.sala_id;
  const salaUuid = (salaRaw && isUuid(salaRaw)) ? String(salaRaw).trim() : null;

  const descripcion = data.descripcion !== undefined ? (data.descripcion ? String(data.descripcion).trim() : null) : null;
  const clientUuid = (data.uuid && isUuid(data.uuid)) ? String(data.uuid).trim() : crypto.randomUUID();

  let foto = data.foto || null;
  if (data.fotoBase64) {
    try {
      const isWebp = data.fotoBase64.startsWith('data:image/webp');
      const photoExt = isWebp ? '.webp' : '.jpg';
      const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const dir = resolveClientesDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${clientUuid}${photoExt}`), buffer);
      foto = `/clientes/${clientUuid}${photoExt}`;
      invalidateClienteThumbnails(clientUuid);
    } catch (e) {
      console.error('Error guardando foto de cliente:', e);
    }
  }

  if (isPgConnected && sql) {
    const res = await sql`
      INSERT INTO clientes (uuid, nombre, tipo_cliente_uuid, sala_uuid, foto, descripcion)
      VALUES (
        ${clientUuid}::uuid,
        ${nombre},
        ${tipoClienteUuid ? sql`${tipoClienteUuid}::uuid` : sql`NULL`},
        ${salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`},
        ${foto},
        ${descripcion}
      )
      RETURNING uuid, uuid AS id, nombre, tipo_cliente_uuid, tipo_cliente_uuid AS tipo_cliente_id, sala_uuid, sala_uuid AS sala_id, foto, descripcion, created_at, updated_at
    `;
    return res[0];
  } else {
    inMemoryData.clientes = inMemoryData.clientes || [];
    const newItem = { 
      id: clientUuid, 
      uuid: clientUuid,
      nombre, 
      tipo_cliente_id: tipoClienteUuid, 
      tipo_cliente_uuid: tipoClienteUuid,
      sala_id: salaUuid, 
      sala_uuid: salaUuid,
      foto, 
      descripcion, 
      created_at: new Date().toISOString(), 
      updated_at: new Date().toISOString() 
    };
    inMemoryData.clientes.unshift(newItem);
    return newItem;
  }
}

export async function updateClienteModel(id, data) {
  if (!id) throw new Error('ID de cliente inválido');
  const isU = isUuid(id);
  const targetUuid = isU ? String(id).trim() : (data.uuid && isUuid(data.uuid) ? String(data.uuid).trim() : null);
  if (!targetUuid) throw new Error('ID de cliente debe ser un UUID válido');

  const nombre = data.nombre !== undefined ? String(data.nombre).trim() : undefined;
  
  let tipoClienteUuid = undefined;
  if (data.tipo_cliente_uuid !== undefined) {
    tipoClienteUuid = data.tipo_cliente_uuid && isUuid(data.tipo_cliente_uuid) ? String(data.tipo_cliente_uuid).trim() : null;
  } else if (data.tipo_cliente_id !== undefined) {
    tipoClienteUuid = data.tipo_cliente_id && isUuid(data.tipo_cliente_id) ? String(data.tipo_cliente_id).trim() : null;
  }

  let salaUuid = undefined;
  if (data.sala_uuid !== undefined) {
    salaUuid = data.sala_uuid && isUuid(data.sala_uuid) ? String(data.sala_uuid).trim() : null;
  } else if (data.sala_id !== undefined) {
    salaUuid = data.sala_id && isUuid(data.sala_id) ? String(data.sala_id).trim() : null;
  }

  const descripcion = data.descripcion !== undefined ? (data.descripcion ? String(data.descripcion).trim() : null) : undefined;

  let foto = data.foto;
  if (data.fotoBase64) {
    try {
      const isWebp = data.fotoBase64.startsWith('data:image/webp');
      const photoExt = isWebp ? '.webp' : '.jpg';
      const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const dir = resolveClientesDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filename = `${targetUuid}${photoExt}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      foto = `/clientes/${filename}`;
      invalidateClienteThumbnails(targetUuid);
    } catch (e) {
      console.error('Error actualizando foto de cliente:', e);
    }
  } else if (data.removeFoto) {
    foto = null;
    try {
      const dir = resolveClientesDir();
      const filePathJ = path.join(dir, `${targetUuid}.jpg`);
      if (fs.existsSync(filePathJ)) fs.unlinkSync(filePathJ);
      const filePathW = path.join(dir, `${targetUuid}.webp`);
      if (fs.existsSync(filePathW)) fs.unlinkSync(filePathW);
      invalidateClienteThumbnails(targetUuid);
    } catch (e) {}
  }

  if (isPgConnected && sql) {
    const res = await sql`
      UPDATE clientes
      SET
        nombre = COALESCE(${nombre}, nombre),
        tipo_cliente_uuid = ${tipoClienteUuid !== undefined ? (tipoClienteUuid ? sql`${tipoClienteUuid}::uuid` : sql`NULL`) : sql`tipo_cliente_uuid`},
        sala_uuid = ${salaUuid !== undefined ? (salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`) : sql`sala_uuid`},
        foto = ${foto !== undefined ? foto : sql`foto`},
        descripcion = ${descripcion !== undefined ? descripcion : sql`descripcion`},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${targetUuid}::uuid
      RETURNING uuid, uuid AS id, nombre, tipo_cliente_uuid, tipo_cliente_uuid AS tipo_cliente_id, sala_uuid, sala_uuid AS sala_id, foto, descripcion, created_at, updated_at
    `;
    if (!res || res.length === 0) throw new Error('Cliente no encontrado');
    return res[0];
  } else {
    inMemoryData.clientes = inMemoryData.clientes || [];
    const idx = inMemoryData.clientes.findIndex(c => 
      String(c.uuid) === String(targetUuid) || String(c.id) === String(targetUuid)
    );
    if (idx !== -1) {
      inMemoryData.clientes[idx] = { 
        ...inMemoryData.clientes[idx], 
        ...data, 
        ...(foto !== undefined ? { foto } : {}),
        ...(descripcion !== undefined ? { descripcion } : {}),
        updated_at: new Date().toISOString() 
      };
      return inMemoryData.clientes[idx];
    }
    throw new Error('Cliente no encontrado');
  }
}

export async function deleteClienteModel(id) {
  const result = await deleteEntityDynamic('clientes', 'cliente', id);
  if (result && (result.success || result.id || result.uuid)) {
    try {
      const dir = resolveClientesDir();
      const targetUuid = result.uuid || (isUuid(id) ? id : null);
      if (targetUuid) {
        const filePathU = path.join(dir, `${targetUuid}.jpg`);
        if (fs.existsSync(filePathU)) fs.unlinkSync(filePathU);
        invalidateClienteThumbnails(targetUuid);
      }
    } catch (e) {}
  }
  return result;
}

// --- DATOS DEL LIBRO (CECOM: LIBRO DATOS OPERATIVOS) ---
export async function getLibroDatosModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const isLibU = isUuid(libroId);
  const targetLibroUuid = isLibU ? String(libroId).trim() : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_datos = inMemoryData.libro_datos || [];
    const found = inMemoryData.libro_datos.find(d => 
      String(d.libro_uuid) === String(libroId) || String(d.libro_id) === String(libroId)
    );
    return found || null;
  }

  let resolvedLibroUuid = targetLibroUuid;
  if (!resolvedLibroUuid) {
    const lRow = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroId)} LIMIT 1`;
    if (lRow.length > 0) resolvedLibroUuid = lRow[0].uuid;
  }
  if (!resolvedLibroUuid) return null;

  const rows = await sql`
    SELECT 
      uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id,
      apertura_sala_inicio, apertura_sala_fin,
      apertura_maquinas_inicio, apertura_maquinas_fin,
      apertura_bingo_inicio, apertura_bingo_fin,
      retiros_dropbox_inicio, retiros_dropbox_fin,
      conteo_dropbox_inicio, conteo_dropbox_fin,
      operador_turno_a, operador_turno_c,
      created_at, updated_at
    FROM libro_datos
    WHERE libro_uuid = ${resolvedLibroUuid}::uuid
      AND (is_deleted IS FALSE OR is_deleted IS NULL)
    LIMIT 1
  `;

  return rows.length > 0 ? rows[0] : null;
}

export async function saveLibroDatosModel(libroId, data) {
  if (!libroId) throw new Error('ID de libro inválido');
  const isLibU = isUuid(libroId);
  let resolvedLibroUuid = isLibU ? String(libroId).trim() : null;

  if (isPgConnected && sql) {
    if (!resolvedLibroUuid) {
      const lRows = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroId)} LIMIT 1`;
      if (lRows.length > 0) resolvedLibroUuid = lRows[0].uuid;
    }
  }
  if (!resolvedLibroUuid) throw new Error('Libro no encontrado');

  const aperturaSalaInicio = (data.apertura_sala_inicio || '').trim() || null;
  const aperturaSalaFin = (data.apertura_sala_fin || '').trim() || null;
  const aperturaMaquinasInicio = (data.apertura_maquinas_inicio || '').trim() || null;
  const aperturaMaquinasFin = (data.apertura_maquinas_fin || '').trim() || null;
  const aperturaBingoInicio = (data.apertura_bingo_inicio || '').trim() || null;
  const aperturaBingoFin = (data.apertura_bingo_fin || '').trim() || null;
  const retirosDropboxInicio = (data.retiros_dropbox_inicio || '').trim() || null;
  const retirosDropboxFin = (data.retiros_dropbox_fin || '').trim() || null;
  const conteoDropboxInicio = (data.conteo_dropbox_inicio || '').trim() || null;
  const conteoDropboxFin = (data.conteo_dropbox_fin || '').trim() || null;
  const operadorTurnoA = (data.operador_turno_a || '').trim() || null;
  const operadorTurnoC = (data.operador_turno_c || '').trim() || null;
  const datosUuid = (data.uuid && isUuid(data.uuid)) ? String(data.uuid).trim() : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    inMemoryData.libro_datos = inMemoryData.libro_datos || [];
    let idx = inMemoryData.libro_datos.findIndex(d => 
      String(d.libro_uuid) === String(resolvedLibroUuid) || String(d.libro_id) === String(resolvedLibroUuid)
    );
    if (idx !== -1) {
      inMemoryData.libro_datos[idx] = {
        ...inMemoryData.libro_datos[idx],
        apertura_sala_inicio: aperturaSalaInicio,
        apertura_sala_fin: aperturaSalaFin,
        apertura_maquinas_inicio: aperturaMaquinasInicio,
        apertura_maquinas_fin: aperturaMaquinasFin,
        apertura_bingo_inicio: aperturaBingoInicio,
        apertura_bingo_fin: aperturaBingoFin,
        retiros_dropbox_inicio: retirosDropboxInicio,
        retiros_dropbox_fin: retirosDropboxFin,
        conteo_dropbox_inicio: conteoDropboxInicio,
        conteo_dropbox_fin: conteoDropboxFin,
        operador_turno_a: operadorTurnoA,
        operador_turno_c: operadorTurnoC,
        updated_at: new Date().toISOString()
      };
      return inMemoryData.libro_datos[idx];
    } else {
      const newRecord = {
        id: datosUuid,
        uuid: datosUuid,
        libro_id: resolvedLibroUuid,
        libro_uuid: resolvedLibroUuid,
        apertura_sala_inicio: aperturaSalaInicio,
        apertura_sala_fin: aperturaSalaFin,
        apertura_maquinas_inicio: aperturaMaquinasInicio,
        apertura_maquinas_fin: aperturaMaquinasFin,
        apertura_bingo_inicio: aperturaBingoInicio,
        apertura_bingo_fin: aperturaBingoFin,
        retiros_dropbox_inicio: retirosDropboxInicio,
        retiros_dropbox_fin: retirosDropboxFin,
        conteo_dropbox_inicio: conteoDropboxInicio,
        conteo_dropbox_fin: conteoDropboxFin,
        operador_turno_a: operadorTurnoA,
        operador_turno_c: operadorTurnoC,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      inMemoryData.libro_datos.push(newRecord);
      return newRecord;
    }
  }

  const existingRow = await sql`
    SELECT uuid FROM libro_datos
    WHERE libro_uuid = ${resolvedLibroUuid}::uuid
    LIMIT 1
  `;

  let rows;
  if (existingRow.length > 0) {
    rows = await sql`
      UPDATE libro_datos SET
        apertura_sala_inicio = ${aperturaSalaInicio},
        apertura_sala_fin = ${aperturaSalaFin},
        apertura_maquinas_inicio = ${aperturaMaquinasInicio},
        apertura_maquinas_fin = ${aperturaMaquinasFin},
        apertura_bingo_inicio = ${aperturaBingoInicio},
        apertura_bingo_fin = ${aperturaBingoFin},
        retiros_dropbox_inicio = ${retirosDropboxInicio},
        retiros_dropbox_fin = ${retirosDropboxFin},
        conteo_dropbox_inicio = ${conteoDropboxInicio},
        conteo_dropbox_fin = ${conteoDropboxFin},
        operador_turno_a = ${operadorTurnoA},
        operador_turno_c = ${operadorTurnoC},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${existingRow[0].uuid}::uuid
      RETURNING 
        uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id,
        apertura_sala_inicio, apertura_sala_fin,
        apertura_maquinas_inicio, apertura_maquinas_fin,
        apertura_bingo_inicio, apertura_bingo_fin,
        retiros_dropbox_inicio, retiros_dropbox_fin,
        conteo_dropbox_inicio, conteo_dropbox_fin,
        operador_turno_a, operador_turno_c,
        created_at, updated_at
    `;
  } else {
    rows = await sql`
      INSERT INTO libro_datos (
        uuid,
        libro_uuid,
        apertura_sala_inicio, apertura_sala_fin,
        apertura_maquinas_inicio, apertura_maquinas_fin,
        apertura_bingo_inicio, apertura_bingo_fin,
        retiros_dropbox_inicio, retiros_dropbox_fin,
        conteo_dropbox_inicio, conteo_dropbox_fin,
        operador_turno_a, operador_turno_c
      )
      VALUES (
        ${datosUuid}::uuid,
        ${resolvedLibroUuid}::uuid,
        ${aperturaSalaInicio}, ${aperturaSalaFin},
        ${aperturaMaquinasInicio}, ${aperturaMaquinasFin},
        ${aperturaBingoInicio}, ${aperturaBingoFin},
        ${retirosDropboxInicio}, ${retirosDropboxFin},
        ${conteoDropboxInicio}, ${conteoDropboxFin},
        ${operadorTurnoA}, ${operadorTurnoC}
      )
      RETURNING 
        uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id,
        apertura_sala_inicio, apertura_sala_fin,
        apertura_maquinas_inicio, apertura_maquinas_fin,
        apertura_bingo_inicio, apertura_bingo_fin,
        retiros_dropbox_inicio, retiros_dropbox_fin,
        conteo_dropbox_inicio, conteo_dropbox_fin,
        operador_turno_a, operador_turno_c,
        created_at, updated_at
    `;
  }

  return rows[0];
}

// --- NOVEDADES DE MESAS (CECOM: LIBRO NOVEDADES MESAS) ---
export async function getLibroNovedadesMesasModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const isLibU = isUuid(libroId);
  const targetLibroUuid = isLibU ? String(libroId).trim() : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas || [];
    return inMemoryData.libro_novedades_mesas.filter(d => 
      String(d.libro_uuid) === String(libroId) || String(d.libro_id) === String(libroId)
    );
  }

  let resolvedLibroUuid = targetLibroUuid;
  if (!resolvedLibroUuid) {
    const lRow = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroId)} LIMIT 1`;
    if (lRow.length > 0) resolvedLibroUuid = lRow[0].uuid;
  }
  if (!resolvedLibroUuid) return [];

  const rows = await sql`
    SELECT 
      nm.uuid,
      nm.uuid AS id,
      nm.libro_uuid,
      nm.libro_uuid AS libro_id,
      nm.mesa_uuid,
      nm.mesa_uuid AS mesa_id,
      m.nombre AS mesa_nombre,
      m.uuid AS mesa_real_uuid,
      m.sala_uuid,
      m.sala_uuid AS sala_id,
      j.nombre AS juego_nombre,
      j.uuid AS juego_uuid,
      nm.hora_apertura,
      nm.hora_cierre,
      nm.pitboss,
      nm.croupier_apertura,
      nm.croupier_cierre,
      nm.observacion,
      nm.created_at,
      nm.updated_at
    FROM libro_novedades_mesas nm
    LEFT JOIN mesas m ON nm.mesa_uuid = m.uuid
    LEFT JOIN juegos j ON m.juego_uuid = j.uuid
    WHERE nm.libro_uuid = ${resolvedLibroUuid}::uuid
      AND (nm.is_deleted IS FALSE OR nm.is_deleted IS NULL)
    ORDER BY m.nombre ASC, nm.uuid ASC
  `;

  return rows;
}

export async function saveLibroNovedadesMesaModel(libroId, data) {
  if (!libroId) throw new Error('ID de libro inválido');
  const isLibU = isUuid(libroId);
  let resolvedLibroUuid = isLibU ? String(libroId).trim() : null;

  if (isPgConnected && sql) {
    if (!resolvedLibroUuid) {
      const lRows = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroId)} LIMIT 1`;
      if (lRows.length > 0) resolvedLibroUuid = lRows[0].uuid;
    }
  }
  if (!resolvedLibroUuid) throw new Error('Libro no encontrado');

  const rawMesa = data.mesa_uuid || data.mesa_id;
  if (!rawMesa) throw new Error('ID de mesa inválido');
  const isMesaU = isUuid(rawMesa);
  let resolvedMesaUuid = isMesaU ? String(rawMesa).trim() : null;

  if (isPgConnected && sql) {
    if (!resolvedMesaUuid) {
      const mRows = await sql`SELECT uuid FROM mesas WHERE uuid::text = ${String(rawMesa)} LIMIT 1`;
      if (mRows.length > 0) resolvedMesaUuid = mRows[0].uuid;
    }
  }
  if (!resolvedMesaUuid) throw new Error('Mesa no encontrada');

  const horaApertura = (data.hora_apertura || '').trim() || null;
  const horaCierre = (data.hora_cierre || '').trim() || null;
  const pitboss = (data.pitboss || '').trim() || null;
  const croupierApertura = (data.croupier_apertura || '').trim() || null;
  const croupierCierre = (data.croupier_cierre || '').trim() || null;
  const observacion = (data.observacion || '').trim() || null;
  const novUuid = (data.uuid && isUuid(data.uuid)) ? String(data.uuid).trim() : crypto.randomUUID();

  if (!isPgConnected || !sql) {
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas || [];
    let idx = inMemoryData.libro_novedades_mesas.findIndex(
      d => (String(d.libro_uuid) === String(resolvedLibroUuid) || String(d.libro_id) === String(resolvedLibroUuid)) &&
           (String(d.mesa_uuid) === String(resolvedMesaUuid) || String(d.mesa_id) === String(resolvedMesaUuid))
    );
    if (idx !== -1) {
      inMemoryData.libro_novedades_mesas[idx] = {
        ...inMemoryData.libro_novedades_mesas[idx],
        hora_apertura: horaApertura,
        hora_cierre: horaCierre,
        pitboss: pitboss,
        croupier_apertura: croupierApertura,
        croupier_cierre: croupierCierre,
        observacion: observacion,
        updated_at: new Date().toISOString()
      };
      return inMemoryData.libro_novedades_mesas[idx];
    } else {
      const newRecord = {
        id: novUuid,
        uuid: novUuid,
        libro_id: resolvedLibroUuid,
        libro_uuid: resolvedLibroUuid,
        mesa_id: resolvedMesaUuid,
        mesa_uuid: resolvedMesaUuid,
        hora_apertura: horaApertura,
        hora_cierre: horaCierre,
        pitboss: pitboss,
        croupier_apertura: croupierApertura,
        croupier_cierre: croupierCierre,
        observacion: observacion,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      inMemoryData.libro_novedades_mesas.push(newRecord);
      return newRecord;
    }
  }

  const existingRow = await sql`
    SELECT uuid FROM libro_novedades_mesas
    WHERE libro_uuid = ${resolvedLibroUuid}::uuid AND mesa_uuid = ${resolvedMesaUuid}::uuid
    LIMIT 1
  `;

  let rows;
  if (existingRow.length > 0) {
    rows = await sql`
      UPDATE libro_novedades_mesas SET
        hora_apertura = ${horaApertura},
        hora_cierre = ${horaCierre},
        pitboss = ${pitboss},
        croupier_apertura = ${croupierApertura},
        croupier_cierre = ${croupierCierre},
        observacion = ${observacion},
        updated_at = CURRENT_TIMESTAMP
      WHERE uuid = ${existingRow[0].uuid}::uuid
      RETURNING 
        uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id, mesa_uuid, mesa_uuid AS mesa_id,
        hora_apertura, hora_cierre,
        pitboss, croupier_apertura, croupier_cierre,
        observacion,
        created_at, updated_at
    `;
  } else {
    rows = await sql`
      INSERT INTO libro_novedades_mesas (
        uuid,
        libro_uuid,
        mesa_uuid,
        hora_apertura,
        hora_cierre,
        pitboss,
        croupier_apertura,
        croupier_cierre,
        observacion
      )
      VALUES (
        ${novUuid}::uuid,
        ${resolvedLibroUuid}::uuid,
        ${resolvedMesaUuid}::uuid,
        ${horaApertura},
        ${horaCierre},
        ${pitboss},
        ${croupierApertura},
        ${croupierCierre},
        ${observacion}
      )
      RETURNING 
        uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id, mesa_uuid, mesa_uuid AS mesa_id,
        hora_apertura, hora_cierre,
        pitboss, croupier_apertura, croupier_cierre,
        observacion,
        created_at, updated_at
    `;
  }

  return rows[0];
}

export async function deleteLibroNovedadesMesaModel(recordId) {
  if (!recordId) throw new Error('ID de registro inválido');
  const isU = isUuid(recordId);
  const targetUuid = isU ? String(recordId).trim() : null;
  if (!targetUuid) throw new Error('ID de registro debe ser UUID válido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas || [];
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas.filter(d => 
      String(d.uuid) !== String(targetUuid) && String(d.id) !== String(targetUuid)
    );
    return { success: true, id: targetUuid, uuid: targetUuid };
  }

  await sql`
    DELETE FROM libro_novedades_mesas
    WHERE uuid = ${targetUuid}::uuid
  `;

  return { success: true, id: targetUuid, uuid: targetUuid };
}

// --- REPORTE CONSOLIDADO DEL LIBRO (TABLA libro_reporte - HISTÓRICO Y COMPARTIR) ---
export async function saveLibroReporteModel(libroId) {
  if (!libroId) throw new Error('ID de libro inválido');
  const isLibU = isUuid(libroId);

  const [
    libroRes,
    datosRes,
    dropRes,
    novedadesRes,
    aportesRes,
    llavesRes,
    clientesRes,
    incidenciasRes
  ] = await Promise.all([
    getLibroByIdModel(libroId).catch(e => null),
    getLibroDatosModel(libroId).catch(e => null),
    getLibroDropMesasModel(libroId).catch(e => []),
    getLibroNovedadesMesasModel(libroId).catch(e => []),
    getLibroAportesModel(libroId).catch(e => []),
    getLibroControlLlavesModel(libroId).catch(e => []),
    getLibroControlClientesModel(libroId).catch(e => []),
    getLibroIncidenciasGeneralesModel(libroId).catch(e => [])
  ]);

  const libroObj = (libroRes && libroRes.data) ? libroRes.data : (libroRes?.uuid || libroRes?.id ? libroRes : null);
  let resolvedLibroUuid = libroObj?.uuid || (isLibU ? String(libroId).trim() : null);

  if (!resolvedLibroUuid && sql && isPgConnected) {
    const lRow = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(libroId)} LIMIT 1`;
    if (lRow.length > 0) resolvedLibroUuid = lRow[0].uuid;
  }
  if (!resolvedLibroUuid) throw new Error('Libro no encontrado');

  const salaUuid = libroObj?.sala_uuid || null;
  const salaNombre = libroObj?.sala_nombre || libroObj?.sala_nombre_comercial || 'Sala';
  const fecha = libroObj?.descripcion || null;

  const liveCounts = {
    datos: datosRes ? 1 : 0,
    drop_mesas: Array.isArray(dropRes) ? dropRes.length : 0,
    novedades_mesas: Array.isArray(novedadesRes) ? novedadesRes.length : 0,
    aportes: Array.isArray(aportesRes) ? aportesRes.length : 0,
    aportes_maquinas: Array.isArray(aportesRes) ? aportesRes.length : 0,
    control_llaves: Array.isArray(llavesRes) ? llavesRes.length : 0,
    control_clientes: Array.isArray(clientesRes) ? clientesRes.length : 0,
    incidencias_generales: Array.isArray(incidenciasRes) ? incidenciasRes.length : 0
  };

  const fullData = {
    libro_id: resolvedLibroUuid,
    libro_uuid: resolvedLibroUuid,
    sala_id: salaUuid,
    sala_uuid: salaUuid,
    sala_nombre: salaNombre,
    fecha: fecha,
    libro: libroObj || null,
    datos: datosRes || null,
    drop_mesas: Array.isArray(dropRes) ? dropRes : [],
    novedades_mesas: Array.isArray(novedadesRes) ? novedadesRes : [],
    aportes: Array.isArray(aportesRes) ? aportesRes : [],
    aportes_maquinas: Array.isArray(aportesRes) ? aportesRes : [],
    control_llaves: Array.isArray(llavesRes) ? llavesRes : [],
    control_clientes: Array.isArray(clientesRes) ? clientesRes : [],
    incidencias_generales: Array.isArray(incidenciasRes) ? incidenciasRes : []
  };

  const jsonStr = JSON.stringify(fullData);
  const repUuid = crypto.randomUUID();

  if (isPgConnected && sql) {
    const existingRow = await sql`
      SELECT uuid FROM libro_reporte
      WHERE libro_uuid = ${resolvedLibroUuid}::uuid
      LIMIT 1
    `;

    let rows;
    if (existingRow.length > 0) {
      rows = await sql`
        UPDATE libro_reporte SET
          data = CAST(${jsonStr} AS JSONB),
          updated_at = CURRENT_TIMESTAMP
        WHERE uuid = ${existingRow[0].uuid}::uuid
        RETURNING uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id, data, created_at, updated_at
      `;
    } else {
      rows = await sql`
        INSERT INTO libro_reporte (
          uuid,
          libro_uuid,
          data
        ) VALUES (
          ${repUuid}::uuid,
          ${resolvedLibroUuid}::uuid,
          CAST(${jsonStr} AS JSONB)
        )
        RETURNING uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id, data, created_at, updated_at
      `;
    }

    return {
      success: true,
      exists: true,
      liveCounts,
      data: {
        ...rows[0],
        data: fullData
      }
    };
  }

  if (!inMemoryData.libro_reporte) inMemoryData.libro_reporte = [];
  const existingIdx = inMemoryData.libro_reporte.findIndex(r => 
    String(r.libro_uuid) === String(resolvedLibroUuid) || String(r.libro_id) === String(resolvedLibroUuid)
  );
  const record = {
    id: existingIdx !== -1 ? inMemoryData.libro_reporte[existingIdx].id : repUuid,
    uuid: existingIdx !== -1 ? inMemoryData.libro_reporte[existingIdx].uuid : repUuid,
    libro_id: resolvedLibroUuid,
    libro_uuid: resolvedLibroUuid,
    sala_id: salaUuid,
    sala_uuid: salaUuid,
    sala_nombre: salaNombre,
    fecha: fecha,
    data: fullData,
    created_at: existingIdx !== -1 ? inMemoryData.libro_reporte[existingIdx].created_at : new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    inMemoryData.libro_reporte[existingIdx] = record;
  } else {
    inMemoryData.libro_reporte.push(record);
  }

  return { success: true, exists: true, liveCounts, data: record };
}

export async function getLibroReporteModel(idOrLibroId, autoGenerate = false) {
  if (!idOrLibroId) throw new Error('ID de reporte o libro inválido');
  const isU = isUuid(idOrLibroId);

  // Consulta en paralelo de las subvistas en vivo para conteos y vista previa
  const [
    libroRes,
    datosRes,
    dropRes,
    novedadesRes,
    aportesRes,
    llavesRes,
    clientesRes,
    incidenciasRes
  ] = await Promise.all([
    getLibroByIdModel(idOrLibroId).catch(() => null),
    getLibroDatosModel(idOrLibroId).catch(() => null),
    getLibroDropMesasModel(idOrLibroId).catch(() => []),
    getLibroNovedadesMesasModel(idOrLibroId).catch(() => []),
    getLibroAportesModel(idOrLibroId).catch(() => []),
    getLibroControlLlavesModel(idOrLibroId).catch(() => []),
    getLibroControlClientesModel(idOrLibroId).catch(() => []),
    getLibroIncidenciasGeneralesModel(idOrLibroId).catch(() => [])
  ]);

  const liveCounts = {
    datos: datosRes ? 1 : 0,
    drop_mesas: Array.isArray(dropRes) ? dropRes.length : 0,
    novedades_mesas: Array.isArray(novedadesRes) ? novedadesRes.length : 0,
    aportes: Array.isArray(aportesRes) ? aportesRes.length : 0,
    aportes_maquinas: Array.isArray(aportesRes) ? aportesRes.length : 0,
    control_llaves: Array.isArray(llavesRes) ? llavesRes.length : 0,
    control_clientes: Array.isArray(clientesRes) ? clientesRes.length : 0,
    incidencias_generales: Array.isArray(incidenciasRes) ? incidenciasRes.length : 0
  };

  const libroObj = (libroRes && libroRes.data) ? libroRes.data : (libroRes?.uuid || libroRes?.id ? libroRes : null);
  let resolvedLibroUuid = libroObj?.uuid || (isU ? String(idOrLibroId).trim() : null);

  if (!resolvedLibroUuid && sql && isPgConnected) {
    const lRow = await sql`SELECT uuid FROM libros WHERE uuid::text = ${String(idOrLibroId)} LIMIT 1`;
    if (lRow.length > 0) resolvedLibroUuid = lRow[0].uuid;
  }

  const previewData = {
    libro_id: resolvedLibroUuid,
    libro_uuid: resolvedLibroUuid,
    sala_id: libroObj?.sala_uuid || null,
    sala_uuid: libroObj?.sala_uuid || null,
    sala_nombre: libroObj?.sala_nombre || libroObj?.sala_nombre_comercial || 'Sala',
    fecha: libroObj?.descripcion || null,
    libro: libroObj || null,
    datos: datosRes || null,
    drop_mesas: Array.isArray(dropRes) ? dropRes : [],
    novedades_mesas: Array.isArray(novedadesRes) ? novedadesRes : [],
    aportes: Array.isArray(aportesRes) ? aportesRes : [],
    aportes_maquinas: Array.isArray(aportesRes) ? aportesRes : [],
    control_llaves: Array.isArray(llavesRes) ? llavesRes : [],
    control_clientes: Array.isArray(clientesRes) ? clientesRes : [],
    incidencias_generales: Array.isArray(incidenciasRes) ? incidenciasRes : []
  };

  if (isPgConnected && sql) {
    let rows = [];
    if (resolvedLibroUuid) {
      rows = await sql`
        SELECT uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id, data, created_at, updated_at
        FROM libro_reporte
        WHERE libro_uuid = ${resolvedLibroUuid}::uuid
        ORDER BY updated_at DESC
        LIMIT 1
      `;
    } else if (isU) {
      rows = await sql`
        SELECT uuid, uuid AS id, libro_uuid, libro_uuid AS libro_id, data, created_at, updated_at
        FROM libro_reporte
        WHERE uuid = ${idOrLibroId}::uuid OR libro_uuid = ${idOrLibroId}::uuid
        ORDER BY updated_at DESC
        LIMIT 1
      `;
    }

    if (rows && rows.length > 0) {
      let rData = rows[0].data;
      if (typeof rData === 'string') {
        try { rData = JSON.parse(rData); } catch (e) {}
      }
      return {
        success: true,
        exists: true,
        liveCounts,
        data: {
          ...rows[0],
          data: rData
        }
      };
    }
  } else {
    let found = null;
    if (resolvedLibroUuid) {
      found = (inMemoryData.libro_reporte || []).find(r => 
        String(r.libro_uuid) === String(resolvedLibroUuid) || String(r.libro_id) === String(resolvedLibroUuid)
      );
    } else {
      found = (inMemoryData.libro_reporte || []).find(r => 
        String(r.uuid) === String(idOrLibroId) || 
        String(r.libro_uuid) === String(idOrLibroId)
      );
    }
    if (found) {
      return {
        success: true,
        exists: true,
        liveCounts,
        data: found
      };
    }
  }

  if (autoGenerate) {
    return await saveLibroReporteModel(idOrLibroId);
  }

  return {
    success: true,
    exists: false,
    liveCounts,
    data: {
      id: null,
      uuid: null,
      libro_id: resolvedLibroUuid,
      libro_uuid: resolvedLibroUuid,
      sala_id: libroObj?.sala_uuid || null,
      sala_uuid: libroObj?.sala_uuid || null,
      sala_nombre: libroObj?.sala_nombre || libroObj?.sala_nombre_comercial || 'Sala',
      fecha: libroObj?.descripcion || null,
      data: previewData,
      created_at: null,
      updated_at: null
    }
  };
}

export async function getLibroResumenModel(libroId) {
  const res = await getLibroReporteModel(libroId, false);
  return res.data?.data || res.data || res;
}

/**
 * Motor de sincronización Delta para arquitectura Local-First.
 * Devuelve únicamente registros modificados (upserted) o eliminados (deleted) desde 'since'.
 */
export async function getDeltaSyncModel(params = {}) {
  if (!isPgConnected || !sql) {
    return {
      timestamp: new Date().toISOString(),
      since: params.since || new Date(0).toISOString(),
      changes: {}
    };
  }

  const since = params.since ? new Date(params.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const validSince = isNaN(since.getTime()) ? new Date(0) : since;
  const currentTimestamp = new Date().toISOString();

  const allowedTables = [
    'clientes',
    'empleados',
    'salas',
    'departamentos',
    'areas',
    'cargos',
    'horarios',
    'maquinas',
    'mesas',
    'llaves',
    'estados',
    'sociedades',
    'valores',
    'juegos',
    'juegos_maquinas',
    'marcas',
    'modelos',
    'tipos',
    'modos',
    'legal',
    'rangos',
    'metodos_pago',
    'tipo_clientes',
    'tipo_incidencias',
    'dispositivos',
    'usuarios',
    'libros',
    'libro_control_clientes',
    'libro_aportes',
    'libro_control_llaves',
    'libro_incidencias_generales',
    'libro_novedades_mesas',
    'libro_datos',
    'libro_drop_mesas'
  ];

  let targetTables = allowedTables;
  if (params.entities) {
    const list = String(params.entities).split(',').map(e => e.trim().toLowerCase());
    targetTables = allowedTables.filter(t => list.includes(t));
  }

  const changes = {};

  for (const tbl of targetTables) {
    try {
      // Upserted: records where updated_at >= since and is_deleted is false (or null)
      const upserted = await sql`
        SELECT *, uuid AS id FROM ${sql(tbl)}
        WHERE updated_at >= ${validSince} AND (is_deleted IS FALSE OR is_deleted IS NULL)
        ORDER BY updated_at ASC
        LIMIT 1000
      `;

      // Deleted: records where updated_at >= since and is_deleted is true
      const deleted = await sql`
        SELECT uuid, uuid AS id, deleted_at FROM ${sql(tbl)}
        WHERE updated_at >= ${validSince} AND is_deleted IS TRUE
        ORDER BY updated_at ASC
        LIMIT 1000
      `;

      changes[tbl] = {
        upserted: upserted || [],
        deleted: deleted || []
      };
    } catch (tblErr) {
      changes[tbl] = {
        upserted: [],
        deleted: [],
        error: tblErr.message
      };
    }
  }

  return {
    timestamp: currentTimestamp,
    since: validSince.toISOString(),
    changes
  };
}


