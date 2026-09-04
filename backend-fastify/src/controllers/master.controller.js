import {
  getUsuariosModel, createUsuarioModel, updateUsuarioModel, deleteUsuarioModel,
  getSalasModel, createSalaModel, updateSalaModel, deleteSalaModel,
  getPaginasModel, createPaginaModel, updatePaginaModel, deletePaginaModel,
  getModulosModel, createModuloModel, updateModuloModel, deleteModuloModel, reorderModulosModel,
  getDispositivosModel, createDispositivoModel, updateDispositivoModel, injectDispositivoPushConfigModel, injectHikvisionIsapiHttpListeningModel, deleteDispositivoModel,
  getAttlogsModel, getLatestAttlogsModel, getAttlogsCountModel, getAttlogsFilterOptionsModel, getAttlogsStatsModel, syncAttlogsModel, getLastAttlogEventTimeModel, getAttlogPositionModel, getAttlogDetailModel,
  getConfiguracionModel, updateConfiguracionModel,
  getUserSalasMapModel, updateUserSalasModel, getUserPermissionsMapModel, updateUserPermissionsModel,
  getDepartamentosModel, getDepartamentosFilterOptionsModel, createDepartamentoModel, updateDepartamentoModel, deleteDepartamentoModel,
  getAreasModel, getAreasFilterOptionsModel, createAreaModel, updateAreaModel, deleteAreaModel,
  getCargosModel, getCargosFilterOptionsModel, createCargoModel, updateCargoModel, deleteCargoModel,
  getEmpleadosModel, getEmpleadosFilterOptionsModel, checkEmpleadoCedulaModel, getEmpleadoDispositivosModel, createEmpleadoModel, updateEmpleadoModel, deleteEmpleadoModel,
  getDepartamentosCiclosModel, getDepartamentosCiclosFilterOptionsModel,
  getPlantillasHorariosModel, getPlantillasHorariosFilterOptionsModel, createPlantillaHorarioModel, updatePlantillaHorarioModel, deletePlantillaHorarioModel,
  getDepartamentoEmpleadosCiclosModel, updateDepartamentoEmpleadosCiclosModel,
  getFeriadosModel, getFeriadosFilterOptionsModel, createFeriadoModel, updateFeriadoModel, deleteFeriadoModel,
  getCumpleanosModel, getCarnetsModel,
  getCortesModel, getCorteByIdModel, createCorteModel, deleteCorteModel, getCortesFilterOptionsModel
} from '../models/master.model.js';

