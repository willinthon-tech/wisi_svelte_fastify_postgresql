import crypto from 'crypto';
import http from 'http';
import https from 'https';

/**
 * Genera el hash MD5 de una cadena
 */
function md5Hash(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Extrae un parámetro de una cabecera de autenticación WWW-Authenticate
 */
function getAuthParam(header, param) {
  if (!header) return '';
  const match = header.match(new RegExp(`${param}="?([^",\\s]+)"?`, 'i'));
  return match ? match[1] : '';
}

/**
 * Calcula la cabecera Digest Authorization
 */
export function computeDigestHeader(wwwAuthHeader, username, password, method, uri) {
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

/**
 * Realiza una petición HTTP/HTTPS de bajo nivel a un equipo ISAPI
 */
export function isapiHttpRequest(targetUrl, options = {}) {
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
          headers: res.headers,
          data
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

/**
 * Ejecuta una llamada ISAPI completa con negociación Digest Authentication automática
 */
export async function executeIsapiCall(baseHost, uri, method = 'GET', bodyObj = null, username = 'admin', password = '') {
  const cleanHost = baseHost.startsWith('http://') || baseHost.startsWith('https://')
    ? baseHost.replace(/\/+$/, '')
    : `http://${baseHost.replace(/\/+$/, '')}`;
  const fullUrl = `${cleanHost}${uri}`;
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : undefined;

  let authHeader = '';

  // Paso 1: Reto inicial para obtener nonce si es necesario
  try {
    const challengeRes = await isapiHttpRequest(fullUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json, text/plain, */*' },
      timeout: 5000
    });
    if (challengeRes.status === 401 && challengeRes.headers['www-authenticate']) {
      authHeader = computeDigestHeader(challengeRes.headers['www-authenticate'], username, password, method, uri);
    }
  } catch (e) {
    // Si falla el challenge o el equipo responde directo, se continúa
  }

  // Paso 2: Petición principal con cabecera de autenticación
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json; charset=UTF-8'
  };
  if (authHeader) headers['Authorization'] = authHeader;

  let res = await isapiHttpRequest(fullUrl, {
    method,
    headers,
    body: bodyStr,
    timeout: 10000
  });

  // Paso 3: Reintento si responde 401 (re-desafío o expiración de nonce)
  if (res.status === 401 && res.headers['www-authenticate']) {
    headers['Authorization'] = computeDigestHeader(res.headers['www-authenticate'], username, password, method, uri);
    res = await isapiHttpRequest(fullUrl, {
      method,
      headers,
      body: bodyStr,
      timeout: 10000
    });
  }

  let parsed = null;
  if (res.data) {
    try {
      parsed = JSON.parse(res.data);
    } catch (e) {
      parsed = res.data;
    }
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    data: parsed,
    raw: res.data
  };
}

/**
 * Convierte una cédula a número de tarjeta compatible con Hikvision
 * Ejemplo: V25047058 -> 125047058, E25047058 -> 225047058
 */
export function generarCardNoDesdeCedula(cedula) {
  if (!cedula) return '';
  let s = String(cedula).trim().toUpperCase();
  if (s.startsWith('V')) return '1' + s.substring(1).replace(/\D/g, '');
  if (s.startsWith('E')) return '2' + s.substring(1).replace(/\D/g, '');
  return '1' + s.replace(/\D/g, '');
}

/**
 * Obtiene la lista completa de usuarios registrados en un biométrico o panel
 */
export async function getDeviceUsers(ipHost, username, password) {
  if (!ipHost) throw new Error('IP de dispositivo no especificada');
  const allUsers = [];
  let position = 0;
  const maxResults = 30;
  let hasMore = true;
  let totalMatches = 0;

  while (hasMore) {
    const searchBody = {
      UserInfoSearchCond: {
        searchID: "1",
        searchResultPosition: position,
        maxResults
      }
    };

    const res = await executeIsapiCall(ipHost, '/ISAPI/AccessControl/UserInfo/Search?format=json', 'POST', searchBody, username, password);
    if (!res.ok && res.status !== 200) {
      throw new Error(`El dispositivo (${ipHost}) respondió HTTP ${res.status}`);
    }

    const searchData = res.data?.UserInfoSearch || {};
    totalMatches = Number(searchData.totalMatches) || 0;
    const currentMatches = Number(searchData.numOfMatches) || 0;
    const users = searchData.UserInfo || [];

    if (Array.isArray(users) && users.length > 0) {
      allUsers.push(...users);
      position += users.length;
    } else if (typeof users === 'object' && users.employeeNo) {
      allUsers.push(users);
      position += 1;
    }

    if (currentMatches === 0 || allUsers.length >= totalMatches || position >= 1500) {
      hasMore = false;
    }
  }

  return {
    total: allUsers.length,
    users: allUsers
  };
}

/**
 * Agrega o actualiza un usuario en el biométrico o panel
 */
export async function addUserToDevice(ipHost, username, password, employeeData, isPanel = false) {
  const cedula = String(employeeData.cedula || employeeData.employeeNo || '').trim().toUpperCase();
  const nombre = String(employeeData.nombre || employeeData.name || '').trim();
  const gender = (employeeData.sexo || '').toLowerCase().includes('fem') ? 'female' : 'male';

  const beginTime = employeeData.fecha_ingreso ? `${employeeData.fecha_ingreso}T00:00:00` : '2024-01-01T00:00:00';
  const endTime = '2035-12-31T23:59:59';

  let body;
  if (isPanel) {
    body = {
      UserInfo: {
        employeeNo: cedula,
        name: nombre,
        userType: "normal",
        closeDelayEnabled: false,
        Valid: {
          enable: true,
          beginTime,
          endTime,
          timeType: "local"
        },
        belongGroup: "",
        password: "",
        doorRight: "1,2",
        RightPlan: [
          { doorNo: 1, planTemplateNo: "1" },
          { doorNo: 2, planTemplateNo: "1" }
        ],
        maxOpenDoorTime: 0,
        openDoorTime: 0
      }
    };
  } else {
    body = {
      UserInfo: {
        employeeNo: cedula,
        name: nombre,
        gender,
        userType: "normal",
        doorNo: 1,
        belongGroup: "1",
        localUIRight: false,
        maxOpenDoorTime: 0,
        Valid: {
          enable: true,
          beginTime,
          endTime,
          timeType: "local"
        },
        doorRight: "1",
        RightPlan: [
          { doorNo: 1, planTemplateNo: "1" }
        ]
      }
    };
  }

  const res = await executeIsapiCall(ipHost, '/ISAPI/AccessControl/UserInfo/SetUp?format=json', 'PUT', body, username, password);
  return res;
}

/**
 * Registra la tarjeta de acceso de un empleado
 */
export async function setupCardInDevice(ipHost, username, password, employeeNo, cardNo) {
  const body = {
    CardInfo: {
      employeeNo,
      cardNo: String(cardNo),
      cardType: "normalCard"
    }
  };
  return await executeIsapiCall(ipHost, '/ISAPI/AccessControl/CardInfo/SetUp?format=json', 'PUT', body, username, password);
}

/**
 * Registra el rostro facial de un empleado usando una URL accesible
 */
export async function uploadFaceToDevice(ipHost, username, password, employeeNo, name, gender, photoUrl) {
  // 1. Eliminar foto previa si existe
  try {
    const delBody = {
      FPID: [{ value: employeeNo }]
    };
    await executeIsapiCall(ipHost, '/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD', 'PUT', delBody, username, password);
  } catch (e) {
    // Ignorar si no tenía foto previa
  }

  // 2. Registrar foto
  const body = {
    faceURL: photoUrl,
    faceLibType: "blackFD",
    FDID: "1",
    FPID: employeeNo,
    name,
    gender: gender === 'female' ? 'female' : 'male',
    featurePointType: "face"
  };

  return await executeIsapiCall(ipHost, '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', 'POST', body, username, password);
}

/**
 * Elimina un usuario por completo de un biométrico o panel
 */
export async function deleteUserFromDevice(ipHost, username, password, employeeNo, isPanel = false) {
  const cleanNo = String(employeeNo).trim().toUpperCase();
  const cardNo = generarCardNoDesdeCedula(cleanNo);

  // 1. Eliminar rostro (solo en biométricos)
  if (!isPanel) {
    try {
      const faceDelBody = {
        FPID: [{ value: cleanNo }]
      };
      await executeIsapiCall(ipHost, '/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD', 'PUT', faceDelBody, username, password);
    } catch (e) {}
  }

  // 2. Eliminar tarjeta
  if (cardNo) {
    try {
      const cardDelBody = {
        CardInfoDelCond: {
          CardNoList: [{ cardNo: String(cardNo) }]
        }
      };
      await executeIsapiCall(ipHost, '/ISAPI/AccessControl/CardInfo/Delete?format=json', 'PUT', cardDelBody, username, password);
    } catch (e) {}
  }

  // 3. Eliminar usuario
  const userDelBody = {
    UserInfoDelCond: {
      EmployeeNoList: [{ employeeNo: cleanNo }]
    }
  };
  return await executeIsapiCall(ipHost, '/ISAPI/AccessControl/UserInfo/Delete?format=json', 'PUT', userDelBody, username, password);
}
