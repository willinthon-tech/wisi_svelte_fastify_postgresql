/**
 * tauriIsapi.service.js
 * Servicio para comunicación directa y local con biométricos y paneles Hikvision
 * utilizando el puente nativo en Rust de Tauri 2 en Windows.
 */

/**
 * Detecta si la app se ejecuta en el entorno nativo de escritorio en Windows (Tauri sin Android)
 */
export function isTauriWindows() {
  if (typeof window === 'undefined') return false;

  // Si es Android (Capacitor o WebView móvil), NO es Windows
  const isAndroid = (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) ||
    (typeof window.Capacitor !== 'undefined' && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
  if (isAndroid) return false;

  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return true;

  const loc = window.location;
  if (loc && (loc.hostname === 'tauri.localhost' || loc.protocol === 'tauri:')) return true;

  return false;
}

/**
 * Invoca el comando nativo isapi_request en Rust
 */
export async function callLocalIsapi(host, uri, method = 'GET', body = null, username = 'admin', password = '', timeoutSecs = 10) {
  if (!isTauriWindows()) {
    throw new Error('Las operaciones locales con biométricos solo están disponibles desde la aplicación de escritorio en Windows.');
  }

  let invokeFn = null;
  if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
    invokeFn = window.__TAURI_INTERNALS__.invoke;
  } else {
    try {
      const tauriCore = await import('@tauri-apps/api/core');
      invokeFn = tauriCore.invoke;
    } catch (e) {
      throw new Error('No se pudo acceder a la API nativa de Tauri en Windows.');
    }
  }

  const payload = {
    host,
    uri,
    method: method ? method.toUpperCase() : 'GET',
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
    username: username || 'admin',
    password: password || '',
    timeoutSecs: timeoutSecs || 10
  };

  const response = await invokeFn('isapi_request', payload);
  return response;
}

/**
 * Genera el número de tarjeta numérico a partir de la cédula para paneles
 */
export function generarCardNoDesdeCedula(cedula) {
  if (!cedula) return '';
  const clean = String(cedula).trim().toUpperCase();
  const digits = clean.replace(/\D/g, '');
  if (!digits) return '';

  if (clean.startsWith('E')) {
    return `2${digits}`;
  }
  return `1${digits}`;
}

/**
 * Obtiene todos los usuarios registrados físicamente en un biométrico o panel
 */
export async function localGetDeviceUsers(host, username = 'admin', password = '') {
  let allUsers = [];
  let position = 0;
  const maxResults = 50;
  let hasMore = true;
  let safetyCounter = 0;

  while (hasMore && safetyCounter < 50) {
    safetyCounter++;
    const searchBody = {
      UserInfoSearchCond: {
        searchID: "1",
        searchResultPosition: position,
        maxResults
      }
    };

    const res = await callLocalIsapi(host, '/ISAPI/AccessControl/UserInfo/Search?format=json', 'POST', searchBody, username, password, 10);
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status} al consultar usuarios en ${host}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(res.data);
    } catch (e) {
      throw new Error(`Respuesta no válida del dispositivo ${host}`);
    }

    const userInfoSearch = parsed?.UserInfoSearch;
    if (!userInfoSearch) break;

    const matches = userInfoSearch.numOfMatches || 0;
    const users = userInfoSearch.UserInfo || [];

    if (Array.isArray(users)) {
      allUsers.push(...users);
    } else if (users && typeof users === 'object') {
      allUsers.push(users);
    }

    position += (Array.isArray(users) ? users.length : 1);
    if (position >= matches || (Array.isArray(users) && users.length === 0)) {
      hasMore = false;
    }
  }

  return allUsers;
}

/**
 * Agrega o actualiza un empleado en el biométrico o panel
 */