export async function getAttlogsStats(request, reply) {
  try {
    const salaIdsRaw = request.query?.sala_ids;
    let salaIds = null;
    if (salaIdsRaw && String(salaIdsRaw).trim().length > 0) {
      const parsed = String(salaIdsRaw).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
      if (parsed.length > 0) salaIds = parsed;
    }
    const startDate = request.query?.start_date || request.query?.fecha_desde || null;
    const endDate = request.query?.end_date || request.query?.fecha_hasta || null;

    const stats = await getAttlogsStatsModel(salaIds, startDate, endDate);
    return reply.send({ success: true, data: stats });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getLastAttlogEventTime(request, reply) {
  try {
    const { id } = request.params || {};
    const lastEventTime = await getLastAttlogEventTimeModel(id || null);
    return reply.send({ success: true, dispositivo_id: id ? Number(id) : null, last_event_time: lastEventTime });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getAttlogPosition(request, reply) {
  try {
    const { id } = request.params;
    const salaIdsRaw = request.query?.sala_ids || request.query?.user_sala_ids;
    const estadosRaw = request.query?.estados;
    let salaIds = null;
    if (salaIdsRaw && String(salaIdsRaw).trim().length > 0 && String(salaIdsRaw) !== '-1') {
      const parsed = String(salaIdsRaw).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
      if (parsed.length > 0) salaIds = parsed;
    }
    let estados = null;
    if (estadosRaw && String(estadosRaw).trim().length > 0) {
      estados = String(estadosRaw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
    const pos = await getAttlogPositionModel(id, salaIds, estados);
    if (!pos) return reply.status(404).send({ success: false, error: 'Marcaje no encontrado' });
    return reply.send({ success: true, data: pos });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getAttlogDetail(request, reply) {
  try {
    const { id } = request.params;
    const detail = await getAttlogDetailModel(id);
    if (!detail) {
      return reply.status(404).send({ success: false, error: 'Marcaje no encontrado' });
    }
    return reply.send({ success: true, data: detail.record, position: detail.position });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getUsuarios(request, reply) {
  const users = await getUsuariosModel();
  return reply.send({ success: true, data: users });
}

function parseBody(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) {
    try {
      const str = body.toString('utf-8').trim();
      return str ? JSON.parse(str) : {};
    } catch {
      return {};
    }
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

export async function createUsuario(request, reply) {
  try {
    const data = parseBody(request.body);
    const user = await createUsuarioModel(data);
    return reply.status(201).send({ success: true, data: user });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateUsuario(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const user = await updateUsuarioModel(id, data);
    return reply.send({ success: true, data: user });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteUsuario(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteUsuarioModel(id);
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getSalas(request, reply) {
  const salas = await getSalasModel();
  return reply.send({ success: true, data: salas });
}

export async function createSala(request, reply) {
  const data = parseBody(request.body);
  const sala = await createSalaModel(data);
  return reply.status(201).send({ success: true, data: sala });
}

export async function updateSala(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const sala = await updateSalaModel(id, data);
    return reply.send({ success: true, data: sala });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteSala(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteSalaModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getPaginas(request, reply) {
  const paginas = await getPaginasModel();
  return reply.send({ success: true, data: paginas });
}

export async function createPagina(request, reply) {
  try {
    const data = parseBody(request.body);
    const pagina = await createPaginaModel(data);
    return reply.status(201).send({ success: true, data: pagina });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updatePagina(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const pagina = await updatePaginaModel(id, data);
    return reply.send({ success: true, data: pagina });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deletePagina(request, reply) {
  try {
    const { id } = request.params;
    const result = await deletePaginaModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getModulos(request, reply) {
  const modulos = await getModulosModel();
  return reply.send({ success: true, data: modulos });
}

export async function createModulo(request, reply) {
  try {
    const data = parseBody(request.body);
    const modulo = await createModuloModel(data);
    return reply.status(201).send({ success: true, data: modulo });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateModulo(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const modulo = await updateModuloModel(id, data);
    return reply.send({ success: true, data: modulo });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteModulo(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteModuloModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function reorderModulos(request, reply) {
  try {
    const body = parseBody(request.body);
    const items = Array.isArray(body) ? body : (body.items || body.modulos || []);
    const result = await reorderModulosModel(items);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getDispositivos(request, reply) {
  const { sala_id, sala_ids } = request.query || {};
  const dispositivos = await getDispositivosModel(sala_id, sala_ids);
  return reply.send({ success: true, data: dispositivos });
}

export async function createDispositivo(request, reply) {
  try {
    const data = parseBody(request.body);
    const dispositivo = await createDispositivoModel(data);
    return reply.status(201).send({ success: true, data: dispositivo });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateDispositivo(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const dispositivo = await updateDispositivoModel(id, data);
    return reply.send({ success: true, data: dispositivo });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function injectDispositivoPushConfig(request, reply) {
  try {
    const { id } = request.params;
    const { server_url } = parseBody(request.body) || {};
    const result = await injectDispositivoPushConfigModel(id, server_url);
    return reply.send({
      success: true,
      message: `Configuración HTTP Push inyectada exitosamente en el dispositivo '${result.nombre}'`,
      data: result
    });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function injectHikvisionIsapiHttpListening(request, reply) {
  try {
    const { id } = request.params;
    const config = parseBody(request.body) || {};
    const result = await injectHikvisionIsapiHttpListeningModel(id, config);
    if (!result.success) {
      return reply.status(400).send(result);
    }
    return reply.send({
      success: true,
      message: result.message || `Configuración HTTP Listening ISAPI inyectada a '${result.nombre || id}'`,
      data: result
    });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteDispositivo(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteDispositivoModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getAttlogs(request, reply) {
  return getLatestAttlogs(request, reply);
}

export async function getLatestAttlogs(request, reply) {
  try {
    const limit = Number(request.query?.limit) || 10;
    const page = Number(request.query?.page);
    const offset = !isNaN(page) && page > 0 ? (page - 1) * limit : (Number(request.query?.offset) || 0);
    const search = request.query?.search || '';
    const sortBy = request.query?.sortBy || 'event_time';
    const sortDir = request.query?.sortDir || request.query?.sortOrder || 'desc';

    const parseIds = (raw) => {
      if (!raw || String(raw).trim().length === 0) return null;
      const arr = String(raw).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
      return arr.length > 0 ? arr : null;
    };

    const parseStrings = (raw) => {
      if (!raw || String(raw).trim().length === 0) return null;
      const arr = String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      return arr.length > 0 ? arr : null;
    };

    const userSalaIds = parseIds(request.query?.user_sala_ids);
    const salaIds = parseIds(request.query?.sala_ids);
    const dispositivoIds = parseIds(request.query?.dispositivo_ids);
    const estados = parseStrings(request.query?.estados);
    const verifyModes = parseStrings(request.query?.verify_modes);
    const hasPhoto = request.query?.has_photo || null;
    const estatusEmpleados = parseStrings(request.query?.estatus_empleados);
    const departamentoIds = parseIds(request.query?.departamento_ids);
    const areaIds = parseIds(request.query?.area_ids);
    const cargoIds = parseIds(request.query?.cargo_ids);
    const sexo = parseStrings(request.query?.sexo);
    const onlyRealMarcajes = request.query?.only_real_marcajes === 'true';

    const filterOpts = {
      userSalaIds,
      salaIds,
      dispositivoIds,
      estados,
      verifyModes,
      hasPhoto,
      estatusEmpleados,
      departamentoIds,
      areaIds,
      cargoIds,
      sexo,
      onlyRealMarcajes
    };

    const attlogs = await getLatestAttlogsModel(limit, offset, salaIds, search, sortBy, sortDir, filterOpts);
    const total = await getAttlogsCountModel(salaIds, search, filterOpts);
    return reply.send({ success: true, data: attlogs, total, limit, offset });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getAttlogsFilterOptions(request, reply) {
  try {
    const parseIds = (raw) => {
      if (!raw || String(raw).trim().length === 0) return null;
      const arr = String(raw).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
      return arr.length > 0 ? arr : null;
    };

    const parseStrings = (raw) => {
      if (!raw || String(raw).trim().length === 0) return null;
      const arr = String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      return arr.length > 0 ? arr : null;
    };

    const userSalaIds = parseIds(request.query?.user_sala_ids);
    const salaIds = parseIds(request.query?.sala_ids);
    const dispositivoIds = parseIds(request.query?.dispositivo_ids);
    const estados = parseStrings(request.query?.estados);
    const verifyModes = parseStrings(request.query?.verify_modes);
    const hasPhoto = request.query?.has_photo || null;
    const estatusEmpleados = parseStrings(request.query?.estatus_empleados);
    const departamentoIds = parseIds(request.query?.departamento_ids);
    const areaIds = parseIds(request.query?.area_ids);
    const cargoIds = parseIds(request.query?.cargo_ids);
    const sexo = parseStrings(request.query?.sexo);
    const search = request.query?.search || '';

    const options = await getAttlogsFilterOptionsModel({
      userSalaIds,
      salaIds,
      dispositivoIds,
      estados,
      verifyModes,
      hasPhoto,
      estatusEmpleados,
      departamentoIds,
      areaIds,
      cargoIds,
      sexo,
      search
    });

    return reply.send({ success: true, data: options });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

function findTag(str, tag) {
  const startTag = '<' + tag + '>';
  const endTag = '</' + tag + '>';
  const sIdx = str.indexOf(startTag);
  if (sIdx !== -1) {
    const eIdx = str.indexOf(endTag, sIdx + startTag.length);
    if (eIdx !== -1) return str.substring(sIdx + startTag.length, eIdx).trim();
  }
  const jsonKey = '"' + tag + '"';
  const jIdx = str.indexOf(jsonKey);
  if (jIdx !== -1) {
    const sub = str.substring(jIdx + jsonKey.length);
    const colIdx = sub.indexOf(':');
    if (colIdx !== -1) {
      const valSub = sub.substring(colIdx + 1).trim();
      if (valSub.startsWith('"')) {
        const endQuote = valSub.indexOf('"', 1);
        if (endQuote !== -1) return valSub.substring(1, endQuote).trim();
      }
    }
  }
  return null;
}

function extractHikvisionPushData(obj, rawStr = null) {
  if (!obj && !rawStr) return null;

  if (rawStr && typeof rawStr === 'string') {
    const emp = findTag(rawStr, 'employeeNoString') || findTag(rawStr, 'employeeNo') || findTag(rawStr, 'cardNo');
    const nm = findTag(rawStr, 'name') || findTag(rawStr, 'employeeName');
    const tm = findTag(rawStr, 'dateTime') || findTag(rawStr, 'time') || findTag(rawStr, 'eventTime') || findTag(rawStr, 'date');
    const picUrl = findTag(rawStr, 'pictureURL') || findTag(rawStr, 'pictureUrl') || findTag(rawStr, 'URL');
    const picB64 = findTag(rawStr, 'pictureBase64') || findTag(rawStr, 'pictureData') || findTag(rawStr, 'base64Data');
    const subEvt = findTag(rawStr, 'subEventType') || findTag(rawStr, 'minor') || findTag(rawStr, 'eventType');
    const majEvt = findTag(rawStr, 'major');
    const cvmEvt = findTag(rawStr, 'currentVerifyMode') || findTag(rawStr, 'verifyMode') || findTag(rawStr, 'currentverifymode');
    const asEVT = findTag(rawStr, 'attendanceStatus') || findTag(rawStr, 'attendancestatus');
    const devIp = findTag(rawStr, 'ipAddress') || findTag(rawStr, 'deviceIP') || findTag(rawStr, 'devIp') || findTag(rawStr, 'IPAddress') || findTag(rawStr, 'localIP') || findTag(rawStr, 'localControllerID');

    if (emp) {
      let resolvedVerifyMode = cvmEvt;
      if (!resolvedVerifyMode && subEvt) {
        const subNum = Number(subEvt);
        if (subNum === 75 || subNum === 0x4b) resolvedVerifyMode = 'face';
        else if (subNum === 1 || subNum === 0x01) resolvedVerifyMode = 'card';
        else if (subNum === 38 || subNum === 0x26) resolvedVerifyMode = 'fingerprint';
        else if (subNum === 80) resolvedVerifyMode = 'faceOrCard';
      }
      return { empNo: emp, name: nm, rawTime: tm, pictureURL: picUrl, fotoBase64: picB64, subEventType: subEvt, major: majEvt, currentVerifyMode: resolvedVerifyMode, attendanceStatus: asEVT, deviceIp: devIp };
    }
  }

  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (e) {
      return extractHikvisionPushData(null, obj);
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const res = extractHikvisionPushData(item, rawStr);
      if (res) return res;
    }
    return null;
  }

  if (typeof obj !== 'object' || obj === null) return null;

  const targetObj = obj.AccessControllerEvent || obj.eventLog || obj.event_log || obj.AcsEvent || obj.acsEvent || obj.EventNotification || obj.infoList || (Array.isArray(obj.InfoList) ? obj.InfoList[0] : obj.InfoList) || obj.data || obj.event || obj.params || obj;

  const empNo = targetObj.employeeNoString || targetObj.employeeNo || targetObj.cardNo || targetObj.cardNoString || targetObj.employeeNoDB || targetObj.userID || targetObj.personID || targetObj.subEventNo || obj.employeeNoString || obj.employeeNo || obj.cardNo;
  const name = targetObj.name || targetObj.employeeName || targetObj.userName || obj.name || obj.employeeName;
  const rawTime = targetObj.dateTime || targetObj.time || targetObj.eventTime || targetObj.date || obj.dateTime || obj.time || obj.eventTime;
  const pictureURL = targetObj.pictureURL || targetObj.pictureUrl || targetObj.URL || obj.pictureURL;
  const fotoBase64 = targetObj.pictureBase64 || targetObj.pictureData || targetObj.base64Data || obj.pictureBase64;
  const subEventType = targetObj.subEventType || targetObj.minor || targetObj.eventType || obj.subEventType || obj.minor;
  const major = targetObj.major || obj.major;
  const rawVerifyMode = targetObj.currentVerifyMode || targetObj.currentverifymode || targetObj.verifyMode || targetObj.verifymode || obj.currentVerifyMode || obj.currentverifymode || null;
  const attendanceStatus = targetObj.attendanceStatus || targetObj.attendancestatus || obj.attendanceStatus || obj.attendancestatus || null;
  const deviceIp = targetObj.ipAddress || targetObj.deviceIP || targetObj.devIp || targetObj.IPAddress || targetObj.localIP || targetObj.localControllerID || targetObj.ip || obj.ipAddress || obj.deviceIP || obj.devIp || null;

  let resolvedVerifyMode = rawVerifyMode;
  if (!resolvedVerifyMode && subEventType) {
    const subNum = Number(subEventType);
    if (subNum === 75 || subNum === 0x4b) resolvedVerifyMode = 'face';
    else if (subNum === 1 || subNum === 0x01) resolvedVerifyMode = 'card';
    else if (subNum === 38 || subNum === 0x26) resolvedVerifyMode = 'fingerprint';
    else if (subNum === 80) resolvedVerifyMode = 'faceOrCard';
  }

  if (empNo) {
    return { empNo, name, rawTime, pictureURL, fotoBase64, subEventType, major, currentVerifyMode: resolvedVerifyMode, attendanceStatus, deviceIp };
  }

  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const res = extractHikvisionPushData(obj[key], rawStr);
      if (res) return res;
    }
  }

  return null;
}

function formatLocalDateTime(rawTime) {
  if (rawTime) {
    return String(rawTime).trim();
  }
  return new Date().toISOString();
}

let cachedDispositivos = null;
let lastDevFetch = 0;
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

const deviceStateMap = new Map();

async function getCachedDispositivos() {
  const now = Date.now();
  if (!cachedDispositivos || (now - lastDevFetch > 60000)) {
    try {
      cachedDispositivos = await getDispositivosModel();
      lastDevFetch = now;
    } catch (e) {
      if (!cachedDispositivos) cachedDispositivos = [];
    }
  }
  return cachedDispositivos;
}

export async function syncAttlogs(request, reply) {
  try {
    let body = request.body;
    let rawBuf = null;

    if (Buffer.isBuffer(body)) {
      rawBuf = body;
      const rawStr = rawBuf.toString('utf8');
      try {
        body = JSON.parse(rawStr);
      } catch (e) {
        body = rawStr;
      }
    }
    //console.log('willinthon')
    //console.log(body)

    // Case 1: Standard Agent Payload ({ dispositivo_id: 1, attlogs: [...] })
    if (body && typeof body === 'object' && Array.isArray(body.attlogs)) {
      const result = await syncAttlogsModel(body);
      return reply.status(201).send({ success: true, ...result });
    }

    // Case 2: Direct Hikvision Push Event (XML, JSON, or Multipart string/buffer)
    let rawStr = '';
    if (rawBuf) {
      rawStr = rawBuf.toString('binary');
    } else if (typeof body === 'string') {
      rawStr = body;
    } else {
      rawStr = JSON.stringify(body || {});
    }

    // Extract clean client IP (supports direct TCP and Reverse Proxy / NGINX Cloud headers)
    const rawIp = (request.headers['x-forwarded-for'] || request.ip || '').split(',')[0].trim();
    const callerIp = rawIp.replace(/^.*:/, '').trim();

    const extracted = extractHikvisionPushData(body, rawStr);

    if (!extracted || !extracted.empNo) {
      return reply.status(200).send({ status: "OK", statusCode: 1, statusString: "OK" });
    }

    // Log real-time biometric event cleanly
    const evtInfo = extracted.subEventType ? `(Evento: ${extracted.subEventType})` : '';
    //console.log(`\x1b[32m🟢`);

    const dispositivos = await getCachedDispositivos();
    let matchedDev = null;

    // 1. Buscar por IP local explícita reportada en el paquete
    const targetLocalIp = extracted.deviceIp ? String(extracted.deviceIp).trim() : null;
    if (targetLocalIp) {
      matchedDev = dispositivos.find(d => {
        const loc = (d.ip_local || '').trim();
        return loc && (loc === targetLocalIp || loc.includes(targetLocalIp) || targetLocalIp.includes(loc));
      });
    }

    // 2. Buscar si alguna IP local de la tabla dispositivos está contenida dentro del payload raw
    if (!matchedDev && rawStr) {
      matchedDev = dispositivos.find(d => {
        const loc = (d.ip_local || '').trim();
        return loc && loc.length >= 7 && rawStr.includes(loc);
      });
    }

    // 3. Si la conexión viene de una IP local directa (red local o VPN), comparar contra ip_local
    if (!matchedDev && callerIp) {
      matchedDev = dispositivos.find(d => {
        const loc = (d.ip_local || '').trim();
        return loc && (callerIp === loc || loc.includes(callerIp) || callerIp.includes(loc));
      });
    }

    // 4. Fallback: Si no coincide ninguna IP local específica, asignar al dispositivo más apropiado sin descartar
    if (!matchedDev && dispositivos.length > 0) {
      matchedDev = dispositivos[0];
    }

    const devNombre = matchedDev ? (matchedDev.nombre || `Biométrico (${matchedDev.ip_local || callerIp})`) : 'Biométrico';
    const salaNombre = matchedDev ? (matchedDev.sala_nombre || 'Sin Sala') : 'Sin Sala';

    // Connection state tracking ONLY (Conectado / Desconectado)
    const now = Date.now();
    let state = deviceStateMap.get(callerIp);
    if (!state) {
      state = { lastSeen: now, isOnline: true, devNombre, salaNombre };
      deviceStateMap.set(callerIp, state);
      //console.log(`\x1b[32m🟢 [CONECTADO]\x1b[0m Dispositivo: ${devNombre} | Sala: ${salaNombre} | IP: ${callerIp}`);
    } else {
      state.devNombre = devNombre;
      state.salaNombre = salaNombre;
      if (!state.isOnline) {
        state.isOnline = true;
        //console.log(`\x1b[32m🟢 [CONECTADO]\x1b[0m Dispositivo: ${devNombre} | Sala: ${salaNombre} | IP: ${callerIp}`);
      }
      state.lastSeen = now;
    }

    const eventTimeStr = formatLocalDateTime(extracted.rawTime);

    let fotoBase64 = extracted.fotoBase64 || null;
    if (!fotoBase64 && rawBuf) {
      const startIdx = rawBuf.indexOf(JPEG_START);
      const endIdx = rawBuf.lastIndexOf(JPEG_END);
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        fotoBase64 = rawBuf.subarray(startIdx, endIdx + 2).toString('base64');
      }
    }

    const payload = {
      dispositivo_id: matchedDev.id,
      dispositivo_nombre: devNombre,
      sala_id: matchedDev.sala_id || null,
      sala_nombre: salaNombre,
      timestamp: new Date().toISOString(),
      attlogs: [{
        employee_no: String(extracted.empNo),
        event_time: eventTimeStr,
        attendanceStatus: extracted.attendanceStatus,
        currentVerifyMode: extracted.currentVerifyMode,
        nombre: extracted.name || null,
        foto_base64: fotoBase64
      }]
    };

    const result = await syncAttlogsModel(payload);
    return reply.status(200).send({ status: "OK", statusCode: 1, statusString: "OK", ...result });
  } catch (err) {
    console.error('Error procesando Push en Backend:', err);
    return reply.status(200).send({ status: "OK", statusCode: 1, statusString: "OK" });
  }
}

export async function getConfiguracion(request, reply) {
  try {
    const config = await getConfiguracionModel();
    return reply.send({ success: true, data: config });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function updateConfiguracion(request, reply) {
  try {
    const body = parseBody(request.body) || {};
    let dataToUpdate = body;
    if (body.clave && body.valor !== undefined) {
      dataToUpdate = { [body.clave]: body.valor };
    }
    const result = await updateConfiguracionModel(dataToUpdate);
    return reply.send({ success: true, message: 'Configuración actualizada exitosamente', data: result });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getUserSalasMap(request, reply) {
  try {
    const data = await getUserSalasMapModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function updateUserSalas(request, reply) {
  try {
    const { userId } = request.params;
    const body = parseBody(request.body);
    const result = await updateUserSalasModel(userId, body.salas || body);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getUserPermissionsMap(request, reply) {
  try {
    const data = await getUserPermissionsMapModel();
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function updateUserPermissions(request, reply) {
  try {
    const { userId } = request.params;
    const body = parseBody(request.body);
    const result = await updateUserPermissionsModel(userId, body.permissions || body);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}


// --- DEPARTAMENTOS ---
export async function getDepartamentosFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }

    const result = await getDepartamentosFilterOptionsModel({
      userSalaIds,
      salaIds,
      search: q.search
    });
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getDepartamentos(request, reply) {
  const result = await getDepartamentosModel(request.query);
  return reply.send(result);
}

export async function createDepartamento(request, reply) {
  try {
    const data = parseBody(request.body);
    const result = await createDepartamentoModel(data);
    return reply.status(201).send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateDepartamento(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const result = await updateDepartamentoModel(id, data);
    return reply.send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteDepartamento(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteDepartamentoModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}


// --- ÁREAS ---
export async function getAreasFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let departamentoIds = null;
    if (q.departamento_ids) {
      departamentoIds = String(q.departamento_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }

    const result = await getAreasFilterOptionsModel({
      userSalaIds,
      salaIds,
      departamentoIds,
      search: q.search
    });
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getAreas(request, reply) {
  const result = await getAreasModel(request.query);
  return reply.send(result);
}

export async function createArea(request, reply) {
  try {
    const data = parseBody(request.body);
    const result = await createAreaModel(data);
    return reply.status(201).send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateArea(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const result = await updateAreaModel(id, data);
    return reply.send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteArea(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteAreaModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}


// --- CARGOS ---
export async function getCargosFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let departamentoIds = null;
    if (q.departamento_ids) {
      departamentoIds = String(q.departamento_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let areaIds = null;
    if (q.area_ids) {
      areaIds = String(q.area_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }

    const result = await getCargosFilterOptionsModel({
      userSalaIds,
      salaIds,
      departamentoIds,
      areaIds,
      search: q.search
    });
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getCargos(request, reply) {
  const result = await getCargosModel(request.query);
  return reply.send(result);
}

export async function createCargo(request, reply) {
  try {
    const data = parseBody(request.body);
    const result = await createCargoModel(data);
    return reply.status(201).send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateCargo(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const result = await updateCargoModel(id, data);
    return reply.send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteCargo(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteCargoModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}


// --- EMPLEADOS ---
export async function getEmpleadosFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let departamentoIds = null;
    if (q.departamento_ids) {
      departamentoIds = String(q.departamento_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let areaIds = null;
    if (q.area_ids) {
      areaIds = String(q.area_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let cargoIds = null;
    if (q.cargo_ids) {
      cargoIds = String(q.cargo_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let sexo = null;
    if (q.sexo) {
      sexo = String(q.sexo).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }

    const result = await getEmpleadosFilterOptionsModel({
      userSalaIds,
      salaIds,
      departamentoIds,
      areaIds,
      cargoIds,
      sexo,
      activo: q.activo ?? 'true',
      search: q.search
    });
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getEmpleados(request, reply) {
  const result = await getEmpleadosModel(request.query);
  return reply.send(result);
}

export async function checkEmpleadoCedula(request, reply) {
  try {
    const { cedula, excludeId } = request.query || {};
    const result = await checkEmpleadoCedulaModel(cedula, excludeId);
    return reply.send({ success: true, ...result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getEmpleadoDispositivos(request, reply) {
  try {
    const { id } = request.params;
    const result = await getEmpleadoDispositivosModel(id);
    return reply.send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function createEmpleado(request, reply) {
  try {
    const data = parseBody(request.body);
    const result = await createEmpleadoModel(data);
    return reply.status(201).send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateEmpleado(request, reply) {
  try {
    const { id } = request.params;
    const data = parseBody(request.body);
    const result = await updateEmpleadoModel(id, data);
    return reply.send({ success: true, data: result });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteEmpleado(request, reply) {
  try {
    const { id } = request.params;
    const result = await deleteEmpleadoModel(id);
    return reply.send(result);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function handleZkIclockCdata(request, reply) {
  try {
    const query = request.query || {};
    const sn = query.SN || query.sn || 'ZK_UNKNOWN';

    if (request.method === 'GET') {
      return reply.type('text/plain').send('OK');
    }

    const rawBody = typeof request.body === 'string'
      ? request.body
      : (Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '');

    const lines = rawBody.split('\n');
    const attlogsToSync = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('\t');
      if (parts.length >= 2) {
        const empNo = parts[0].trim();
        const eventTime = parts[1].trim();
        if (empNo && eventTime) {
          attlogsToSync.push({
            employee_no: empNo,
            event_time: eventTime,
            nombre: null
          });
        }
      }
    }

    if (attlogsToSync.length > 0) {
      const dispositivos = await getCachedDispositivos();
      const rawIp = (request.headers['x-forwarded-for'] || request.ip || '').split(',')[0].trim();
      const callerIp = rawIp.replace(/^.*:/, '').trim();

      const matchedDev = dispositivos.find(d => (d.ip_local && d.ip_local.includes(callerIp)) || (d.ip_remota && d.ip_remota.includes(callerIp))) || dispositivos[0];

      const payload = {
        dispositivo_id: matchedDev ? matchedDev.id : 1,
        dispositivo_nombre: matchedDev ? matchedDev.nombre : `ZK (${sn})`,
        sala_id: matchedDev ? matchedDev.sala_id : 1,
        sala_nombre: matchedDev ? matchedDev.sala_nombre : 'Sin Sala',
        attlogs: attlogsToSync
      };

      await syncAttlogsModel(payload);
      console.log(`[32m🟢 [ATTLOG ZK][0m Recibidos ${attlogsToSync.length} marcajes de ZK (${sn})`);
    }

    return reply.type('text/plain').send('OK');
  } catch (err) {
    console.error('Error procesando ZK IClock CData:', err);
    return reply.type('text/plain').send('OK');
  }
}


// --- PLANTILLAS HORARIOS ---
export async function getPlantillasHorariosFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let tipo = null;
    if (q.tipo) {
      tipo = String(q.tipo).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    }

    const result = await getPlantillasHorariosFilterOptionsModel({
      userSalaIds,
      salaIds,
      tipo,
      search: q.search
    });
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getPlantillasHorarios(request, reply) {
  const result = await getPlantillasHorariosModel(request.query);
  return reply.send(result);
}

export async function createPlantillaHorario(request, reply) {
  const body = parseBody(request.body);
  const result = await createPlantillaHorarioModel(body);
  return reply.send({ success: true, data: result });
}

export async function updatePlantillaHorario(request, reply) {
  const { id } = request.params;
  const body = parseBody(request.body);
  const result = await updatePlantillaHorarioModel(id, body);
  return reply.send({ success: true, data: result });
}

export async function deletePlantillaHorario(request, reply) {
  const { id } = request.params;
  const result = await deletePlantillaHorarioModel(id);
  return reply.send(result);
}



export async function getDepartamentosCiclos(request, reply) {
  try {
    const res = await getDepartamentosCiclosModel(request.query || {});
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getDepartamentosCiclosFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }

    const res = await getDepartamentosCiclosFilterOptionsModel({
      userSalaIds,
      salaIds,
      search: q.search
    });
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getDepartamentoEmpleadosCiclos(request, reply) {
  try {
    const { deptId } = request.params;
    const search = request.query?.search || '';
    const res = await getDepartamentoEmpleadosCiclosModel(deptId, search);
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function updateDepartamentoEmpleadosCiclos(request, reply) {
  try {
    const { deptId } = request.params;
    const payload = request.body || {};
    const res = await updateDepartamentoEmpleadosCiclosModel(deptId, payload);
    return reply.send(res);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

// ==========================================
// 📅 CONTROLADORES DE FERIADOS / CALENDARIO
// ==========================================

export async function getFeriados(request, reply) {
  try {
    const res = await getFeriadosModel(request.query);
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getFeriadosFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    const res = await getFeriadosFilterOptionsModel({
      userSalaIds,
      salaIds,
      search: q.search
    });
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function createFeriado(request, reply) {
  try {
    const data = request.body || {};
    if (!data.nombre || !data.nombre.trim()) {
      return reply.status(400).send({ success: false, error: 'El nombre es obligatorio' });
    }
    if (!data.sala_id) {
      return reply.status(400).send({ success: false, error: 'La sala es obligatoria' });
    }
    const res = await createFeriadoModel(data);
    return reply.status(201).send({ success: true, data: res });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateFeriado(request, reply) {
  try {
    const { id } = request.params;
    const data = request.body || {};
    const res = await updateFeriadoModel(id, data);
    return reply.send({ success: true, data: res });
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteFeriado(request, reply) {
  try {
    const { id } = request.params;
    const res = await deleteFeriadoModel(id);
    if (!res.success) {
      return reply.status(409).send(res);
    }
    return reply.send(res);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getCumpleanos(request, reply) {
  try {
    const data = await getCumpleanosModel(request.query);
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getCarnets(request, reply) {
  try {
    const data = await getCarnetsModel(request.query);
    return reply.send({ success: true, data });
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

// ==========================================
// 📊 CONTROLADORES DE CORTES HISTÓRICOS
// ==========================================

export async function getCortes(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    let salaIds = null;
    if (q.sala_ids) {
      salaIds = String(q.sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }

    const res = await getCortesModel({
      page: q.page,
      limit: q.limit,
      search: q.search,
      userSalaIds,
      salaIds
    });
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getCorteById(request, reply) {
  try {
    const { id } = request.params;
    const res = await getCorteByIdModel(id);
    if (!res.success) {
      return reply.status(404).send(res);
    }
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function createCorte(request, reply) {
  try {
    const body = request.body || {};
    if (!body.titulo || !body.titulo.trim()) {
      return reply.status(400).send({ success: false, error: 'El título del corte es obligatorio' });
    }
    if (!body.fecha_desde || !body.fecha_hasta) {
      return reply.status(400).send({ success: false, error: 'Las fechas desde y hasta son obligatorias' });
    }

    const res = await createCorteModel(body);
    return reply.status(201).send(res);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteCorte(request, reply) {
  try {
    const { id } = request.params;
    const res = await deleteCorteModel(id);
    return reply.send(res);
  } catch (err) {
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getCortesFilterOptions(request, reply) {
  try {
    const q = request.query || {};
    let userSalaIds = null;
    if (q.user_sala_ids) {
      userSalaIds = String(q.user_sala_ids).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
    }
    const res = await getCortesFilterOptionsModel({ userSalaIds });
    return reply.send(res);
  } catch (err) {
    return reply.status(500).send({ success: false, error: err.message });
  }
}
