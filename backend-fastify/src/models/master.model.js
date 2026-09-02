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
export async function getAttlogsModel() {
  const config = await getConfiguracionModel();
  const tz = config.timezone || 'America/Caracas';

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
      } else if (e === 'undefined' || e === 'otros' || e === 'indefinido') {
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
  const tz = config.timezone || 'America/Caracas';

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

    return await sql`
      SELECT a.id, a.attendancestatus, a.currentverifymode, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
             COALESCE(NULLIF(TRIM(e.nombre), ''), NULLIF(TRIM(a.nombre), ''), 'Empleado ' || a.employee_no) AS nombre,
             a.dispositivo_id, d.nombre AS dispositivo_nombre, d.sala_id, s.nombre AS sala_nombre,
             e.id AS empleado_id, e.cedula, e.foto AS empleado_foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento,
             c.nombre AS cargo_nombre, ar.nombre AS area_nombre, dep.nombre AS departamento_nombre,
             a.has_photo,
             (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
      FROM attlogs a
      LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas ar ON c.area_id = ar.id
      LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      ${whereClause}
      ${orderClause}
      LIMIT ${numLimit} OFFSET ${numOffset}
    `;
  }

  let list = (inMemoryData.attlogs || []);
  return list.slice(numOffset, numOffset + numLimit);
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
      SELECT COUNT(*)::int AS total
      FROM attlogs a
      LEFT JOIN dispositivos d ON a.dispositivo_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
    const [salasRes, devRes, estRes, vmRes, fotoRes, empStatusRes, sexoRes, depRes, areaRes, cargoRes] = await Promise.all([
      // 1. Salas Options: Always include all user's assigned salas, with dynamic matching count
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipSalas: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

        let allSalas;
        if (options.userSalaIds && options.userSalaIds.length > 0) {
          allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) ORDER BY s.nombre ASC`;
        } else {
          allSalas = await sql`SELECT s.id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
        }

        const countsRes = await sql`
          SELECT s.id, COUNT(a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
          SELECT d.id, COUNT(a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
            SUM(CASE WHEN LOWER(a.attendancestatus) = 'checkin' THEN 1 ELSE 0 END)::int AS checkin_count,
            SUM(CASE WHEN LOWER(a.attendancestatus) = 'checkout' THEN 1 ELSE 0 END)::int AS checkout_count,
            SUM(CASE WHEN LOWER(COALESCE(a.attendancestatus, '')) NOT IN ('checkin', 'checkout') THEN 1 ELSE 0 END)::int AS undefined_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
          { key: 'undefined', label: 'Indefinido / Otros', count: row.undefined_count || 0 }
        ].filter(e => e.count > 0 || activeEst.has(e.key));
      })(),

      // 4. Verify Modes Options (Facial, Facial / Carnet, Tarjeta / Carnet, Huella, Otros)
      (async () => {
        const conds = buildAttlogConditions({ ...options, skipVerifyModes: true });
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            SUM(CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('face', 'facial') THEN 1 ELSE 0 END)::int AS face_count,
            SUM(CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('cardorface', 'faceorcard') THEN 1 ELSE 0 END)::int AS card_or_face_count,
            SUM(CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) IN ('card', 'tarjeta', 'carnet') THEN 1 ELSE 0 END)::int AS card_count,
            SUM(CASE WHEN LOWER(COALESCE(a.currentverifymode, '')) LIKE '%finger%' OR LOWER(COALESCE(a.currentverifymode, '')) LIKE '%huella%' THEN 1 ELSE 0 END)::int AS finger_count,
            SUM(CASE WHEN a.currentverifymode IS NULL OR (
              LOWER(COALESCE(a.currentverifymode, '')) NOT IN ('face', 'facial', 'card', 'tarjeta', 'carnet', 'cardorface', 'faceorcard') AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%finger%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%huella%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pw%' AND
              LOWER(COALESCE(a.currentverifymode, '')) NOT LIKE '%pass%'
            ) THEN 1 ELSE 0 END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
            SUM(CASE WHEN a.has_photo = TRUE THEN 1 ELSE 0 END)::int AS con_foto_count,
            SUM(CASE WHEN a.has_photo = FALSE OR a.has_photo IS NULL THEN 1 ELSE 0 END)::int AS sin_foto_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
            SUM(CASE WHEN e.activo = TRUE THEN 1 ELSE 0 END)::int AS activos_count,
            SUM(CASE WHEN e.activo = FALSE THEN 1 ELSE 0 END)::int AS desincorporados_count,
            SUM(CASE WHEN e.id IS NULL OR e.activo IS NULL THEN 1 ELSE 0 END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
            SUM(CASE WHEN LOWER(COALESCE(e.sexo, '')) IN ('f', 'femenino', 'mujer') THEN 1 ELSE 0 END)::int AS mujer_count,
            SUM(CASE WHEN LOWER(COALESCE(e.sexo, '')) IN ('m', 'masculino', 'hombre') THEN 1 ELSE 0 END)::int AS hombre_count,
            SUM(CASE WHEN e.id IS NULL OR e.sexo IS NULL OR LOWER(COALESCE(e.sexo, '')) NOT IN ('f', 'femenino', 'mujer', 'm', 'masculino', 'hombre') THEN 1 ELSE 0 END)::int AS otros_count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          LEFT JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            dep.id, 
            dep.nombre, 
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre, 
            COUNT(a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            ar.id, 
            ar.nombre, 
            COALESCE(dep.nombre, 'Sin Departamento') AS departamento_nombre, 
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre,
            COUNT(a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
          JOIN cargos c ON e.cargo_id = c.id
          JOIN areas ar ON c.area_id = ar.id
          LEFT JOIN departamentos dep ON ar.departamento_id = dep.id
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
        const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;
        const res = await sql`
          SELECT 
            c.id, 
            c.nombre, 
            COALESCE(ar.nombre, 'Sin Área') AS area_nombre, 
            COALESCE(dep.nombre, 'Sin Departamento') AS departamento_nombre,
            COALESCE(s_dep.nombre, s.nombre, 'Sin Sala') AS sala_nombre,
            COUNT(a.id)::int AS count
          FROM attlogs a
          JOIN dispositivos d ON a.dispositivo_id = d.id
          LEFT JOIN salas s ON d.sala_id = s.id
          JOIN empleados e ON REPLACE(REPLACE(UPPER(COALESCE(a.employee_no, '')), 'V', ''), '-', '') = REPLACE(REPLACE(UPPER(COALESCE(e.cedula, '')), 'V', ''), '-', '')
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
  } else if (estados === null) {
    whereConditions.push(sql`LOWER(COALESCE(a.attendancestatus, '')) IN ('checkin', 'checkout')`);
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
      const rows = await sql`
        INSERT INTO attlogs (dispositivo_id, employee_no, event_time, nombre, attendancestatus, currentverifymode, has_photo)
        VALUES (${Number(dispositivo_id)}, ${String(log.employee_no)}, ${log.event_time}, ${log.nombre || null}, ${log.attendanceStatus || null}, ${verifyMode}, ${hasPhoto})
        ON CONFLICT (dispositivo_id, employee_no, event_time)
        DO UPDATE SET updated_at = CURRENT_TIMESTAMP,
                      currentverifymode = COALESCE(EXCLUDED.currentverifymode, attlogs.currentverifymode),
                      has_photo = CASE WHEN EXCLUDED.has_photo = TRUE THEN TRUE ELSE attlogs.has_photo END
        RETURNING id
      `;
      const attlogId = rows[0]?.id;
      if (attlogId && log.foto_base64) {
        saveAttlogPhoto(attlogId, log.foto_base64);
      }
      if (attlogId) {
        let fullRecord = null;
        try {
          const tz = 'America/Caracas';
          const fullRows = await sql`
            SELECT a.id, a.attendancestatus, a.currentverifymode, a.employee_no, to_char(a.event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
                   COALESCE(NULLIF(TRIM(e.nombre), ''), NULLIF(TRIM(a.nombre), ''), 'Empleado ' || a.employee_no) AS nombre,
                   a.dispositivo_id, d.nombre AS dispositivo_nombre, d.sala_id, s.nombre AS sala_nombre,
                   e.id AS empleado_id, e.cedula, e.foto AS empleado_foto, e.sexo, e.fecha_ingreso, e.fecha_nacimiento,
                   c.nombre AS cargo_nombre, ar.nombre AS area_nombre, dep.nombre AS departamento_nombre,
                   (SELECT count(*)::int FROM attlogs a2 WHERE a2.employee_no = a.employee_no AND LOWER(COALESCE(a2.attendancestatus, '')) IN ('checkin', 'checkout')) AS total_employee_attlogs
            FROM attlogs a
            LEFT JOIN empleados e ON (a.employee_no = e.cedula OR a.employee_no = CAST(e.id AS TEXT) OR e.cedula = 'V' || a.employee_no OR e.cedula = REPLACE(a.employee_no, 'V', ''))
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
              currentverifymode: fullRows[0].currentverifymode || verifyMode || null,
              currentverifymode_status: fullRows[0].currentverifymode || verifyMode || null
            };
          }
        } catch (e) {
          console.warn('Error enriqueciendo evento de nuevo marcaje:', e);
        }

        attlogEvents.emit('new_attlog', fullRecord || {
          id: attlogId,
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
  const tz = 'America/Caracas';
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
  const tz = config.timezone || 'America/Caracas';

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
  'REPORTE': 2,
  'EDITAR': 3,
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
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) ORDER BY s.nombre ASC`;
  } else {
    allSalas = await sql`SELECT s.id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
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
    conds.push(sql`s.id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`s.id = ANY(${options.salaIds})`);
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
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
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
    conds.push(sql`s.id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`s.id = ANY(${options.salaIds})`);
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
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
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
    conds.push(sql`s.id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`s.id = ANY(${options.salaIds})`);
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
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
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
      SELECT e.*, c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.nombre AS sala_nombre
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
      SELECT e.*, c.nombre AS cargo_nombre, a.nombre AS area_nombre, d.nombre AS departamento_nombre, s.nombre AS sala_nombre
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

export async function createEmpleadoModel(data) {
  if (isPgConnected && sql) {
    const nextIdRes = await sql`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM empleados`;
    const nextId = Number(nextIdRes[0].next_id);
    const foto = data.foto || `/empleados/${nextId}.jpg`;

    const rows = await sql`
      INSERT INTO empleados (id, foto, nombre, cedula, fecha_ingreso, fecha_nacimiento, sexo, cargo_id, activo, motivo_desincorporacion)
      VALUES (${nextId}, ${foto}, ${data.nombre}, ${data.cedula}, ${data.fecha_ingreso || null}, ${data.fecha_nacimiento || null}, ${data.sexo || 'Masculino'}, ${data.cargo_id || null}, ${data.activo ?? true}, ${data.motivo_desincorporacion || null})
      RETURNING *
    `;
    return rows[0];
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

    const foto = data.foto !== undefined ? data.foto : existing.foto;
    const nombre = data.nombre !== undefined ? data.nombre : existing.nombre;
    const cedula = data.cedula !== undefined ? data.cedula : existing.cedula;
    const fecha_ingreso = data.fecha_ingreso !== undefined ? data.fecha_ingreso : existing.fecha_ingreso;
    const fecha_nacimiento = data.fecha_nacimiento !== undefined ? data.fecha_nacimiento : existing.fecha_nacimiento;
    const sexo = data.sexo !== undefined ? data.sexo : existing.sexo;
    const cargo_id = data.cargo_id !== undefined ? (data.cargo_id ? Number(data.cargo_id) : null) : existing.cargo_id;
    const activo = data.activo !== undefined ? Boolean(data.activo) : existing.activo;
    const motivo_desincorporacion = data.motivo_desincorporacion !== undefined ? data.motivo_desincorporacion : existing.motivo_desincorporacion;

    const rows = await sql`
      UPDATE empleados
      SET foto = ${foto},
          nombre = ${nombre},
          cedula = ${cedula},
          fecha_ingreso = ${fecha_ingreso},
          fecha_nacimiento = ${fecha_nacimiento},
          sexo = ${sexo},
          cargo_id = ${cargo_id},
          activo = ${activo},
          motivo_desincorporacion = ${motivo_desincorporacion},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${eId}
      RETURNING *
    `;
    return rows[0];
  }
  return null;
}

export async function deleteEmpleadoModel(id) {
  return await deleteEntityDynamic('empleados', 'empleado', id);
}



// --- PLANTILLAS HORARIOS ---
export function buildPlantillasHorariosConditions(options = {}) {
  const conds = [];

  // 1. Restricción por salas asignadas al usuario logueado
  if (options.userSalaIds && options.userSalaIds.length > 0) {
    conds.push(sql`p.sala_id = ANY(${options.userSalaIds})`);
  }

  // 2. Salas seleccionadas
  if (!options.skipSalas && options.salaIds && options.salaIds.length > 0) {
    conds.push(sql`p.sala_id = ANY(${options.salaIds})`);
  }

  // 3. Tipos seleccionados (horario, plantilla)
  if (!options.skipTipo && options.tipo && options.tipo.length > 0) {
    const tipos = options.tipo.map(t => String(t).toLowerCase());
    conds.push(sql`LOWER(p.tipo) = ANY(${tipos})`);
  }

  // 4. Búsqueda por texto
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
      data: { salas: [], tipo: [] }
    };
  }

  const [salas, tipoRes] = await Promise.all([
    // 1. Salas
    (async () => {
      const conds = buildPlantillasHorariosConditions({ ...options, skipSalas: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

      let allSalas;
      if (options.userSalaIds && options.userSalaIds.length > 0) {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s WHERE s.id = ANY(${options.userSalaIds}) ORDER BY s.nombre ASC`;
      } else {
        allSalas = await sql`SELECT s.id, s.nombre FROM salas s ORDER BY s.nombre ASC`;
      }

      const countsRes = await sql`
        SELECT p.sala_id AS id, COUNT(p.id)::int AS count
        FROM plantillas_horarios p
        LEFT JOIN salas s ON p.sala_id = s.id
        ${where}
        GROUP BY p.sala_id
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

    // 2. Tipo (horario, plantilla)
    (async () => {
      const conds = buildPlantillasHorariosConditions({ ...options, skipTipo: true });
      const where = conds.length > 0 ? sql`WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

      const countsRes = await sql`
        SELECT LOWER(COALESCE(p.tipo, 'horario')) AS tipo_val, COUNT(p.id)::int AS count
        FROM plantillas_horarios p
        LEFT JOIN salas s ON p.sala_id = s.id
        ${where}
        GROUP BY LOWER(COALESCE(p.tipo, 'horario'))
      `;
      const countMap = new Map(countsRes.map(r => [r.tipo_val, r.count]));
      const activeSet = new Set((options.tipo || []).map(t => String(t).toLowerCase()));

      const availableTipos = [
        { id: 'horario', nombre: 'Horario', count: countMap.get('horario') || 0 },
        { id: 'plantilla', nombre: 'Excepción', count: countMap.get('plantilla') || 0 }
      ];

      return availableTipos
        .filter(t => t.count > 0 || activeSet.has(t.id))
        .sort((a, b) => b.count - a.count);
    })()
  ]);

  return {
    success: true,
    data: {
      salas,
      tipo: tipoRes
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
  let tipo = null;
  if (params.tipo) {
    tipo = String(params.tipo).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  }

  const allowedSortColumns = {
    'id': 'p.id',
    'codigo': "CASE WHEN p.codigo ~ '^[0-9]+$' THEN LPAD(p.codigo, 10, '0') ELSE UPPER(p.codigo) END",
    'nombre': 'UPPER(p.nombre)',
    'sala_nombre': 'UPPER(s.nombre)',
    'horas_trabajo': 'p.hora_entrada',
    'hora_entrada': 'p.hora_entrada',
    'jornada': "COALESCE(p.hora_salida, '00:00:00') - COALESCE(p.hora_entrada, '00:00:00')",
    'color': 'p.color',
    'tipo': 'p.tipo'
  };

  const sortSql = allowedSortColumns[sortBy] || allowedSortColumns['codigo'];
  const orderClause = sql.unsafe("ORDER BY " + sortSql + " " + sortDir + ", p.id DESC");

  if (isPgConnected && sql) {
    const conds = buildPlantillasHorariosConditions({
      userSalaIds,
      salaIds,
      tipo,
      search
    });

    const whereClause = conds.length > 0
      ? sql`WHERE ${conds.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`
      : sql``;

    const countRes = await sql`
      SELECT COUNT(*)::int AS total
      FROM plantillas_horarios p
      LEFT JOIN salas s ON p.sala_id = s.id
      ${whereClause}
    `;
    const total = countRes[0]?.total || 0;

    const dataRes = await sql`
      SELECT p.*, s.nombre AS sala_nombre
      FROM plantillas_horarios p
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
    const computedTipo = (!data.hora_entrada && !data.hora_salida) ? 'plantilla' : (data.tipo || 'horario');
    const rows = await sql`
      INSERT INTO plantillas_horarios (
        nombre, sala_id, codigo, hora_entrada, hora_salida, 
        hora_descanso_entrada, hora_descanso_salida, descanso_automatico, color, tipo
      )
      VALUES (
        ${data.nombre}, ${Number(data.sala_id)}, ${data.codigo}, 
        ${data.hora_entrada || null}, ${data.hora_salida || null}, 
        ${data.hora_descanso_entrada || null}, ${data.hora_descanso_salida || null}, 
        ${data.descanso_automatico || null}, ${data.color || '#FFFF99'}, 
        ${computedTipo}
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
    const computedTipo = (!data.hora_entrada && !data.hora_salida) ? 'plantilla' : (data.tipo || 'horario');
    const rows = await sql`
      UPDATE plantillas_horarios
      SET nombre = ${data.nombre},
          sala_id = ${Number(data.sala_id)},
          codigo = ${data.codigo},
          hora_entrada = ${data.hora_entrada || null},
          hora_salida = ${data.hora_salida || null},
          descanso_automatico = ${data.descanso_automatico || null},
          color = ${data.color || '#FFFF99'},
          tipo = ${computedTipo},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${pId}
      RETURNING *
    `;
    return rows[0];
  }
  return null;
}

export async function deletePlantillaHorarioModel(id) {
  return await deleteEntityDynamic('plantillas_horarios', 'plantilla_horario', id);
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

      // Get all distinct assigned shift plantillas for active employees in this department
      const horariosRes = await sql`
        SELECT DISTINCT ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color, ph.tipo
        FROM empleados_plantillas_horarios eph
        JOIN empleados e ON eph.empleado_id = e.id
        JOIN cargos c ON e.cargo_id = c.id
        JOIN areas a ON c.area_id = a.id
        JOIN plantillas_horarios ph ON eph.plantilla_horario_id = ph.id
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

    // Get all shift plantillas for this department's sala
    const plantillasSala = await sql`
      SELECT id, codigo, nombre, hora_entrada, hora_salida, color, tipo
      FROM plantillas_horarios
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
        SELECT ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color, ph.tipo
        FROM empleados_plantillas_horarios eph
        JOIN plantillas_horarios ph ON eph.plantilla_horario_id = ph.id
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
    const plantillaId = payload.plantilla_id ? Number(payload.plantilla_id) : null;
    const empId = payload.empleado_id ? Number(payload.empleado_id) : null;

    if (action === 'bulk_add' && plantillaId) {
      await sql`
        INSERT INTO empleados_plantillas_horarios (empleado_id, plantilla_horario_id)
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
      // Remove ALL horario-type plantillas from ALL employees in this department
      // (plantillas where tipo = 'horario' only; exceptions like L/U are auto-excluded since they are tipo='excepcion')
      await sql`
        DELETE FROM empleados_plantillas_horarios
        WHERE empleado_id IN (
          SELECT e.id
          FROM empleados e
          JOIN cargos c ON e.cargo_id = c.id
          JOIN areas a ON c.area_id = a.id
          WHERE a.departamento_id = ${dId} AND e.activo = TRUE
        )
        AND plantilla_horario_id IN (
          SELECT id FROM plantillas_horarios WHERE tipo = 'horario'
        );
      `;
      return { success: true, message: 'Todos los horarios han sido quitados de los empleados del departamento' };
    }

    if (action === 'toggle' && empId && plantillaId) {
      const existing = await sql`
        SELECT id FROM empleados_plantillas_horarios 
        WHERE empleado_id = ${empId} AND plantilla_horario_id = ${plantillaId}
      `;
      if (existing.length > 0) {
        await sql`
          DELETE FROM empleados_plantillas_horarios 
          WHERE empleado_id = ${empId} AND plantilla_horario_id = ${plantillaId}
        `;
        return { success: true, action: 'removed' };
      } else {
        await sql`
          INSERT INTO empleados_plantillas_horarios (empleado_id, plantilla_horario_id)
          VALUES (${empId}, ${plantillaId})
          ON CONFLICT DO NOTHING;
        `;
        return { success: true, action: 'added' };
      }
    }

    if (action === 'remove' && empId && plantillaId) {
      await sql`
        DELETE FROM empleados_plantillas_horarios 
        WHERE empleado_id = ${empId} AND plantilla_horario_id = ${plantillaId}
      `;
      return { success: true };
    }

    if (Array.isArray(payload.assignments)) {
      for (const item of payload.assignments) {
        const eId = Number(item.empleado_id);
        const pIds = Array.isArray(item.plantilla_ids) ? item.plantilla_ids : [];
        if (!eId) continue;
        await sql`DELETE FROM empleados_plantillas_horarios WHERE empleado_id = ${eId}`;
        for (const pId of pIds) {
          await sql`
            INSERT INTO empleados_plantillas_horarios (empleado_id, plantilla_horario_id)
            VALUES (${eId}, ${Number(pId)})
            ON CONFLICT DO NOTHING;
          `;
        }
      }
      return { success: true };
    }
    return { success: true };
  } catch (err) {
    console.error('Error in updateDepartamentoEmpleadosCiclosModel:', err);
    return { success: false, error: err.message || 'Error al actualizar base de datos' };
  }
}

