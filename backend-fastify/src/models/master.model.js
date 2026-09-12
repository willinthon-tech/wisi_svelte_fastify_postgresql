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

export async function getDynamicTableDependencies(tableName, recordId) {
  if (!isPgConnected || !sql) return [];
  const dependencies = [];
  const visited = new Set();

  async function inspect(currTable, currIds) {
    if (!currIds || currIds.length === 0) return;

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
          `SELECT id, "${childColumn}" FROM "${childTable}" WHERE "${childColumn}" = ANY($1::int[])`,
          [currIds]
        );

        const count = childRows.length;
        if (count > 0) {
          dependencies.push({ label: getHumanLabel(childTable), count });
          const childIds = childRows.map(r => r.id).filter(id => id !== undefined && id !== null);
          if (childIds.length > 0) {
            await inspect(childTable, childIds);
          }
        }
      }
    } catch (err) {
      console.warn(`Error in dynamic FK inspection for ${currTable}:`, err.message);
    }
  }

  await inspect(tableName, [Number(recordId)]);
  return dependencies;
}

export async function deleteEntityDynamic(tableName, entityTypeLabel, id) {
  const rId = Number(id);
  if (isNaN(rId) || rId <= 0) {
    return {
      success: false,
      message: 'ID de registro inválido'
    };
  }
  if (isPgConnected && sql) {
    let name = `ID: ${rId}`;
    try {
      const rows = await sql.unsafe(`SELECT * FROM "${tableName}" WHERE id = $1`, [rId]);
      if (rows && rows.length > 0) {
        name = rows[0].nombre || rows[0].title || rows[0].nombre_apellido || rows[0].usuario || rows[0].name || `ID: ${rId}`;
      }
    } catch (e) {
      // Ignore if table structure differs
    }

    const dependencies = await getDynamicTableDependencies(tableName, rId);

    if (dependencies && dependencies.length > 0) {
      return {
        success: false,
        blocked: true,
        entityType: entityTypeLabel || tableName,
        entityName: name,
        entityId: rId,
        message: `No se puede eliminar ${entityTypeLabel || tableName} porque tiene elementos asociados.`,
        dependencies
      };
    }

    try {
      await sql.unsafe(`DELETE FROM "${tableName}" WHERE id = $1`, [rId]);
    } catch (err) {
      if (err.code === '23503') { // PostgreSQL foreign_key_violation
        return {
          success: false,
          blocked: true,
          entityType: entityTypeLabel || tableName,
          entityName: name,
          entityId: rId,
          message: `No se puede eliminar ${entityTypeLabel || tableName} porque está referenciado en la base de datos.`,
          dependencies: [{ label: 'Registros Vinculados', count: 1 }]
        };
      }
      throw err;
    }
  }
  return { success: true, id: rId };
}


// --- USUARIOS ---
export async function getUsuariosModel() {
  if (isPgConnected && sql) {
    return await sql`SELECT id, nombre_apellido, usuario, password FROM usuarios ORDER BY id DESC`;
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
      RETURNING id, nombre_apellido, usuario, password
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.usuarios.length > 0 ? Math.max(...inMemoryData.usuarios.map(u => u.id)) + 1 : 1;
    const newUser = {
      id: nextId,
      nombre_apellido: cleanName,
      usuario: cleanUser,
      password: cleanPass
    };
    inMemoryData.usuarios.unshift(newUser);
    return newUser;
  }
}

export async function updateUsuarioModel(id, data) {
  const uId = Number(id);
  const { nombre_apellido, usuario, password } = data || {};

  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE usuarios
      SET nombre_apellido = ${nombre_apellido}, usuario = ${usuario}, password = ${password}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${uId}
      RETURNING id, nombre_apellido, usuario, password
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.usuarios.findIndex(u => u.id === uId);
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
    return await sql`SELECT * FROM salas ORDER BY id DESC`;
  }
  return inMemoryData.salas;
}

export async function createSalaModel(data) {
  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO salas (grupo_id, nombre, nombre_comercial, rif, ubicacion, correo, telefono)
      VALUES (${data.grupo_id || 1}, ${data.nombre}, ${data.nombre_comercial}, ${data.rif}, ${data.ubicacion}, ${data.correo}, ${data.telefono})
      RETURNING *
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.salas.length > 0 ? Math.max(...inMemoryData.salas.map(s => s.id)) + 1 : 1;
    const newSala = { id: nextId, ...data };
    inMemoryData.salas.unshift(newSala);
    return newSala;
  }
}

export async function updateSalaModel(id, data) {
  const sId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE salas
      SET grupo_id = ${data.grupo_id}, nombre = ${data.nombre}, nombre_comercial = ${data.nombre_comercial},
          rif = ${data.rif}, ubicacion = ${data.ubicacion}, correo = ${data.correo}, telefono = ${data.telefono}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.salas.findIndex(s => s.id === sId);
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
    return await sql`SELECT * FROM paginas ORDER BY id ASC`;
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
    const nextId = inMemoryData.paginas.length > 0 ? Math.max(...inMemoryData.paginas.map(p => p.id)) + 1 : 1;
    return newPagina;
  }
}

export async function updatePaginaModel(id, data) {
  const pId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE paginas
      SET nombre = ${data.nombre}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${pId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.paginas.findIndex(p => p.id === pId);
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
    return await sql`SELECT * FROM modulos ORDER BY orden ASC, id ASC`;
  }
  return [...inMemoryData.modulos].sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.id - b.id);
}

export async function reorderModulosModel(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return { success: true, message: 'No hay elementos para reordenar' };
  }

  if (isPgConnected && sql) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const mId = Number(item.id);
      const newOrder = Number(item.orden !== undefined ? item.orden : (i + 1));
      if (!isNaN(mId)) {
        await sql`
          UPDATE modulos
          SET orden = ${newOrder}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${mId}
        `;
      }
    }
    const updated = await sql`SELECT * FROM modulos ORDER BY orden ASC, id ASC`;
    return { success: true, data: updated };
  } else {
    items.forEach((item, i) => {
      const mId = Number(item.id);
      const newOrder = Number(item.orden !== undefined ? item.orden : (i + 1));
      const target = inMemoryData.modulos.find(m => m.id === mId);
      if (target) {
        target.orden = newOrder;
      }
    });
    inMemoryData.modulos.sort((a, b) => (a.orden || 0) - (b.orden || 0) || a.id - b.id);
    return { success: true, data: inMemoryData.modulos };
  }
}

export async function createModuloModel(data) {
  if (isPgConnected && sql) {
    let newOrder = data.orden !== undefined ? Number(data.orden) : null;
    if (newOrder === null && data.page_id) {
      const maxRes = await sql`SELECT COALESCE(MAX(orden), 0) + 1 AS next_order FROM modulos WHERE page_id = ${data.page_id}`;
      newOrder = maxRes[0]?.next_order || 1;
    }
    const rows = await sql`
      INSERT INTO modulos (nombre, icono, ruta, page_id, orden)
      VALUES (${data.nombre}, ${data.icono || 'settings'}, ${data.ruta}, ${data.page_id}, ${newOrder || 0})
      RETURNING *
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.modulos.length > 0 ? Math.max(...inMemoryData.modulos.map(m => m.id)) + 1 : 1;
    const newModulo = { id: nextId, ...data, orden: data.orden || inMemoryData.modulos.length + 1 };
    inMemoryData.modulos.push(newModulo);
    return newModulo;
  }
}

export async function updateModuloModel(id, data) {
  const mId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE modulos
      SET nombre = ${data.nombre}, 
          icono = ${data.icono || 'settings'}, 
          ruta = ${data.ruta}, 
          page_id = ${data.page_id}, 
          orden = ${data.orden !== undefined ? Number(data.orden) : sql`orden`},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${mId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.modulos.findIndex(m => m.id === mId);
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


// --- DISPOSITIVOS ---
export async function getDispositivosModel(salaId = null, salaIds = null) {
  let ids = [];
  if (salaIds) {
    ids = Array.isArray(salaIds) ? salaIds.map(Number).filter(Boolean) : String(salaIds).split(',').map(Number).filter(Boolean);
  } else if (salaId && !isNaN(Number(salaId))) {
    ids = [Number(salaId)];
  }

  if (isPgConnected && sql) {
    if (ids.length > 0) {
      return await sql`
        SELECT d.*, COALESCE(d.ip_panel, '') AS ip_panel, COALESCE(d.ip_panel, '') AS ip_panel_remoto, s.nombre AS sala_nombre
        FROM dispositivos d
        LEFT JOIN salas s ON d.sala_id = s.id
        WHERE d.sala_id = ANY(${ids})
        ORDER BY d.nombre ASC
      `;
    }
    return await sql`
      SELECT d.*, COALESCE(d.ip_panel, '') AS ip_panel, COALESCE(d.ip_panel, '') AS ip_panel_remoto, s.nombre AS sala_nombre
      FROM dispositivos d
      LEFT JOIN salas s ON d.sala_id = s.id
      ORDER BY d.id DESC
    `;
  }
  if (ids.length > 0) {
    return (inMemoryData.dispositivos || []).filter(d => ids.includes(Number(d.sala_id)));
  }
  return inMemoryData.dispositivos;
}

export async function createDispositivoModel(data) {
  const ipPanelVal = data.ip_panel || data.ip_panel_remoto || '';
  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO dispositivos (nombre, sala_id, ip_local, ip_remota, ip_panel, usuario, clave)
      VALUES (${data.nombre}, ${data.sala_id}, ${data.ip_local}, ${data.ip_remota}, ${ipPanelVal}, ${data.usuario || 'admin'}, ${data.clave || '123456'})
      RETURNING *, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto
    `;
    return rows[0];
  } else {
    const nextId = inMemoryData.dispositivos.length > 0 ? Math.max(...inMemoryData.dispositivos.map(d => d.id)) + 1 : 1;
    const newDispositivo = { id: nextId, ...data, ip_panel: ipPanelVal, ip_panel_remoto: ipPanelVal };
    inMemoryData.dispositivos.unshift(newDispositivo);
    return newDispositivo;
  }
}