export async function localAddUser(host, username = 'admin', password = '', employeeData, isPanel = false) {
  const rawCedula = String(employeeData.cedula || employeeData.employeeNo || '').trim().toUpperCase();
  const nombre = String(employeeData.nombre || employeeData.name || '').trim();
  const gender = (employeeData.sexo || '').toLowerCase().includes('fem') ? 'female' : 'male';

  let datePart = '2024-01-01';
  if (employeeData.fecha_ingreso) {
    const s = String(employeeData.fecha_ingreso).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) datePart = s;
  }
  const beginTime = `${datePart}T00:00:00`;
  const endTime = '2035-12-31T23:59:59';

  let body;
  if (isPanel) {
    const panelEmployeeNo = generarCardNoDesdeCedula(rawCedula) || rawCedula.replace(/\D/g, '');
    body = {
      UserInfo: {
        employeeNo: panelEmployeeNo,
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
        employeeNo: rawCedula,
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

  const res = await callLocalIsapi(host, '/ISAPI/AccessControl/UserInfo/SetUp?format=json', 'PUT', body, username, password, 10);
  return res;
}

/**
 * Registra la tarjeta de acceso de un empleado
 */
export async function localSetupCard(host, username = 'admin', password = '', employeeNo, cardNo) {
  const body = {
    CardInfo: {
      employeeNo: String(employeeNo),
      cardNo: String(cardNo),
      cardType: "normalCard"
    }
  };
  return await callLocalIsapi(host, '/ISAPI/AccessControl/CardInfo/SetUp?format=json', 'PUT', body, username, password, 10);
}

/**
 * Registra el rostro facial de un empleado usando la URL pública
 */
export async function localUploadFace(host, username = 'admin', password = '', employeeNo, name, gender, photoUrl) {
  if (!photoUrl) return null;

  // 1. Intentar borrar rostro previo
  try {
    const delBody = {
      FPID: [
        { value: String(employeeNo) },
        { value: String(employeeNo).replace(/\D/g, '') }
      ]
    };
    await callLocalIsapi(host, '/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD', 'PUT', delBody, username, password, 5);
  } catch (e) {
    // Ignorar si no tenía rostro previo
  }

  // 2. Registrar nuevo rostro enviando la URL pública
  const body = {
    faceURL: photoUrl,
    faceLibType: "blackFD",
    FDID: "1",
    FPID: String(employeeNo),
    name: String(name || '').trim(),
    gender: gender === 'female' ? 'female' : 'male',
    featurePointType: "face"
  };

  return await callLocalIsapi(host, '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', 'POST', body, username, password, 12);
}

/**
 * Elimina un usuario por completo del biométrico o panel
 */
export async function localDeleteUser(host, username = 'admin', password = '', employeeNo, isPanel = false) {
  const cleanNo = String(employeeNo).trim().toUpperCase();
  const cardNo = generarCardNoDesdeCedula(cleanNo);
  const digitsOnly = cleanNo.replace(/\D/g, '');

  // 1. Eliminar rostro si es biométrico
  if (!isPanel) {
    try {
      const faceDelBody = {
        FPID: [
          { value: cleanNo },
          { value: digitsOnly }
        ]
      };
      await callLocalIsapi(host, '/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD', 'PUT', faceDelBody, username, password, 5);
    } catch (e) {}
  }

  // 2. Eliminar tarjeta
  const cardNoList = [];
  if (cardNo) cardNoList.push({ cardNo: String(cardNo) });
  if (digitsOnly && digitsOnly !== cardNo) cardNoList.push({ cardNo: String(digitsOnly) });
  if (cardNoList.length > 0) {
    try {
      const cardDelBody = { CardInfoDelCond: { CardNoList: cardNoList } };
      await callLocalIsapi(host, '/ISAPI/AccessControl/CardInfo/Delete?format=json', 'PUT', cardDelBody, username, password, 5);
    } catch (e) {}
  }

  // 3. Eliminar usuario
  const userDelBody = {
    UserInfoDelCond: {
      EmployeeNoList: [
        { employeeNo: cleanNo },
        { employeeNo: digitsOnly }
      ]
    }
  };
  return await callLocalIsapi(host, '/ISAPI/AccessControl/UserInfo/Delete?format=json', 'PUT', userDelBody, username, password, 10);
}