export async function updateDispositivoModel(id, data) {
  const dId = Number(id);
  const ipPanelVal = data.ip_panel || data.ip_panel_remoto || '';
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE dispositivos
      SET nombre = ${data.nombre}, sala_id = ${data.sala_id}, ip_local = ${data.ip_local},
          ip_remota = ${data.ip_remota}, ip_panel = ${ipPanelVal}, usuario = ${data.usuario || 'admin'},
          clave = ${data.clave || '123456'}
      WHERE id = ${dId}
      RETURNING *, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto
    `;
    return rows[0];
  } else {
    const idx = inMemoryData.dispositivos.findIndex(d => d.id === dId);
    if (idx !== -1) {
      inMemoryData.dispositivos[idx] = { ...inMemoryData.dispositivos[idx], ...data, ip_panel: ipPanelVal, ip_panel_remoto: ipPanelVal };
      return inMemoryData.dispositivos[idx];
    }
    return null;
  }
}

export async function injectDispositivoPushConfigModel(id, serverUrl) {
  const dId = Number(id);
  let dev = null;
  if (isPgConnected && sql) {
    const rows = await sql`SELECT * FROM dispositivos WHERE id = ${dId}`;
    dev = rows[0];
  } else {
    dev = (inMemoryData.dispositivos || []).find(d => d.id === dId);
  }

  if (!dev) {
    throw new Error(`Dispositivo con ID ${id} no encontrado`);
  }

  const rawIp = dev.ip_remota || dev.ip_local || '127.0.0.1';
  const cleanIp = rawIp.split(':')[0].trim();
  const portPart = rawIp.includes(':') ? rawIp.split(':')[1].trim() : '80';
  const pushEndpoint = serverUrl ? `${serverUrl}/iclock/cdata` : `http://${cleanIp}:${portPart}/iclock/cdata`;

  console.log(`[PUSH INJECT] ⚡ Inyectando HTTP Push Config a Biométrico #${dev.id} ('${dev.nombre}') -> IP: ${rawIp}`);
  console.log(`[PUSH INJECT] Servidor Push de Destino: ${pushEndpoint}`);

  return {
    dispositivo_id: dev.id,
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
  const dId = Number(id);
  let dev = null;
  if (isPgConnected && sql) {
    const rows = await sql`SELECT *, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto FROM dispositivos WHERE id = ${dId}`;
    dev = rows[0];
  } else {
    dev = (inMemoryData.dispositivos || []).find(d => d.id === dId);
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
  const ipAddress = (config.ip_domain || savedConfig.isapi_ip_domain || 'willinthon.wisi.space').trim();
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

  console.log(`[ISAPI INJECTION] ⚡ Conectando a '${dev.nombre}' en ${isapiFullUrl} (ip_remota: ${rawIp}, usuario: '${username}')...`);

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
          console.log(`[ISAPI SUCCESS] ✅ HTTP Listening configurado en '${dev.nombre}' vía reintento Digest`);
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
      console.log(`[ISAPI SUCCESS] ✅ HTTP Listening aplicado en '${dev.nombre}' (${baseHost})`);
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
      SELECT a.id, a.attendancestatus, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time, a.nombre, a.dispositivo_id, d.sala_id,
             d.nombre AS dispositivo_nombre, s.nombre AS sala_nombre
      FROM attlogs a
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ORDER BY a.event_time DESC, a.id DESC
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
  if (userSalaIds && Array.isArray(userSalaIds) && userSalaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${userSalaIds})`);
  }

  // 2. Filter by Salas (unless skipped for facet aggregation)
  if (!skipSalas && salaIds && Array.isArray(salaIds) && salaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${salaIds})`);
  }

  // 3. Filter by Dispositivos (unless skipped)
  if (!skipDispositivos && dispositivoIds && Array.isArray(dispositivoIds) && dispositivoIds.length > 0) {
    conds.push(sql`a.dispositivo_id = ANY(${dispositivoIds})`);
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
      CAST(a.id AS TEXT) LIKE ${pattern}
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
        estOrs.push(sql`(e.id IS NULL OR e.activo IS NULL)`);
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
        sexOrs.push(sql`(e.id IS NULL OR e.sexo IS NULL OR LOWER(COALESCE(e.sexo, '')) NOT IN ('f', 'femenino', 'mujer', 'm', 'masculino', 'hombre'))`);
      }
    }
    if (sexOrs.length > 0) {
      conds.push(sql`(${sexOrs.reduce((a, b) => sql`${a} OR ${b}`)})`);
    }
  }

  // 10. Filter by Departamentos
  if (!skipDepartamentos && departamentoIds && Array.isArray(departamentoIds) && departamentoIds.length > 0) {
    conds.push(sql`dep.id = ANY(${departamentoIds})`);
  }

  // 11. Filter by Áreas
  if (!skipAreas && areaIds && Array.isArray(areaIds) && areaIds.length > 0) {
    conds.push(sql`ar.id = ANY(${areaIds})`);
  }

  // 12. Filter by Cargos
  if (!skipCargos && cargoIds && Array.isArray(cargoIds) && cargoIds.length > 0) {
    conds.push(sql`c.id = ANY(${cargoIds})`);
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
    'id': 'a.id',
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

    const orderClause = sql.unsafe(`ORDER BY ${sortCol} ${orderDirection}, a.id DESC`);

    const rows = await sql`
      SELECT a.id, a.attendancestatus, a.currentverifymode, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
             COALESCE(NULLIF(TRIM(e.nombre), ''), NULLIF(TRIM(a.nombre), ''), 'Empleado ' || a.employee_no) AS nombre,
             a.dispositivo_id, d.nombre AS dispositivo_nombre, d.sala_id, s.nombre AS sala_nombre,
             e.id AS empleado_id, e.cedula, e.foto AS empleado_foto, e.sexo, 
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, 
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             c.nombre AS cargo_nombre, ar.nombre AS area_nombre, dep.nombre AS departamento_nombre,
             a.has_photo,
             (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
      FROM attlogs a
      LEFT JOIN LATERAL (
        SELECT e.id, e.cedula, e.nombre, e.foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento, e.cargo_id, e.activo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.id AS TEXT)
          )
        ORDER BY e.activo DESC, e.id DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas ar ON c.area_id = ar.id
      LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${whereClause}
      ${orderClause}
      LIMIT ${numLimit} OFFSET ${numOffset}
    `;

    // Deduplicate as defense in depth: guarantees strict ID uniqueness in backend output
    const seenIds = new Set();
    const uniqueRows = [];
    for (const row of rows) {
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        uniqueRows.push(row);
      }
    }
    return uniqueRows;
  }

  let list = (inMemoryData.attlogs || []);
  const seenIds = new Set();
  const uniqueList = [];
  for (const item of list) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
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
      SELECT COUNT(DISTINCT a.id)::int AS total
      FROM attlogs a
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      LEFT JOIN LATERAL (
        SELECT e.id, e.cargo_id, e.activo, e.sexo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.id AS TEXT)
          )
        ORDER BY e.activo DESC, e.id DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas ar ON c.area_id = ar.id
      LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
        SELECT e.id, e.cargo_id, e.activo, e.sexo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.id AS TEXT)
          )
        ORDER BY e.activo DESC, e.id DESC
        LIMIT 1
      ) e ON TRUE
    `;

    const [salasRes, devRes, estRes, vmRes, fotoRes, empStatusRes, sexoRes, depRes, areaRes, cargoRes] = await Promise.all([
      // 1. Salas Options: Always include all user's assigned salas, with dynamic matching count
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipSalas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        let allSalas;
        if (options.userSalaIds && options.userSalaIds.length > 0) {
          allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
        } else {
          allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
        }

        const countsRes = await sql`
          SELECT s.id, COUNT(DISTINCT a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
          ${where}
          GROUP BY s.id
        `;
        const countMap = new Map(countsRes.map(r => [r.id, r.count]));
        const activeSalas = new Set((options.salaIds || []).map(Number));
        return allSalas
          .map(s => ({
            id: s.id,
            nombre: s.nombre,
            count: countMap.get(s.id) || 0
          }))
          .filter(s => s.count > 0 || activeSalas.has(Number(s.id)));
      })(),

      // 2. Dispositivos Options: Always include devices of assigned/selected salas, with dynamic matching count
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipDispositivos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        let devWhere = [];
        if (options.salaIds && options.salaIds.length > 0) {
          devWhere.push(sql`d.sala_id = ANY(${options.salaIds})`);
        } else if (options.userSalaIds && options.userSalaIds.length > 0) {
          devWhere.push(sql`d.sala_id = ANY(${options.userSalaIds})`);
        }
        const devWhereClause = devWhere.length > 0 ? sql`WHERE ${devWhere.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        const allDevs = await sql`
          SELECT d.id, d.nombre, d.sala_id, s.nombre AS sala_nombre
          FROM dispositivos d
          LEFT JOIN salas s ON d.sala_id = s.id
          ${devWhereClause}
          ORDER BY s.nombre ASC, d.nombre ASC
        `;

        const countsRes = await sql`
          SELECT d.id, COUNT(DISTINCT a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
          ${where}
          GROUP BY d.id
        `;
        const countMap = new Map(countsRes.map(r => [r.id, r.count]));
        const activeDevs = new Set((options.dispositivoIds || []).map(Number));
        return allDevs
          .map(d => ({
            id: d.id,
            nombre: d.nombre,
            sala_id: d.sala_id,
            sala_nombre: d.sala_nombre,
            count: countMap.get(d.id) || 0
          }))
          .filter(d => d.count > 0 || activeDevs.has(Number(d.id)));
      })(),

      // 3. Estados Options (Entrada, Salida, Indefinido/Otros)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipEstados: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            COUNT(DISTINCT CASE WHEN LOWER(a.attendancestatus) = 'checkin' THEN a.id END)::int AS checkin_count,
            COUNT(DISTINCT CASE WHEN LOWER(a.attendancestatus) = 'checkout' THEN a.id END)::int AS checkout_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.attendancestatus, '')) NOT IN ('checkin', 'checkout') THEN a.id END)::int AS undefined_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('face', 'facial') THEN a.id END)::int AS face_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('cardorface', 'faceorcard') THEN a.id END)::int AS card_or_face_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('card', 'tarjeta', 'carnet') THEN a.id END)::int AS card_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) LIKE '%finger%' OR LOWER(COALESCE(a.currentverifymode, '')) LIKE '%huella%' THEN a.id END)::int AS finger_count,
            COUNT(DISTINCT CASE WHEN a.currentverifymode IS NULL OR (
              LOWER(COALESCE(a.currentverifymode, '')) NOT IN ('face', 'facial', 'card', 'tarjeta', 'carnet', 'cardorface', 'faceorcard') AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%finger%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%huella%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pw%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pass%'
            ) THEN a.id END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
            COUNT(DISTINCT CASE WHEN a.has_photo = TRUE THEN a.id END)::int AS con_foto_count,
            COUNT(DISTINCT CASE WHEN a.has_photo = FALSE OR a.has_photo IS NULL THEN a.id END)::int AS sin_foto_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
            COUNT(DISTINCT CASE WHEN e.activo = TRUE THEN a.id END)::int AS activos_count,
            COUNT(DISTINCT CASE WHEN e.activo = FALSE THEN a.id END)::int AS desincorporados_count,
            COUNT(DISTINCT CASE WHEN e.id IS NULL OR e.activo IS NULL THEN a.id END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(e.sexo, '')) IN ('f', 'femenino', 'mujer') THEN a.id END)::int AS mujer_count,
            COUNT(DISTINCT CASE WHEN LOWER(COALESCE(e.sexo, '')) IN ('m', 'masculino', 'hombre') THEN a.id END)::int AS hombre_count,
            COUNT(DISTINCT CASE WHEN e.id IS NULL OR e.sexo IS NULL OR LOWER(COALESCE(e.sexo, '')) NOT IN ('f', 'femenino', 'mujer', 'm', 'masculino', 'hombre') THEN a.id END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          LEFT JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
        if (options.userSalaIds && options.userSalaIds.length > 0) {
          conds.push(sql`dep.sala_id = ANY(${options.userSalaIds})`);
        }
        if (options.salaIds && options.salaIds.length > 0) {
          conds.push(sql`dep.sala_id = ANY(${options.salaIds})`);
        }
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            dep.id, 
            dep.nombre, 
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre, 
            COUNT(DISTINCT a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          JOIN cargos c ON e.cargo_id = c.id
          JOIN areas ar ON c.area_id = ar.id
          JOIN departamentos dep ON ar.departamento_id = dep.id
          LEFT JOIN salas s_dep ON dep.sala_id = s_dep.id
          ${where}
          GROUP BY dep.id, dep.nombre, s_dep.nombre, s.nombre
          ORDER BY count DESC
        `;
        // Aggregate by unique dep.id in case of any remaining device-room splits
        const aggMap = new Map();
        for (const r of res) {
          const idNum = Number(r.id);
          if (!aggMap.has(idNum)) {
            aggMap.set(idNum, {
              id: idNum,
              nombre: r.nombre,
              sala_nombre: r.sala_nombre,
              count: 0
            });
          }
          aggMap.get(idNum).count += Number(r.count) || 0;
        }
        const activeSet = new Set((options.departamentoIds || []).map(Number));
        return Array.from(aggMap.values())
          .filter(r => r.count > 0 || activeSet.has(r.id))
          .sort((a, b) => b.count - a.count);
      })(),

      // 9. Áreas (Grouped by Departamento and Sala)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipAreas: true });
        if (options.userSalaIds && options.userSalaIds.length > 0) {
          conds.push(sql`dep.sala_id = ANY(${options.userSalaIds})`);
        }
        if (options.salaIds && options.salaIds.length > 0) {
          conds.push(sql`dep.sala_id = ANY(${options.salaIds})`);
        }
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            ar.id, 
            ar.nombre, 
            COALESCE(dep.nombre, 'Sin Departamento') AS departamento_nombre, 
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre,
            COUNT(DISTINCT a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          JOIN cargos c ON e.cargo_id = c.id
          JOIN areas ar ON c.area_id = ar.id
          JOIN departamentos dep ON ar.departamento_id = dep.id
          LEFT JOIN salas s_dep ON dep.sala_id = s_dep.id
          ${where}
          GROUP BY ar.id, ar.nombre, dep.nombre, s_dep.nombre, s.nombre
          ORDER BY count DESC
        `;
        // Aggregate by unique ar.id to guarantee NO duplicated rows
        const aggMap = new Map();
        for (const r of res) {
          const idNum = Number(r.id);
          if (!aggMap.has(idNum)) {
            aggMap.set(idNum, {
              id: idNum,
              nombre: r.nombre,
              departamento_nombre: r.departamento_nombre,
              sala_nombre: r.sala_nombre,
              count: 0
            });
          }
          aggMap.get(idNum).count += Number(r.count) || 0;
        }
        const activeSet = new Set((options.areaIds || []).map(Number));
        return Array.from(aggMap.values())
          .filter(r => r.count > 0 || activeSet.has(r.id))
          .sort((a, b) => b.count - a.count);
      })(),

      // 10. Cargos (Grouped by Área, Departamento and Sala)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipCargos: true });
        if (options.userSalaIds && options.userSalaIds.length > 0) {
          conds.push(sql`dep.sala_id = ANY(${options.userSalaIds})`);
        }
        if (options.salaIds && options.salaIds.length > 0) {
          conds.push(sql`dep.sala_id = ANY(${options.salaIds})`);
        }
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            c.id, 
            c.nombre, 
            COALESCE(ar.nombre, 'Sin Área') AS area_nombre, 
            COALESCE(dep.nombre, 'Sin Departamento') AS departamento_nombre,
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre,
            COUNT(DISTINCT a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          ${lateralJoin}
          JOIN cargos c ON e.cargo_id = c.id
          LEFT JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
          LEFT JOIN salas s_dep ON dep.sala_id = s_dep.id
          ${where}
          GROUP BY c.id, c.nombre, ar.nombre, dep.nombre, s_dep.nombre, s.nombre
          ORDER BY count DESC
        `;
        // Aggregate by unique c.id to guarantee NO duplicated rows
        const aggMap = new Map();
        for (const r of res) {
          const idNum = Number(r.id);
          if (!aggMap.has(idNum)) {
            aggMap.set(idNum, {
              id: idNum,
              nombre: r.nombre,
              area_nombre: r.area_nombre,
              departamento_nombre: r.departamento_nombre,
              sala_nombre: r.sala_nombre,
              count: 0
            });
          }
          aggMap.get(idNum).count += Number(r.count) || 0;
        }
        const activeSet = new Set((options.cargoIds || []).map(Number));
        return Array.from(aggMap.values())
          .filter(r => r.count > 0 || activeSet.has(r.id))
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
  if (!isPgConnected || !sql) return { id: Number(id), globalIndex: 0, position: 1 };

  const target = await sql`
    SELECT id, event_time, attendancestatus, employee_no
    FROM attlogs
    WHERE id = ${Number(id)}
    LIMIT 1
  `;
  if (!target || target.length === 0) return null;
  const rec = target[0];

  let whereConditions = [];
  if (estados && Array.isArray(estados) && estados.length > 0) {
    whereConditions.push(sql`LOWER(COALESCE(a.attendancestatus, '')) = ANY(${estados.map(e => e.toLowerCase())})`);
  }
  if (salaIds && Array.isArray(salaIds) && salaIds.length > 0) {
    whereConditions.push(sql`d.sala_id = ANY(${salaIds})`);
  }
  whereConditions.push(sql`(a.event_time > ${rec.event_time} OR (a.event_time = ${rec.event_time} AND a.id > ${rec.id}))`);

  const whereClause = sql`WHERE ${whereConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`;

  const res = await sql`
    SELECT count(*)::int AS total
    FROM attlogs a
    LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
    ${whereClause}
  `;

  const globalIndex = res[0]?.total || 0;
  return {
    id: Number(id),
    globalIndex,
    position: globalIndex + 1
  };
}

export async function getAttlogDetailModel(id) {
  if (!isPgConnected || !sql) return null;
  const targetId = Number(id);
  if (isNaN(targetId)) return null;

  try {
    const config = await getConfiguracionModel();
    const tz = getDbTimezone(config);

    const rows = await sql`
      SELECT a.id,
             a.dispositivo_id,
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
             e.id AS empleado_id,
             e.cedula,
             e.foto AS empleado_foto,
             e.foto,
             c.id AS cargo_id,
             c.nombre AS cargo_nombre,
             c.nombre AS cargo,
             ar.id AS area_id,
             ar.nombre AS area_nombre,
             dep.id AS departamento_id,
             dep.nombre AS departamento_nombre,
             s.id AS sala_id,
             s.nombre AS sala_nombre,
             d.nombre AS dispositivo_nombre,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             e.sexo,
             (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
      FROM attlogs a
      LEFT JOIN LATERAL (
        SELECT e.id, e.cedula, e.nombre, e.foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento, e.cargo_id, e.activo
        FROM empleados e
        WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
          AND (
            REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
            OR a.employee_no = CAST(e.id AS TEXT)
          )
        ORDER BY e.activo DESC, e.id DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas ar ON c.area_id = ar.id
      LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      WHERE a.id = ${targetId}
      LIMIT 1
    `;

    if (!rows || rows.length === 0) return null;
    const record = rows[0];
    const pos = await getAttlogPositionModel(targetId);

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

      // 1. Evitar crear marcaje duplicado si ya existe un evento para el mismo empleado en el mismo segundo
      const existingAtt = await sql`
        SELECT id, has_photo FROM attlogs
        WHERE REPLACE(REPLACE(UPPER(COALESCE(employee_no, '')), 'V', ''), '-', '') = ${normEmp}
          AND event_time = ${log.event_time}::timestamp
        LIMIT 1
      `;

      let attlogId;
      if (existingAtt.length > 0) {
        attlogId = existingAtt[0].id;
        console.log(`\x1b[33m⚠️  [ATTLOG]\x1b[0m Marcaje duplicado detectado (id: ${attlogId}) para emp: ${log.employee_no} @ ${log.event_time} - se actualiza pero NO se emite evento`);
        await sql`
          UPDATE attlogs
          SET updated_at = CURRENT_TIMESTAMP,
              currentverifymode = COALESCE(${verifyMode}, currentverifymode),
              attendancestatus = COALESCE(${log.attendanceStatus || null}, attendancestatus),
              has_photo = CASE WHEN ${hasPhoto} = TRUE THEN TRUE ELSE has_photo END
          WHERE id = ${attlogId}
        `;
      } else {
        const rows = await sql`
          INSERT INTO attlogs (dispositivo_id, employee_no, event_time, nombre, attendancestatus, currentverifymode, has_photo)
          VALUES (${Number(dispositivo_id)}, ${String(log.employee_no)}, ${log.event_time}, ${log.nombre || null}, ${log.attendanceStatus || null}, ${verifyMode}, ${hasPhoto})
          ON CONFLICT (dispositivo_id, employee_no, event_time)
          DO UPDATE SET updated_at = CURRENT_TIMESTAMP,
                        currentverifymode = COALESCE(EXCLUDED.currentverifymode, attlogs.currentverifymode),
                        has_photo = CASE WHEN EXCLUDED.has_photo = TRUE THEN TRUE ELSE attlogs.has_photo END
          RETURNING id
        `;
        attlogId = rows[0]?.id;
      }
      if (attlogId && log.foto_base64) {
        await saveAttlogPhoto(attlogId, log.foto_base64);
      }
      if (attlogId) {
        let fullRecord = null;
        try {
          const config = await getConfiguracionModel();
          const tz = getDbTimezone(config);
          const fullRows = await sql`
            SELECT a.id, a.attendancestatus, a.currentverifymode, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
                   COALESCE(NULLIF(TRIM(e.nombre), ''), NULLIF(TRIM(a.nombre), ''), 'Empleado ' || a.employee_no) AS nombre,
                   a.dispositivo_id, d.nombre AS dispositivo_nombre, d.sala_id, s.nombre AS sala_nombre,
                   e.id AS empleado_id, e.cedula, e.foto AS empleado_foto, e.sexo, 
                   to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso, 
                   to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
                   c.nombre AS cargo_nombre, ar.nombre AS area_nombre, dep.nombre AS departamento_nombre,
                   a.has_photo,
                   (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
            FROM attlogs a
            LEFT JOIN LATERAL (
              SELECT e.id, e.cedula, e.nombre, e.foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento, e.cargo_id, e.activo
              FROM empleados e
              WHERE NULLIF(TRIM(a.employee_no), '') IS NOT NULL
                AND (
                  REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
                  OR a.employee_no = CAST(e.id AS TEXT)
                )
              ORDER BY e.activo DESC, e.id DESC
              LIMIT 1
            ) e ON TRUE
            LEFT JOIN cargos c ON e.cargo_id = c.id
            LEFT JOIN areas ar ON c.area_id = ar.id
            LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
            LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
            LEFT JOIN salas s ON d.sala_id = s.id
            WHERE a.id = ${attlogId}
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
          id: attlogId,
          has_photo: hasPhoto,
          dispositivo_id: Number(dispositivo_id),
          sala_id: data.sala_id || null,
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
        console.log(`\x1b[32m🟢 [ATTLOG]\x1b[0m Evento emitido | emp: ${empName} | sala: ${fullRecord?.sala_nombre || data.sala_nombre} | status: ${fullRecord?.attendancestatus || log.attendanceStatus} | id: ${attlogId}`);
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
  const dId = dispositivoId ? Number(dispositivoId) : null;
  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);
  if (isPgConnected && sql) {
    let rows;
    if (dId) {
      rows = await sql`
        SELECT to_char(max(event_time) AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') as last_event_time 
        FROM attlogs 
        WHERE dispositivo_id = ${dId} AND LOWER(COALESCE(attendancestatus, '')) IN ('checkin', 'checkout')
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
    if (dId) devLogs = devLogs.filter(a => Number(a.dispositivo_id) === dId);
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
        await sql`UPDATE attlogs SET has_photo = TRUE WHERE id = ${attlogId}`;
      }
    }
  } catch (err) {
    console.error(`Error guardando foto para marcaje attlog #${attlogId}:`, err.message);
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

    if (salaIds && Array.isArray(salaIds) && salaIds.length > 0) {
      whereConds.push(sql`d.sala_id = ANY(${salaIds})`);
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
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
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

const permNameToId = {
  'AGREGAR': 1,
  'EDITAR': 3,
  'ELIMINAR': 4,
  'BORRAR': 4,
  'VER': 5
};

export async function getUserSalasMapModel() {
  if (isPgConnected && sql) {
    const rows = await sql`SELECT user_id, sala_id FROM user_salas`;
    const map = {};
    for (const r of rows) {
      if (!map[r.user_id]) map[r.user_id] = [];
      map[r.user_id].push(r.sala_id);
    }
    return map;
  }
  return inMemoryData.user_salas || {};
}

export async function updateUserSalasModel(userId, salaIds) {
  const uId = Number(userId);
  const ids = Array.isArray(salaIds) ? salaIds.map(Number).filter(n => !isNaN(n)) : [];

  if (isPgConnected && sql) {
    await sql`DELETE FROM user_salas WHERE user_id = ${uId}`;
    for (const sId of ids) {
      await sql`INSERT INTO user_salas (user_id, sala_id) VALUES (${uId}, ${sId}) ON CONFLICT DO NOTHING`;
    }
  }
  inMemoryData.user_salas = inMemoryData.user_salas || {};
  inMemoryData.user_salas[uId] = ids;
  return { success: true, user_id: uId, salas: ids };
}

export async function getUserPermissionsMapModel() {
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT ump.user_id, ump.module_id, p.nombre as perm_name
      FROM user_module_permissions ump
      INNER JOIN permissions p ON ump.permission_id = p.id
    `;
    const map = {};
    for (const r of rows) {
      if (!map[r.user_id]) map[r.user_id] = {};
      if (!map[r.user_id][r.module_id]) map[r.user_id][r.module_id] = [];
      if (!map[r.user_id][r.module_id].includes(r.perm_name)) {
        map[r.user_id][r.module_id].push(r.perm_name);
      }
    }
    return map;
  }
  return inMemoryData.user_module_permissions || {};
}

export async function updateUserPermissionsModel(userId, permissionsMap) {
  const uId = Number(userId);
  const modMap = permissionsMap || {};

  if (isPgConnected && sql) {
    await sql`DELETE FROM user_module_permissions WHERE user_id = ${uId}`;
    for (const [modIdStr, perms] of Object.entries(modMap)) {
      const mId = Number(modIdStr);
      if (isNaN(mId) || !Array.isArray(perms)) continue;
      for (const pName of perms) {
        const pId = permNameToId[pName];
        if (pId) {
          await sql`
            INSERT INTO user_module_permissions (user_id, module_id, permission_id)
            VALUES (${uId}, ${mId}, ${pId})
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }
  }
  inMemoryData.user_module_permissions = inMemoryData.user_module_permissions || {};
  inMemoryData.user_module_permissions[uId] = modMap;
  return { success: true, user_id: uId, permissions: modMap };
}


// --- DEPARTAMENTOS ---
export function buildDepartamentoConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(d.id AS TEXT) LIKE ${term}
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  }

  const countsRes = await sql`
    SELECT d.sala_id AS id, COUNT(d.id)::int AS count
    FROM departamentos d
    LEFT JOIN salas s ON d.sala_id = s.id
    ${where}
    GROUP BY d.sala_id
  `;
  const countMap = new Map(countsRes.map(r => [r.id, r.count]));
  const activeSalas = new Set((options.salaIds || []).map(Number));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }

  const conds = buildDepartamentoConditions({
    userSalaIds,
    salaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'd.id',
    'nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'd.id';

  const countRes = await sql`
    SELECT COUNT(d.id)::int AS total
    FROM departamentos d
    LEFT JOIN salas s ON d.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, d.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT d.*, s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT d.*, s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_id = s.id
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
  if (!data.sala_id) throw new Error('Debe seleccionar una sala para el departamento');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM departamentos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un departamento registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO departamentos (id, nombre, sala_id)
      VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM departamentos), ${cleanName}, ${Number(data.sala_id)})
      RETURNING *
    `;
    return rows[0];
  }
  return null;
}

export async function updateDepartamentoModel(id, data) {
  const dId = Number(id);
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del departamento es obligatorio');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM departamentos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND id != ${dId}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otro departamento registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    // sala_id is immutable once created
    const rows = await sql`
      UPDATE departamentos
      SET nombre = ${cleanName}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${dId}
      RETURNING *
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Departamentos seleccionados
  if (!options.skipDepartamentos && options.departamentoIds && options.departamentoIds.length > 0) {
    conds.push(sql`d.id = ANY(${options.departamentoIds})`);
  }

  // 4. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(a.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(a.id AS TEXT) LIKE ${term}
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
      if (options.userSalaIds && options.userSalaIds.length > 0) {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT s.id, COUNT(a.id)::int AS count
        FROM areas a
        JOIN departamentos d ON a.departamento_id = d.id
        JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY s.id
      `;
      const countMap = new Map(countsRes.map(r => [r.id, r.count]));
      const activeSalas = new Set((options.salaIds || []).map(Number));
      return allSalas
        .map(s => ({
          id: s.id,
          nombre: s.nombre,
          count: countMap.get(s.id) || 0
        }))
        .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
        .sort((a, b) => b.count - a.count);
    })(),

    // 2. Departamentos (Grouped by Sala)
    (async () => {
      const conds = buildAreaConditions({ ...options, skipDepartamentos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          d.id, 
          d.nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre, 
          COUNT(a.id)::int AS count
        FROM areas a
        JOIN departamentos d ON a.departamento_id = d.id
        LEFT JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY d.id, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set((options.departamentoIds || []).map(Number));
      return res
        .map(r => ({
          id: r.id,
          nombre: r.nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(Number(r.id)));
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let departamentoIds = null;
  if (params.departamento_ids) {
    departamentoIds = String(params.departamento_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }

  const conds = buildAreaConditions({
    userSalaIds,
    salaIds,
    departamentoIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'a.id',
    'nombre': 'a.nombre',
    'departamento_nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'a.id';

  const countRes = await sql`
    SELECT COUNT(a.id)::int AS total
    FROM areas a
    LEFT JOIN departamentos d ON a.departamento_id = d.id
    LEFT JOIN salas s ON d.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, a.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT a.*, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_id AS sala_id
      FROM areas a
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT a.*, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_id AS sala_id
      FROM areas a
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
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
  if (!data.departamento_id) throw new Error('Debe seleccionar un departamento para el área');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM areas 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un área registrada con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO areas (id, nombre, departamento_id)
      VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM areas), ${cleanName}, ${Number(data.departamento_id)})
      RETURNING *
    `;
    return rows[0];
  }
  return null;
}

export async function updateAreaModel(id, data) {
  const aId = Number(id);
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del área es obligatorio');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM areas 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND id != ${aId}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otra área registrada con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      UPDATE areas
      SET nombre = ${cleanName}, 
          departamento_id = ${data.departamento_id ? Number(data.departamento_id) : sql`departamento_id`},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${aId}
      RETURNING *
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Departamentos seleccionados
  if (!options.skipDepartamentos && options.departamentoIds && options.departamentoIds.length > 0) {
    conds.push(sql`d.id = ANY(${options.departamentoIds})`);
  }

  // 4. Áreas seleccionadas
  if (!options.skipAreas && options.areaIds && options.areaIds.length > 0) {
    conds.push(sql`a.id = ANY(${options.areaIds})`);
  }

  // 5. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(c.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(a.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(c.id AS TEXT) LIKE ${term}
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
      if (options.userSalaIds && options.userSalaIds.length > 0) {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT s.id, COUNT(c.id)::int AS count
        FROM cargos c
        JOIN areas a ON c.area_id = a.id
        JOIN departamentos d ON a.departamento_id = d.id
        JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY s.id
      `;
      const countMap = new Map(countsRes.map(r => [r.id, r.count]));
      const activeSalas = new Set((options.salaIds || []).map(Number));
      return allSalas
        .map(s => ({
          id: s.id,
          nombre: s.nombre,
          count: countMap.get(s.id) || 0
        }))
        .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
        .sort((a, b) => b.count - a.count);
    })(),

    // 2. Departamentos (Grouped by Sala)
    (async () => {
      const conds = buildCargoConditions({ ...options, skipDepartamentos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          d.id, 
          d.nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre, 
          COUNT(c.id)::int AS count
        FROM cargos c
        JOIN areas a ON c.area_id = a.id
        JOIN departamentos d ON a.departamento_id = d.id
        LEFT JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY d.id, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set((options.departamentoIds || []).map(Number));
      return res
        .map(r => ({
          id: r.id,
          nombre: r.nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(Number(r.id)));
    })(),

    // 3. Áreas (Grouped by Departamento and Sala)
    (async () => {
      const conds = buildCargoConditions({ ...options, skipAreas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          a.id, 
          a.nombre, 
          COALESCE(d.nombre, 'Sin Departamento') AS departamento_nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
          COUNT(c.id)::int AS count
        FROM cargos c
        JOIN areas a ON c.area_id = a.id
        LEFT JOIN departamentos d ON a.departamento_id = d.id
        LEFT JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY a.id, a.nombre, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set((options.areaIds || []).map(Number));
      return res
        .map(r => ({
          id: r.id,
          nombre: r.nombre,
          departamento_nombre: r.departamento_nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(Number(r.id)));
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let departamentoIds = null;
  if (params.departamento_ids) {
    departamentoIds = String(params.departamento_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let areaIds = null;
  if (params.area_ids) {
    areaIds = String(params.area_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }

  const conds = buildCargoConditions({
    userSalaIds,
    salaIds,
    departamentoIds,
    areaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'c.id',
    'nombre': 'c.nombre',
    'area_nombre': 'a.nombre',
    'departamento_nombre': 'd.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'c.id';

  const countRes = await sql`
    SELECT COUNT(c.id)::int AS total
    FROM cargos c
    LEFT JOIN areas a ON c.area_id = a.id
    LEFT JOIN departamentos d ON a.departamento_id = d.id
    LEFT JOIN salas s ON d.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, c.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT c.*, a.nombre AS area_nombre, d.id AS departamento_id, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_id AS sala_id
      FROM cargos c
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT c.*, a.nombre AS area_nombre, d.id AS departamento_id, d.nombre AS departamento_nombre, s.nombre AS sala_nombre, d.sala_id AS sala_id
      FROM cargos c
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
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
  if (!data.area_id) throw new Error('Debe seleccionar un área para el cargo');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM cargos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un cargo registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO cargos (id, nombre, area_id)
      VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM cargos), ${cleanName}, ${Number(data.area_id)})
      RETURNING *
    `;
    return rows[0];
  }
  return null;
}

export async function updateCargoModel(id, data) {
  const cId = Number(id);
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre del cargo es obligatorio');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM cargos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND id != ${cId}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otro cargo registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      UPDATE cargos
      SET nombre = ${cleanName}, 
          area_id = ${data.area_id ? Number(data.area_id) : sql`area_id`},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${cId}
      RETURNING *
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`d.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Departamentos seleccionados
  if (!options.skipDepartamentos && options.departamentoIds && options.departamentoIds.length > 0) {
    conds.push(sql`d.id = ANY(${options.departamentoIds})`);
  }

  // 4. Áreas seleccionadas
  if (!options.skipAreas && options.areaIds && options.areaIds.length > 0) {
    conds.push(sql`a.id = ANY(${options.areaIds})`);
  }

  // 5. Cargos seleccionados
  if (!options.skipCargos && options.cargoIds && options.cargoIds.length > 0) {
    conds.push(sql`c.id = ANY(${options.cargoIds})`);
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
      CAST(e.id AS TEXT) LIKE ${term}
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
      if (options.userSalaIds && options.userSalaIds.length > 0) {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT s.id, COUNT(e.id)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        JOIN departamentos d ON a.departamento_id = d.id
        JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY s.id
      `;
      const countMap = new Map(countsRes.map(r => [r.id, r.count]));
      const activeSalas = new Set((options.salaIds || []).map(Number));
      return allSalas
        .map(s => ({
          id: s.id,
          nombre: s.nombre,
          count: countMap.get(s.id) || 0
        }))
        .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
        .sort((a, b) => b.count - a.count);
    })(),

    // 2. Departamentos (Grouped by Sala)
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipDepartamentos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          d.id, 
          d.nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre, 
          COUNT(e.id)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        JOIN departamentos d ON a.departamento_id = d.id
        LEFT JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY d.id, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set((options.departamentoIds || []).map(Number));
      return res
        .map(r => ({
          id: r.id,
          nombre: r.nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(Number(r.id)));
    })(),

    // 3. Áreas (Grouped by Departamento and Sala)
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipAreas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          a.id, 
          a.nombre, 
          COALESCE(d.nombre, 'Sin Departamento') AS departamento_nombre, 
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
          COUNT(e.id)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        LEFT JOIN departamentos d ON a.departamento_id = d.id
        LEFT JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY a.id, a.nombre, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set((options.areaIds || []).map(Number));
      return res
        .map(r => ({
          id: r.id,
          nombre: r.nombre,
          departamento_nombre: r.departamento_nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(Number(r.id)));
    })(),

    // 4. Cargos (Grouped by Área, Departamento and Sala)
    (async () => {
      const conds = buildEmpleadoConditions({ ...options, skipCargos: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const res = await sql`
        SELECT 
          c.id, 
          c.nombre, 
          COALESCE(a.nombre, 'Sin Área') AS area_nombre, 
          COALESCE(d.nombre, 'Sin Departamento') AS departamento_nombre,
          COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
          COUNT(e.id)::int AS count
        FROM empleados e
        JOIN cargos c ON e.cargo_id = c.id
        LEFT JOIN areas a ON c.area_id = a.id
        LEFT JOIN departamentos d ON a.departamento_id = d.id
        LEFT JOIN salas s ON d.sala_id = s.id
        ${where}
        GROUP BY c.id, c.nombre, a.nombre, d.nombre, s.nombre
        ORDER BY count DESC
      `;
      const activeSet = new Set((options.cargoIds || []).map(Number));
      return res
        .map(r => ({
          id: r.id,
          nombre: r.nombre,
          area_nombre: r.area_nombre,
          departamento_nombre: r.departamento_nombre,
          sala_nombre: r.sala_nombre,
          count: r.count
        }))
        .filter(r => r.count > 0 || activeSet.has(Number(r.id)));
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
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        JOIN departamentos d ON a.departamento_id = d.id
        JOIN salas s ON d.sala_id = s.id
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let departamentoIds = null;
  if (params.departamento_ids) {
    departamentoIds = String(params.departamento_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let areaIds = null;
  if (params.area_ids) {
    areaIds = String(params.area_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let cargoIds = null;
  if (params.cargo_ids) {
    cargoIds = String(params.cargo_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
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
    'id': 'e.id',
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

  const orderCol = allowedSortColumns[sortBy] || 'e.id';

  const countRes = await sql`
    SELECT COUNT(e.id)::int AS total
    FROM empleados e
    LEFT JOIN cargos c ON e.cargo_id = c.id
    LEFT JOIN areas a ON c.area_id = a.id
    LEFT JOIN departamentos d ON a.departamento_id = d.id
    LEFT JOIN salas s ON d.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, e.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT e.id, e.foto, e.nombre, e.cedula, e.sexo, e.cargo_id, e.activo, e.motivo_desincorporacion,
             e.created_at, e.updated_at,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.id AS sala_id, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT e.id, e.foto, e.nombre, e.cedula, e.sexo, e.cargo_id, e.activo, e.motivo_desincorporacion,
             e.created_at, e.updated_at,
             to_char(e.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
             to_char(e.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
             c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.id AS sala_id, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
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
  const excId = excludeId ? Number(excludeId) : null;

  const rows = await sql`
    SELECT 
      e.id, 
      e.nombre, 
      e.cedula, 
      e.activo, 
      s.nombre AS sala_nombre
    FROM empleados e
    LEFT JOIN cargos c ON e.cargo_id = c.id
    LEFT JOIN areas a ON c.area_id = a.id
    LEFT JOIN departamentos d ON a.departamento_id = d.id
    LEFT JOIN salas s ON d.sala_id = s.id
    WHERE REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '') = ${normCedula}
      ${excId ? sql`AND e.id != ${excId}` : sql``}
    LIMIT 1
  `;

  if (rows.length > 0) {
    return {
      exists: true,
      empleado: {
        id: rows[0].id,
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
  const rows = await sql`
    SELECT dispositivo_id 
    FROM empleado_dispositivos 
    WHERE empleado_id = ${Number(empleadoId)}
  `;
  return rows.map(r => r.dispositivo_id);
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

export async function createEmpleadoModel(data) {
  if (isPgConnected && sql) {
    if (data.cedula && String(data.cedula).trim()) {
      const normCedula = String(data.cedula).trim().toUpperCase().replace(/V|-/g, '');
      const existing = await sql`
        SELECT id, nombre, cedula
        FROM empleados
        WHERE REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') = ${normCedula}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe un empleado registrado con la cédula ${data.cedula} (${existing[0].nombre})`);
      }
    }

    const nextIdRes = await sql`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM empleados`;
    const nextId = Number(nextIdRes[0].next_id);
    const foto = data.foto || `/empleados/${nextId}.jpg`;

    // Guardar foto en disco si viene en base64
    if (data.fotoBase64) {
      try {
        const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.join(process.cwd(), 'empleados');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${nextId}.jpg`), buffer);
      } catch (e) {
        console.error('Error guardando foto de empleado:', e);
      }
    }

    const fIngreso = cleanDateOnly(data.fecha_ingreso);
    const fNacimiento = cleanDateOnly(data.fecha_nacimiento);

    const rows = await sql`
      INSERT INTO empleados (id, foto, nombre, cedula, fecha_ingreso, fecha_nacimiento, sexo, cargo_id, activo, motivo_desincorporacion)
      VALUES (${nextId}, ${foto}, ${data.nombre}, ${data.cedula}, ${fIngreso}::date, ${fNacimiento}::date, ${data.sexo || 'Masculino'}, ${data.cargo_id || null}, ${data.activo ?? true}, ${data.motivo_desincorporacion || null})
      RETURNING *
    `;
    const emp = rows[0];

    // Sincronizar dispositivos seleccionados
    if (Array.isArray(data.dispositivo_ids)) {
      for (const devId of data.dispositivo_ids) {
        const dNum = Number(devId);
        if (!isNaN(dNum) && dNum > 0) {
          await sql`
            INSERT INTO empleado_dispositivos (id, empleado_id, dispositivo_id)
            VALUES (
              (SELECT COALESCE(MAX(id), 0) + 1 FROM empleado_dispositivos),
              ${nextId},
              ${dNum}
            )
          `;
        }
      }
    }

    return emp;
  }
  return null;
}

export async function updateEmpleadoModel(id, data) {
  const eId = Number(id);
  if (isPgConnected && sql) {
    // 1. Fetch current employee record to preserve fields not included in partial update
    const currentRows = await sql`SELECT * FROM empleados WHERE id = ${eId}`;
    if (currentRows.length === 0) throw new Error('Empleado no encontrado');
    const existing = currentRows[0];

    // Validar cédula única si se está actualizando
    const cedula = data.cedula !== undefined ? data.cedula : existing.cedula;
    if (cedula && String(cedula).trim()) {
      const normCedula = String(cedula).trim().toUpperCase().replace(/V|-/g, '');
      const existingWithCedula = await sql`
        SELECT id, nombre, cedula
        FROM empleados
        WHERE REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') = ${normCedula}
          AND id <> ${eId}
        LIMIT 1
      `;
      if (existingWithCedula.length > 0) {
        throw new Error(`Ya existe otro empleado registrado con la cédula ${cedula} (${existingWithCedula[0].nombre})`);
      }
    }

    // Guardar nueva foto en disco si viene en base64
    if (data.fotoBase64) {
      try {
        const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.join(process.cwd(), 'empleados');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${eId}.jpg`), buffer);
      } catch (e) {
        console.error('Error actualizando foto de empleado:', e);
      }
    }

    const foto = data.foto !== undefined ? data.foto : (data.fotoBase64 ? `/empleados/${eId}.jpg` : existing.foto);
    const nombre = data.nombre !== undefined ? data.nombre : existing.nombre;
    const rawIngreso = data.fecha_ingreso !== undefined ? data.fecha_ingreso : existing.fecha_ingreso;
    const fecha_ingreso = cleanDateOnly(rawIngreso);
    const rawNac = data.fecha_nacimiento !== undefined ? data.fecha_nacimiento : existing.fecha_nacimiento;
    const fecha_nacimiento = cleanDateOnly(rawNac);
    const sexo = data.sexo !== undefined ? data.sexo : existing.sexo;
    const cargo_id = data.cargo_id !== undefined ? (data.cargo_id ? Number(data.cargo_id) : null) : existing.cargo_id;
    const activo = data.activo !== undefined ? Boolean(data.activo) : existing.activo;
    const motivo_desincorporacion = data.motivo_desincorporacion !== undefined ? data.motivo_desincorporacion : existing.motivo_desincorporacion;

    const rows = await sql`
      UPDATE empleados
      SET foto = ${foto},
          nombre = ${nombre},
          cedula = ${cedula},
          fecha_ingreso = ${fecha_ingreso}::date,
          fecha_nacimiento = ${fecha_nacimiento}::date,
          sexo = ${sexo},
          cargo_id = ${cargo_id},
          activo = ${activo},
          motivo_desincorporacion = ${motivo_desincorporacion},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${eId}
      RETURNING *
    `;
    const updatedEmp = rows[0];

    // Sincronizar dispositivos seleccionados si se enviaron
    if (Array.isArray(data.dispositivo_ids)) {
      await sql`DELETE FROM empleado_dispositivos WHERE empleado_id = ${eId}`;
      for (const devId of data.dispositivo_ids) {
        const dNum = Number(devId);
        if (!isNaN(dNum) && dNum > 0) {
          await sql`
            INSERT INTO empleado_dispositivos (id, empleado_id, dispositivo_id)
            VALUES (
              (SELECT COALESCE(MAX(id), 0) + 1 FROM empleado_dispositivos),
              ${eId},
              ${dNum}
            )
          `;
        }
      }
    }

    return updatedEmp;
  }
  return null;
}

export async function deleteEmpleadoModel(id) {
  return await deleteEntityDynamic('empleados', 'empleado', id);
}



// --- PLANTILLAS HORARIOS ---
export function buildPlantillasHorariosConditions(options = {}) {
  const conds = [];

  // Excluir excepciones y plantillas sin horas asignadas (esta tabla es exclusivamente para Horarios de trabajo)
  conds.push(sql`p.hora_entrada IS NOT NULL AND p.hora_salida IS NOT NULL AND COALESCE(p.codigo, '') NOT IN ('L', 'U')`);

  // 1. Restricción por salas asignadas al usuario logueado
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`(p.sala_id IS NULL OR p.sala_id = ANY(${options.userSalaIds}))`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`p.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(p.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(p.codigo, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(p.id AS TEXT) LIKE ${term}
    )`);
  }

  return conds;
}

export async function getPlantillasHorariosFilterOptionsModel(options = {}) {
  if (!isPgConnected || !sql) {
    return {
      success: true,
      data: { salas: [] }
    };
  }

  const conds = buildPlantillasHorariosConditions({ ...options, skipSalas: true });
  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  let allSalas;
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  }

  const countsRes = await sql`
    SELECT p.sala_id AS id, COUNT(p.id)::int AS count
    FROM horarios p
    LEFT JOIN salas s ON p.sala_id = s.id
    ${where}
    GROUP BY p.sala_id
  `;
  const countMap = new Map(countsRes.map(r => [r.id, r.count]));
  const activeSalas = new Set((options.salaIds || []).map(Number));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
    .sort((a, b) => b.count - a.count);

  return {
    success: true,
    data: {
      salas
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

  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
  }

  const allowedSortColumns = {
    'id': 'p.id',
    'codigo': "CASE WHEN p.codigo ~ '^[0-9]+$' THEN LPAD(p.codigo, 10, '0') ELSE UPPER(p.codigo) END",
    'nombre': 'UPPER(p.nombre)',
    'sala_nombre': 'UPPER(s.nombre)',
    'horas_trabajo': 'p.hora_entrada',
    'hora_entrada': 'p.hora_entrada',
    'jornada': "COALESCE(p.hora_salida, '00:00:00') - COALESCE(p.hora_entrada, '00:00:00')",
    'color': 'p.color'
  };

  const sortSql = allowedSortColumns[sortBy] || allowedSortColumns['codigo'];
  const orderClause = sql.unsafe("ORDER BY " + sortSql + " " + sortDir + ", p.id DESC");

  if (isPgConnected && sql) {
    const conds = buildPlantillasHorariosConditions({
      userSalaIds,
      salaIds,
      search
    });

    const whereClause = conds.length > 0
      ? sql`WHERE ${conds.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const countRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM horarios p
      LEFT JOIN salas s ON p.sala_id = s.id
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT p.*, s.nombre AS sala_nombre
      FROM horarios p
      LEFT JOIN salas s ON p.sala_id = s.id
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
    const salaId = (data.sala_id !== null && data.sala_id !== undefined && data.sala_id !== '') ? Number(data.sala_id) : null;

    if (!codigo) {
      throw new Error('El código del horario es obligatorio.');
    }
    if (!nombre) {
      throw new Error('La descripción o nombre del horario es obligatorio.');
    }
    if (!salaId) {
      throw new Error('La sala asignada es obligatoria para el horario.');
    }

    // 1. Validar unicidad global contra excepciones
    const [excConflict] = await sql`
      SELECT id, codigo, descripcion 
      FROM excepciones 
      WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (excConflict) {
      throw new Error(`El código "${codigo}" no puede usarse porque pertenece a la excepción global "${excConflict.descripcion}".`);
    }

    // 2. Validar unicidad de código dentro de la misma sala
    const [horConflict] = await sql`
      SELECT h.id, h.codigo, h.nombre, COALESCE(s.nombre, 'esta sala') AS sala_nombre 
      FROM horarios h 
      LEFT JOIN salas s ON h.sala_id = s.id 
      WHERE LOWER(TRIM(h.codigo)) = LOWER(${codigo}) 
        AND ((${salaId}::int IS NULL AND h.sala_id IS NULL) OR h.sala_id = ${salaId}::int)
      LIMIT 1
    `;
    if (horConflict) {
      throw new Error(`El código "${codigo}" ya pertenece al horario "${horConflict.nombre}" de la sala "${horConflict.sala_nombre}".`);
    }

    const rows = await sql`
      INSERT INTO horarios (
        nombre, sala_id, codigo, hora_entrada, hora_salida, color
      )
      VALUES (
        ${nombre}, ${salaId}, ${codigo}, 
        ${data.hora_entrada || null}, ${data.hora_salida || null}, 
        ${data.color || '#FFFF99'}
      )
      RETURNING *
    `;
    return rows[0];
  }
  return null;
}

export async function updatePlantillaHorarioModel(id, data) {
  const pId = Number(id);
  if (isPgConnected && sql) {
    const [current] = await sql`
      SELECT id, codigo, sala_id, nombre 
      FROM horarios 
      WHERE id = ${pId}
    `;
    if (!current) {
      throw new Error(`El horario con ID ${pId} no existe.`);
    }

    const finalCodigo = (data.codigo !== undefined && data.codigo !== null)
      ? String(data.codigo).trim().toUpperCase()
      : (current.codigo ? String(current.codigo).trim().toUpperCase() : null);

    const finalSalaId = (data.sala_id !== undefined && data.sala_id !== null && data.sala_id !== '')
      ? Number(data.sala_id)
      : (current.sala_id !== null ? Number(current.sala_id) : null);

    if (finalCodigo) {
      // 1. Validar contra excepciones globales
      const [excConflict] = await sql`
        SELECT id, codigo, descripcion 
        FROM excepciones 
        WHERE LOWER(TRIM(codigo)) = LOWER(${finalCodigo}) 
        LIMIT 1
      `;
      if (excConflict) {
        throw new Error(`El código "${finalCodigo}" no puede usarse porque pertenece a la excepción global "${excConflict.descripcion}".`);
      }

      // 2. Validar contra horarios en la misma sala excluyendo el registro actual
      const [horConflict] = await sql`
        SELECT h.id, h.codigo, h.nombre, COALESCE(s.nombre, 'esta sala') AS sala_nombre 
        FROM horarios h 
        LEFT JOIN salas s ON h.sala_id = s.id 
        WHERE LOWER(TRIM(h.codigo)) = LOWER(${finalCodigo}) 
          AND ((${finalSalaId}::int IS NULL AND h.sala_id IS NULL) OR h.sala_id = ${finalSalaId}::int)
          AND h.id != ${pId}
        LIMIT 1
      `;
      if (horConflict) {
        throw new Error(`El código "${finalCodigo}" ya pertenece al horario "${horConflict.nombre}" de la sala "${horConflict.sala_nombre}".`);
      }
    }

    const nombre = data.nombre !== undefined ? data.nombre : current.nombre;
    const horaEntrada = data.hora_entrada !== undefined ? data.hora_entrada : null;
    const horaSalida = data.hora_salida !== undefined ? data.hora_salida : null;
    const color = data.color !== undefined ? data.color : '#FFFF99';

    const rows = await sql`
      UPDATE horarios
      SET nombre = ${nombre},
          sala_id = ${finalSalaId},
          codigo = ${finalCodigo},
          hora_entrada = ${horaEntrada},
          hora_salida = ${horaSalida},
          color = ${color},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${pId}
      RETURNING *
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

  let orderBySql = sql`ORDER BY d.id ASC`;

  if (sortBy === 'departamento_nombre') {
    orderBySql = sortOrder === 'DESC'
      ? sql`ORDER BY LOWER(d.nombre) DESC, d.id DESC`
      : sql`ORDER BY LOWER(d.nombre) ASC, d.id ASC`;
  } else if (sortBy === 'sala_nombre') {
    orderBySql = sortOrder === 'DESC'
      ? sql`ORDER BY LOWER(s.nombre) DESC, d.nombre DESC`
      : sql`ORDER BY LOWER(s.nombre) ASC, d.nombre ASC`;
  } else if (sortBy === 'id') {
    orderBySql = sortOrder === 'DESC'
      ? sql`ORDER BY d.id DESC`
      : sql`ORDER BY d.id ASC`;
  }

  let userSalaIds = null;
  if (params.user_sala_ids && String(params.user_sala_ids).trim().length > 0) {
    const parsed = String(params.user_sala_ids).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
    if (parsed.length > 0) userSalaIds = parsed;
  }

  let salaIds = null;
  if (params.sala_ids && String(params.sala_ids).trim().length > 0) {
    const parsed = String(params.sala_ids).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
    if (parsed.length > 0) salaIds = parsed;
  }

  try {
    let whereConditions = [];

    if (userSalaIds && Array.isArray(userSalaIds) && userSalaIds.length > 0) {
      whereConditions.push(sql`d.sala_id = ANY(${userSalaIds})`);
    }

    if (salaIds && Array.isArray(salaIds) && salaIds.length > 0) {
      whereConditions.push(sql`d.sala_id = ANY(${salaIds})`);
    }

    if (search) {
      const pattern = `%${search.toLowerCase()}%`;
      whereConditions.push(sql`(
        LOWER(COALESCE(d.nombre, '')) LIKE ${pattern} OR
        LOWER(COALESCE(s.nombre, '')) LIKE ${pattern} OR
        CAST(d.id AS TEXT) LIKE ${pattern}
      )`);
    }

    const whereClause = whereConditions.length > 0
      ? sql`WHERE ${whereConditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const countRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_id = s.id
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT 
        d.id AS id,
        d.nombre AS departamento_nombre,
        d.sala_id,
        s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_id = s.id
      ${whereClause}
      ${orderBySql}
      LIMIT ${limit} OFFSET ${offset}
    `;

    for (const item of dataRes) {
      // Get total active employees in this department
      const empCountRes = await sql`
        SELECT COUNT(e.id)::int AS total
        FROM empleados e
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        WHERE a.departamento_id = ${item.id} AND e.activo = TRUE
      `;
      item.total_empleados = empCountRes[0]?.total || 0;

      // Get all distinct assigned shift horarios for active employees in this department
      const horariosRes = await sql`
        SELECT DISTINCT ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color
        FROM empleados_horarios eph
        JOIN empleados e ON eph.empleado_id = e.id
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        JOIN horarios ph ON eph.horario_id = ph.id
        WHERE a.departamento_id = ${item.id} AND e.activo = TRUE
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
  const dId = Number(deptId);
  if (isNaN(dId) || !dId) return { success: false, error: 'ID de departamento inválido' };

  try {
    const [dept] = await sql`
      SELECT d.id, d.nombre AS departamento_nombre, d.sala_id, s.nombre AS sala_nombre
      FROM departamentos d
      LEFT JOIN salas s ON d.sala_id = s.id
      WHERE d.id = ${dId}
    `;

    if (!dept) return { success: false, error: 'Departamento no encontrado' };

    // Get all shift horarios for this department's sala
    const plantillasSala = await sql`
      SELECT id, codigo, nombre, hora_entrada, hora_salida, color
      FROM horarios
      WHERE sala_id = ${dept.sala_id}
      ORDER BY codigo ASC, id ASC
    `;

    // Get employees of this department
    const cleanSearch = String(search || '').trim().toLowerCase();
    let searchCondition = sql``;
    if (cleanSearch) {
      const pattern = `%${cleanSearch}%`;
      searchCondition = sql`AND (
        LOWER(COALESCE(e.nombre, '')) LIKE ${pattern} OR
        LOWER(COALESCE(e.cedula, '')) LIKE ${pattern} OR
        CAST(e.id AS TEXT) LIKE ${pattern} OR
        LOWER(COALESCE(c.nombre, '')) LIKE ${pattern}
      )`;
    }

    const empleados = await sql`
      SELECT 
        e.id AS empleado_id,
        e.nombre AS empleado_nombre,
        e.cedula,
        e.foto,
        c.nombre AS cargo_nombre,
        a.nombre AS area_nombre
      FROM empleados e
      JOIN cargos c ON e.cargo_id = c.id
      JOIN areas a ON c.area_id = a.id
      WHERE a.departamento_id = ${dId} AND e.activo = TRUE
      ${searchCondition}
      ORDER BY e.nombre ASC
    `;

    for (const emp of empleados) {
      const empHorarios = await sql`
        SELECT ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color
        FROM empleados_horarios eph
        JOIN horarios ph ON eph.horario_id = ph.id
        WHERE eph.empleado_id = ${emp.empleado_id}
        ORDER BY ph.codigo ASC, ph.id ASC
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
  const dId = Number(deptId);
  if (isNaN(dId) || !dId) return { success: false, error: 'ID de departamento inválido' };

  try {
    const action = payload.action;
    const plantillaId = payload.plantilla_id ? Number(payload.plantilla_id) : (payload.horario_id ? Number(payload.horario_id) : null);
    const empId = payload.empleado_id ? Number(payload.empleado_id) : null;

    if (action === 'bulk_add' && plantillaId) {
      await sql`
        INSERT INTO empleados_horarios (empleado_id, horario_id)
        SELECT e.id, ${plantillaId}
        FROM empleados e
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        WHERE a.departamento_id = ${dId} AND e.activo = TRUE
        ON CONFLICT DO NOTHING;
      `;
      return { success: true, message: 'Horario asignado a todos los empleados del departamento' };
    }

    if (action === 'bulk_remove_all') {
      // Remove ALL horarios from ALL employees in this department
      await sql`
        DELETE FROM empleados_horarios
        WHERE empleado_id IN (
          SELECT e.id
          FROM empleados e
          JOIN cargos c ON e.cargo_id = c.id
          JOIN areas a ON c.area_id = a.id
          WHERE a.departamento_id = ${dId} AND e.activo = TRUE
        )
        AND horario_id IN (
          SELECT id FROM horarios
        );
      `;
      return { success: true, message: 'Todos los horarios han sido quitados de los empleados del departamento' };
    }

    if (action === 'toggle' && empId && plantillaId) {
      const existing = await sql`
        SELECT id FROM empleados_horarios 
        WHERE empleado_id = ${empId} AND horario_id = ${plantillaId}
      `;
      if (existing.length > 0) {
        await sql`
          DELETE FROM empleados_horarios 
          WHERE empleado_id = ${empId} AND horario_id = ${plantillaId}
        `;
        return { success: true, action: 'removed' };
      } else {
        await sql`
          INSERT INTO empleados_horarios (empleado_id, horario_id)
          VALUES (${empId}, ${plantillaId})
          ON CONFLICT DO NOTHING;
        `;
        return { success: true, action: 'added' };
      }
    }

    if (action === 'remove' && empId && plantillaId) {
      await sql`
        DELETE FROM empleados_horarios 
        WHERE empleado_id = ${empId} AND horario_id = ${plantillaId}
      `;
      return { success: true };
    }

    if (Array.isArray(payload.assignments)) {
      for (const item of payload.assignments) {
        const eId = Number(item.empleado_id);
        const pIds = Array.isArray(item.plantilla_ids) ? item.plantilla_ids : (Array.isArray(item.horario_ids) ? item.horario_ids : []);
        if (!eId) continue;
        await sql`
          DELETE FROM empleados_horarios 
          WHERE empleado_id = ${eId}
          AND horario_id IN (
            SELECT id FROM horarios
          )
        `;
        for (const pId of pIds) {
          const numPId = Number(pId);
          if (numPId) {
            await sql`
              INSERT INTO empleados_horarios (empleado_id, horario_id)
              VALUES (${eId}, ${numPId})
              ON CONFLICT DO NOTHING;
            `;
          }
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
// 📅 MODELOS DE FERIADOS / CALENDARIO
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

  // Filtro por salas asignadas al usuario
  if (userSalaIds && userSalaIds.length > 0) {
    const ids = userSalaIds.map(Number).filter(Boolean);
    if (ids.length > 0) {
      conds.push(sql`f.sala_id IN ${sql(ids)}`);
    }
  }

  // Filtro por selección de salas en el filtro superior
  if (salaIds && salaIds.length > 0) {
    const ids = salaIds.map(Number).filter(Boolean);
    if (ids.length > 0) {
      conds.push(sql`f.sala_id IN ${sql(ids)}`);
    }
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

  let allSalas = [];
  if (userSalaIds.length > 0) {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id IN ${sql(userSalaIds)} AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  }

  const countsRes = await sql`
    SELECT f.sala_id AS id, COUNT(f.id)::int AS count
    FROM feriados f
    LEFT JOIN salas s ON f.sala_id = s.id
    ${where}
    GROUP BY f.sala_id
  `;
  const countMap = new Map(countsRes.map(r => [r.id, r.count]));
  const activeSalas = new Set((options.salaIds || []).map(Number));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
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

  const userSalaIds = params.user_sala_ids ? params.user_sala_ids.split(',').map(Number).filter(Boolean) : [];
  const salaIds = params.sala_ids ? params.sala_ids.split(',').map(Number).filter(Boolean) : [];

  const allowedSortColumns = {
    'id': 'f.id ' + sortDir,
    'nombre': 'UPPER(f.nombre) ' + sortDir,
    'sala_nombre': 'UPPER(s.nombre) ' + sortDir,
    'mes': 'f.mes ' + sortDir + ', f.dia ' + sortDir,
    'mes_nombre': 'f.mes ' + sortDir + ', f.dia ' + sortDir,
    'dia': 'f.dia ' + sortDir + ', f.mes ' + sortDir,
    'fecha': 'f.mes ' + sortDir + ', f.dia ' + sortDir
  };

  const sortSql = allowedSortColumns[sortBy] || ('f.mes ' + sortDir + ', f.dia ' + sortDir);
  const orderClause = sql.unsafe("ORDER BY " + sortSql + ", f.id ASC");

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
      LEFT JOIN salas s ON f.sala_id = s.id
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT f.*, s.nombre AS sala_nombre
      FROM feriados f
      LEFT JOIN salas s ON f.sala_id = s.id
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
  const salaId = Number(data.sala_id);
  const mes = Math.min(12, Math.max(1, parseInt(data.mes) || 1));
  const dia = Math.min(31, Math.max(1, parseInt(data.dia) || 1));

  if (!nombre) throw new Error('El nombre de la fecha patria o feriado es obligatorio');
  if (!salaId) throw new Error('Debe seleccionar una sala válida');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT f.id, f.nombre, s.nombre as sala_nombre
      FROM feriados f
      LEFT JOIN salas s ON f.sala_id = s.id
      WHERE f.sala_id = ${salaId} AND f.mes = ${mes} AND f.dia = ${dia}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un feriado ("${existing[0].nombre}") para esta sala en la fecha ${dia}/${mes}`);
    }
    const rows = await sql`
      INSERT INTO feriados (nombre, sala_id, mes, dia)
      VALUES (
        ${nombre},
        ${salaId},
        ${mes},
        ${dia}
      )
      RETURNING *
    `;
    const row = rows[0];
    if (row) {
      const sala = await sql`SELECT nombre FROM salas WHERE id = ${row.sala_id}`;
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
  const fId = Number(id);
  if (isPgConnected && sql) {
    const current = await sql`SELECT * FROM feriados WHERE id = ${fId}`;
    if (current.length === 0) throw new Error('Feriado no encontrado');

    const targetSalaId = data.sala_id ? Number(data.sala_id) : current[0].sala_id;
    const targetMes = data.mes ? Math.min(12, Math.max(1, parseInt(data.mes))) : current[0].mes;
    const targetDia = data.dia ? Math.min(31, Math.max(1, parseInt(data.dia))) : current[0].dia;

    const existing = await sql`
      SELECT f.id, f.nombre 
      FROM feriados f
      WHERE f.sala_id = ${targetSalaId} AND f.mes = ${targetMes} AND f.dia = ${targetDia} AND f.id != ${fId}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe otro feriado ("${existing[0].nombre}") para esta sala en la fecha ${targetDia}/${targetMes}`);
    }

    const rows = await sql`
      UPDATE feriados
      SET nombre = ${data.nombre ? data.nombre.trim() : sql`nombre`},
          sala_id = ${targetSalaId},
          mes = ${targetMes},
          dia = ${targetDia},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${fId}
      RETURNING *
    `;
    const row = rows[0];
    if (row) {
      const sala = await sql`SELECT nombre FROM salas WHERE id = ${row.sala_id}`;
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

    if (sala_ids) {
      const sIds = sala_ids.split(',').map(Number).filter(Boolean);
      if (sIds.length > 0) {
        conds.push(sql`s.id IN ${sql(sIds)}`);
      }
    } else if (user_sala_ids) {
      const uIds = user_sala_ids.split(',').map(Number).filter(Boolean);
      if (uIds.length > 0) {
        conds.push(sql`s.id IN ${sql(uIds)}`);
      }
    }

    const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const rows = await sql`
      SELECT 
        e.id, 
        e.nombre, 
        e.cedula,
        e.fecha_nacimiento, 
        e.fecha_ingreso,
        e.foto,
        EXTRACT(DAY FROM e.fecha_nacimiento)::int AS dia,
        EXTRACT(MONTH FROM e.fecha_nacimiento)::int AS mes,
        EXTRACT(YEAR FROM e.fecha_nacimiento)::int AS anio_nacimiento,
        s.id AS sala_id, 
        COALESCE(s.nombre, 'Sin Sala') AS sala_nombre,
        c.nombre AS cargo_nombre,
        COALESCE(d.nombre, 'General') AS departamento_nombre,
        COALESCE(a.nombre, '') AS area_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${where}
      ORDER BY dia ASC, e.nombre ASC
    `;

    return rows.map(r => ({
      ...r,
      foto: r.foto || `/empleados/${r.id}.jpg`
    }));
  }

  return [];
}

// --- CARNETS DE EMPLEADOS ---
export async function getCarnetsModel(params = {}) {
  const { sala_ids, user_sala_ids, search } = params;
  if (isPgConnected && sql) {
    const conds = [sql`e.activo = true`];

    if (sala_ids) {
      const sIds = String(sala_ids).split(',').map(Number).filter(Boolean);
      if (sIds.length > 0) {
        conds.push(sql`s.id IN ${sql(sIds)}`);
      }
    } else if (user_sala_ids) {
      const uIds = String(user_sala_ids).split(',').map(Number).filter(Boolean);
      if (uIds.length > 0) {
        conds.push(sql`s.id IN ${sql(uIds)}`);
      }
    }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      conds.push(sql`(e.nombre ILIKE ${term} OR e.cedula ILIKE ${term} OR c.nombre ILIKE ${term})`);
    }

    const where = sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const rows = await sql`
      SELECT 
        e.id, 
        e.nombre, 
        e.cedula,
        e.fecha_nacimiento, 
        e.fecha_ingreso,
        e.foto,
        s.id AS sala_id, 
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
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${where}
      ORDER BY s.nombre ASC, e.nombre ASC
    `;

    return rows.map(r => ({
      ...r,
      foto: r.foto || `/empleados/${r.id}.jpg`,
      sala_logo: `/salas/${r.sala_id}.svg`
    }));
  }

  return [];
}

// ==========================================
// 📊 HISTÓRICOS DE CORTES DE ASISTENCIA
// ==========================================

export async function getCortesModel(options = {}) {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 10;
  const offset = (page - 1) * limit;
  const search = options.search ? String(options.search).trim().toLowerCase() : '';
  const validSorts = ['id', 'fecha_desde', 'fecha_hasta', 'total_empleados', 'created_at', 'updated_at'];
  const sortBy = validSorts.includes(options.sortBy) ? options.sortBy : 'id';
  const sortDir = (options.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (isPgConnected && sql) {
    try {
      const conds = [];
      // Filtrar solo cortes con visible = TRUE (o NULL como TRUE para compatibilidad)
      conds.push(sql`COALESCE(cortes.visible, TRUE) = TRUE`);

      if (options.userSalaIds && options.userSalaIds.length > 0) {
        conds.push(sql`(cortes.salas_ids IS NULL OR cardinality(cortes.salas_ids) = 0 OR cortes.salas_ids && ${options.userSalaIds}::int[])`);
      }

      if (options.salaIds && options.salaIds.length > 0) {
        conds.push(sql`cortes.salas_ids && ${options.salaIds}::int[]`);
      }

      if (search) {
        const term = `%${search}%`;
        conds.push(sql`(
          CAST(cortes.id AS TEXT) LIKE ${term} OR
          EXISTS (
            SELECT 1 FROM salas s 
            WHERE s.id = ANY(cortes.salas_ids) 
              AND (LOWER(COALESCE(s.nombre_comercial, '')) LIKE ${term} OR LOWER(COALESCE(s.nombre, '')) LIKE ${term})
          )
        )`);
      }

      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
      const order = sql.unsafe(`ORDER BY cortes.${sortBy} ${sortDir}, cortes.id DESC`);

      const [countResult, rows] = await Promise.all([
        sql`SELECT COUNT(*)::int AS total FROM cortes ${where}`,
        sql`
          SELECT 
            cortes.id, 
            cortes.salas_ids, 
            cortes.fecha_desde, 
            cortes.fecha_hasta, 
            cortes.total_empleados, 
            cortes.created_at, 
            cortes.updated_at,
            (
              SELECT ARRAY_AGG(COALESCE(s.nombre_comercial, s.nombre))
              FROM salas s
              WHERE s.id = ANY(cortes.salas_ids)
            ) AS salas_nombres
          FROM cortes 
          ${where}
          ${order}
          LIMIT ${limit} OFFSET ${offset}
        `
      ]);

      return {
        success: true,
        data: rows,
        total: countResult[0]?.total || 0,
        page,
        limit
      };
    } catch (err) {
      console.error('Error getCortesModel en PG:', err);
    }
  }

  // Fallback in-memory
  let items = [...(inMemoryData.cortes || [])].filter(c => c.visible !== false && c.visible !== 0);
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    const userIds = options.userSalaIds.map(Number);
    items = items.filter(c => !c.salas_ids || c.salas_ids.length === 0 || (Array.isArray(c.salas_ids) && c.salas_ids.some(id => userIds.includes(Number(id)))));
  }
  if (options.salaIds && options.salaIds.length > 0) {
    const filterIds = options.salaIds.map(Number);
    items = items.filter(c => Array.isArray(c.salas_ids) && c.salas_ids.some(id => filterIds.includes(Number(id))));
  }
  if (search) {
    items = items.filter(c => 
      String(c.id).includes(search) ||
      (c.salas_nombres || []).some(n => String(n).toLowerCase().includes(search))
    );
  }
  items.sort((a, b) => b.id - a.id);
  const total = items.length;
  const paged = items.slice(offset, offset + limit).map(c => {
    const { data, ...rest } = c;
    return rest;
  });

  return {
    success: true,
    data: paged,
    total,
    page,
    limit
  };
}

export async function getCorteByIdModel(id) {
  const numId = Number(id);
  if (isPgConnected && sql) {
    try {
      const rows = await sql`SELECT * FROM cortes WHERE id = ${numId} LIMIT 1`;
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
        return { success: true, data: { ...rows[0], data: corteData } };
      }
      return { success: false, error: 'Corte no encontrado' };
    } catch (err) {
      console.error('Error getCorteByIdModel en PG:', err);
    }
  }

  const found = (inMemoryData.cortes || []).find(c => Number(c.id) === numId);
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
    salas_ids,
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

  // Extraer salas_ids limpios
  let cleanSalasIds = [];
  if (Array.isArray(salas_ids) && salas_ids.length > 0) {
    cleanSalasIds = Array.from(new Set(salas_ids.map(Number).filter(n => !isNaN(n) && n > 0)));
  } else if (sala_id) {
    cleanSalasIds = [Number(sala_id)];
  }

  // Si no vinieron salas_ids explícitos, extraer de los empleados en data
  if (cleanSalasIds.length === 0 && parsedData) {
    const emps = parsedData.empleados || (parsedData.reportData && parsedData.reportData.empleados) || [];
    if (Array.isArray(emps) && emps.length > 0) {
      const ids = emps.map(e => Number(e.sala_id)).filter(n => !isNaN(n) && n > 0);
      cleanSalasIds = Array.from(new Set(ids));
    }
  }

  const jsonStr = typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData || {});

  if (isPgConnected && sql) {
    try {
      const rows = await sql`
        INSERT INTO cortes (
          salas_ids, 
          fecha_desde, 
          fecha_hasta, 
          total_empleados, 
          data,
          visible
        ) VALUES (
          ${cleanSalasIds}::int[],
          ${fecha_desde},
          ${fecha_hasta},
          ${total_empleados ? Number(total_empleados) : 0},
          CAST(${jsonStr} AS JSONB),
          ${isVisible}
        )
        RETURNING id, salas_ids, fecha_desde, fecha_hasta, total_empleados, visible, created_at, updated_at
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
  const nextId = inMemoryData.cortes.length > 0 ? Math.max(...inMemoryData.cortes.map(c => Number(c.id) || 0)) + 1 : 1;
  const newCorte = {
    id: nextId,
    salas_ids: cleanSalasIds,
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
  const numId = Number(id);
  if (isPgConnected && sql) {
    try {
      await sql`DELETE FROM cortes WHERE id = ${numId}`;
      if (inMemoryData.cortes) {
        inMemoryData.cortes = inMemoryData.cortes.filter(c => Number(c.id) !== numId);
      }
      return { success: true };
    } catch (err) {
      console.error('Error deleteCorteModel en PG:', err);
      throw err;
    }
  }

  if (inMemoryData.cortes) {
    inMemoryData.cortes = inMemoryData.cortes.filter(c => Number(c.id) !== numId);
  }
  return { success: true };
}

export async function getCortesFilterOptionsModel(options = {}) {
  const salasMap = new Map();

  if (isPgConnected && sql) {
    try {
      let rows;
      if (options.userSalaIds && options.userSalaIds.length > 0) {
        rows = await sql`SELECT id, nombre, nombre_comercial FROM salas WHERE id = ANY(${options.userSalaIds}) AND (grupo_id IS NULL OR grupo_id = 1) ORDER BY id ASC`;
      } else {
        rows = await sql`SELECT id, nombre, nombre_comercial FROM salas WHERE (grupo_id IS NULL OR grupo_id = 1) ORDER BY id ASC`;
      }
      rows.forEach(s => {
        salasMap.set(Number(s.id), { id: s.id, nombre: s.nombre_comercial || s.nombre });
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
    if (!options.userSalaIds || options.userSalaIds.map(Number).includes(Number(s.id))) {
      salasMap.set(Number(s.id), { id: s.id, nombre: s.nombre_comercial || s.nombre });
    }
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
        SELECT * FROM descargas 
        ORDER BY id DESC
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
        SELECT * FROM descargas 
        WHERE plataforma = 'android' 
        ORDER BY id DESC LIMIT 1
      `;
      const windowsRows = await sql`
        SELECT * FROM descargas 
        WHERE plataforma = 'windows' 
        ORDER BY id DESC LIMIT 1
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

    // 4. Insert initial record to get generated ID
    const inserted = await sql`
      INSERT INTO descargas (plataforma, formato, archivo, peso, peso_bytes, version_num, fecha)
      VALUES (${plataforma}, ${formato}, 'temp', ${pesoFormateado}, ${pesoBytes}, ${versionNum}, CURRENT_TIMESTAMP)
      RETURNING id, fecha
    `;
    const recordId = inserted[0].id;

    // 5. Generate official filename: app-wisi-{plataforma}-v{conteo}-c{id}.{formato}
    const finalFilename = `app-wisi-${plataforma}-v${versionNum}-c${recordId}.${formato}`;

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
      WHERE id = ${recordId}
      RETURNING *
    `;

    return { success: true, data: updated[0] };
  }

  // Fallback in-memory
  if (!inMemoryData.descargas) inMemoryData.descargas = [];
  versionNum = inMemoryData.descargas.filter(d => d.plataforma === plataforma).length + 1;
  const nextId = inMemoryData.descargas.length > 0 ? Math.max(...inMemoryData.descargas.map(d => Number(d.id) || 0)) + 1 : 1;
  const finalFilename = `app-wisi-${plataforma}-v${versionNum}-c${nextId}.${formato}`;

  const downloadsDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  fs.writeFileSync(path.join(downloadsDir, finalFilename), buffer);

  const newDescarga = {
    id: nextId,
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
  const numId = Number(id);
  const fs = await import('fs');
  const path = await import('path');

  if (isPgConnected && sql) {
    const existing = await sql`SELECT archivo FROM descargas WHERE id = ${numId}`;
    if (existing.length > 0 && existing[0].archivo) {
      const filePath = path.join(process.cwd(), 'downloads', existing[0].archivo);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    await sql`DELETE FROM descargas WHERE id = ${numId}`;
    return { success: true };
  }

  if (inMemoryData.descargas) {
    inMemoryData.descargas = inMemoryData.descargas.filter(d => Number(d.id) !== numId);
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
      CAST(j.id AS TEXT) LIKE ${term}
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const conds = buildJuegoConditions({ search });
  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'j.id',
    'nombre': 'j.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'j.id';

  const countRes = await sql`
    SELECT COUNT(j.id)::int AS total
    FROM juegos j
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, j.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT j.*
      FROM juegos j
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT j.*
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

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM juegos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un juego registrado con el nombre "${toTitleCase(cleanName)}"`);
    }

    const rows = await sql`
      INSERT INTO juegos (nombre)
      VALUES (${cleanName})
      RETURNING *
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
  const jId = Number(id);
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;

  if (isPgConnected && sql) {
    if (cleanName) {
      const existing = await sql`
        SELECT id FROM juegos 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND id != ${jId}
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
      WHERE id = ${jId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.juegos || []).findIndex(j => j.id === jId);
    if (idx !== -1) {
      inMemoryData.juegos[idx] = { ...inMemoryData.juegos[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.juegos[idx];
    }
    return null;
  }
}

export async function deleteJuegoModel(id) {
  const jId = Number(id);
  if (isPgConnected && sql) {
    // Validar si tiene mesas asociadas
    const mesasCount = await sql`SELECT count(*)::int AS count FROM mesas WHERE juego_id = ${jId}`;
    if (mesasCount[0]?.count > 0) {
      const jNameRes = await sql`SELECT nombre FROM juegos WHERE id = ${jId}`;
      return {
        success: false,
        blocked: true,
        entityType: 'juego',
        entityName: jNameRes[0]?.nombre || `ID: ${jId}`,
        entityId: jId,
        message: `No se puede eliminar el juego porque tiene ${mesasCount[0].count} mesa(s) asociada(s). Elimine o reasigne primero las mesas vinculadas.`,
        dependencies: [{ label: 'Mesas Vinculadas', count: mesasCount[0].count }]
      };
    }
    await sql`DELETE FROM juegos WHERE id = ${jId}`;
    return { success: true, id: jId };
  } else {
    inMemoryData.juegos = (inMemoryData.juegos || []).filter(j => j.id !== jId);
    return { success: true, id: jId };
  }
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`m.sala_id = ANY(${options.userSalaIds})`);
  }

  // 3. Salas seleccionadas en el filtro
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`m.sala_id = ANY(${options.salaIds})`);
  }

  // 4. Juegos seleccionados en el filtro
  if (!options.skipJuegos && options.juegoIds && options.juegoIds.length > 0) {
    conds.push(sql`m.juego_id = ANY(${options.juegoIds})`);
  }

  // 5. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(m.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(j.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(m.id AS TEXT) LIKE ${term}
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  }

  const countsSalasRes = await sql`
    SELECT m.sala_id AS id, COUNT(m.id)::int AS count
    FROM mesas m
    LEFT JOIN salas s ON m.sala_id = s.id
    LEFT JOIN juegos j ON m.juego_id = j.id
    ${whereSalas}
    GROUP BY m.sala_id
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.id, r.count]));
  const activeSalas = new Set((options.salaIds || []).map(Number));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countSalasMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
    .sort((a, b) => b.count - a.count);

  // Filtro de Juegos
  const condsJuegos = buildMesaConditions({ ...options, skipJuegos: true, active });
  const whereJuegos = condsJuegos.length > 0 ? sql`WHERE ${condsJuegos.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allJuegos = await sql`SELECT j.id, j.nombre FROM juegos j ORDER BY j.nombre ASC`;

  const countsJuegosRes = await sql`
    SELECT m.juego_id AS id, COUNT(m.id)::int AS count
    FROM mesas m
    LEFT JOIN salas s ON m.sala_id = s.id
    LEFT JOIN juegos j ON m.juego_id = j.id
    ${whereJuegos}
    GROUP BY m.juego_id
  `;
  const countJuegosMap = new Map(countsJuegosRes.map(r => [r.id, r.count]));
  const activeJuegos = new Set((options.juegoIds || []).map(Number));

  const juegos = allJuegos
    .map(j => ({
      id: j.id,
      nombre: j.nombre,
      count: countJuegosMap.get(j.id) || 0
    }))
    .filter(j => j.count > 0 || activeJuegos.has(Number(j.id)))
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const active = params.active !== undefined ? Number(params.active) : 1;

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let juegoIds = null;
  if (params.juego_ids) {
    juegoIds = String(params.juego_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }

  const conds = buildMesaConditions({
    active,
    userSalaIds,
    salaIds,
    juegoIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'm.id',
    'nombre': 'm.nombre',
    'juego_nombre': 'j.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'm.id';

  const countRes = await sql`
    SELECT COUNT(m.id)::int AS total
    FROM mesas m
    LEFT JOIN salas s ON m.sala_id = s.id
    JOIN juegos j ON m.juego_id = j.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, m.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT m.*, j.nombre AS juego_nombre, s.id AS sala_id, s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM mesas m
      LEFT JOIN salas s ON m.sala_id = s.id
      JOIN juegos j ON m.juego_id = j.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT m.*, j.nombre AS juego_nombre, s.id AS sala_id, s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM mesas m
      LEFT JOIN salas s ON m.sala_id = s.id
      JOIN juegos j ON m.juego_id = j.id
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
  if (!data.juego_id) throw new Error('Debe seleccionar un juego para la mesa');
  if (!data.sala_id) throw new Error('Debe seleccionar una sala para la mesa');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM mesas 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND sala_id = ${Number(data.sala_id)}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe una mesa registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }

    const rows = await sql`
      INSERT INTO mesas (nombre, juego_id, sala_id, active)
      VALUES (${cleanName}, ${Number(data.juego_id)}, ${Number(data.sala_id)}, 1)
      RETURNING *
    `;
    return rows[0];
  } else {
    const cleanLower = cleanName.toLowerCase();
    const existing = (inMemoryData.mesas || []).find(m => (m.nombre || '').trim().toLowerCase() === cleanLower && Number(m.sala_id) === Number(data.sala_id));
    if (existing) {
      throw new Error(`Ya existe una mesa registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }
    const nextId = (inMemoryData.mesas?.length || 0) > 0 ? Math.max(...inMemoryData.mesas.map(m => m.id)) + 1 : 1;
    const newMesa = {
      id: nextId,
      nombre: cleanName,
      juego_id: Number(data.juego_id),
      sala_id: Number(data.sala_id),
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
  const mId = Number(id);
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
  const juegoId = data.juego_id ? Number(data.juego_id) : null;
  let salaId = data.sala_id ? Number(data.sala_id) : null;
  const active = data.active !== undefined ? Number(data.active) : null;

  if (isPgConnected && sql) {
    if (cleanName && !salaId) {
      const cur = await sql`SELECT sala_id FROM mesas WHERE id = ${mId} LIMIT 1`;
      if (cur.length > 0) {
        salaId = cur[0].sala_id;
      }
    }

    if (cleanName) {
      const existing = await sql`
        SELECT id FROM mesas 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND (${salaId}::int IS NULL OR sala_id = ${salaId})
          AND id != ${mId}
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe otra mesa registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
      }
    }

    const rows = await sql`
      UPDATE mesas
      SET 
        nombre = COALESCE(${cleanName}, nombre),
        juego_id = COALESCE(${juegoId}, juego_id),
        sala_id = COALESCE(${salaId}, sala_id),
        active = COALESCE(${active}, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${mId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.mesas || []).findIndex(m => m.id === mId);
    if (idx !== -1) {
      inMemoryData.mesas[idx] = { ...inMemoryData.mesas[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.mesas[idx];
    }
    return null;
  }
}

// Soft delete: Marca active = 0 (envía a Mesas Borradas)
export async function softDeleteMesaModel(id) {
  const mId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE mesas 
      SET active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ${mId} 
      RETURNING *
    `;
    return { success: true, id: mId, mesa: rows[0] };
  } else {
    const mesa = (inMemoryData.mesas || []).find(m => m.id === mId);
    if (mesa) mesa.active = 0;
    return { success: true, id: mId };
  }
}

// Restore: Marca active = 1 (restaura de Mesas Borradas a Mesas)
export async function restoreMesaModel(id) {
  const mId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE mesas 
      SET active = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ${mId} 
      RETURNING *
    `;
    return { success: true, id: mId, mesa: rows[0] };
  } else {
    const mesa = (inMemoryData.mesas || []).find(m => m.id === mId);
    if (mesa) mesa.active = 1;
    return { success: true, id: mId };
  }
}

// Purge: Eliminación física definitiva desde Mesas Borradas
export async function purgeMesaModel(id) {
  return await deleteEntityDynamic('mesas', 'mesa', id);
}

// =========================================================================
// 🎰 MODELOS PARA CONFIGURACIÓN DE MÁQUINAS (CONF.M: MAQUINAS)
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
      const sortBy = params.sortBy === 'nombre' ? 'nombre' : 'id';
      const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      const searchPattern = `%${search}%`;
      const whereClause = search
        ? sql`WHERE LOWER(nombre) LIKE ${searchPattern} OR id::text LIKE ${searchPattern}`
        : sql``;

      const countRes = await sql`
        SELECT COUNT(id)::int AS total
        FROM ${sql(tableName)}
        ${whereClause}
      `;
      const total = countRes[0]?.total || 0;

      const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, id DESC`);

      let data;
      if (limit > 0) {
        data = await sql`
          SELECT *
          FROM ${sql(tableName)}
          ${whereClause}
          ${orderClause}
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        data = await sql`
          SELECT *
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

      if (isPgConnected && sql) {
        const existing = await sql`
          SELECT id FROM ${sql(tableName)} 
          WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName})
          LIMIT 1
        `;
        if (existing.length > 0) {
          throw new Error(`Ya existe un registro de ${entityLabel} con el nombre "${toTitleCase(cleanName)}"`);
        }

        const rows = await sql`
          INSERT INTO ${sql(tableName)} (nombre)
          VALUES (${cleanName})
          RETURNING *
        `;
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
          nombre: toTitleCase(cleanName),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        inMemoryData[memKey] = [newItem, ...list];
        return newItem;
      }
    },

    update: async function(id, data) {
      const rId = Number(id);
      const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;

      if (isPgConnected && sql) {
        if (cleanName) {
          const existing = await sql`
            SELECT id FROM ${sql(tableName)} 
            WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND id != ${rId}
            LIMIT 1
          `;
          if (existing.length > 0) {
            throw new Error(`Ya existe otro registro de ${entityLabel} con el nombre "${toTitleCase(cleanName)}"`);
          }
        }

        const rows = await sql`
          UPDATE ${sql(tableName)}
          SET 
            nombre = COALESCE(${cleanName}, nombre),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${rId}
          RETURNING *
        `;
        return rows[0] ? { ...rows[0], nombre: toTitleCase(rows[0].nombre) } : null;
      } else {
        const list = inMemoryData[memKey] || [];
        const idx = list.findIndex(i => i.id === rId);
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...data, updated_at: new Date().toISOString() };
          if (cleanName) list[idx].nombre = toTitleCase(cleanName);
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

// 1.4. RANGOS (CONF.M: CECOM)
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
  const mId = Number(id);
  if (isPgConnected && sql) {
    const modelosCount = await sql`SELECT count(*)::int AS count FROM modelos WHERE marca_id = ${mId}`;
    if (modelosCount[0]?.count > 0) {
      const row = await sql`SELECT nombre FROM marcas WHERE id = ${mId}`;
      return {
        success: false,
        blocked: true,
        entityType: 'marca',
        entityName: row[0]?.nombre || `ID: ${mId}`,
        entityId: mId,
        message: `No se puede eliminar la marca porque tiene ${modelosCount[0].count} modelo(s) asociado(s). Elimine o reasigne primero los modelos vinculados.`,
        dependencies: [{ label: 'Modelos Vinculados', count: modelosCount[0].count }]
      };
    }
  }
  return await deleteEntityDynamic('marcas', 'marca', id);
}

// 6. MODELOS (Con marca_id y JOIN a marcas)
export async function getModelosModel(params = {}) {
  if (!isPgConnected || !sql) {
    let list = inMemoryData.modelos || [];
    const search = String(params.search || '').trim().toLowerCase();
    if (search) {
      list = list.filter(m => (m.nombre || '').toLowerCase().includes(search) || (m.marca_nombre || '').toLowerCase().includes(search));
    }
    if (params.marcaIds && params.marcaIds.length > 0) {
      list = list.filter(m => params.marcaIds.map(Number).includes(Number(m.marca_id)));
    }
    return { success: true, data: list, total: list.length, page: 1, limit: 10, totalPages: 1 };
  }

  const page = Math.max(1, Number(params.page) || 1);
  const hasLimit = params.limit !== undefined && String(params.limit).toLowerCase() !== 'all' && Number(params.limit) > 0;
  const limit = hasLimit ? Number(params.limit) : 0;
  const offset = hasLimit ? (page - 1) * limit : 0;
  const search = String(params.search || '').trim().toLowerCase();
  const sortBy = params.sortBy === 'nombre' ? 'm.nombre' : (params.sortBy === 'marca_nombre' ? 'ma.nombre' : 'm.id');
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const conds = [];
  if (params.marcaIds && params.marcaIds.length > 0) {
    conds.push(sql`m.marca_id = ANY(${params.marcaIds})`);
  }
  if (search) {
    const searchPattern = `%${search}%`;
    conds.push(sql`(LOWER(m.nombre) LIKE ${searchPattern} OR LOWER(ma.nombre) LIKE ${searchPattern} OR m.id::text LIKE ${searchPattern})`);
  }

  const whereClause = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const countRes = await sql`
    SELECT COUNT(m.id)::int AS total
    FROM modelos m
    LEFT JOIN marcas ma ON m.marca_id = ma.id
    ${whereClause}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, m.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT m.*, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_id = ma.id
      ${whereClause}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT m.*, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_id = ma.id
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
      conds.push(sql`(LOWER(m.nombre) LIKE ${searchPattern} OR LOWER(ma.nombre) LIKE ${searchPattern} OR m.id::text LIKE ${searchPattern})`);
    }
    const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

    const res = await sql`
      SELECT ma.id, ma.nombre, COUNT(DISTINCT m.id)::int AS count
      FROM modelos m
      JOIN marcas ma ON m.marca_id = ma.id
      ${where}
      GROUP BY ma.id, ma.nombre
      ORDER BY ma.nombre ASC
    `.catch(() => []);
    const active = new Set((options.marcaIds || []).map(Number));
    const marcas = (res || [])
      .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
      .filter(r => r.count > 0 || active.has(Number(r.id)));

    return { success: true, data: { marcas } };
  } catch (err) {
    return { success: true, data: { marcas: [] } };
  }
}

export async function createModeloModel(data) {
  const cleanName = (data.nombre || '').trim();
  const marcaId = data.marca_id ? Number(data.marca_id) : null;
  if (!cleanName) throw new Error('El nombre del modelo es obligatorio');

  if (isPgConnected && sql) {
    const marcaCond = marcaId !== null 
      ? sql`marca_id = ${marcaId}` 
      : sql`marca_id IS NULL`;

    const existing = await sql`
      SELECT id FROM modelos 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
        AND ${marcaCond}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un modelo con el nombre "${toTitleCase(cleanName)}" para esta marca`);
    }

    const rows = await sql`
      INSERT INTO modelos (nombre, marca_id)
      VALUES (${cleanName}, ${marcaId})
      RETURNING *
    `;
    const full = await sql`
      SELECT m.*, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_id = ma.id
      WHERE m.id = ${rows[0].id}
    `;
    return {
      ...full[0],
      nombre: toTitleCase(full[0].nombre),
      marca_nombre: full[0].marca_nombre ? toTitleCase(full[0].marca_nombre) : 'Sin Marca'
    };
  } else {
    const list = inMemoryData.modelos || [];
    const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
    const marca = (inMemoryData.marcas || []).find(ma => ma.id === marcaId);
    const newModelo = {
      id: nextId,
      nombre: toTitleCase(cleanName),
      marca_id: marcaId,
      marca_nombre: marca ? toTitleCase(marca.nombre) : 'Sin Marca',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.modelos = [newModelo, ...list];
    return newModelo;
  }
}

export async function updateModeloModel(id, data) {
  const mId = Number(id);
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
  const marcaId = data.marca_id !== undefined ? (data.marca_id ? Number(data.marca_id) : null) : undefined;

  if (isPgConnected && sql) {
    if (cleanName) {
      const marcaCond = marcaId !== undefined
        ? (marcaId !== null ? sql`marca_id = ${marcaId}` : sql`marca_id IS NULL`)
        : sql`1=1`;

      const existing = await sql`
        SELECT id FROM modelos 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND id != ${mId}
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
        marca_id = ${marcaId !== undefined ? marcaId : sql`marca_id`},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${mId}
    `;

    const full = await sql`
      SELECT m.*, ma.nombre AS marca_nombre
      FROM modelos m
      LEFT JOIN marcas ma ON m.marca_id = ma.id
      WHERE m.id = ${mId}
    `;
    return full[0] ? {
      ...full[0],
      nombre: toTitleCase(full[0].nombre),
      marca_nombre: full[0].marca_nombre ? toTitleCase(full[0].marca_nombre) : 'Sin Marca'
    } : null;
  } else {
    const list = inMemoryData.modelos || [];
    const idx = list.findIndex(i => i.id === mId);
    if (idx !== -1) {
      if (cleanName) list[idx].nombre = toTitleCase(cleanName);
      if (marcaId !== undefined) {
        list[idx].marca_id = marcaId;
        const marca = (inMemoryData.marcas || []).find(ma => ma.id === marcaId);
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
  const validSorts = ['codigo', 'descripcion', 'color', 'tipo', 'id'];
  const sortBy = validSorts.includes(params.sortBy) ? params.sortBy : 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const searchPattern = `%${search}%`;
  const whereClause = search
    ? sql`WHERE LOWER(codigo) LIKE ${searchPattern} OR LOWER(descripcion) LIKE ${searchPattern} OR LOWER(tipo) LIKE ${searchPattern} OR id::text LIKE ${searchPattern}`
    : sql``;

  const countRes = await sql`SELECT COUNT(id)::int AS total FROM excepciones ${whereClause}`;
  const total = countRes[0]?.total || 0;
  const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`SELECT * FROM excepciones ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
  } else {
    data = await sql`SELECT * FROM excepciones ${whereClause} ${orderClause}`;
  }
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
  return { success: true, data, total, page, limit, totalPages };
}

export async function createExcepcionModel(data) {
  const codigo = (data.codigo || '').trim().toUpperCase();
  const descripcion = (data.descripcion || '').trim();
  const color = (data.color || '#3B82F6').trim();
  const tipo = (data.tipo || 'Asignable').trim();

  if (!codigo || !descripcion) {
    throw new Error('El código y la descripción de la excepción son obligatorios.');
  }

  if (isPgConnected && sql) {
    // 1. Validar unicidad dentro de la tabla de excepciones
    const [existingExc] = await sql`
      SELECT id, codigo, descripcion 
      FROM excepciones 
      WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (existingExc) {
      throw new Error(`El código "${codigo}" ya está registrado en la excepción "${existingExc.descripcion}".`);
    }

    // 2. Validar que no pertenezca a ningún horario de ninguna sala en toda la tabla horarios
    const [existingHor] = await sql`
      SELECT h.id, h.codigo, h.nombre, COALESCE(s.nombre, 'Sin Sala') AS sala_nombre 
      FROM horarios h 
      LEFT JOIN salas s ON h.sala_id = s.id 
      WHERE LOWER(TRIM(h.codigo)) = LOWER(${codigo}) 
      LIMIT 1
    `;
    if (existingHor) {
      throw new Error(`El código "${codigo}" no puede usarse porque ya pertenece al horario "${existingHor.nombre}" de la sala "${existingHor.sala_nombre}".`);
    }

    const rows = await sql`
      INSERT INTO excepciones (codigo, descripcion, color, tipo)
      VALUES (${codigo}, ${descripcion}, ${color}, ${tipo})
      RETURNING *
    `;
    return rows[0];
  } else {
    const list = inMemoryData.excepciones || [];
    const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
    const newItem = { id: nextId, codigo, descripcion, color, tipo, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    inMemoryData.excepciones = [newItem, ...list];
    return newItem;
  }
}

export async function updateExcepcionModel(id, data) {
  const eId = Number(id);
  const codigo = data.codigo !== undefined && data.codigo !== null ? String(data.codigo).trim().toUpperCase() : null;
  const descripcion = data.descripcion !== undefined && data.descripcion !== null ? String(data.descripcion).trim() : null;
  const color = data.color !== undefined && data.color !== null ? String(data.color).trim() : null;
  const tipo = data.tipo !== undefined && data.tipo !== null ? String(data.tipo).trim() : null;

  if (isPgConnected && sql) {
    if (codigo) {
      // 1. Validar que no exista en otra excepción
      const [existingExc] = await sql`
        SELECT id, codigo, descripcion 
        FROM excepciones 
        WHERE LOWER(TRIM(codigo)) = LOWER(${codigo}) AND id != ${eId} 
        LIMIT 1
      `;
      if (existingExc) {
        throw new Error(`El código "${codigo}" ya está registrado en la excepción "${existingExc.descripcion}".`);
      }

      // 2. Validar que no pertenezca a ningún horario de ninguna sala en toda la tabla horarios
      const [existingHor] = await sql`
        SELECT h.id, h.codigo, h.nombre, COALESCE(s.nombre, 'Sin Sala') AS sala_nombre 
        FROM horarios h 
        LEFT JOIN salas s ON h.sala_id = s.id 
        WHERE LOWER(TRIM(h.codigo)) = LOWER(${codigo}) 
        LIMIT 1
      `;
      if (existingHor) {
        throw new Error(`El código "${codigo}" no puede usarse porque ya pertenece al horario "${existingHor.nombre}" de la sala "${existingHor.sala_nombre}".`);
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
      WHERE id = ${eId}
      RETURNING *
    `;
    return rows[0] || null;
  } else {
    const list = inMemoryData.excepciones || [];
    const idx = list.findIndex(i => i.id === eId);
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
  const validSorts = ['descripcion', 'dia', 'mes', 'id'];
  const sortBy = validSorts.includes(params.sortBy) ? params.sortBy : 'mes, dia';
  const sortDir = (params.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const searchPattern = `%${search}%`;
  const whereClause = search
    ? sql`WHERE LOWER(descripcion) LIKE ${searchPattern} OR dia::text LIKE ${searchPattern} OR mes::text LIKE ${searchPattern} OR id::text LIKE ${searchPattern}`
    : sql``;

  const countRes = await sql`SELECT COUNT(id)::int AS total FROM fechas_patrias ${whereClause}`;
  const total = countRes[0]?.total || 0;
  const orderClause = sql.unsafe(`ORDER BY ${sortBy} ${sortDir}, id ASC`);

  let data;
  if (limit > 0) {
    data = await sql`SELECT * FROM fechas_patrias ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
  } else {
    data = await sql`SELECT * FROM fechas_patrias ${whereClause} ${orderClause}`;
  }
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
  return { success: true, data, total, page, limit, totalPages };
}

export async function createFechaPatriaModel(data) {
  const descripcion = (data.descripcion || '').trim();
  const dia = Number(data.dia);
  const mes = Number(data.mes);

  if (!descripcion) throw new Error('La descripción de la fecha patria es obligatoria');
  if (isNaN(dia) || dia < 1 || dia > 31) throw new Error('El día debe ser un número entre 1 y 31');
  if (isNaN(mes) || mes < 1 || mes > 12) throw new Error('El mes debe ser un número entre 1 y 12');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id, descripcion FROM fechas_patrias 
      WHERE dia = ${dia} AND mes = ${mes}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe una fecha patria registrada para el ${dia}/${mes} ("${existing[0].descripcion}")`);
    }
    const rows = await sql`
      INSERT INTO fechas_patrias (descripcion, dia, mes)
      VALUES (${descripcion}, ${dia}, ${mes})
      RETURNING *
    `;
    return rows[0];
  } else {
    const list = inMemoryData.fechas_patrias || [];
    if (list.some(i => Number(i.dia) === dia && Number(i.mes) === mes)) {
      throw new Error(`Ya existe una fecha patria registrada para el ${dia}/${mes}`);
    }
    const nextId = list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1;
    const newItem = { id: nextId, descripcion, dia, mes, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    inMemoryData.fechas_patrias = [newItem, ...list];
    return newItem;
  }
}

export async function updateFechaPatriaModel(id, data) {
  const fId = Number(id);
  const descripcion = data.descripcion !== undefined ? String(data.descripcion).trim() : null;
  const dia = data.dia !== undefined ? Number(data.dia) : null;
  const mes = data.mes !== undefined ? Number(data.mes) : null;

  if (dia !== null && (isNaN(dia) || dia < 1 || dia > 31)) throw new Error('El día debe ser un número entre 1 y 31');
  if (mes !== null && (isNaN(mes) || mes < 1 || mes > 12)) throw new Error('El mes debe ser un número entre 1 y 12');

  if (isPgConnected && sql) {
    const current = await sql`SELECT * FROM fechas_patrias WHERE id = ${fId}`;
    if (current.length === 0) throw new Error('Fecha patria no encontrada');

    const targetDia = dia !== null ? dia : current[0].dia;
    const targetMes = mes !== null ? mes : current[0].mes;

    const existing = await sql`
      SELECT id, descripcion FROM fechas_patrias 
      WHERE dia = ${targetDia} AND mes = ${targetMes} AND id != ${fId}
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
      WHERE id = ${fId}
      RETURNING *
    `;
    return rows[0] || null;
  } else {
    const list = inMemoryData.fechas_patrias || [];
    const idx = list.findIndex(i => i.id === fId);
    if (idx !== -1) {
      const targetDia = dia !== null ? dia : list[idx].dia;
      const targetMes = mes !== null ? mes : list[idx].mes;
      if (list.some(i => Number(i.dia) === Number(targetDia) && Number(i.mes) === Number(targetMes) && i.id !== fId)) {
        throw new Error(`Ya existe otra fecha patria registrada para el ${targetDia}/${targetMes}`);
      }
      if (descripcion !== null) list[idx].descripcion = descripcion;
      if (dia !== null) list[idx].dia = dia;
      if (mes !== null) list[idx].mes = mes;
      list[idx].updated_at = new Date().toISOString();
      return list[idx];
    }
    return null;
  }
}

export async function deleteFechaPatriaModel(id) {
  return await deleteEntityDynamic('fechas_patrias', 'fecha patria', id);
}

// ==========================================
// 🎰 12. MÁQUINAS (CRUD PRINCIPAL)
// ==========================================

export function buildMaquinasConditions(params = {}) {
  const conds = [];

  if (params.userSalaIds && params.userSalaIds.length > 0) {
    conds.push(sql`m.sala_id = ANY(${params.userSalaIds})`);
  }
  if (!params.skipSalas && params.salaIds && params.salaIds.length > 0) {
    conds.push(sql`m.sala_id = ANY(${params.salaIds})`);
  }
  if (!params.skipGrupos && params.grupoIds && params.grupoIds.length > 0) {
    conds.push(sql`s.grupo_id = ANY(${params.grupoIds})`);
  }
  if (!params.skipMarcas && params.marcaIds && params.marcaIds.length > 0) {
    conds.push(sql`mod.marca_id = ANY(${params.marcaIds})`);
  }
  if (!params.skipModelos && params.modeloIds && params.modeloIds.length > 0) {
    conds.push(sql`m.modelo_id = ANY(${params.modeloIds})`);
  }
  if (!params.skipJuegos && params.juegoIds && params.juegoIds.length > 0) {
    conds.push(sql`m.juego_id = ANY(${params.juegoIds})`);
  }
  if (!params.skipEstados && params.estadoIds && params.estadoIds.length > 0) {
    conds.push(sql`m.estado_id = ANY(${params.estadoIds})`);
  }
  if (!params.skipSociedades && params.sociedadIds && params.sociedadIds.length > 0) {
    conds.push(sql`m.sociedad_id = ANY(${params.sociedadIds})`);
  }
  if (!params.skipValores && params.valorIds && params.valorIds.length > 0) {
    conds.push(sql`m.valor_id = ANY(${params.valorIds})`);
  }
  if (!params.skipTipos && params.tipoIds && params.tipoIds.length > 0) {
    conds.push(sql`m.tipo_id = ANY(${params.tipoIds})`);
  }
  if (!params.skipModos && params.modoIds && params.modoIds.length > 0) {
    conds.push(sql`m.modo_id = ANY(${params.modoIds})`);
  }
  if (!params.skipLegales && params.legalIds && params.legalIds.length > 0) {
    conds.push(sql`m.legal_id = ANY(${params.legalIds})`);
  }

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
      m.id::text LIKE ${term}
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
    let list = inMemoryData.maquinas || [];
    if (search) {
      list = list.filter(m =>
        (m.nombre || '').toLowerCase().includes(search) ||
        (m.serial || '').toLowerCase().includes(search) ||
        (m.sala_nombre || '').toLowerCase().includes(search) ||
        String(m.id).includes(search)
      );
    }
    if (searchNombre) {
      list = list.filter(m => (m.nombre || '').toLowerCase().includes(searchNombre));
    }
    if (searchSerial) {
      list = list.filter(m => (m.serial || '').toLowerCase().includes(searchSerial));
    }
    if (params.userSalaIds && params.userSalaIds.length > 0) {
      list = list.filter(m => m.sala_id && params.userSalaIds.map(Number).includes(Number(m.sala_id)));
    }
    if (params.salaIds && params.salaIds.length > 0) {
      list = list.filter(m => m.sala_id && params.salaIds.map(Number).includes(Number(m.sala_id)));
    }
    const total = list.length;
    const paged = list.slice(offset, offset + limit);
    return { success: true, data: paged, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  }

  try {
    const conds = buildMaquinasConditions(params);
    const whereClause = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

    const validSortCols = {
      id: 'm.id',
      nombre: 'm.nombre',
      serial: 'm.serial',
      puestos: 'm.puestos',
      sala_id: 's.nombre',
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
      created_at: 'm.created_at'
    };

    const sortCol = validSortCols[params.sortBy] || 'm.id';
    const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderClause = sql.unsafe(`ORDER BY ${sortCol} ${sortDir}, m.id DESC`);

    const fromJoin = sql`
      FROM maquinas m
      LEFT JOIN salas s ON m.sala_id = s.id
      LEFT JOIN grupo_salas gs ON s.grupo_id = gs.id
      LEFT JOIN juegos_maquinas j ON m.juego_id = j.id
      LEFT JOIN estados e ON m.estado_id = e.id
      LEFT JOIN sociedades soc ON m.sociedad_id = soc.id
      LEFT JOIN valores v ON m.valor_id = v.id
      LEFT JOIN modelos mod ON m.modelo_id = mod.id
      LEFT JOIN marcas mar ON mod.marca_id = mar.id
      LEFT JOIN tipos t ON m.tipo_id = t.id
      LEFT JOIN modos mo ON m.modo_id = mo.id
      LEFT JOIN legal l ON m.legal_id = l.id
    `;

    const countRes = await sql`SELECT COUNT(m.id)::int AS total ${fromJoin} ${whereClause}`;
    const total = countRes[0]?.total || 0;

    const selectCols = sql`
      SELECT 
        m.id,
        m.nombre,
        m.serial,
        m.puestos,
        m.sala_id,
        s.nombre AS sala_nombre,
        s.nombre_comercial AS sala_nombre_comercial,
        s.grupo_id AS grupo_sala_id,
        gs.nombre AS grupo_sala_nombre,
        m.juego_id,
        j.nombre AS juego_nombre,
        m.estado_id,
        e.nombre AS estado_nombre,
        m.sociedad_id,
        soc.nombre AS sociedad_nombre,
        m.valor_id,
        v.nombre AS valor_nombre,
        m.modelo_id,
        mod.nombre AS modelo_nombre,
        mod.marca_id,
        mar.nombre AS marca_nombre,
        m.tipo_id,
        t.nombre AS tipo_nombre,
        m.modo_id,
        mo.nombre AS modo_nombre,
        m.legal_id,
        l.nombre AS legal_nombre,
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
        legales: inMemoryData.legal || []
      }
    };
  }

  try {
    const fromJoin = sql`
      FROM maquinas m
      LEFT JOIN salas s ON m.sala_id = s.id
      LEFT JOIN grupo_salas gs ON s.grupo_id = gs.id
      LEFT JOIN juegos_maquinas j ON m.juego_id = j.id
      LEFT JOIN estados e ON m.estado_id = e.id
      LEFT JOIN sociedades soc ON m.sociedad_id = soc.id
      LEFT JOIN valores v ON m.valor_id = v.id
      LEFT JOIN modelos mod ON m.modelo_id = mod.id
      LEFT JOIN marcas mar ON mod.marca_id = mar.id
      LEFT JOIN tipos t ON m.tipo_id = t.id
      LEFT JOIN modos mo ON m.modo_id = mo.id
      LEFT JOIN legal l ON m.legal_id = l.id
    `;

    const [sociedadesRes, legalesRes, marcasRes, modelosRes, juegosRes, gruposRes, salasRes, estadosRes, valoresRes, tiposRes, modosRes] = await Promise.all([
      // 1. Sociedades (Grouped from maquinas matching filters)
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipSociedades: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT soc.id, soc.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND soc.id IS NOT NULL
          GROUP BY soc.id, soc.nombre
          ORDER BY soc.nombre ASC
        `.catch(() => []);
        const active = new Set((options.sociedadIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 2. Legal
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipLegales: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT l.id, l.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND l.id IS NOT NULL
          GROUP BY l.id, l.nombre
          ORDER BY l.nombre ASC
        `.catch(() => []);
        const active = new Set((options.legalIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 3. Marcas
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipMarcas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT mar.id, mar.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND mar.id IS NOT NULL
          GROUP BY mar.id, mar.nombre
          ORDER BY mar.nombre ASC
        `.catch(() => []);
        const active = new Set((options.marcaIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 4. Modelos (Subgroup label by Marca)
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipModelos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT mod.id, mod.nombre, mod.marca_id, mar.nombre AS marca_nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND mod.id IS NOT NULL
          GROUP BY mod.id, mod.nombre, mod.marca_id, mar.nombre
          ORDER BY mar.nombre ASC, mod.nombre ASC
        `.catch(() => []);
        const active = new Set((options.modeloIds || []).map(Number));
        return (res || [])
          .map(r => ({ 
            id: r.id, 
            nombre: toTitleCase(r.nombre), 
            marca_id: r.marca_id,
            subgroup_label: r.marca_nombre ? toTitleCase(r.marca_nombre) : 'Sin Marca',
            count: r.count 
          }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 5. Juegos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipJuegos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT j.id, j.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND j.id IS NOT NULL
          GROUP BY j.id, j.nombre
          ORDER BY j.nombre ASC
        `.catch(() => []);
        const active = new Set((options.juegoIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 6. Grupos de Sala
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipGrupos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT gs.id, gs.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND gs.id IS NOT NULL
          GROUP BY gs.id, gs.nombre
          ORDER BY gs.nombre ASC
        `.catch(() => []);
        const active = new Set((options.grupoIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 7. Salas (Subgroup label by Grupo)
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipSalas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT s.id, s.nombre, s.nombre_comercial, s.grupo_id, gs.nombre AS grupo_nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND s.id IS NOT NULL
          GROUP BY s.id, s.nombre, s.nombre_comercial, s.grupo_id, gs.nombre
          ORDER BY s.nombre ASC
        `.catch(() => []);
        const active = new Set((options.salaIds || []).map(Number));
        return (res || [])
          .map(r => ({ 
            id: r.id, 
            nombre: r.nombre, 
            grupo_id: r.grupo_id,
            subgroup_label: r.grupo_nombre ? toTitleCase(r.grupo_nombre) : 'Sin Grupo',
            count: r.count 
          }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 8. Estados
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipEstados: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT e.id, e.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND e.id IS NOT NULL
          GROUP BY e.id, e.nombre
          ORDER BY e.nombre ASC
        `.catch(() => []);
        const active = new Set((options.estadoIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 9. Valores
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipValores: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT v.id, v.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND v.id IS NOT NULL
          GROUP BY v.id, v.nombre
          ORDER BY v.nombre ASC
        `.catch(() => []);
        const active = new Set((options.valorIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 10. Tipos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipTipos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT t.id, t.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND t.id IS NOT NULL
          GROUP BY t.id, t.nombre
          ORDER BY t.nombre ASC
        `.catch(() => []);
        const active = new Set((options.tipoIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
      })(),

      // 11. Modos
      (async () => {
        const conds = buildMaquinasConditions({ ...options, skipModos: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT mo.id, mo.nombre, COUNT(DISTINCT m.id)::int AS count
          ${fromJoin}
          ${where}
          AND mo.id IS NOT NULL
          GROUP BY mo.id, mo.nombre
          ORDER BY mo.nombre ASC
        `.catch(() => []);
        const active = new Set((options.modoIds || []).map(Number));
        return (res || [])
          .map(r => ({ id: r.id, nombre: toTitleCase(r.nombre), count: r.count }))
          .filter(r => r.count > 0 || active.has(Number(r.id)));
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
        modos: modosRes || []
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
        legales: []
      }
    };
  }
}

export async function getMaquinaByIdModel(id) {
  const mId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT 
        m.id,
        m.nombre,
        m.serial,
        m.puestos,
        m.sala_id,
        s.nombre AS sala_nombre,
        s.nombre_comercial AS sala_nombre_comercial,
        s.grupo_id AS grupo_sala_id,
        gs.nombre AS grupo_sala_nombre,
        m.juego_id,
        j.nombre AS juego_nombre,
        m.estado_id,
        e.nombre AS estado_nombre,
        m.sociedad_id,
        soc.nombre AS sociedad_nombre,
        m.valor_id,
        v.nombre AS valor_nombre,
        m.modelo_id,
        mod.nombre AS modelo_nombre,
        m.tipo_id,
        t.nombre AS tipo_nombre,
        m.modo_id,
        mo.nombre AS modo_nombre,
        m.legal_id,
        l.nombre AS legal_nombre,
        m.created_at,
        m.updated_at
      FROM maquinas m
      LEFT JOIN salas s ON m.sala_id = s.id
      LEFT JOIN grupo_salas gs ON s.grupo_id = gs.id
      LEFT JOIN juegos_maquinas j ON m.juego_id = j.id
      LEFT JOIN estados e ON m.estado_id = e.id
      LEFT JOIN sociedades soc ON m.sociedad_id = soc.id
      LEFT JOIN valores v ON m.valor_id = v.id
      LEFT JOIN modelos mod ON m.modelo_id = mod.id
      LEFT JOIN tipos t ON m.tipo_id = t.id
      LEFT JOIN modos mo ON m.modo_id = mo.id
      LEFT JOIN legal l ON m.legal_id = l.id
      WHERE m.id = ${mId}
      LIMIT 1
    `;
    return rows[0] || null;
  } else {
    return (inMemoryData.maquinas || []).find(m => m.id === mId) || null;
  }
}

export async function createMaquinaModel(data) {
  const rawNombre = (data.nombre !== undefined && data.nombre !== null) ? String(data.nombre).trim() : '';
  const nombre = rawNombre || 'N/A';
  const rawSerial = (data.serial !== undefined && data.serial !== null) ? String(data.serial).trim() : '';
  const serial = rawSerial || 'N/A';
  const puestos = Number(data.puestos) > 0 ? Number(data.puestos) : 1;
  const sala_id = data.sala_id ? Number(data.sala_id) : null;
  const juego_id = data.juego_id ? Number(data.juego_id) : null;
  const estado_id = data.estado_id ? Number(data.estado_id) : null;
  const sociedad_id = data.sociedad_id ? Number(data.sociedad_id) : null;
  const valor_id = data.valor_id ? Number(data.valor_id) : null;
  const modelo_id = data.modelo_id ? Number(data.modelo_id) : null;
  const tipo_id = data.tipo_id ? Number(data.tipo_id) : null;
  const modo_id = data.modo_id ? Number(data.modo_id) : null;
  const legal_id = data.legal_id ? Number(data.legal_id) : null;

  if (isPgConnected && sql) {
    if (serial.toUpperCase() !== 'N/A') {
      const existing = await sql`
        SELECT id, nombre, serial FROM maquinas 
        WHERE LOWER(TRIM(serial)) = LOWER(${serial}) AND UPPER(TRIM(serial)) != 'N/A'
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw new Error(`Ya existe una máquina registrada con el serial "${serial}" (${existing[0].nombre})`);
      }
    }

    const rows = await sql`
      INSERT INTO maquinas (
        nombre, serial, puestos, sala_id, juego_id, estado_id,
        sociedad_id, valor_id, modelo_id, tipo_id, modo_id, legal_id
      ) VALUES (
        ${nombre}, ${serial}, ${puestos}, ${sala_id}, ${juego_id}, ${estado_id},
        ${sociedad_id}, ${valor_id}, ${modelo_id}, ${tipo_id}, ${modo_id}, ${legal_id}
      )
      RETURNING *
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
    const nextId = inMemoryData.maquinas.length > 0 ? Math.max(...inMemoryData.maquinas.map(m => m.id)) + 1 : 1;
    const item = {
      id: nextId,
      nombre,
      serial,
      puestos,
      sala_id,
      juego_id,
      estado_id,
      sociedad_id,
      valor_id,
      modelo_id,
      tipo_id,
      modo_id,
      legal_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.maquinas.unshift(item);
    return item;
  }
}

export async function updateMaquinaModel(id, data) {
  const mId = Number(id);
  const nombre = data.nombre !== undefined ? (String(data.nombre).trim() || 'N/A') : undefined;
  const serial = data.serial !== undefined ? (String(data.serial).trim() || 'N/A') : undefined;
  const puestos = data.puestos !== undefined ? (Number(data.puestos) > 0 ? Number(data.puestos) : 1) : undefined;
  const sala_id = data.sala_id !== undefined ? (data.sala_id ? Number(data.sala_id) : null) : undefined;
  const juego_id = data.juego_id !== undefined ? (data.juego_id ? Number(data.juego_id) : null) : undefined;
  const estado_id = data.estado_id !== undefined ? (data.estado_id ? Number(data.estado_id) : null) : undefined;
  const sociedad_id = data.sociedad_id !== undefined ? (data.sociedad_id ? Number(data.sociedad_id) : null) : undefined;
  const valor_id = data.valor_id !== undefined ? (data.valor_id ? Number(data.valor_id) : null) : undefined;
  const modelo_id = data.modelo_id !== undefined ? (data.modelo_id ? Number(data.modelo_id) : null) : undefined;
  const tipo_id = data.tipo_id !== undefined ? (data.tipo_id ? Number(data.tipo_id) : null) : undefined;
  const modo_id = data.modo_id !== undefined ? (data.modo_id ? Number(data.modo_id) : null) : undefined;
  const legal_id = data.legal_id !== undefined ? (data.legal_id ? Number(data.legal_id) : null) : undefined;

  if (isPgConnected && sql) {
    if (serial !== undefined && serial.toUpperCase() !== 'N/A') {
      const existing = await sql`
        SELECT id, nombre, serial FROM maquinas 
        WHERE id != ${mId} AND LOWER(TRIM(serial)) = LOWER(${serial}) AND UPPER(TRIM(serial)) != 'N/A'
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
        sala_id = ${sala_id !== undefined ? sala_id : sql`sala_id`},
        juego_id = ${juego_id !== undefined ? juego_id : sql`juego_id`},
        estado_id = ${estado_id !== undefined ? estado_id : sql`estado_id`},
        sociedad_id = ${sociedad_id !== undefined ? sociedad_id : sql`sociedad_id`},
        valor_id = ${valor_id !== undefined ? valor_id : sql`valor_id`},
        modelo_id = ${modelo_id !== undefined ? modelo_id : sql`modelo_id`},
        tipo_id = ${tipo_id !== undefined ? tipo_id : sql`tipo_id`},
        modo_id = ${modo_id !== undefined ? modo_id : sql`modo_id`},
        legal_id = ${legal_id !== undefined ? legal_id : sql`legal_id`},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${mId}
      RETURNING *
    `;
    return rows[0] || null;
  } else {
    const list = inMemoryData.maquinas || [];
    const idx = list.findIndex(m => m.id === mId);
    if (idx !== -1) {
      if (serial !== undefined && serial.toUpperCase() !== 'N/A') {
        const exists = list.find(m => m.id !== mId && (m.serial || '').trim().toLowerCase() === serial.toLowerCase() && (m.serial || '').trim().toUpperCase() !== 'N/A');
        if (exists) {
          throw new Error(`Ya existe otra máquina registrada con el serial "${serial}" (${exists.nombre})`);
        }
      }
      if (nombre !== undefined) list[idx].nombre = nombre;
      if (serial !== undefined) list[idx].serial = serial;
      if (puestos !== undefined) list[idx].puestos = puestos;
      if (sala_id !== undefined) list[idx].sala_id = sala_id;
      if (juego_id !== undefined) list[idx].juego_id = juego_id;
      if (estado_id !== undefined) list[idx].estado_id = estado_id;
      if (sociedad_id !== undefined) list[idx].sociedad_id = sociedad_id;
      if (valor_id !== undefined) list[idx].valor_id = valor_id;
      if (modelo_id !== undefined) list[idx].modelo_id = modelo_id;
      if (tipo_id !== undefined) list[idx].tipo_id = tipo_id;
      if (modo_id !== undefined) list[idx].modo_id = modo_id;
      if (legal_id !== undefined) list[idx].legal_id = legal_id;
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
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`l.sala_id = ANY(${options.userSalaIds})`);
  }

  // 3. Salas seleccionadas en el filtro
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`l.sala_id = ANY(${options.salaIds})`);
  }

  // 4. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(l.nombre, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(l.id AS TEXT) LIKE ${term}
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

  // Filtro de Salas (Excluyendo galpones grupo_id = 2)
  const condsSalas = buildLlaveConditions({ ...options, skipSalas: true, active });
  const whereSalas = condsSalas.length > 0 ? sql`WHERE ${condsSalas.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  let allSalas;
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  }

  const countsSalasRes = await sql`
    SELECT l.sala_id AS id, COUNT(l.id)::int AS count
    FROM llaves l
    LEFT JOIN salas s ON l.sala_id = s.id
    ${whereSalas}
    GROUP BY l.sala_id
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.id, r.count]));
  const activeSalas = new Set((options.salaIds || []).map(Number));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countSalasMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const active = params.active !== undefined ? Number(params.active) : 1;

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }

  const conds = buildLlaveConditions({
    active,
    userSalaIds,
    salaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'l.id',
    'nombre': 'l.nombre',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'l.id';

  const countRes = await sql`
    SELECT COUNT(l.id)::int AS total
    FROM llaves l
    LEFT JOIN salas s ON l.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, l.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT l.*, s.id AS sala_id, s.nombre AS sala_nombre
      FROM llaves l
      LEFT JOIN salas s ON l.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT l.*, s.id AS sala_id, s.nombre AS sala_nombre
      FROM llaves l
      LEFT JOIN salas s ON l.sala_id = s.id
      ${where}
      ${orderClause}
    `;
  }

  data = data.map(r => ({ ...r, nombre: toTitleCase(r.nombre) }));
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function createLlaveModel(data) {
  const cleanName = (data.nombre || '').trim();
  if (!cleanName) throw new Error('El nombre de la llave es obligatorio');
  if (!data.sala_id) throw new Error('Debe seleccionar una sala para la llave');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM llaves 
      WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) AND sala_id = ${Number(data.sala_id)}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe una llave registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }

    const rows = await sql`
      INSERT INTO llaves (nombre, sala_id, active)
      VALUES (${cleanName}, ${Number(data.sala_id)}, 1)
      RETURNING *
    `;
    return rows[0];
  } else {
    const cleanLower = cleanName.toLowerCase();
    const existing = (inMemoryData.llaves || []).find(m => (m.nombre || '').trim().toLowerCase() === cleanLower && Number(m.sala_id) === Number(data.sala_id));
    if (existing) {
      throw new Error(`Ya existe una llave registrada con el nombre "${toTitleCase(cleanName)}" en esta sala`);
    }
    const nextId = (inMemoryData.llaves?.length || 0) > 0 ? Math.max(...inMemoryData.llaves.map(m => m.id)) + 1 : 1;
    const newLlave = {
      id: nextId,
      nombre: cleanName,
      sala_id: Number(data.sala_id),
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
  const lId = Number(id);
  const cleanName = data.nombre !== undefined ? String(data.nombre).trim() : null;
  let salaId = data.sala_id ? Number(data.sala_id) : null;
  const active = data.active !== undefined ? Number(data.active) : null;

  if (isPgConnected && sql) {
    if (cleanName && !salaId) {
      const cur = await sql`SELECT sala_id FROM llaves WHERE id = ${lId} LIMIT 1`;
      if (cur.length > 0) {
        salaId = cur[0].sala_id;
      }
    }

    if (cleanName) {
      const existing = await sql`
        SELECT id FROM llaves 
        WHERE LOWER(TRIM(nombre)) = LOWER(${cleanName}) 
          AND (${salaId}::int IS NULL OR sala_id = ${salaId})
          AND id != ${lId}
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
        sala_id = COALESCE(${salaId}, sala_id),
        active = COALESCE(${active}, active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${lId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.llaves || []).findIndex(m => m.id === lId);
    if (idx !== -1) {
      inMemoryData.llaves[idx] = { ...inMemoryData.llaves[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.llaves[idx];
    }
    return null;
  }
}

// Soft delete: Marca active = 0 (envía a Llaves Borradas)
export async function softDeleteLlaveModel(id) {
  const lId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE llaves 
      SET active = 0, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ${lId} 
      RETURNING *
    `;
    return { success: true, id: lId, llave: rows[0] };
  } else {
    const llave = (inMemoryData.llaves || []).find(m => m.id === lId);
    if (llave) llave.active = 0;
    return { success: true, id: lId };
  }
}

// Restore: Marca active = 1 (restaura de Llaves Borradas a Llaves)
export async function restoreLlaveModel(id) {
  const lId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      UPDATE llaves 
      SET active = 1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ${lId} 
      RETURNING *
    `;
    return { success: true, id: lId, llave: rows[0] };
  } else {
    const llave = (inMemoryData.llaves || []).find(m => m.id === lId);
    if (llave) llave.active = 1;
    return { success: true, id: lId };
  }
}

// Purge: Eliminación definitiva física de la base de datos
export async function purgeLlaveModel(id) {
  const lId = Number(id);
  if (isPgConnected && sql) {
    await sql`DELETE FROM llaves WHERE id = ${lId}`;
    return { success: true, id: lId };
  } else {
    inMemoryData.llaves = (inMemoryData.llaves || []).filter(m => m.id !== lId);
    return { success: true, id: lId };
  }
}

// ==========================================
// --- LIBROS (CECOM: LIBRO) ---
// ==========================================

export function buildLibroConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`l.sala_id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas en el filtro
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`l.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Búsqueda por texto
  if (options.search && String(options.search).trim()) {
    const term = `%${String(options.search).trim().toLowerCase()}%`;
    conds.push(sql`(
      LOWER(COALESCE(l.descripcion, '')) LIKE ${term} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${term} OR
      CAST(l.id AS TEXT) LIKE ${term}
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

  // Filtro de Salas (Excluyendo galpones grupo_id = 2)
  const condsSalas = buildLibroConditions({ ...options, skipSalas: true });
  const whereSalas = condsSalas.length > 0 ? sql`WHERE ${condsSalas.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  let allSalas;
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) AND (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE (s.grupo_id IS NULL OR s.grupo_id = 1) ORDER BY s.nombre ASC`;
  }

  const countsSalasRes = await sql`
    SELECT l.sala_id AS id, COUNT(l.id)::int AS count
    FROM libros l
    LEFT JOIN salas s ON l.sala_id = s.id
    ${whereSalas}
    GROUP BY l.sala_id
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.id, r.count]));
  const activeSalas = new Set((options.salaIds || []).map(Number));

  const salas = allSalas
    .map(s => ({
      id: s.id,
      nombre: s.nombre,
      count: countSalasMap.get(s.id) || 0
    }))
    .filter(s => s.count > 0 || activeSalas.has(Number(s.id)))
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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Parse filters
  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }

  const conds = buildLibroConditions({
    userSalaIds,
    salaIds,
    search
  });

  const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

  const allowedSortColumns = {
    'id': 'l.id',
    'descripcion': 'l.descripcion',
    'sala_nombre': 's.nombre'
  };

  const orderCol = allowedSortColumns[sortBy] || 'l.id';

  const countRes = await sql`
    SELECT COUNT(l.id)::int AS total
    FROM libros l
    LEFT JOIN salas s ON l.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, l.id DESC`);

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT l.*, s.id AS sala_id, s.nombre AS sala_nombre
      FROM libros l
      LEFT JOIN salas s ON l.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT l.*, s.id AS sala_id, s.nombre AS sala_nombre
      FROM libros l
      LEFT JOIN salas s ON l.sala_id = s.id
      ${where}
      ${orderClause}
    `;
  }

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

  return { success: true, data, total, page, limit, totalPages };
}

export async function getLibroByIdModel(id) {
  const lId = Number(id);
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT l.*, s.id AS sala_id, s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM libros l
      LEFT JOIN salas s ON l.sala_id = s.id
      WHERE l.id = ${lId}
      LIMIT 1
    `;
    if (rows && rows.length > 0) {
      return { success: true, data: rows[0] };
    }
  } else {
    const found = (inMemoryData.libros || []).find(l => Number(l.id) === lId);
    if (found) {
      return { success: true, data: found };
    }
  }
  return { success: false, error: 'Libro no encontrado' };
}

export async function createLibroModel(data) {
  const cleanDesc = (data.descripcion || '').trim();
  if (!cleanDesc) throw new Error('La fecha del libro es obligatoria');
  if (!data.sala_id) throw new Error('Debe seleccionar una sala para el libro');

  if (isPgConnected && sql) {
    const existing = await sql`
      SELECT id FROM libros 
      WHERE LOWER(TRIM(descripcion)) = LOWER(${cleanDesc}) AND sala_id = ${Number(data.sala_id)}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(`Ya existe un libro registrado con la fecha "${cleanDesc}" en esta sala`);
    }

    const rows = await sql`
      INSERT INTO libros (descripcion, sala_id)
      VALUES (${cleanDesc}, ${Number(data.sala_id)})
      RETURNING *
    `;
    return rows[0];
  } else {
    const cleanLower = cleanDesc.toLowerCase();
    const existing = (inMemoryData.libros || []).find(m => (m.descripcion || '').trim().toLowerCase() === cleanLower && Number(m.sala_id) === Number(data.sala_id));
    if (existing) {
      throw new Error(`Ya existe un libro registrado con la fecha "${cleanDesc}" en esta sala`);
    }
    const nextId = (inMemoryData.libros?.length || 0) > 0 ? Math.max(...inMemoryData.libros.map(m => m.id)) + 1 : 1;
    const newLibro = {
      id: nextId,
      descripcion: cleanDesc,
      sala_id: Number(data.sala_id),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libros = inMemoryData.libros || [];
    inMemoryData.libros.unshift(newLibro);
    return newLibro;
  }
}

export async function updateLibroModel(id, data) {
  const lId = Number(id);
  const cleanDesc = data.descripcion !== undefined ? String(data.descripcion).trim() : null;
  let salaId = data.sala_id ? Number(data.sala_id) : null;

  if (isPgConnected && sql) {
    if (cleanDesc && !salaId) {
      const cur = await sql`SELECT sala_id FROM libros WHERE id = ${lId} LIMIT 1`;
      if (cur.length > 0) {
        salaId = cur[0].sala_id;
      }
    }

    if (cleanDesc) {
      const existing = await sql`
        SELECT id FROM libros 
        WHERE LOWER(TRIM(descripcion)) = LOWER(${cleanDesc}) 
          AND (${salaId}::int IS NULL OR sala_id = ${salaId})
          AND id != ${lId}
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
        sala_id = COALESCE(${salaId}, sala_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${lId}
      RETURNING *
    `;
    return rows[0];
  } else {
    const idx = (inMemoryData.libros || []).findIndex(m => m.id === lId);
    if (idx !== -1) {
      inMemoryData.libros[idx] = { ...inMemoryData.libros[idx], ...data, updated_at: new Date().toISOString() };
      return inMemoryData.libros[idx];
    }
    return null;
  }
}

export async function deleteLibroModel(id) {
  const lId = Number(id);
  if (isPgConnected && sql) {
    await sql`DELETE FROM libros WHERE id = ${lId}`;
    return { success: true, id: lId };
  } else {
    inMemoryData.libros = (inMemoryData.libros || []).filter(m => m.id !== lId);
    return { success: true, id: lId };
  }
}

// --- DROP DE MESAS (CECOM: LIBRO DROP) ---
export async function getLibroDropMesasModel(libroId) {
  const lId = Number(libroId);
  if (!lId) return [];

  if (!isPgConnected || !sql) {
    const list = inMemoryData.libro_drop_mesas || [];
    return list.filter(d => Number(d.libro_id) === lId);
  }

  const rows = await sql`
    SELECT 
      d.id,
      d.libro_id,
      d.mesa_id,
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
    JOIN mesas m ON d.mesa_id = m.id
    LEFT JOIN juegos j ON m.juego_id = j.id
    LEFT JOIN salas s ON m.sala_id = s.id
    WHERE d.libro_id = ${lId}
    ORDER BY d.id ASC
  `;

  return rows.map(r => ({
    ...r,
    mesa_nombre: r.mesa_nombre ? toTitleCase(r.mesa_nombre) : '',
    juego_nombre: r.juego_nombre ? toTitleCase(r.juego_nombre) : ''
  }));
}

export async function createLibroDropMesaModel(data) {
  const libroId = Number(data.libro_id);
  const mesaId = Number(data.mesa_id);
  if (!libroId) throw new Error('El ID del libro es obligatorio');
  if (!mesaId) throw new Error('Debe seleccionar una mesa');

  const b100 = Math.max(0, parseInt(data.denominacion_100 ?? data.b100 ?? 0, 10) || 0);
  const b50 = Math.max(0, parseInt(data.denominacion_50 ?? data.b50 ?? 0, 10) || 0);
  const b20 = Math.max(0, parseInt(data.denominacion_20 ?? data.b20 ?? 0, 10) || 0);
  const b10 = Math.max(0, parseInt(data.denominacion_10 ?? data.b10 ?? 0, 10) || 0);
  const b5 = Math.max(0, parseInt(data.denominacion_5 ?? data.b5 ?? 0, 10) || 0);
  const b1 = Math.max(0, parseInt(data.denominacion_1 ?? data.b1 ?? 0, 10) || 0);

  const total = (b100 * 100) + (b50 * 50) + (b20 * 20) + (b10 * 10) + (b5 * 5) + (b1 * 1);

  if (!isPgConnected || !sql) {
    inMemoryData.libro_drop_mesas = inMemoryData.libro_drop_mesas || [];
    const existingIdx = (inMemoryData.libro_drop_mesas || []).findIndex(
      d => Number(d.libro_id) === libroId && Number(d.mesa_id) === mesaId
    );

    const mesa = (inMemoryData.mesas || []).find(m => Number(m.id) === mesaId) || {};

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

    const nextId = (inMemoryData.libro_drop_mesas.length > 0)
      ? Math.max(...inMemoryData.libro_drop_mesas.map(d => d.id)) + 1
      : 1;

    const newDrop = {
      id: nextId,
      libro_id: libroId,
      mesa_id: mesaId,
      denominacion_100: b100,
      denominacion_50: b50,
      denominacion_20: b20,
      denominacion_10: b10,
      denominacion_5: b5,
      denominacion_1: b1,
      b100,
      b50,
      b20,
      b10,
      b5,
      b1,
      total,
      mesa_nombre: mesa.nombre || `Mesa #${mesaId}`,
      juego_nombre: mesa.juego_nombre || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_drop_mesas.push(newDrop);
    return newDrop;
  }

  // Comprobar si ya existe un registro previo para esta mesa en este libro
  const existingRow = await sql`
    SELECT id FROM libro_drop_mesas
    WHERE libro_id = ${libroId} AND mesa_id = ${mesaId}
    LIMIT 1
  `;

  let insertedId = null;
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
      WHERE id = ${existingRow[0].id}
      RETURNING id
    `;
    insertedId = updated[0].id;
  } else {
    const res = await sql`
      INSERT INTO libro_drop_mesas (
        libro_id, mesa_id, 
        denominacion_100, denominacion_50, denominacion_20, denominacion_10, denominacion_5, denominacion_1, 
        total
      )
      VALUES (
        ${libroId}, ${mesaId}, 
        ${b100}, ${b50}, ${b20}, ${b10}, ${b5}, ${b1}, 
        ${total}
      )
      RETURNING id
    `;
    insertedId = res[0].id;
  }

  const details = await sql`
    SELECT 
      d.id,
      d.libro_id,
      d.mesa_id,
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
    JOIN mesas m ON d.mesa_id = m.id
    LEFT JOIN juegos j ON m.juego_id = j.id
    LEFT JOIN salas s ON m.sala_id = s.id
    WHERE d.id = ${insertedId}
    LIMIT 1
  `;

  const finalRow = details[0] || { id: insertedId };
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
  const dropId = Number(id);
  const lId = Number(libroId);
  if (!dropId) throw new Error('ID de registro de drop inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_drop_mesas = inMemoryData.libro_drop_mesas || [];
    inMemoryData.libro_drop_mesas = inMemoryData.libro_drop_mesas.filter(d => Number(d.id) !== dropId);
    return { success: true, id: dropId };
  }

  await sql`
    DELETE FROM libro_drop_mesas
    WHERE id = ${dropId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;

  return { success: true, id: dropId };
}

// --- CONTROL DE LLAVES (CECOM: LIBRO CONTROL DE LLAVES) ---
export async function getLibroControlLlavesModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    const list = inMemoryData.libro_control_llaves.filter(c => Number(c.libro_id) === lId);
    return list.map(c => {
      const llavesList = (inMemoryData.llaves || []).filter(l => (c.llaves_ids || []).includes(Number(l.id)));
      return {
        ...c,
        llaves_detalle: llavesList.map(l => ({ id: l.id, nombre: l.nombre }))
      };
    }).sort((a, b) => Number(b.id) - Number(a.id));
  }

  const rows = await sql`
    SELECT 
      cl.id,
      cl.libro_id,
      cl.descripcion,
      cl.hora_salida,
      cl.hora_recepcion,
      cl.llaves_ids,
      cl.created_at,
      cl.updated_at,
      COALESCE(
        (
          SELECT json_agg(json_build_object('id', l.id, 'nombre', l.nombre) ORDER BY l.nombre)
          FROM llaves l
          WHERE l.id = ANY(cl.llaves_ids)
        ), '[]'::json
      ) AS llaves_detalle
    FROM libro_control_llaves cl
    WHERE cl.libro_id = ${lId}
    ORDER BY cl.id DESC
  `;

  return rows;
}

export async function createLibroControlLlavesModel(data) {
  const libroId = Number(data.libro_id);
  if (!libroId) throw new Error('ID de libro inválido');

  let llavesIds = Array.isArray(data.llaves_ids) 
    ? data.llaves_ids.map(Number).filter(n => !isNaN(n) && n > 0)
    : [];

  if (llavesIds.length === 0) {
    throw new Error('Debe seleccionar al menos una llave');
  }

  const descripcion = (data.descripcion || '').trim() || 'General';
  
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const horaSalida = (data.hora_salida || '').trim() || currentHHMM;
  const horaRecepcion = (data.hora_recepcion || '').trim() || null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    const nextId = (inMemoryData.libro_control_llaves.length > 0)
      ? Math.max(...inMemoryData.libro_control_llaves.map(d => d.id)) + 1
      : 1;
    const llavesList = (inMemoryData.llaves || []).filter(l => llavesIds.includes(Number(l.id)));
    const newRecord = {
      id: nextId,
      libro_id: libroId,
      llaves_ids: llavesIds,
      descripcion,
      hora_salida: horaSalida,
      hora_recepcion: horaRecepcion,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      llaves_detalle: llavesList.map(l => ({ id: l.id, nombre: l.nombre }))
    };
    inMemoryData.libro_control_llaves.push(newRecord);
    return newRecord;
  }

  const res = await sql`
    INSERT INTO libro_control_llaves (
      libro_id, llaves_ids, descripcion, hora_salida, hora_recepcion
    )
    VALUES (
      ${libroId}, ${llavesIds}, ${descripcion}, ${horaSalida}, ${horaRecepcion}
    )
    RETURNING id
  `;

  const insertedId = res[0].id;

  const rows = await sql`
    SELECT 
      cl.id,
      cl.libro_id,
      cl.descripcion,
      cl.hora_salida,
      cl.hora_recepcion,
      cl.llaves_ids,
      cl.created_at,
      cl.updated_at,
      COALESCE(
        (
          SELECT json_agg(json_build_object('id', l.id, 'nombre', l.nombre) ORDER BY l.nombre)
          FROM llaves l
          WHERE l.id = ANY(cl.llaves_ids)
        ), '[]'::json
      ) AS llaves_detalle
    FROM libro_control_llaves cl
    WHERE cl.id = ${insertedId}
    LIMIT 1
  `;

  return rows[0];
}

export async function updateLibroControlLlavesHorasModel(controlId, libroId, data) {
  const cId = Number(controlId);
  const lId = Number(libroId);
  if (!cId) throw new Error('ID de registro de control de llaves inválido');

  const horaSalida = (data.hora_salida || '').trim() || null;
  const horaRecepcion = (data.hora_recepcion || '').trim() || null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    const idx = inMemoryData.libro_control_llaves.findIndex(c => Number(c.id) === cId);
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
    WHERE id = ${cId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;

  const rows = await sql`
    SELECT 
      cl.id,
      cl.libro_id,
      cl.descripcion,
      cl.hora_salida,
      cl.hora_recepcion,
      cl.llaves_ids,
      cl.created_at,
      cl.updated_at,
      COALESCE(
        (
          SELECT json_agg(json_build_object('id', l.id, 'nombre', l.nombre) ORDER BY l.nombre)
          FROM llaves l
          WHERE l.id = ANY(cl.llaves_ids)
        ), '[]'::json
      ) AS llaves_detalle
    FROM libro_control_llaves cl
    WHERE cl.id = ${cId}
    LIMIT 1
  `;

  return rows[0];
}

export async function deleteLibroControlLlavesModel(id, libroId) {
  const cId = Number(id);
  const lId = Number(libroId);
  if (!cId) throw new Error('ID de registro de control de llaves inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves || [];
    inMemoryData.libro_control_llaves = inMemoryData.libro_control_llaves.filter(c => Number(c.id) !== cId);
    return { success: true, id: cId };
  }

  await sql`
    DELETE FROM libro_control_llaves
    WHERE id = ${cId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;

  return { success: true, id: cId };
}

// --- APORTES DE LIBRO (CECOM: LIBRO APORTES) ---
export async function getLibroAportesModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    return inMemoryData.libro_aportes
      .filter(a => Number(a.libro_id) === lId)
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  const rows = await sql`
    SELECT 
      la.id,
      la.libro_id,
      la.empleado_id,
      la.rango_id,
      la.monto,
      la.created_at,
      la.updated_at,
      e.nombre AS empleado_nombre,
      e.cedula AS empleado_cedula,
      e.foto AS empleado_foto,
      c.nombre AS cargo_nombre,
      d.nombre AS departamento_nombre,
      r.nombre AS rango_nombre
    FROM libro_aportes la
    JOIN empleados e ON e.id = la.empleado_id
    LEFT JOIN cargos c ON c.id = e.cargo_id
    LEFT JOIN areas a ON a.id = c.area_id
    LEFT JOIN departamentos d ON d.id = a.departamento_id
    JOIN rangos r ON r.id = la.rango_id
    WHERE la.libro_id = ${lId}
    ORDER BY la.id DESC
  `;

  return rows;
}

export async function createLibroAporteModel(data) {
  const libroId = Number(data.libro_id);
  const empleadoId = Number(data.empleado_id);
  const rangoId = Number(data.rango_id);
  const monto = Number(data.monto) || 0;

  if (!libroId) throw new Error('ID de libro inválido');
  if (!empleadoId) throw new Error('Debe seleccionar un empleado');
  if (!rangoId) throw new Error('Debe seleccionar un rango');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    const nextId = (inMemoryData.libro_aportes.length > 0)
      ? Math.max(...inMemoryData.libro_aportes.map(d => d.id)) + 1
      : 1;
    const newRecord = {
      id: nextId,
      libro_id: libroId,
      empleado_id: empleadoId,
      rango_id: rangoId,
      monto,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_aportes.push(newRecord);
    return newRecord;
  }

  const res = await sql`
    INSERT INTO libro_aportes (
      libro_id, empleado_id, rango_id, monto
    )
    VALUES (
      ${libroId}, ${empleadoId}, ${rangoId}, ${monto}
    )
    RETURNING id
  `;

  const insertedId = res[0].id;

  const rows = await sql`
    SELECT 
      la.id,
      la.libro_id,
      la.empleado_id,
      la.rango_id,
      la.monto,
      la.created_at,
      la.updated_at,
      e.nombre AS empleado_nombre,
      e.cedula AS empleado_cedula,
      e.foto AS empleado_foto,
      c.nombre AS cargo_nombre,
      d.nombre AS departamento_nombre,
      r.nombre AS rango_nombre
    FROM libro_aportes la
    JOIN empleados e ON e.id = la.empleado_id
    LEFT JOIN cargos c ON c.id = e.cargo_id
    LEFT JOIN areas a ON a.id = c.area_id
    LEFT JOIN departamentos d ON d.id = a.departamento_id
    JOIN rangos r ON r.id = la.rango_id
    WHERE la.id = ${insertedId}
  `;

  return rows[0];
}

export async function updateLibroAporteModel(id, libroId, data) {
  const aId = Number(id);
  const lId = Number(libroId);
  if (!aId) throw new Error('ID de aporte inválido');

  const empleadoId = data.empleado_id !== undefined ? Number(data.empleado_id) : null;
  const rangoId = data.rango_id !== undefined ? Number(data.rango_id) : null;
  const monto = data.monto !== undefined ? Number(data.monto) : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    const idx = inMemoryData.libro_aportes.findIndex(a => Number(a.id) === aId);
    if (idx !== -1) {
      if (empleadoId) inMemoryData.libro_aportes[idx].empleado_id = empleadoId;
      if (rangoId) inMemoryData.libro_aportes[idx].rango_id = rangoId;
      if (monto !== undefined) inMemoryData.libro_aportes[idx].monto = monto;
      inMemoryData.libro_aportes[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_aportes[idx];
    }
    return null;
  }

  await sql`
    UPDATE libro_aportes
    SET
      empleado_id = COALESCE(${empleadoId}, empleado_id),
      rango_id = COALESCE(${rangoId}, rango_id),
      monto = COALESCE(${monto}, monto),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${aId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;

  const rows = await sql`
    SELECT 
      la.id,
      la.libro_id,
      la.empleado_id,
      la.rango_id,
      la.monto,
      la.created_at,
      la.updated_at,
      e.nombre AS empleado_nombre,
      e.cedula AS empleado_cedula,
      e.foto AS empleado_foto,
      c.nombre AS cargo_nombre,
      d.nombre AS departamento_nombre,
      r.nombre AS rango_nombre
    FROM libro_aportes la
    JOIN empleados e ON e.id = la.empleado_id
    LEFT JOIN cargos c ON c.id = e.cargo_id
    LEFT JOIN areas a ON a.id = c.area_id
    LEFT JOIN departamentos d ON d.id = a.departamento_id
    JOIN rangos r ON r.id = la.rango_id
    WHERE la.id = ${aId}
  `;

  return rows[0] || null;
}

export async function deleteLibroAporteModel(id, libroId) {
  const aId = Number(id);
  const lId = Number(libroId);
  if (!aId) throw new Error('ID de aporte inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_aportes = inMemoryData.libro_aportes || [];
    inMemoryData.libro_aportes = inMemoryData.libro_aportes.filter(a => Number(a.id) !== aId);
    return { success: true, id: aId };
  }

  await sql`
    DELETE FROM libro_aportes 
    WHERE id = ${aId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;
  return { success: true, id: aId };
}

// --- INCIDENCIAS GENERALES (CECOM: LIBRO INCIDENCIAS GENERALES) ---
export async function getLibroIncidenciasGeneralesModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    return inMemoryData.libro_incidencias_generales
      .filter(c => Number(c.libro_id) === lId)
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  const rows = await sql`
    SELECT 
      lig.id, 
      lig.libro_id, 
      lig.tipo_incidencia_id,
      lig.descripcion, 
      COALESCE(ti.nombre, lig.tipo, 'General') AS tipo, 
      COALESCE(ti.nombre, lig.tipo, 'General') AS tipo_incidencia_nombre,
      lig.hora, 
      lig.created_at, 
      lig.updated_at
    FROM libro_incidencias_generales lig
    LEFT JOIN tipo_incidencias ti ON lig.tipo_incidencia_id = ti.id
    WHERE lig.libro_id = ${lId}
    ORDER BY lig.id DESC
  `;

  return rows;
}

export async function createLibroIncidenciaGeneralModel(data) {
  const libroId = Number(data.libro_id);
  if (!libroId) throw new Error('ID de libro inválido');

  const descripcion = (data.descripcion || '').trim();
  if (!descripcion) {
    throw new Error('La descripción de la incidencia es obligatoria');
  }

  let tipoIncidenciaId = data.tipo_incidencia_id ? Number(data.tipo_incidencia_id) : null;
  let tipo = (data.tipo || '').trim();

  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hora = (data.hora || '').trim() || currentHHMM;

  if (!isPgConnected || !sql) {
    if (!tipoIncidenciaId) tipoIncidenciaId = 1;
    if (!tipo) tipo = 'General';
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    const nextId = (inMemoryData.libro_incidencias_generales.length > 0)
      ? Math.max(...inMemoryData.libro_incidencias_generales.map(d => d.id)) + 1
      : 1;
    const newRecord = {
      id: nextId,
      libro_id: libroId,
      tipo_incidencia_id: tipoIncidenciaId,
      descripcion,
      tipo,
      hora,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_incidencias_generales.push(newRecord);
    return newRecord;
  }

  if (tipoIncidenciaId) {
    const match = await sql`SELECT nombre FROM tipo_incidencias WHERE id = ${tipoIncidenciaId} LIMIT 1`;
    if (match.length > 0) tipo = match[0].nombre;
  } else if (tipo) {
    const match = await sql`SELECT id, nombre FROM tipo_incidencias WHERE LOWER(TRIM(nombre)) = LOWER(${tipo}) LIMIT 1`;
    if (match.length > 0) {
      tipoIncidenciaId = match[0].id;
      tipo = match[0].nombre;
    }
  }
  if (!tipoIncidenciaId) tipoIncidenciaId = 1;
  if (!tipo) tipo = 'General';

  const res = await sql`
    INSERT INTO libro_incidencias_generales (
      libro_id, tipo_incidencia_id, descripcion, tipo, hora
    )
    VALUES (
      ${libroId}, ${tipoIncidenciaId}, ${descripcion}, ${tipo}, ${hora}
    )
    RETURNING id, libro_id, tipo_incidencia_id, descripcion, tipo, hora, created_at, updated_at
  `;

  return res[0];
}

export async function updateLibroIncidenciaGeneralModel(incidenciaId, libroId, data) {
  const incId = Number(incidenciaId);
  const lId = Number(libroId);
  if (!incId) throw new Error('ID de incidencia inválido');

  const descripcion = data.descripcion !== undefined ? (data.descripcion || '').trim() : null;
  const tipoIncidenciaId = data.tipo_incidencia_id !== undefined ? Number(data.tipo_incidencia_id) : null;
  let tipo = data.tipo !== undefined ? (data.tipo || 'General').trim() : null;
  const hora = data.hora !== undefined ? (data.hora || '').trim() : null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    const idx = inMemoryData.libro_incidencias_generales.findIndex(c => Number(c.id) === incId);
    if (idx !== -1) {
      if (descripcion !== null) inMemoryData.libro_incidencias_generales[idx].descripcion = descripcion;
      if (tipoIncidenciaId !== null) inMemoryData.libro_incidencias_generales[idx].tipo_incidencia_id = tipoIncidenciaId;
      if (tipo !== null) inMemoryData.libro_incidencias_generales[idx].tipo = tipo;
      if (hora !== null) inMemoryData.libro_incidencias_generales[idx].hora = hora;
      inMemoryData.libro_incidencias_generales[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_incidencias_generales[idx];
    }
    throw new Error('Incidencia no encontrada');
  }

  if (tipoIncidenciaId) {
    const match = await sql`SELECT nombre FROM tipo_incidencias WHERE id = ${tipoIncidenciaId} LIMIT 1`;
    if (match.length > 0) tipo = match[0].nombre;
  }

  const rows = await sql`
    UPDATE libro_incidencias_generales
    SET 
      descripcion = COALESCE(${descripcion}, descripcion),
      tipo_incidencia_id = COALESCE(${tipoIncidenciaId}, tipo_incidencia_id),
      tipo = COALESCE(${tipo}, tipo),
      hora = COALESCE(${hora}, hora),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${incId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
    RETURNING id, libro_id, tipo_incidencia_id, descripcion, tipo, hora, created_at, updated_at
  `;

  return rows[0];
}

export const updateLibroIncidenciaGeneralHoraModel = updateLibroIncidenciaGeneralModel;

export async function deleteLibroIncidenciaGeneralModel(id, libroId) {
  const incId = Number(id);
  const lId = Number(libroId);
  if (!incId) throw new Error('ID de incidencia inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales || [];
    inMemoryData.libro_incidencias_generales = inMemoryData.libro_incidencias_generales.filter(c => Number(c.id) !== incId);
    return { success: true, id: incId };
  }

  await sql`
    DELETE FROM libro_incidencias_generales
    WHERE id = ${incId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;

  return { success: true, id: incId };
}

// --- CONTROL DE CLIENTES (CECOM: LIBRO CONTROL DE CLIENTES) ---
export async function getLibroControlClientesModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    const list = inMemoryData.libro_control_clientes.filter(c => Number(c.libro_id) === lId);
    return list.sort((a, b) => Number(b.id) - Number(a.id));
  }

  const rows = await sql`
    SELECT 
      lcc.id, lcc.libro_id, lcc.cliente_id, 
      COALESCE(c.nombre, '') AS cliente, 
      lcc.tipo, lcc.monto, lcc.metodo_pago_id, 
      COALESCE(mp.nombre, 'General') AS metodo,
      lcc.hora, 
      lcc.created_at, lcc.updated_at,
      COALESCE(tc.nombre, 'General') AS tipo_cliente_nombre,
      c.tipo_cliente_id
    FROM libro_control_clientes lcc
    LEFT JOIN clientes c ON lcc.cliente_id = c.id
    LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
    LEFT JOIN metodos_pago mp ON lcc.metodo_pago_id = mp.id
    WHERE lcc.libro_id = ${lId}
    ORDER BY lcc.id DESC
  `;

  return rows;
}

export async function getClientesSugerenciasModel(query = '', options = {}) {
  const cleanQ = (query || '').trim().toLowerCase();
  const salaId = options.salaId ? Number(options.salaId) : null;
  const libroId = options.libroId ? Number(options.libroId) : null;

  if (!isPgConnected || !sql) {
    inMemoryData.clientes = inMemoryData.clientes || [];
    let all = inMemoryData.clientes.map(c => ({
      id: c.id,
      nombre: c.nombre,
      tipo_cliente_nombre: '',
      sala_id: c.sala_id
    }));
    if (salaId) all = all.filter(c => Number(c.sala_id) === salaId);
    if (cleanQ) all = all.filter(c => c.nombre.toLowerCase().includes(cleanQ));
    return all.slice(0, 30);
  }

  // Si no tenemos salaId pero sí libroId, obtener el sala_id del libro
  let resolvedSalaId = salaId;
  if (!resolvedSalaId && libroId) {
    const lib = await sql`SELECT sala_id FROM libros WHERE id = ${libroId} LIMIT 1`;
    if (lib.length > 0 && lib[0].sala_id) {
      resolvedSalaId = Number(lib[0].sala_id);
    }
  }

  let rows;
  if (resolvedSalaId) {
    rows = await sql`
      SELECT c.id, c.nombre, c.sala_id, c.tipo_cliente_id, COALESCE(tc.nombre, 'General') AS tipo_cliente_nombre
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
      WHERE c.sala_id = ${resolvedSalaId}
        ${cleanQ ? sql`AND (LOWER(c.nombre) LIKE ${`%${cleanQ}%`} OR LOWER(COALESCE(tc.nombre, '')) LIKE ${`%${cleanQ}%`})` : sql``}
      ORDER BY c.nombre ASC
      LIMIT 30
    `;
  } else {
    rows = await sql`
      SELECT c.id, c.nombre, c.sala_id, c.tipo_cliente_id, COALESCE(tc.nombre, 'General') AS tipo_cliente_nombre
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
      WHERE 1=1
        ${cleanQ ? sql`AND (LOWER(c.nombre) LIKE ${`%${cleanQ}%`} OR LOWER(COALESCE(tc.nombre, '')) LIKE ${`%${cleanQ}%`})` : sql``}
      ORDER BY c.nombre ASC
      LIMIT 30
    `;
  }

  return rows.map(r => ({
    id: r.id,
    nombre: r.nombre,
    tipo_cliente_id: r.tipo_cliente_id,
    tipo_cliente_nombre: r.tipo_cliente_nombre || 'General',
    sala_id: r.sala_id
  }));
}

export async function createLibroControlClienteModel(data) {
  const libroId = Number(data.libro_id);
  if (!libroId) throw new Error('ID de libro inválido');

  const clienteNombre = (data.cliente || '').trim();
  let clienteId = data.cliente_id ? Number(data.cliente_id) : null;

  if (!clienteId && !clienteNombre) {
    throw new Error('El nombre del cliente es obligatorio');
  }

  // Resolver salaId del libro
  let resolvedSalaId = null;
  if (sql && isPgConnected) {
    const lib = await sql`SELECT sala_id FROM libros WHERE id = ${libroId} LIMIT 1`;
    if (lib.length > 0 && lib[0].sala_id) {
      resolvedSalaId = Number(lib[0].sala_id);
    }
  }

  // Si no viene clienteId pero viene clienteNombre, buscar si existe o crearlo automáticamente
  if (!clienteId && clienteNombre) {
    if (sql && isPgConnected) {
      const existing = await sql`
        SELECT id FROM clientes 
        WHERE LOWER(TRIM(nombre)) = LOWER(${clienteNombre}) 
          ${resolvedSalaId ? sql`AND sala_id = ${resolvedSalaId}` : sql``}
        LIMIT 1
      `;
      if (existing.length > 0) {
        clienteId = existing[0].id;
      } else {
        // Crear cliente con tipo_cliente_id = 1 (General) por defecto
        const newClient = await sql`
          INSERT INTO clientes (nombre, tipo_cliente_id, sala_id)
          VALUES (${clienteNombre}, 1, ${resolvedSalaId || 1})
          RETURNING id
        `;
        clienteId = newClient[0].id;
      }
    }
  }

  const tipo = (data.tipo || 'Compra').trim();
  const monto = parseFloat(data.monto) || 0;
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0');

  // Resolver metodo_pago_id
  let metodoPagoId = data.metodo_pago_id ? Number(data.metodo_pago_id) : null;
  const metodoNombre = (data.metodo || '').trim();
  if (!metodoPagoId && metodoNombre && sql && isPgConnected) {
    const mRow = await sql`
      SELECT id FROM metodos_pago 
      WHERE LOWER(TRIM(nombre)) = LOWER(${metodoNombre}) 
      LIMIT 1
    `;
    if (mRow.length > 0) metodoPagoId = mRow[0].id;
  }
  if (!metodoPagoId) metodoPagoId = 1; // Por defecto 1 (General)

  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hora = (data.hora || '').trim() || currentHHMM;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    const nextId = (inMemoryData.libro_control_clientes.length > 0)
      ? Math.max(...inMemoryData.libro_control_clientes.map(d => d.id)) + 1
      : 1;
    const newRecord = {
      id: nextId,
      libro_id: libroId,
      cliente_id: clienteId,
      cliente: clienteNombre,
      tipo,
      monto,
      metodo_pago_id: metodoPagoId,
      metodo: metodoNombre || 'General',
      hora,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryData.libro_control_clientes.unshift(newRecord);
    return newRecord;
  }

  const res = await sql`
    INSERT INTO libro_control_clientes (
      libro_id, cliente_id, tipo, monto, metodo_pago_id, hora
    )
    VALUES (
      ${libroId}, ${clienteId}, ${tipo}, ${monto}, ${metodoPagoId}, ${hora}
    )
    RETURNING id, libro_id, cliente_id, tipo, monto, metodo_pago_id, hora, created_at, updated_at
  `;

  let clientInfo = null;
  if (clienteId) {
    const cRows = await sql`
      SELECT c.nombre AS cliente, tc.nombre AS tipo_cliente_nombre, c.tipo_cliente_id
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
      WHERE c.id = ${clienteId}
      LIMIT 1
    `;
    if (cRows.length > 0) clientInfo = cRows[0];
  }

  let metodoInfo = null;
  if (metodoPagoId) {
    const mRows = await sql`SELECT nombre FROM metodos_pago WHERE id = ${metodoPagoId} LIMIT 1`;
    if (mRows.length > 0) metodoInfo = mRows[0];
  }

  return {
    ...res[0],
    cliente: clientInfo ? clientInfo.cliente : clienteNombre,
    tipo_cliente_nombre: clientInfo ? clientInfo.tipo_cliente_nombre : 'General',
    tipo_cliente_id: clientInfo ? clientInfo.tipo_cliente_id : 1,
    metodo: metodoInfo ? metodoInfo.nombre : (metodoNombre || 'General'),
    metodo_pago_id: metodoPagoId
  };
}

export async function updateLibroControlClienteModel(controlId, libroId, data) {
  const cId = Number(controlId);
  const lId = Number(libroId);
  if (!cId) throw new Error('ID de registro inválido');

  const hora = (data.hora || '').trim();
  if (!hora) throw new Error('La hora es obligatoria');

  let metodoPagoId = data.metodo_pago_id !== undefined ? (data.metodo_pago_id ? Number(data.metodo_pago_id) : null) : undefined;
  const metodoNombre = data.metodo !== undefined ? String(data.metodo).trim() : undefined;
  if (metodoPagoId === undefined && metodoNombre && sql && isPgConnected) {
    const mRow = await sql`
      SELECT id FROM metodos_pago 
      WHERE LOWER(TRIM(nombre)) = LOWER(${metodoNombre}) 
      LIMIT 1
    `;
    if (mRow.length > 0) metodoPagoId = mRow[0].id;
  }

  let clienteId = data.cliente_id !== undefined ? (data.cliente_id ? Number(data.cliente_id) : null) : undefined;
  const clienteNombre = data.cliente !== undefined ? String(data.cliente).trim() : undefined;

  // Si clienteNombre viene pero no clienteId, resolver o crear
  if (clienteNombre && !clienteId && sql && isPgConnected) {
    let resolvedSalaId = null;
    if (lId) {
      const lib = await sql`SELECT sala_id FROM libros WHERE id = ${lId} LIMIT 1`;
      if (lib.length > 0 && lib[0].sala_id) resolvedSalaId = Number(lib[0].sala_id);
    }
    const existing = await sql`
      SELECT id FROM clientes 
      WHERE LOWER(TRIM(nombre)) = LOWER(${clienteNombre}) 
        ${resolvedSalaId ? sql`AND sala_id = ${resolvedSalaId}` : sql``}
      LIMIT 1
    `;
    if (existing.length > 0) {
      clienteId = existing[0].id;
    } else {
      const newClient = await sql`
        INSERT INTO clientes (nombre, tipo_cliente_id, sala_id)
        VALUES (${clienteNombre}, 1, ${resolvedSalaId || 1})
        RETURNING id
      `;
      clienteId = newClient[0].id;
    }
  }

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    const idx = inMemoryData.libro_control_clientes.findIndex(c => Number(c.id) === cId);
    if (idx !== -1) {
      inMemoryData.libro_control_clientes[idx].hora = hora;
      if (metodoPagoId !== undefined) inMemoryData.libro_control_clientes[idx].metodo_pago_id = metodoPagoId;
      if (metodoNombre !== undefined) inMemoryData.libro_control_clientes[idx].metodo = metodoNombre;
      if (clienteId !== undefined) inMemoryData.libro_control_clientes[idx].cliente_id = clienteId;
      if (clienteNombre !== undefined) inMemoryData.libro_control_clientes[idx].cliente = clienteNombre;
      inMemoryData.libro_control_clientes[idx].updated_at = new Date().toISOString();
      return inMemoryData.libro_control_clientes[idx];
    }
    throw new Error('Registro no encontrado');
  }

  const rows = await sql`
    UPDATE libro_control_clientes
    SET 
      hora = ${hora},
      metodo_pago_id = ${metodoPagoId !== undefined ? metodoPagoId : sql`metodo_pago_id`},
      cliente_id = ${clienteId !== undefined ? clienteId : sql`cliente_id`},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${cId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
    RETURNING id, libro_id, cliente_id, tipo, monto, metodo_pago_id, hora, created_at, updated_at
  `;

  if (!rows || rows.length === 0) {
    throw new Error('Registro no encontrado');
  }

  const updatedRecord = rows[0];
  let clientInfo = null;
  if (updatedRecord.cliente_id) {
    const cRows = await sql`
      SELECT c.nombre AS cliente, tc.nombre AS tipo_cliente_nombre, c.tipo_cliente_id
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
      WHERE c.id = ${updatedRecord.cliente_id}
      LIMIT 1
    `;
    if (cRows.length > 0) clientInfo = cRows[0];
  }

  let metodoInfo = null;
  if (updatedRecord.metodo_pago_id) {
    const mRows = await sql`SELECT nombre FROM metodos_pago WHERE id = ${updatedRecord.metodo_pago_id} LIMIT 1`;
    if (mRows.length > 0) metodoInfo = mRows[0];
  }

  return {
    ...updatedRecord,
    cliente: clientInfo ? clientInfo.cliente : (clienteNombre || ''),
    tipo_cliente_nombre: clientInfo ? clientInfo.tipo_cliente_nombre : '',
    tipo_cliente_id: clientInfo ? clientInfo.tipo_cliente_id : null,
    metodo: metodoInfo ? metodoInfo.nombre : (metodoNombre || 'General'),
    metodo_pago_id: updatedRecord.metodo_pago_id
  };
}

export async function deleteLibroControlClienteModel(id, libroId) {
  const cId = Number(id);
  const lId = Number(libroId);
  if (!cId) throw new Error('ID de registro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes || [];
    inMemoryData.libro_control_clientes = inMemoryData.libro_control_clientes.filter(c => Number(c.id) !== cId);
    return { success: true, id: cId };
  }

  await sql`
    DELETE FROM libro_control_clientes
    WHERE id = ${cId} ${lId ? sql`AND libro_id = ${lId}` : sql``}
  `;

  return { success: true, id: cId };
}

// --- CLIENTES (CECOM / GESTIÓN DE CLIENTES) ---
export function buildClienteConditions(options = {}) {
  const conds = [];

  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`c.sala_id = ANY(${options.userSalaIds})`);
  }

  if (options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`c.sala_id = ANY(${options.salaIds})`);
  }

  if (options.tipoClienteIds && options.tipoClienteIds.length > 0) {
    conds.push(sql`c.tipo_cliente_id = ANY(${options.tipoClienteIds})`);
  }

  if (options.search) {
    const s = `%${options.search}%`;
    conds.push(sql`(
      LOWER(c.nombre) LIKE ${s} OR 
      LOWER(COALESCE(c.descripcion, '')) LIKE ${s} OR 
      LOWER(COALESCE(tc.nombre, '')) LIKE ${s} OR 
      LOWER(COALESCE(s.nombre, '')) LIKE ${s} OR 
      c.id::text LIKE ${s}
    )`);
  }

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
  const sortBy = params.sortBy || 'id';
  const sortDir = (params.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  let userSalaIds = null;
  if (params.user_sala_ids) {
    userSalaIds = String(params.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let salaIds = null;
  if (params.sala_ids) {
    salaIds = String(params.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  }
  let tipoClienteIds = null;
  if (params.tipo_cliente_ids) {
    tipoClienteIds = String(params.tipo_cliente_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
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
    'id': 'c.id',
    'nombre': 'c.nombre',
    'tipo_cliente_nombre': 'tc.nombre',
    'sala_nombre': 's.nombre',
    'descripcion': 'c.descripcion',
    'created_at': 'c.created_at'
  };
  const orderCol = allowedSortColumns[sortBy] || 'c.id';
  const orderClause = sql.unsafe(`ORDER BY ${orderCol} ${sortDir}, c.id DESC`);

  const countRes = await sql`
    SELECT COUNT(c.id)::int AS total
    FROM clientes c
    LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
    LEFT JOIN salas s ON c.sala_id = s.id
    ${where}
  `;
  const total = countRes[0]?.total || 0;

  let data;
  if (limit > 0) {
    data = await sql`
      SELECT c.id, c.nombre, c.tipo_cliente_id, c.sala_id, c.foto, c.descripcion,
             to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
             to_char(COALESCE(c.updated_at, c.created_at), 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
             tc.nombre AS tipo_cliente_nombre,
             s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
      LEFT JOIN salas s ON c.sala_id = s.id
      ${where}
      ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    data = await sql`
      SELECT c.id, c.nombre, c.tipo_cliente_id, c.sala_id, c.foto, c.descripcion,
             to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
             to_char(COALESCE(c.updated_at, c.created_at), 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
             tc.nombre AS tipo_cliente_nombre,
             s.nombre AS sala_nombre, s.nombre_comercial AS sala_nombre_comercial
      FROM clientes c
      LEFT JOIN tipo_clientes tc ON c.tipo_cliente_id = tc.id
      LEFT JOIN salas s ON c.sala_id = s.id
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
    allSalas = await sql`SELECT id, nombre FROM salas WHERE id = ANY(${userSalaIds}) ORDER BY nombre ASC`;
  } else {
    allSalas = await sql`SELECT id, nombre FROM salas ORDER BY nombre ASC`;
  }

  const countsSalasRes = await sql`
    SELECT c.sala_id AS id, COUNT(c.id)::int AS count
    FROM clientes c
    WHERE c.sala_id IS NOT NULL
    GROUP BY c.sala_id
  `;
  const countSalasMap = new Map(countsSalasRes.map(r => [r.id, r.count]));
  const salas = allSalas.map(s => ({
    id: s.id,
    nombre: s.nombre,
    count: countSalasMap.get(s.id) || 0
  }));

  const allTipos = await sql`SELECT id, nombre FROM tipo_clientes ORDER BY nombre ASC`;
  const countsTiposRes = await sql`
    SELECT c.tipo_cliente_id AS id, COUNT(c.id)::int AS count
    FROM clientes c
    WHERE c.tipo_cliente_id IS NOT NULL
    GROUP BY c.tipo_cliente_id
  `;
  const countTiposMap = new Map(countsTiposRes.map(r => [r.id, r.count]));
  const tipo_clientes = allTipos.map(t => ({
    id: t.id,
    nombre: t.nombre,
    count: countTiposMap.get(t.id) || 0
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
  const tipoClienteId = data.tipo_cliente_id ? Number(data.tipo_cliente_id) : null;
  const salaId = data.sala_id ? Number(data.sala_id) : null;
  const descripcion = data.descripcion !== undefined ? (data.descripcion ? String(data.descripcion).trim() : null) : null;

  let nextId = 1;
  if (isPgConnected && sql) {
    try {
      await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto VARCHAR(255);`;
      await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS descripcion TEXT;`;
    } catch (e) {}
    const nextIdRes = await sql`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM clientes`;
    nextId = Number(nextIdRes[0].next_id);
  } else {
    inMemoryData.clientes = inMemoryData.clientes || [];
    nextId = inMemoryData.clientes.length > 0 ? Math.max(...inMemoryData.clientes.map(c => c.id)) + 1 : 1;
  }

  let foto = data.foto || null;
  if (data.fotoBase64) {
    try {
      const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const dir = resolveClientesDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${nextId}.jpg`), buffer);
      foto = `/clientes/${nextId}.jpg`;
      invalidateClienteThumbnails(nextId);
    } catch (e) {
      console.error('Error guardando foto de cliente:', e);
    }
  }

  if (isPgConnected && sql) {
    const res = await sql`
      INSERT INTO clientes (id, nombre, tipo_cliente_id, sala_id, foto, descripcion)
      VALUES (${nextId}, ${nombre}, ${tipoClienteId}, ${salaId}, ${foto}, ${descripcion})
      RETURNING id, nombre, tipo_cliente_id, sala_id, foto, descripcion, created_at, updated_at
    `;
    return res[0];
  } else {
    inMemoryData.clientes = inMemoryData.clientes || [];
    const newItem = { id: nextId, nombre, tipo_cliente_id: tipoClienteId, sala_id: salaId, foto, descripcion, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    inMemoryData.clientes.unshift(newItem);
    return newItem;
  }
}

export async function updateClienteModel(id, data) {
  const cId = Number(id);
  if (!cId) throw new Error('ID de cliente inválido');

  const nombre = data.nombre !== undefined ? String(data.nombre).trim() : undefined;
  const tipoClienteId = data.tipo_cliente_id !== undefined ? (data.tipo_cliente_id ? Number(data.tipo_cliente_id) : null) : undefined;
  const salaId = data.sala_id !== undefined ? (data.sala_id ? Number(data.sala_id) : null) : undefined;
  const descripcion = data.descripcion !== undefined ? (data.descripcion ? String(data.descripcion).trim() : null) : undefined;

  let foto = data.foto;
  if (data.fotoBase64) {
    try {
      const base64Data = data.fotoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const dir = resolveClientesDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${cId}.jpg`), buffer);
      foto = `/clientes/${cId}.jpg`;
      invalidateClienteThumbnails(cId);
    } catch (e) {
      console.error('Error actualizando foto de cliente:', e);
    }
  } else if (data.removeFoto) {
    foto = null;
    try {
      const dir = resolveClientesDir();
      const filePath = path.join(dir, `${cId}.jpg`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      invalidateClienteThumbnails(cId);
    } catch (e) {}
  }

  if (isPgConnected && sql) {
    try {
      await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto VARCHAR(255);`;
      await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS descripcion TEXT;`;
    } catch (e) {}

    const res = await sql`
      UPDATE clientes
      SET
        nombre = COALESCE(${nombre}, nombre),
        tipo_cliente_id = ${tipoClienteId !== undefined ? tipoClienteId : sql`tipo_cliente_id`},
        sala_id = ${salaId !== undefined ? salaId : sql`sala_id`},
        foto = ${foto !== undefined ? foto : sql`foto`},
        descripcion = ${descripcion !== undefined ? descripcion : sql`descripcion`},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${cId}
      RETURNING id, nombre, tipo_cliente_id, sala_id, foto, descripcion, created_at, updated_at
    `;
    return res[0];
  } else {
    inMemoryData.clientes = inMemoryData.clientes || [];
    const idx = inMemoryData.clientes.findIndex(c => c.id === cId);
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
  const cId = Number(id);
  const result = await deleteEntityDynamic('clientes', 'cliente', id);
  if (result && (result.success || result.id)) {
    try {
      const dir = resolveClientesDir();
      const filePath = path.join(dir, `${cId}.jpg`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
  }
  return result;
}

// --- DATOS DEL LIBRO (CECOM: LIBRO DATOS OPERATIVOS) ---
export async function getLibroDatosModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_datos = inMemoryData.libro_datos || [];
    const found = inMemoryData.libro_datos.find(d => Number(d.libro_id) === lId);
    return found || null;
  }

  const rows = await sql`
    SELECT 
      id, libro_id,
      apertura_sala_inicio, apertura_sala_fin,
      apertura_maquinas_inicio, apertura_maquinas_fin,
      apertura_bingo_inicio, apertura_bingo_fin,
      retiros_dropbox_inicio, retiros_dropbox_fin,
      conteo_dropbox_inicio, conteo_dropbox_fin,
      operador_turno_a, operador_turno_c,
      created_at, updated_at
    FROM libro_datos
    WHERE libro_id = ${lId}
    LIMIT 1
  `;

  return rows.length > 0 ? rows[0] : null;
}

export async function saveLibroDatosModel(libroId, data) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

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

  if (!isPgConnected || !sql) {
    inMemoryData.libro_datos = inMemoryData.libro_datos || [];
    let idx = inMemoryData.libro_datos.findIndex(d => Number(d.libro_id) === lId);
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
      const nextId = (inMemoryData.libro_datos.length > 0)
        ? Math.max(...inMemoryData.libro_datos.map(d => d.id)) + 1
        : 1;
      const newRecord = {
        id: nextId,
        libro_id: lId,
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

  const rows = await sql`
    INSERT INTO libro_datos (
      libro_id,
      apertura_sala_inicio, apertura_sala_fin,
      apertura_maquinas_inicio, apertura_maquinas_fin,
      apertura_bingo_inicio, apertura_bingo_fin,
      retiros_dropbox_inicio, retiros_dropbox_fin,
      conteo_dropbox_inicio, conteo_dropbox_fin,
      operador_turno_a, operador_turno_c
    )
    VALUES (
      ${lId},
      ${aperturaSalaInicio}, ${aperturaSalaFin},
      ${aperturaMaquinasInicio}, ${aperturaMaquinasFin},
      ${aperturaBingoInicio}, ${aperturaBingoFin},
      ${retirosDropboxInicio}, ${retirosDropboxFin},
      ${conteoDropboxInicio}, ${conteoDropboxFin},
      ${operadorTurnoA}, ${operadorTurnoC}
    )
    ON CONFLICT (libro_id) DO UPDATE SET
      apertura_sala_inicio = EXCLUDED.apertura_sala_inicio,
      apertura_sala_fin = EXCLUDED.apertura_sala_fin,
      apertura_maquinas_inicio = EXCLUDED.apertura_maquinas_inicio,
      apertura_maquinas_fin = EXCLUDED.apertura_maquinas_fin,
      apertura_bingo_inicio = EXCLUDED.apertura_bingo_inicio,
      apertura_bingo_fin = EXCLUDED.apertura_bingo_fin,
      retiros_dropbox_inicio = EXCLUDED.retiros_dropbox_inicio,
      retiros_dropbox_fin = EXCLUDED.retiros_dropbox_fin,
      conteo_dropbox_inicio = EXCLUDED.conteo_dropbox_inicio,
      conteo_dropbox_fin = EXCLUDED.conteo_dropbox_fin,
      operador_turno_a = EXCLUDED.operador_turno_a,
      operador_turno_c = EXCLUDED.operador_turno_c,
      updated_at = CURRENT_TIMESTAMP
    RETURNING 
      id, libro_id,
      apertura_sala_inicio, apertura_sala_fin,
      apertura_maquinas_inicio, apertura_maquinas_fin,
      apertura_bingo_inicio, apertura_bingo_fin,
      retiros_dropbox_inicio, retiros_dropbox_fin,
      conteo_dropbox_inicio, conteo_dropbox_fin,
      operador_turno_a, operador_turno_c,
      created_at, updated_at
  `;

  return rows[0];
}

// --- NOVEDADES DE MESAS (CECOM: LIBRO NOVEDADES MESAS) ---
export async function getLibroNovedadesMesasModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas || [];
    return inMemoryData.libro_novedades_mesas.filter(d => Number(d.libro_id) === lId);
  }

  const rows = await sql`
    SELECT 
      nm.id,
      nm.libro_id,
      nm.mesa_id,
      m.nombre AS mesa_nombre,
      m.sala_id,
      j.nombre AS juego_nombre,
      nm.hora_apertura,
      nm.hora_cierre,
      nm.pitboss,
      nm.croupier_apertura,
      nm.croupier_cierre,
      nm.observacion,
      nm.created_at,
      nm.updated_at
    FROM libro_novedades_mesas nm
    LEFT JOIN mesas m ON m.id = nm.mesa_id
    LEFT JOIN juegos j ON j.id = m.juego_id
    WHERE nm.libro_id = ${lId}
    ORDER BY m.nombre ASC, nm.id ASC
  `;

  return rows;
}

export async function saveLibroNovedadesMesaModel(libroId, data) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

  const mesaId = Number(data.mesa_id);
  if (!mesaId) throw new Error('ID de mesa inválido');

  const horaApertura = (data.hora_apertura || '').trim() || null;
  const horaCierre = (data.hora_cierre || '').trim() || null;
  const pitboss = (data.pitboss || '').trim() || null;
  const croupierApertura = (data.croupier_apertura || '').trim() || null;
  const croupierCierre = (data.croupier_cierre || '').trim() || null;
  const observacion = (data.observacion || '').trim() || null;

  if (!isPgConnected || !sql) {
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas || [];
    let idx = inMemoryData.libro_novedades_mesas.findIndex(
      d => Number(d.libro_id) === lId && Number(d.mesa_id) === mesaId
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
      const nextId = (inMemoryData.libro_novedades_mesas.length > 0)
        ? Math.max(...inMemoryData.libro_novedades_mesas.map(d => d.id)) + 1
        : 1;
      const newRecord = {
        id: nextId,
        libro_id: lId,
        mesa_id: mesaId,
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

  const rows = await sql`
    INSERT INTO libro_novedades_mesas (
      libro_id,
      mesa_id,
      hora_apertura,
      hora_cierre,
      pitboss,
      croupier_apertura,
      croupier_cierre,
      observacion
    )
    VALUES (
      ${lId},
      ${mesaId},
      ${horaApertura},
      ${horaCierre},
      ${pitboss},
      ${croupierApertura},
      ${croupierCierre},
      ${observacion}
    )
    ON CONFLICT (libro_id, mesa_id) DO UPDATE SET
      hora_apertura = EXCLUDED.hora_apertura,
      hora_cierre = EXCLUDED.hora_cierre,
      pitboss = EXCLUDED.pitboss,
      croupier_apertura = EXCLUDED.croupier_apertura,
      croupier_cierre = EXCLUDED.croupier_cierre,
      observacion = EXCLUDED.observacion,
      updated_at = CURRENT_TIMESTAMP
    RETURNING 
      id, libro_id, mesa_id,
      hora_apertura, hora_cierre,
      pitboss, croupier_apertura, croupier_cierre,
      observacion,
      created_at, updated_at
  `;

  return rows[0];
}

export async function deleteLibroNovedadesMesaModel(recordId) {
  const rId = Number(recordId);
  if (!rId) throw new Error('ID de registro inválido');

  if (!isPgConnected || !sql) {
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas || [];
    inMemoryData.libro_novedades_mesas = inMemoryData.libro_novedades_mesas.filter(d => Number(d.id) !== rId);
    return { success: true };
  }

  await sql`
    DELETE FROM libro_novedades_mesas
    WHERE id = ${rId}
  `;

  return { success: true };
}

// --- REPORTE CONSOLIDADO DEL LIBRO (TABLA libro_reporte - HISTÓRICO Y COMPARTIR) ---
export async function saveLibroReporteModel(libroId) {
  const lId = Number(libroId);
  if (!lId) throw new Error('ID de libro inválido');

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
    getLibroByIdModel(lId).catch(e => null),
    getLibroDatosModel(lId).catch(e => null),
    getLibroDropMesasModel(lId).catch(e => []),
    getLibroNovedadesMesasModel(lId).catch(e => []),
    getLibroAportesModel(lId).catch(e => []),
    getLibroControlLlavesModel(lId).catch(e => []),
    getLibroControlClientesModel(lId).catch(e => []),
    getLibroIncidenciasGeneralesModel(lId).catch(e => [])
  ]);

  const libroObj = (libroRes && libroRes.data) ? libroRes.data : (libroRes?.id ? libroRes : null);
  const salaId = libroObj?.sala_id ? Number(libroObj.sala_id) : null;
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
    libro_id: lId,
    sala_id: salaId,
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

  if (isPgConnected && sql) {
    const rows = await sql`
      INSERT INTO libro_reporte (
        libro_id,
        data
      ) VALUES (
        ${lId},
        CAST(${jsonStr} AS JSONB)
      )
      ON CONFLICT (libro_id) DO UPDATE
      SET
        data = EXCLUDED.data,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, libro_id, data, created_at, updated_at
    `;

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
  const existingIdx = inMemoryData.libro_reporte.findIndex(r => Number(r.libro_id) === lId);
  const record = {
    id: existingIdx !== -1 ? inMemoryData.libro_reporte[existingIdx].id : inMemoryData.libro_reporte.length + 1,
    libro_id: lId,
    sala_id: salaId,
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
  const numId = Number(idOrLibroId);
  if (!numId) throw new Error('ID de reporte o libro inválido');

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
    getLibroByIdModel(numId).catch(() => null),
    getLibroDatosModel(numId).catch(() => null),
    getLibroDropMesasModel(numId).catch(() => []),
    getLibroNovedadesMesasModel(numId).catch(() => []),
    getLibroAportesModel(numId).catch(() => []),
    getLibroControlLlavesModel(numId).catch(() => []),
    getLibroControlClientesModel(numId).catch(() => []),
    getLibroIncidenciasGeneralesModel(numId).catch(() => [])
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

  const libroObj = (libroRes && libroRes.data) ? libroRes.data : (libroRes?.id ? libroRes : null);

  const previewData = {
    libro_id: numId,
    sala_id: libroObj?.sala_id || null,
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
    if (libroObj) {
      // numId es un libro_id existente: buscar estrictamente por libro_id
      rows = await sql`
        SELECT id, libro_id, data, created_at, updated_at
        FROM libro_reporte
        WHERE libro_id = ${numId}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
    } else {
      // Fallback si numId no coincide con ningún libro registrado en la tabla libros
      rows = await sql`
        SELECT id, libro_id, data, created_at, updated_at
        FROM libro_reporte
        WHERE id = ${numId}
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
    if (libroObj) {
      found = (inMemoryData.libro_reporte || []).find(r => Number(r.libro_id) === numId);
    } else {
      found = (inMemoryData.libro_reporte || []).find(r => Number(r.id) === numId);
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

  // Si no existe aún en la tabla libro_reporte:
  if (autoGenerate) {
    return await saveLibroReporteModel(numId);
  }

  // Retorna preview con exists = false para que el botón muestre "+ Generar Reporte"
  return {
    success: true,
    exists: false,
    liveCounts,
    data: {
      id: null,
      libro_id: numId,
      sala_id: libroObj?.sala_id || null,
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

