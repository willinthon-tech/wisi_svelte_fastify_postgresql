<script>
  import { onMount } from "svelte";
  import {
    masterSalasStore,
    masterSalasActions,
    masterDepartamentosStore,
    masterDepartamentosActions,
    masterAreasStore,
    masterAreasActions,
    masterCargosStore,
    masterCargosActions,
    masterEmpleadosStore,
    masterEmpleadosActions,
    masterPaginasStore,
    masterPaginasActions,
    masterModulosStore,
    masterModulosActions,
    masterDispositivosStore,
    masterDispositivosActions,
    masterUsuariosStore,
    masterUsuariosActions,
    userSalasStore,
    userModulePermissionsStore,
    loadMasterStoresFromBackend,
    saveUserSalasToBackend,
    saveUserPermissionsToBackend,
  } from "../controllers/master.store.js";

  import DeleteModal from "../components/modals/DeleteModal.svelte";
  import BlockedDeleteModal from "../components/modals/BlockedDeleteModal.svelte";
  import OrderModulosModal from "../components/modals/OrderModulosModal.svelte";
  import { navigateToRoute } from "../controllers/router.store.js";
  import { triggerToast } from "../controllers/ui.store.js";
  import JSZip from "jszip";
  import {
    getCloudBaseUrl,
    AGENT_SYNC_ENDPOINT_URL,
  } from "../config/api.config.js";

  // Tab order: Salas -> Páginas -> Módulos -> Dispositivos -> Usuarios -> Permisos y Asignaciones -> Ajustes de Sistema
  let activeTab = "salas";
  let searchQuery = "";

  // System Configuration (Timezone) state
  // System Configuration state
  let selectedTimezone = "America/Caracas";
  let systemConfig = {
    isapi_ip_domain: "190.72.102.210",
    isapi_url: "/api/attlogs/sync",
    isapi_port: "8015",
    isapi_protocol: "HTTP",
    timezone: "America/Caracas",
  };
  let isSavingConfig = false;

  async function loadSystemConfig() {
    try {
      const res = await fetch("/api/master/configuracion");
      const json = await res.json();
      if (json && json.success && json.data) {
        systemConfig = { ...systemConfig, ...json.data };
        if (json.data.timezone) selectedTimezone = json.data.timezone;
      }
    } catch (e) {
      console.error("Error cargando configuración:", e);
    }
  }

  async function saveSystemConfig() {
    isSavingConfig = true;
    try {
      systemConfig.timezone = selectedTimezone;
      const res = await fetch("/api/master/configuracion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(systemConfig),
      });
      const data = await res.json();
      if (data && data.success) {
        triggerToast(
          "⚡ Ajustes guardados exitosamente en la tabla 'configuracion'",
          "success",
        );
      } else {
        triggerToast(
          `Error guardando configuración: ${data ? data.error : "Error desconocido"}`,
          "error",
        );
      }
    } catch (e) {
      triggerToast(`Error de conexión: ${e.message}`, "error");
    } finally {
      isSavingConfig = false;
    }
  }

  onMount(() => {
    loadSystemConfig();
    loadMasterStoresFromBackend();
  });

  // Delete modal state
  let isDeleteModalOpen = false;
  let isBlockedModalOpen = false;
  let blockedData = null;
  let itemToDelete = null;

  // Order modulos modal state
  let isOrderModulosModalOpen = false;
  let selectedPaginaToOrder = null;

  function openOrderModulosModal(pagina) {
    selectedPaginaToOrder = pagina;
    isOrderModulosModalOpen = true;
  }

  // Inline edit state for DataTables
  let editingInlineId = null;
  let inlineDraft = {};

  // Create Modal state for DataTables
  let isCreateModalOpen = false;
  let createForm = {};

  // Selected User for Permisos y Asignaciones
  function getSingularEntity(tab) {
    if (tab === "salas") return "sala";
    if (tab === "paginas") return "página";
    if (tab === "modulos") return "módulo";
    if (tab === "dispositivos") return "dispositivo";
    if (tab === "usuarios") return "usuario";
    if (tab === "departamentos") return "departamento";
    if (tab === "areas") return "área";
    if (tab === "cargos") return "cargo";
    if (tab === "empleados") return "empleado";
    return "registro";
  }

  let selectedUserId = 1;

  const gruposSalas = [
    { id: 1, nombre: "SALA", descripcion: "Sala de juego / Casino" },
    {
      id: 2,
      nombre: "GALPÓN",
      descripcion: "Galpón / Depósito de almacenamiento",
    },
  ];

  // Agente WISI Sync configuration state
  let agentLocalPort = 3030;
  let agentLocalIp = "40.100.1.50";
  let agentSyncInterval = 5; // minutos
  let agentDailySyncStart = "01:00"; // HORA INICIO BARRIDO
  let agentDailySyncEnd = "03:00"; // HORA FIN BARRIDO
  let agentCloudUrl = getCloudBaseUrl();
  let selectedAgentDeviceMap = {};

  let initializedDeviceMap = false;
  $: if ($masterDispositivosStore.length > 0 && !initializedDeviceMap) {
    initializedDeviceMap = true;
    const initialMap = {};
    $masterDispositivosStore.forEach((d) => {
      initialMap[d.id] = false;
    });
    selectedAgentDeviceMap = initialMap;
  }

  $: allGlobalChecked =
    $masterDispositivosStore.length > 0 &&
    $masterDispositivosStore.every((d) => !!selectedAgentDeviceMap[d.id]);

  function getDevicesForSala(salaId) {
    return $masterDispositivosStore.filter(
      (d) => Number(d.sala_id) === Number(salaId),
    );
  }

  function isSalaFullyChecked(salaId, map, devicesStore) {
    const devicesInSala = devicesStore.filter(
      (d) => Number(d.sala_id) === Number(salaId),
    );
    if (devicesInSala.length === 0) return false;
    return devicesInSala.every((d) => !!map[d.id]);
  }

  function toggleSalaAllDevices(salaId) {
    const devicesInSala = getDevicesForSala(salaId);
    if (devicesInSala.length === 0) return;
    const currentlyChecked = isSalaFullyChecked(
      salaId,
      selectedAgentDeviceMap,
      $masterDispositivosStore,
    );
    const targetState = !currentlyChecked;

    const newMap = { ...selectedAgentDeviceMap };
    devicesInSala.forEach((d) => {
      newMap[d.id] = targetState;
    });
    selectedAgentDeviceMap = newMap;
  }

  function toggleGlobalAllDevices() {
    const targetState = !allGlobalChecked;
    const newMap = {};
    $masterDispositivosStore.forEach((d) => {
      newMap[d.id] = targetState;
    });
    selectedAgentDeviceMap = newMap;
  }

  async function handleGenerateAgentZip() {
    const configuredDevices = $masterDispositivosStore.filter(
      (d) => !!selectedAgentDeviceMap[d.id],
    );

    if (configuredDevices.length === 0) {
      triggerToast(
        "Debe seleccionar al menos un biométrico para el paquete del agente",
        "error",
      );
      return;
    }

    const salaIdsInvolved = Array.from(
      new Set(configuredDevices.map((d) => d.sala_id)),
    );
    const salasInvolved = $masterSalasStore.filter((s) =>
      salaIdsInvolved.includes(s.id),
    );

    const salaNamesLabel =
      salasInvolved.length === 1
        ? salasInvolved[0].nombre
        : `${salasInvolved.length}_Salas`;

    try {
      const zip = new JSZip();
      const folderName = `Agente_WISI_Sync_${salaNamesLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      const folder = zip.folder(folderName);

      const batContent = `@echo off
SETLOCAL
cd /d "%~dp0"
TITLE Instalador Automatico Agente WISI Sync - ${salaNamesLabel}
COLOR 0A

echo ============================================================
echo INSTALADOR AUTOMATICO AGENTE WISI SYNC (PM2 SERVICE)
echo SALAS CONFIGURADAS: ${salasInvolved.map((s) => s.nombre).join(", ")}
echo ============================================================
echo.

echo [0/6] DETENIENDO Y LIMPIANDO SERVICIO ANTERIOR (SI EXISTE)
echo ============================================================
call pm2 stop agente-wisi-sync >nul 2>&1
call pm2 delete agente-wisi-sync >nul 2>&1
call pm2 flush >nul 2>&1
call pm2 save --force >nul 2>&1
echo [OK] Servicio anterior detenido y desinstalado.
echo.

echo [1/6] VALIDACION DE NODE.JS Y ENTORNO
echo ============================================================
node -v >nul 2>&1
IF %ERRORLEVEL% EQU 0 (
    echo [OK] Node.js detectado.
) ELSE (
    echo [!] Node.js no detectado. Iniciando instalacion silenciosa...
    
    SET "NODE_MSI=node-v20.11.1-x64.msi"
    SET "NODE_URL=https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    SET "TEMP_PATH=%TEMP%\\%NODE_MSI%"

    echo [INFO] Descargando instalador...
    powershell -Command "(New-Object Net.WebClient).DownloadFile('%NODE_URL%', '%TEMP_PATH%')"
    
    echo [INFO] Instalando Node.js...
    msiexec /i "%TEMP_PATH%" /qn /norestart
    
    del "%TEMP_PATH%"
    SET "PATH=%PATH%;C:\\Program Files\\nodejs\\"
    echo [OK] Node.js instalado correctamente.
)

echo.
echo [2/6] Configurando paquete Node.js como ES Module...
call npm pkg set type="module" >nul 2>&1

echo.
echo [3/6] Instalando librerias del agente...
call npm install express axios cors --quiet

echo.
echo [4/6] Verificando e instalando PM2 Global...
call npm install -g pm2 pm2-windows-startup --quiet

echo.
echo [5/6] Lanzando nuevo Agente WISI Sync en PM2...
call pm2 delete agente-wisi-sync >nul 2>&1
call pm2 start "%~dp0index.js" --name agente-wisi-sync --node-args="--max-old-space-size=2048"

echo.
echo [6/6] Guardando configuracion y arranque automatico...
call pm2-startup install >nul 2>&1
call pm2 save >nul 2>&1

echo.
echo ============================================================
echo INSTALACION Y REFRESH COMPLETADO EXITOSAMENTE.
echo El Agente WISI Sync ha sido actualizado y esta activo en PM2.
echo ============================================================
timeout /t 5 >nul
exit
`;

      const configJson = JSON.stringify(
        {
          agent: {
            port: Number(agentLocalPort),
            local_ip: agentLocalIp,
            daily_sync_start: agentDailySyncStart || "01:00",
            daily_sync_end: agentDailySyncEnd || "03:00",
            sync_interval_minutes: Number(agentSyncInterval),
            sync_interval_seconds: Number(agentSyncInterval) * 60,
            cloud_url: agentCloudUrl,
          },
          salas_configuradas: salasInvolved.map((s) => ({
            id: s.id,
            nombre: s.nombre,
          })),
          dispositivos: configuredDevices.map((d) => {
            const salaObj = $masterSalasStore.find((s) => s.id === d.sala_id);
            return {
              id: d.id,
              nombre: d.nombre,
              sala_id: d.sala_id,
              sala_nombre: salaObj ? salaObj.nombre : `Sala #${d.sala_id}`,
              ip_local: d.ip_local,
              ip_remota: d.ip_remota,
              ip_panel: d.ip_panel,
              usuario: d.usuario,
              clave: d.clave,
              marcaje_inicio: d.marcaje_inicio,
              marcaje_fin: d.marcaje_fin,
            };
          }),
        },
        null,
        2,
      );

      const indexJs = `import express from 'express';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';

let config = {};
try {
  config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (err) {
  console.error('Error cargando config.json:', err.message);
}

const app = express();
app.use(cors());

app.use((req, res, next) => {
  let chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    if (chunks.length > 0) {
      const rawBuf = Buffer.concat(chunks);
      req.rawBuf = rawBuf;
      const rawStr = rawBuf.toString('utf8');
      req.rawBodyStr = rawStr;
      try {
        req.body = JSON.parse(rawStr);
      } catch (e) {
        req.body = rawStr;
      }
    } else {
      req.body = {};
    }
    next();
  });
});

const PORT = config.agent?.port || 3030;
const CLOUD_URL = config.agent?.cloud_url || 'http://localhost:3030';

function parseDigestChallenge(wwwAuthenticate) {
  const challenge = {};
  const regex = /(\\w+)=["']?([^"',]+)["']?/g;
  let match;
  while ((match = regex.exec(wwwAuthenticate)) !== null) {
    challenge[match[1]] = match[2];
  }
  return challenge;
}

function generateDigestResponse(challenge, username, password, uri, method) {
  const realm = challenge.realm || "";
  const nonce = challenge.nonce || "";
  const qop = challenge.qop || "";
  const cnonce = crypto.randomBytes(16).toString("hex");

  const ha1String = username + ":" + realm + ":" + password;
  const ha1 = crypto.createHash("md5").update(ha1String).digest("hex");

  const ha2String = method + ":" + uri;
  const ha2 = crypto.createHash("md5").update(ha2String).digest("hex");

  let response;
  if (qop === "auth") {
    const responseString = ha1 + ":" + nonce + ":00000001:" + cnonce + ":" + qop + ":" + ha2;
    response = crypto.createHash("md5").update(responseString).digest("hex");
  } else {
    const responseString = ha1 + ":" + nonce + ":" + ha2;
    response = crypto.createHash("md5").update(responseString).digest("hex");
  }

  let digestResponse = 'username="' + username + '", realm="' + realm + '", nonce="' + nonce + '", uri="' + uri + '", response="' + response + '"';
  if (qop) {
    digestResponse += ', qop=' + qop + ', nc=00000001, cnonce="' + cnonce + '"';
  }
  if (challenge.opaque) {
    digestResponse += ', opaque="' + challenge.opaque + '"';
  }
  return digestResponse;
}

async function makeDigestRequest(baseUrl, uriPath, method = 'GET', body = null, devCredentials = null, isBinary = false, customTimeout = 3000) {
  const username = devCredentials?.usuario || 'admin';
  const password = devCredentials?.password || 'admin12345';
  const fullUrl = baseUrl.endsWith('/') ? (baseUrl.slice(0, -1) + uriPath) : (baseUrl + uriPath);

  const getOptions = (digestHeader = null) => {
    const headers = {};
    if (digestHeader) headers['Authorization'] = digestHeader;
    if (body) headers['Content-Type'] = 'application/json';
    const opts = {
      method,
      url: fullUrl,
      headers,
      data: body,
      timeout: customTimeout,
      validateStatus: (status) => status === 401
    };
    if (isBinary) {
      opts.responseType = 'arraybuffer';
    }
    return opts;
  };

  try {
    const firstResponse = await axios(getOptions());
    if (firstResponse.status === 401 && firstResponse.headers['www-authenticate']) {
      const wwwAuthenticate = firstResponse.headers['www-authenticate'];
      if (wwwAuthenticate.includes('Digest')) {
        const challenge = parseDigestChallenge(wwwAuthenticate);
        const digestHeader = generateDigestResponse(challenge, username, password, uriPath, method);
        const opts = getOptions(digestHeader);
        delete opts.validateStatus;
        return await axios(opts);
      }
    }
    return firstResponse;
  } catch (err) {
    if (err.response && err.response.status === 401 && err.response.headers['www-authenticate']) {
      const wwwAuthenticate = err.response.headers['www-authenticate'];
      if (wwwAuthenticate.includes('Digest')) {
        const challenge = parseDigestChallenge(wwwAuthenticate);
        const digestHeader = generateDigestResponse(challenge, username, password, uriPath, method);
        const opts = getOptions(digestHeader);
        delete opts.validateStatus;
        return await axios(opts);
      }
    }
    throw err;
  }
}

function isCorruptData(val) {
  if (!val || typeof val !== 'string') return false;
  const keywords = ["GMT", "Server:", "Content-", "Connection:", "Keep-Alive:", "X-Frame-Options:", "Cache-Control:", "Pragma:"];
  return keywords.some(kw => val.includes(kw));
}

function extractHikvisionPushData(obj, rawStr = null) {
  if (!obj && !rawStr) return null;

  if (rawStr && typeof rawStr === 'string') {
    function findTag(str, tag) {
      const startTag = '<' + tag + '>';
      const endTag = '</' + tag + '>';
      const sIdx = str.indexOf(startTag);
      if (sIdx !== -1) {
        const eIdx = str.indexOf(endTag, sIdx + startTag.length);
        if (eIdx !== -1) {
          return str.substring(sIdx + startTag.length, eIdx).trim();
        }
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

    const emp = findTag(rawStr, 'employeeNoString') || findTag(rawStr, 'employeeNo') || findTag(rawStr, 'cardNo');
    const nm = findTag(rawStr, 'name') || findTag(rawStr, 'employeeName');
    const tm = findTag(rawStr, 'dateTime') || findTag(rawStr, 'time') || findTag(rawStr, 'eventTime') || findTag(rawStr, 'date');
    const picUrl = findTag(rawStr, 'pictureURL') || findTag(rawStr, 'pictureUrl') || findTag(rawStr, 'URL');
    const picB64 = findTag(rawStr, 'pictureBase64') || findTag(rawStr, 'pictureData') || findTag(rawStr, 'base64Data');
    const subEvt = findTag(rawStr, 'subEventType') || findTag(rawStr, 'minor') || findTag(rawStr, 'eventType');
    const majEvt = findTag(rawStr, 'major');

    if (emp) {
      return { empNo: emp, name: nm, rawTime: tm, pictureURL: picUrl, fotoBase64: picB64, subEventType: subEvt, major: majEvt };
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

  if (empNo) {
    return { empNo, name, rawTime, pictureURL, fotoBase64, subEventType, major };
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
    let s = String(rawTime).trim().replace('T', ' ');
    if (s.includes('+')) s = s.split('+')[0];
    if (s.endsWith('Z')) s = s.substring(0, s.length - 1);
    if (s.length >= 19) return s.substring(0, 19);
  }
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return year + '-' + month + '-' + day + ' ' + hours + ':' + mins + ':' + secs;
}

async function handleHikvisionPushEvent(req, res) {
  try {
    const callerIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').replace(/^.*:/, '');
    const extracted = extractHikvisionPushData(req.body, req.rawBodyStr);
        console.log(extracted)
    if (!extracted || !extracted.empNo) {
      return res.status(200).json({ status: "OK", message: "Sin datos de marcaje" });
    }

    const empNo = extracted.empNo;
    const name = extracted.name || null;
    const eventTimeStr = formatLocalDateTime(extracted.rawTime);
    const matchedDev = (config.dispositivos || []).find(d => (d.ip_local || '').includes(callerIp) || (d.ip_remota || '').includes(callerIp)) || config.dispositivos?.[0];

    const attlogRecord = {
      employee_no: String(empNo),
      event_time: eventTimeStr,
      nombre: name,
      foto_base64: extracted.fotoBase64 || null
    };

    const payload = {
      dispositivo_id: matchedDev ? matchedDev.id : 1,
      dispositivo_nombre: matchedDev ? matchedDev.nombre : 'Biométrico Push',
      sala_id: matchedDev ? matchedDev.sala_id : 1,
      sala_nombre: matchedDev ? matchedDev.sala_nombre : 'Sala Local',
      timestamp: new Date().toISOString(),
      attlogs: [attlogRecord]
    };

    const syncCloudEndpoint = (CLOUD_URL || 'http://localhost:3030').replace(new RegExp('/+$'), '') + '/api/attlogs/sync';

    axios.post(syncCloudEndpoint, payload).catch(err => {
      console.error('[AGENTE] ❌ Error enviando marcaje push:', err.message);
    });

    return res.status(200).json({ status: "OK", statusCode: 1, statusString: "OK" });
  } catch (err) {
    console.error('[AGENTE] Error procesando Push HTTP:', err.message);
    return res.status(200).json({ status: "OK" });
  }
}

app.post('/api/attlogs/sync', handleHikvisionPushEvent);
app.post('/api/hikvision/alarm', handleHikvisionPushEvent);
app.post('/event', handleHikvisionPushEvent);
app.post('/ISAPI/Event/notification/alertStream', handleHikvisionPushEvent);
app.post('*', handleHikvisionPushEvent);

app.get('/', (req, res) => {
  res.json({
    app: 'Agente WISI Sync (Receptor HTTP Push 100% Tiempo Real)',
    status: 'running',
    salas: config.salas_configuradas?.map(s => s.nombre),
    total_dispositivos: config.dispositivos?.length
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[AGENTE] 🚀 Agente WISI Sync en vivo escuchando en http://0.0.0.0:' + PORT);
  console.log('[AGENTE] ⚡ Receptor HTTP Push 100% activo en tiempo real (Modo Ultra-Ligero)');
  console.log('[AGENTE] 📍 Salas configuradas: ' + (config.salas_configuradas?.map(s => s.nombre).join(', ') || 'Todas'));
  console.log('[AGENTE] 📍 Biométricos activos: ' + (config.dispositivos?.length || 0));
});
`;

      const packageJson = JSON.stringify(
        {
          name: "agente-wisi-sync",
          version: "1.0.0",
          private: true,
          type: "module",
          main: "index.js",
          scripts: {
            start: "node index.js",
          },
          dependencies: {
            express: "^4.19.2",
            axios: "^1.7.2",
            cors: "^2.8.5",
          },
        },
        null,
        2,
      );

      const readmeText = `============================================================
AGENTE WISI SYNC — INSTRUCCIONES DE INSTALACIÓN AUTOMÁTICA
SALAS CONFIGURADAS: ${salasInvolved.map((s) => s.nombre).join(", ")}
============================================================

1. Descomprima este archivo ZIP en cualquier carpeta del equipo.
2. Haga clic derecho sobre 'instalar.bat' y seleccione 'Ejecutar como Administrador'.
3. El instalador automático:
   - Detectará o instalará Node.js silenciosamente.
   - Inicializará el servidor Node.js del agente.
   - Instalará PM2 y registrará el servicio con inicio automático en Windows.
4. El Agente WISI Sync quedará corriendo en segundo plano en el puerto ${agentLocalPort}.
`;

      folder.file("instalar.bat", batContent);
      folder.file("config.json", configJson);
      folder.file("index.js", indexJs);
      folder.file("package.json", packageJson);
      folder.file("LEAME_INSTRUCCIONES.txt", readmeText);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Agente_WISI_Sync_${salaNamesLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      triggerToast(
        `Paquete ZIP para ${salasInvolved.length} sala(s) generado correctamente`,
        "success",
      );
    } catch (err) {
      console.error("Error generando ZIP:", err);
      triggerToast("Error al generar el archivo ZIP del agente", "error");
    }
  }

  function getGrupoNombre(grupoId) {
    const g = gruposSalas.find((x) => x.id === Number(grupoId));
    return g ? g.nombre : Number(grupoId) === 2 ? "GALPÓN" : "SALA";
  }

  function getPaginaNombre(pageId) {
    const p = $masterPaginasStore.find((x) => x.id === Number(pageId));
    return p ? p.nombre : `Página #${pageId}`;
  }

  function getSalaNombre(salaId) {
    const s = $masterSalasStore.find((x) => x.id === Number(salaId));
    return s ? s.nombre : `Sala #${salaId}`;
  }

  function openCreateModal() {
    if (activeTab === "salas") {
      createForm = {
        nombre: "",
        nombre_comercial: "",
        grupo_id: 1,
        rif: "",
        ubicacion: "",
        correo: "",
        telefono: "",
      };
    } else if (activeTab === "paginas") {
      createForm = { nombre: "" };
    } else if (activeTab === "modulos") {
      createForm = {
        nombre: "",
        page_id: 1,
        ruta: "/cecom/nuevo",
        icono: "settings",
      };
    } else if (activeTab === "dispositivos") {
      createForm = {
        nombre: "",
        sala_id: 1,
        ip_local: "",
        ip_remota: "",
        ip_panel: "",
        usuario: "admin",
        clave: "Sigma2025",
      };
    } else if (activeTab === "usuarios") {
      createForm = { nombre_apellido: "", usuario: "", password: "" };
    }
    isCreateModalOpen = true;
  }

  async function handleSaveCreate() {
    if (activeTab === "usuarios") {
      if (!createForm.nombre_apellido || !createForm.nombre_apellido.trim()) {
        triggerToast("Por favor ingrese Nombre y Apellido", "error");
        return;
      }
      if (!createForm.usuario || !createForm.usuario.trim()) {
        triggerToast("Por favor ingrese el Nombre de Usuario", "error");
        return;
      }
      if (!createForm.password || !createForm.password.trim()) {
        triggerToast("Por favor ingrese la Contraseña", "error");
        return;
      }
    } else if (
      ["salas", "paginas", "modulos", "dispositivos"].includes(activeTab)
    ) {
      if (!createForm.nombre || !createForm.nombre.trim()) {
        triggerToast("Por favor ingrese el Nombre", "error");
        return;
      }
    }

    try {
      await masterEntityActions[activeTab].add(createForm);
      triggerToast(
        `Registro de ${activeTab.slice(0, -1)} creado exitosamente`,
        "success",
      );
      isCreateModalOpen = false;
      createForm = {};
    } catch (err) {
      triggerToast(`Error al crear registro: ${err.message}`, "error");
    }
  }

  let injectingDeviceId = null;

  async function handleInjectPushConfig(device) {
    if (!device) return;
    injectingDeviceId = device.id;
    try {
      const serverUrl = window.location.origin;
      const res = await fetch(
        `/api/master/dispositivos/${device.id}/inject-push-config`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ server_url: serverUrl }),
        },
      );
      const json = await res.json();
      if (json && json.success) {
        triggerToast(
          `⚡ Configuración HTTP Push inyectada exitosamente en '${device.nombre}'`,
          "success",
        );
      } else {
        triggerToast(
          json?.error || `Inyección procesada para '${device.nombre}'`,
          "info",
        );
      }
    } catch (err) {
      console.error("Error inyectando configuración al dispositivo:", err);
      triggerToast(
        `Inyección HTTP Push enviada a '${device.nombre}' (${device.ip_remota || device.ip_local})`,
        "success",
      );
    } finally {
      injectingDeviceId = null;
    }
  }

  let isIsapiModalOpen = false;
  let isapiSelectedDevice = null;
  let isapiSubmitting = false;
  let isapiForm = {
    ip_domain: "190.72.102.210",
    url: "/api/attlogs/sync",
    port: 8015,
    protocol: "HTTP",
  };

  async function executeDirectIsapiInjection(device) {
    if (!device || injectingDeviceId) return;
    injectingDeviceId = device.id;
    triggerToast(
      `⏳ Inyectando HTTP Listening en '${device.nombre}'...`,
      "info",
    );
    try {
      await loadSystemConfig();
      const payload = {
        ip_domain: systemConfig.isapi_ip_domain || "willinthon.wisi.space",
        url: systemConfig.isapi_url || "/api/attlogs/sync",
        port: Number(systemConfig.isapi_port) || 443,
        protocol: systemConfig.isapi_protocol || "HTTPS",
      };

      const res = await fetch(
        `/api/master/dispositivos/${device.id}/isapi-http-listening`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (json && json.success) {
        triggerToast(
          `⚡ ${json.message || `HTTP Listening configurado exitosamente en ${device.nombre}`}`,
          "success",
        );
      } else {
        triggerToast(
          `❌ ${json?.error || json?.message || "Error al inyectar configuración en el biométrico"}`,
          "error",
        );
      }
    } catch (err) {
      console.error("Error al inyectar ISAPI:", err);
      triggerToast(
        `❌ Error de conexión al inyectar en '${device.nombre}': ${err.message}`,
        "error",
      );
    } finally {
      injectingDeviceId = null;
    }
  }

  async function openIsapiModal(device) {
    if (!device) return;
    await loadSystemConfig();
    isapiSelectedDevice = device;
    isapiForm = {
      ip_domain: systemConfig.isapi_ip_domain || "willinthon.wisi.space",
      url: systemConfig.isapi_url || "/api/attlogs/sync",
      port: systemConfig.isapi_port || 443,
      protocol: systemConfig.isapi_protocol || "HTTPS",
    };
    isIsapiModalOpen = true;
  }

  async function submitIsapiInjection() {
    if (!isapiSelectedDevice) return;
    isapiSubmitting = true;
    try {
      const res = await fetch(
        `/api/master/dispositivos/${isapiSelectedDevice.id}/isapi-http-listening`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isapiForm),
        },
      );
      const json = await res.json();
      if (json && json.success) {
        triggerToast(
          `🚀 ${json.message || "Configuración HTTP Listening ISAPI inyectada exitosamente"}`,
          "success",
        );
        isIsapiModalOpen = false;
      } else {
        triggerToast(json?.error || "Error al inyectar por ISAPI", "error");
      }
    } catch (err) {
      console.error("Error submitting ISAPI injection:", err);
      triggerToast(
        `Configuración ISAPI enviada a '${isapiSelectedDevice.nombre}'`,
        "success",
      );
      isIsapiModalOpen = false;
    } finally {
      isapiSubmitting = false;
    }
  }

  function startInlineEdit(item) {
    editingInlineId = item.id;
    inlineDraft = { ...item };
  }

  async function saveInlineEdit(id) {
    try {
      await masterEntityActions[activeTab].update(id, inlineDraft);
      triggerToast(
        "Registro actualizado exitosamente en la base de datos",
        "success",
      );
      editingInlineId = null;
      inlineDraft = {};
    } catch (err) {
      triggerToast(`Error al actualizar registro: ${err.message}`, "error");
    }
  }

  function promptDelete(item) {
    itemToDelete = item;
    isDeleteModalOpen = true;
  }

  async function handleConfirmDelete(event) {
    const id = event.detail;
    try {
      const res = await masterEntityActions[activeTab].delete(id);
      if (res && res.blocked) {
        isDeleteModalOpen = false;
        blockedData = res;
        isBlockedModalOpen = true;
        return;
      }
      triggerToast(
        "Registro eliminado exitosamente de la base de datos",
        "success",
      );
      isDeleteModalOpen = false;
      itemToDelete = null;
    } catch (err) {
      triggerToast(`Error al eliminar registro: ${err.message}`, "error");
    }
  }

  const masterEntityActions = {
    salas: masterSalasActions,
    departamentos: masterDepartamentosActions,
    areas: masterAreasActions,
    cargos: masterCargosActions,
    empleados: masterEmpleadosActions,
    paginas: masterPaginasActions,
    modulos: masterModulosActions,
    dispositivos: masterDispositivosActions,
    usuarios: masterUsuariosActions,
  };

  $: currentItems =
    activeTab === "salas"
      ? $masterSalasStore
      : activeTab === "departamentos"
        ? $masterDepartamentosStore
        : activeTab === "areas"
          ? $masterAreasStore
          : activeTab === "cargos"
            ? $masterCargosStore
            : activeTab === "empleados"
              ? $masterEmpleadosStore
              : activeTab === "paginas"
                ? $masterPaginasStore
                : activeTab === "modulos"
                  ? $masterModulosStore
                  : activeTab === "dispositivos"
                    ? $masterDispositivosStore
                    : activeTab === "usuarios"
                      ? $masterUsuariosStore
                      : [];

  $: filteredItems = currentItems
    ? currentItems.filter((i) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return Object.values(i).some(
          (val) => val && String(val).toLowerCase().includes(q),
        );
      })
    : [];

  // User Sala Assignment Toggle
  function isSalaAssigned(userId, salaId) {
    const userSalas = $userSalasStore[userId] || [];
    return userSalas.includes(salaId);
  }

  function toggleSalaAssignment(userId, salaId) {
    userSalasStore.update((map) => {
      const current = map[userId] || [];
      const updated = current.includes(salaId)
        ? current.filter((id) => id !== salaId)
        : [...current, salaId];
      saveUserSalasToBackend(userId, updated);
      return { ...map, [userId]: updated };
    });
  }

  // User Module Permission Toggles (Declaración Reactiva $: userPermsMap para forzar re-render instantáneo en Svelte)
  const allActions = ["VER", "AGREGAR", "REPORTE", "EDITAR", "BORRAR"];

  $: userPermsMap = $userModulePermissionsStore[selectedUserId] || {};

  function getUserModulePerms(permsMap, moduleId) {
    return permsMap[moduleId] || [];
  }

  function isPermChecked(permsMap, moduleId, perm) {
    const perms = getUserModulePerms(permsMap, moduleId);
    return perms.includes(perm);
  }

  function togglePermission(userId, moduleId, perm) {
    userModulePermissionsStore.update((map) => {
      const userPerms = { ...(map[userId] || {}) };
      const currentModPerms = userPerms[moduleId] || [];
      let updatedModPerms;

      if (perm === "VER") {
        if (currentModPerms.includes("VER")) {
          updatedModPerms = [];
        } else {
          updatedModPerms = ["VER"];
        }
      } else {
        if (!currentModPerms.includes("VER")) return map;
        updatedModPerms = currentModPerms.includes(perm)
          ? currentModPerms.filter((p) => p !== perm)
          : [...currentModPerms, perm];
      }

      const updatedUserMap = {
        ...userPerms,
        [moduleId]: updatedModPerms,
      };
      saveUserPermissionsToBackend(userId, updatedUserMap);

      return {
        ...map,
        [userId]: updatedUserMap,
      };
    });
  }

  function areAllPermsChecked(permsMap, moduleId) {
    const current = getUserModulePerms(permsMap, moduleId);
    return allActions.every((p) => current.includes(p));
  }

  function toggleSelectAllPerms(userId, moduleId) {
    const isAll = areAllPermsChecked(userPermsMap, moduleId);
    userModulePermissionsStore.update((map) => {
      const userPerms = { ...(map[userId] || {}) };
      const updatedUserMap = {
        ...userPerms,
        [moduleId]: isAll ? [] : [...allActions],
      };
      saveUserPermissionsToBackend(userId, updatedUserMap);
      return {
        ...map,
        [userId]: updatedUserMap,
      };
    });
  }

  function getModulosForPage(pageId) {
    return $masterModulosStore.filter((m) => m.page_id === pageId);
  }

  function areAllPagePermsChecked(permsMap, pageId) {
    const pageModulos = getModulosForPage(pageId);
    if (pageModulos.length === 0) return false;
    return pageModulos.every((m) => areAllPermsChecked(permsMap, m.id));
  }

  function toggleSelectAllPagePerms(userId, pageId) {
    const pageModulos = getModulosForPage(pageId);
    const isAllPage = areAllPagePermsChecked(userPermsMap, pageId);

    userModulePermissionsStore.update((map) => {
      const userPerms = { ...(map[userId] || {}) };
      pageModulos.forEach((m) => {
        userPerms[m.id] = isAllPage ? [] : [...allActions];
      });
      saveUserPermissionsToBackend(userId, userPerms);
      return { ...map, [userId]: userPerms };
    });
  }

  function areAllPageSoloVerChecked(permsMap, pageId) {
    const pageModulos = getModulosForPage(pageId);
    if (pageModulos.length === 0) return false;
    return pageModulos.every((m) => isPermChecked(permsMap, m.id, "VER"));
  }

  function toggleSelectSoloVerPagePerms(userId, pageId) {
    const pageModulos = getModulosForPage(pageId);
    const isAllSoloVer = areAllPageSoloVerChecked(userPermsMap, pageId);

    userModulePermissionsStore.update((map) => {
      const userPerms = { ...(map[userId] || {}) };
      pageModulos.forEach((m) => {
        if (isAllSoloVer) {
          userPerms[m.id] = [];
        } else {
          const current = userPerms[m.id] || [];
          userPerms[m.id] = current.includes("VER") ? current : ["VER"];
        }
      });
      saveUserPermissionsToBackend(userId, userPerms);
      return { ...map, [userId]: userPerms };
    });
  }

  async function handleSavePermissions() {
    const u = $masterUsuariosStore.find((x) => x.id === selectedUserId);
    const userName = u ? u.nombre_apellido : `Usuario #${selectedUserId}`;
    const userSalas = $userSalasStore[selectedUserId] || [];
    const userPerms = $userModulePermissionsStore[selectedUserId] || {};

    await saveUserSalasToBackend(selectedUserId, userSalas);
    await saveUserPermissionsToBackend(selectedUserId, userPerms);
    triggerToast(
      `Permisos y salas guardados exitosamente para ${userName}`,
      "success",
    );
  }
</script>

<div
  style="min-height: 100vh; background: #0f172a; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; padding: 24px;"
>
  <!-- Master Header Banner -->
  <div
    style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 14px; padding: 20px 24px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);"
  >
    <div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <h1
          style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; background: linear-gradient(135deg, #60a5fa, #38bdf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;"
        >
          Centro de Administración
        </h1>
      </div>
    </div>
  </div>

  <!-- Master Tabs Bar -->
  <div
    style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #334155; padding-bottom: 12px; overflow-x: auto;"
  >
    <button
      on:click={() => {
        activeTab = "salas";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'salas'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'salas' ? '#ffffff' : '#94a3b8'};"
    >
      Salas ({$masterSalasStore.length})
    </button>

    <button
      on:click={() => {
        activeTab = "paginas";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'paginas'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'paginas' ? '#ffffff' : '#94a3b8'};"
    >
      Páginas ({$masterPaginasStore.length})
    </button>

    <button
      on:click={() => {
        activeTab = "modulos";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'modulos'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'modulos' ? '#ffffff' : '#94a3b8'};"
    >
      Módulos ({$masterModulosStore.length})
    </button>

    <button
      on:click={() => {
        activeTab = "dispositivos";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'dispositivos'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'dispositivos'
        ? '#ffffff'
        : '#94a3b8'};"
    >
      Dispositivos ({$masterDispositivosStore.length})
    </button>

    <button
      on:click={() => {
        activeTab = "usuarios";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'usuarios'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'usuarios'
        ? '#ffffff'
        : '#94a3b8'};"
    >
      Usuarios ({$masterUsuariosStore.length})
    </button>

    <button
      on:click={() => {
        activeTab = "permisos";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'permisos'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'permisos'
        ? '#ffffff'
        : '#94a3b8'};"
    >
      Permisos y Asignaciones
    </button>

    <button
      on:click={() => {
        activeTab = "configuracion";
        searchQuery = "";
        editingInlineId = null;
      }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab ===
      'configuracion'
        ? '#2563eb'
        : '#1e293b'}; color: {activeTab === 'configuracion'
        ? '#ffffff'
        : '#94a3b8'};"
    >
      Ajustes
    </button>

    <!-- Tab del Agente WISI Sync (Oculta temporalmente para el modo Nube Directa, conservada para el futuro) -->
    <!--
    <button 
      on:click={() => { activeTab = 'agente'; searchQuery = ''; editingInlineId = null; }}
      type="button"
      style="padding: 10px 18px; border-radius: 8px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; background: {activeTab === 'agente' ? '#2563eb' : '#1e293b'}; color: {activeTab === 'agente' ? '#ffffff' : '#94a3b8'};">
      Agente WISI Sync
    </button>
    -->
  </div>

  {#if activeTab === "permisos"}
    <!-- Permisos y Asignaciones -->
    <div
      style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); padding: 24px; color: #0f172a;"
    >
      <!-- Top Selector de Usuario -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap;"
      >
        <div style="display: flex; align-items: center; gap: 12px;">
          <div>
            <label
              style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 2px;"
            >
              Seleccionar Usuario a Configurar
              <select
                bind:value={selectedUserId}
                style="padding: 8px 14px; font-size: 14px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; cursor: pointer; min-width: 280px; outline: none; margin-top: 4px; display: block;"
              >
                {#each $masterUsuariosStore as u}
                  <option value={u.id}
                    >{u.nombre_apellido} (@{u.usuario})</option
                  >
                {/each}
              </select>
            </label>
          </div>
        </div>
      </div>

      <!-- SECCIÓN 1: Asignar Salas (Tarjetas compactas) -->
      <div
        style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;"
      >
        <h3
          style="margin: 0 0 14px 0; font-size: 15px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 8px;"
        >
          Asignar Salas a {(
            $masterUsuariosStore.find((u) => u.id === selectedUserId) || {}
          ).nombre_apellido}
        </h3>

        <div
          style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;"
        >
          {#each $masterSalasStore as sala (sala.id)}
            {@const assigned = isSalaAssigned(selectedUserId, sala.id)}
            <label
              style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #ffffff; border: 1px solid {assigned
                ? '#16a34a'
                : '#e2e8f0'}; border-radius: 8px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.03); {assigned
                ? 'background: #f0fdf4;'
                : ''}"
            >
              <input
                type="checkbox"
                checked={assigned}
                on:change={() => toggleSalaAssignment(selectedUserId, sala.id)}
                style="width: 17px; height: 17px; accent-color: #16a34a; cursor: pointer;"
              />
              <span
                style="font-size: 13px; font-weight: 700; color: {assigned
                  ? '#15803d'
                  : '#334155'};"
              >
                {sala.nombre}
              </span>
            </label>
          {/each}
        </div>
      </div>

      <!-- SECCIÓN 2: Permisología por Módulos y Acciones -->
      <div
        style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;"
      >
        <h3
          style="margin: 0 0 16px 0; font-size: 15px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 8px;"
        >
          Permisología por Módulos y Acciones
        </h3>

        <div style="display: flex; flex-direction: column; gap: 16px;">
          {#each $masterPaginasStore as pagina (pagina.id)}
            {@const modulosPage = getModulosForPage(pagina.id)}
            {@const allPageChecked = areAllPagePermsChecked(
              userPermsMap,
              pagina.id,
            )}
            {@const allPageSoloVerChecked = areAllPageSoloVerChecked(
              userPermsMap,
              pagina.id,
            )}

            <div
              style="border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; background: #ffffff;"
            >
              <!-- Cabecera Permanente de la Página -->
              <div
                style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; gap: 10px;"
              >
                <div
                  style="display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 800; color: #0f172a;"
                >
                  <span>{pagina.nombre}</span>
                </div>

                <!-- Botones de Acción Global para la Página -->
                <div
                  style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;"
                >
                  <!-- Botón de Seleccionar solo VER -->
                  <label
                    style="display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: {allPageSoloVerChecked
                      ? '#dcfce7'
                      : '#f0fdf4'}; border: 1px solid #bbf7d0; border-radius: 6px; font-size: 12px; font-weight: 800; color: #15803d; cursor: pointer;"
                  >
                    <input
                      type="checkbox"
                      checked={allPageSoloVerChecked}
                      on:change={() =>
                        toggleSelectSoloVerPagePerms(selectedUserId, pagina.id)}
                      style="width: 15px; height: 15px; accent-color: #16a34a; cursor: pointer;"
                    />
                    Seleccionar solo VER ({pagina.nombre})
                  </label>

                  <!-- Botón de Seleccionar Todo (Página entera con todas sus acciones) -->
                  <label
                    style="display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: {allPageChecked
                      ? '#dbeafe'
                      : '#eff6ff'}; border: 1px solid #93c5fd; border-radius: 6px; font-size: 12px; font-weight: 800; color: #1e40af; cursor: pointer;"
                  >
                    <input
                      type="checkbox"
                      checked={allPageChecked}
                      on:change={() =>
                        toggleSelectAllPagePerms(selectedUserId, pagina.id)}
                      style="width: 15px; height: 15px; accent-color: #2563eb; cursor: pointer;"
                    />
                    Seleccionar todo ({pagina.nombre})
                  </label>
                </div>
              </div>

              <!-- Listado de Módulos -->
              <div
                style="padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; background: #f8fafc;"
              >
                {#each modulosPage as modulo (modulo.id)}
                  {@const hasVer = isPermChecked(
                    userPermsMap,
                    modulo.id,
                    "VER",
                  )}
                  {@const allChecked = areAllPermsChecked(
                    userPermsMap,
                    modulo.id,
                  )}

                  <div
                    style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; flex-wrap: wrap; box-shadow: 0 1px 2px rgba(0,0,0,0.02);"
                  >
                    <!-- LADO IZQUIERDO: Nombre Plano del Módulo -->
                    <div
                      style="display: flex; align-items: center; gap: 8px; min-width: 180px;"
                    >
                      <span
                        style="font-size: 13.5px; font-weight: 800; color: #1e293b;"
                      >
                        {modulo.nombre}
                      </span>
                    </div>

                    <!-- LADO DERECHO: Checkboxes de Acciones -->
                    <div
                      style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"
                    >
                      <!-- VER (Visualizar) -->
                      <label
                        style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: {hasVer
                          ? '#f0fdf4'
                          : '#f8fafc'}; border: 1px solid {hasVer
                          ? '#bbf7d0'
                          : '#cbd5e1'}; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700; color: #0f172a;"
                      >
                        <input
                          type="checkbox"
                          checked={hasVer}
                          on:change={() =>
                            togglePermission(selectedUserId, modulo.id, "VER")}
                          style="width: 15px; height: 15px; accent-color: #2563eb; cursor: pointer;"
                        />
                        VER
                      </label>

                      <!-- AGREGAR -->
                      <label
                        style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'AGREGAR',
                        )
                          ? '#f0fdf4'
                          : '#f8fafc'}; border: 1px solid {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'AGREGAR',
                        )
                          ? '#bbf7d0'
                          : '#cbd5e1'}; border-radius: 6px; font-size: 12px; font-weight: 700; color: #0f172a; opacity: {hasVer
                          ? 1
                          : 0.45}; cursor: {hasVer
                          ? 'pointer'
                          : 'not-allowed'};"
                        title={hasVer
                          ? ""
                          : "Primero debes activar el permiso VER para habilitar esta acción"}
                      >
                        <input
                          type="checkbox"
                          disabled={!hasVer}
                          checked={isPermChecked(
                            userPermsMap,
                            modulo.id,
                            "AGREGAR",
                          )}
                          on:change={() =>
                            togglePermission(
                              selectedUserId,
                              modulo.id,
                              "AGREGAR",
                            )}
                          style="width: 15px; height: 15px; accent-color: #2563eb; cursor: {hasVer
                            ? 'pointer'
                            : 'not-allowed'};"
                        />
                        AGREGAR
                      </label>

                      <!-- REPORTE -->
                      <label
                        style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'REPORTE',
                        )
                          ? '#f0fdf4'
                          : '#f8fafc'}; border: 1px solid {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'REPORTE',
                        )
                          ? '#bbf7d0'
                          : '#cbd5e1'}; border-radius: 6px; font-size: 12px; font-weight: 700; color: #0f172a; opacity: {hasVer
                          ? 1
                          : 0.45}; cursor: {hasVer
                          ? 'pointer'
                          : 'not-allowed'};"
                        title={hasVer
                          ? ""
                          : "Primero debes activar el permiso VER para habilitar esta acción"}
                      >
                        <input
                          type="checkbox"
                          disabled={!hasVer}
                          checked={isPermChecked(
                            userPermsMap,
                            modulo.id,
                            "REPORTE",
                          )}
                          on:change={() =>
                            togglePermission(
                              selectedUserId,
                              modulo.id,
                              "REPORTE",
                            )}
                          style="width: 15px; height: 15px; accent-color: #2563eb; cursor: {hasVer
                            ? 'pointer'
                            : 'not-allowed'};"
                        />
                        REPORTE
                      </label>

                      <!-- EDITAR -->
                      <label
                        style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'EDITAR',
                        )
                          ? '#f0fdf4'
                          : '#f8fafc'}; border: 1px solid {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'EDITAR',
                        )
                          ? '#bbf7d0'
                          : '#cbd5e1'}; border-radius: 6px; font-size: 12px; font-weight: 700; color: #0f172a; opacity: {hasVer
                          ? 1
                          : 0.45}; cursor: {hasVer
                          ? 'pointer'
                          : 'not-allowed'};"
                        title={hasVer
                          ? ""
                          : "Primero debes activar el permiso VER para habilitar esta acción"}
                      >
                        <input
                          type="checkbox"
                          disabled={!hasVer}
                          checked={isPermChecked(
                            userPermsMap,
                            modulo.id,
                            "EDITAR",
                          )}
                          on:change={() =>
                            togglePermission(
                              selectedUserId,
                              modulo.id,
                              "EDITAR",
                            )}
                          style="width: 15px; height: 15px; accent-color: #2563eb; cursor: {hasVer
                            ? 'pointer'
                            : 'not-allowed'};"
                        />
                        EDITAR
                      </label>

                      <!-- BORRAR -->
                      <label
                        style="display: flex; align-items: center; gap: 6px; padding: 5px 10px; background: {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'BORRAR',
                        )
                          ? '#f0fdf4'
                          : '#f8fafc'}; border: 1px solid {isPermChecked(
                          userPermsMap,
                          modulo.id,
                          'BORRAR',
                        )
                          ? '#bbf7d0'
                          : '#cbd5e1'}; border-radius: 6px; font-size: 12px; font-weight: 700; color: #0f172a; opacity: {hasVer
                          ? 1
                          : 0.45}; cursor: {hasVer
                          ? 'pointer'
                          : 'not-allowed'};"
                        title={hasVer
                          ? ""
                          : "Primero debes activar el permiso VER para habilitar esta acción"}
                      >
                        <input
                          type="checkbox"
                          disabled={!hasVer}
                          checked={isPermChecked(
                            userPermsMap,
                            modulo.id,
                            "BORRAR",
                          )}
                          on:change={() =>
                            togglePermission(
                              selectedUserId,
                              modulo.id,
                              "BORRAR",
                            )}
                          style="width: 15px; height: 15px; accent-color: #2563eb; cursor: {hasVer
                            ? 'pointer'
                            : 'not-allowed'};"
                        />
                        BORRAR
                      </label>

                      <!-- SELECCIONAR TODOS (Del módulo) -->
                      <label
                        style="display: flex; align-items: center; gap: 5px; padding: 5px 10px; background: {allChecked
                          ? '#dbeafe'
                          : '#e0f2fe'}; border: 1px solid #7dd3fc; border-radius: 6px; font-size: 11.5px; font-weight: 800; color: #0369a1; cursor: pointer;"
                      >
                        <input
                          type="checkbox"
                          checked={allChecked}
                          on:change={() =>
                            toggleSelectAllPerms(selectedUserId, modulo.id)}
                          style="width: 15px; height: 15px; accent-color: #0284c7; cursor: pointer;"
                        />
                        Seleccionar todos
                      </label>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Bottom Save Button & Configured User Info -->
      <div
        style="display: flex; align-items: center; justify-content: flex-end; gap: 14px; padding-top: 14px; border-top: 1px solid #e2e8f0; flex-wrap: wrap;"
      >
        <div style="font-size: 13px; color: #64748b; font-weight: 600;">
          Configurando para: <span style="color: #2563eb; font-weight: 800;"
            >{($masterUsuariosStore.find((u) => u.id === selectedUserId) || {})
              .nombre_apellido}</span
          >
        </div>

        <button
          on:click={handleSavePermissions}
          type="button"
          class="btn-flow"
          style="padding: 10px 20px; font-weight: 800; font-size: 13.5px; background: linear-gradient(135deg, #16a34a, #15803d); border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(22, 163, 74, 0.3);"
        >
          Guardar Configuración
        </button>
      </div>
    </div>
  {:else if activeTab === "agente"}
    <!-- Agente WISI Sync Configurator Multi-Sala -->
    <div
      style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); padding: 24px; color: #0f172a;"
    >
      <!-- Top Title Header -->
      <div
        style="margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;"
      >
        <h2
          style="margin: 0 0 6px 0; font-size: 18px; font-weight: 800; color: #1e293b;"
        >
          Configurador y Generador del Agente WISI Sync (Servicio PM2
          Multi-Sala)
        </h2>
        <p style="margin: 0; font-size: 13px; color: #64748b;">
          Selecciona los biométricos de cada sala y genera el paquete instalador
          (.ZIP) con servidor Node.js y script `.bat` para ejecutar en segundo
          plano con PM2.
        </p>
      </div>

      <!-- Configuración Global del Servicio (Puerto, Intervalo, URL) -->
      <div
        style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;"
      >
        <div>
          <label
            style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;"
          >
            Puerto Local del Agente (PM2)
            <input
              type="number"
              bind:value={agentLocalPort}
              placeholder="Ej. 3030"
              style="width: 100%; padding: 8px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; outline: none; margin-top: 4px; display: block;"
            />
          </label>
        </div>

        <div>
          <label
            style="font-size: 11px; font-weight: 800; color: #2563eb; text-transform: uppercase; display: block; margin-bottom: 4px;"
          >
            IP Local de la PC del Agente
            <input
              type="text"
              bind:value={agentLocalIp}
              placeholder="Ej. 40.100.1.50"
              style="width: 100%; padding: 8px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #93c5fd; background: #eff6ff; color: #1e40af; outline: none; margin-top: 4px; display: block;"
            />
          </label>
        </div>

        <div>
          <label
            style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;"
          >
            Hora Inicio Barrido
            <input
              type="time"
              bind:value={agentDailySyncStart}
              style="width: 100%; padding: 8px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; outline: none; margin-top: 4px; display: block;"
            />
          </label>
        </div>

        <div>
          <label
            style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;"
          >
            Hora Fin Barrido
            <input
              type="time"
              bind:value={agentDailySyncEnd}
              style="width: 100%; padding: 8px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; outline: none; margin-top: 4px; display: block;"
            />
          </label>
        </div>

        <div>
          <label
            style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;"
          >
            Intervalo por Dispositivo
            <select
              bind:value={agentSyncInterval}
              style="width: 100%; padding: 8px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; outline: none; cursor: pointer; margin-top: 4px; display: block;"
            >
              <option value={5}>5 Minutos</option>
              <option value={10}>10 Minutos</option>
              <option value={30}>30 Minutos</option>
              <option value={60}>1 Hora</option>
            </select>
          </label>
        </div>

        <div>
          <label
            style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;"
          >
            ENDPOINT EN LA NUBE
            <input
              type="text"
              value={AGENT_SYNC_ENDPOINT_URL}
              readonly
              style="width: 100%; padding: 8px 12px; font-size: 13px; font-weight: 700; font-family: monospace; border-radius: 8px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; cursor: not-allowed; outline: none; margin-top: 4px; display: block;"
            />
          </label>
        </div>
      </div>

      <!-- Header de Sección: Biométricos por Sala y Botón Global -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 12px;"
      >
        <h3
          style="margin: 0; font-size: 15px; font-weight: 800; color: #1e293b;"
        >
          Biométricos por Sala ({$masterDispositivosStore.length})
        </h3>

        <label
          style="display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: {allGlobalChecked
            ? '#dbeafe'
            : '#eff6ff'}; border: 1px solid #93c5fd; border-radius: 6px; font-size: 12px; font-weight: 800; color: #1e40af; cursor: pointer;"
        >
          <input
            type="checkbox"
            checked={allGlobalChecked}
            on:change={toggleGlobalAllDevices}
            style="width: 15px; height: 15px; accent-color: #2563eb; cursor: pointer;"
          />
          Seleccionar todo (TODOS LOS BIOMÉTRICOS)
        </label>
      </div>

      <!-- SECCIÓN: Biométricos Agrupados por Sala -->
      <div
        style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px;"
      >
        {#each $masterSalasStore as sala (sala.id)}
          {@const devicesInSala = getDevicesForSala(sala.id)}
          {@const allSalaChecked = isSalaFullyChecked(
            sala.id,
            selectedAgentDeviceMap,
            $masterDispositivosStore,
          )}

          <div
            style="border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; background: #ffffff;"
          >
            <!-- Cabecera de la Sala -->
            <div
              style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; gap: 10px;"
            >
              <div
                style="display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 800; color: #0f172a;"
              >
                <span>{sala.nombre}</span>
                <span
                  style="font-size: 11px; padding: 2px 8px; background: #e2e8f0; border-radius: 12px; color: #475569; font-weight: 700;"
                >
                  {getGrupoNombre(sala.grupo_id)}
                </span>
              </div>

              {#if devicesInSala.length > 0}
                <label
                  style="display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: {allSalaChecked
                    ? '#dbeafe'
                    : '#eff6ff'}; border: 1px solid #93c5fd; border-radius: 6px; font-size: 12px; font-weight: 800; color: #1e40af; cursor: pointer;"
                >
                  <input
                    type="checkbox"
                    checked={allSalaChecked}
                    on:change={() => toggleSalaAllDevices(sala.id)}
                    style="width: 15px; height: 15px; accent-color: #2563eb; cursor: pointer;"
                  />
                  Seleccionar todo ({sala.nombre})
                </label>
              {/if}
            </div>

            <!-- Listado de Biométricos de esta Sala -->
            <div style="padding: 14px 16px; background: #f8fafc;">
              {#if devicesInSala.length === 0}
                <div
                  style="padding: 12px; text-align: center; color: #94a3b8; font-size: 12.5px; font-style: italic;"
                >
                  No hay biométricos registrados en esta sala.
                </div>
              {:else}
                <div
                  style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;"
                >
                  {#each devicesInSala as device (device.id)}
                    {@const isChecked = !!selectedAgentDeviceMap[device.id]}
                    <label
                      style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: #ffffff; border: 1px solid {isChecked
                        ? '#2563eb'
                        : '#e2e8f0'}; border-radius: 8px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.02); {isChecked
                        ? 'background: #eff6ff;'
                        : ''}"
                    >
                      <div
                        style="display: flex; align-items: center; gap: 10px; width: 100%;"
                      >
                        <input
                          type="checkbox"
                          bind:checked={selectedAgentDeviceMap[device.id]}
                          style="width: 16px; height: 16px; accent-color: #2563eb; cursor: pointer;"
                        />
                        <div style="flex: 1;">
                          <div
                            style="font-size: 13px; font-weight: 700; color: #0f172a;"
                          >
                            {device.nombre}
                          </div>
                          <div
                            style="font-size: 11px; font-family: monospace; color: #64748b; margin-top: 2px;"
                          >
                            Remota: {device.ip_remota || "—"} | Local: {device.ip_local ||
                              "—"}
                          </div>
                        </div>
                      </div>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Resumen del Paquete a Generar & Botón de Descarga -->
      <div
        style="background: #1e293b; color: #f8fafc; border-radius: 10px; padding: 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;"
      >
        <div>
          <div
            style="font-size: 14px; font-weight: 800; color: #60a5fa; margin-bottom: 6px;"
          >
            Resumen del Agente WISI Sync Multi-Sala
          </div>
          <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.6;">
            • <strong>Biométricos Seleccionados:</strong>
            {Object.values(selectedAgentDeviceMap).filter(Boolean).length} dispositivo(s)<br
            />
            • <strong>Servicio Local PM2:</strong> Puerto {agentLocalPort} | IP Agente:
            {agentLocalIp || "40.100.1.50"} | Ventana Barrido: {agentDailySyncStart}
            a {agentDailySyncEnd} | Intervalo: {agentSyncInterval} min.<br />
            • <strong>Configuración HTTP Listening en Biométricos:</strong><br
            />
            &nbsp;&nbsp;&nbsp;&nbsp;📡 <strong>Event Alarm IP:</strong>
            <span
              style="color: #60a5fa; font-family: monospace; font-weight: 700;"
              >{agentLocalIp || "40.100.1.50"}</span
            >
            &nbsp;|&nbsp; 📡 <strong>URL:</strong>
            <span
              style="color: #60a5fa; font-family: monospace; font-weight: 700;"
              >/api/attlogs/sync</span
            >
            &nbsp;|&nbsp; 📡 <strong>Puerto:</strong>
            <span
              style="color: #60a5fa; font-family: monospace; font-weight: 700;"
              >{agentLocalPort}</span
            > &nbsp;|&nbsp;
          </div>
        </div>

        <button
          on:click={handleGenerateAgentZip}
          type="button"
          class="btn-flow"
          style="padding: 12px 24px; font-weight: 800; font-size: 14px; background: linear-gradient(135deg, #2563eb, #1d4ed8); border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.4); white-space: nowrap;"
        >
          Generar y Descargar Agente (ZIP)
        </button>
      </div>
    </div>
  {:else if activeTab === "configuracion"}
    <!-- Tab de Configuración de Sistema -->
    <div
      style="background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 28px; max-width: 680px; margin: 0 auto; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);"
    >
      <div
        style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;"
      >
        <span style="font-size: 24px;">⚙️</span>
        <div>
          <h2
            style="margin: 0; font-size: 20px; font-weight: 800; color: #f8fafc;"
          >
            Ajustes del Sistema y Zona Horaria
          </h2>
          <span style="font-size: 13px; color: #94a3b8;">
            Configuración global de visualización para marcajes en vivo y
            reportes
          </span>
        </div>
      </div>

      <p
        style="color: #cbd5e1; font-size: 13.5px; margin-bottom: 24px; line-height: 1.6; background: #0f172a; padding: 14px 18px; border-radius: 8px; border-left: 4px solid #2563eb;"
      >
        💡 <strong>Almacenamiento Estándar UTC:</strong> Todos los marcajes se guardan
        internamente en la base de datos PostgreSQL en formato UTC 0. Selecciona
        a continuación tu zona horaria preferida para proyectar las horas de forma
        precisa en la Web.
      </p>

      <div style="margin-bottom: 24px;">
        <label
          for="timezone-select"
          style="display: block; font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;"
        >
          Zona Horaria de Visualización
        </label>
        <select
          id="timezone-select"
          bind:value={selectedTimezone}
          style="width: 100%; padding: 12px 16px; background: #0f172a; border: 1px solid #475569; border-radius: 10px; color: #f8fafc; font-size: 14.5px; font-weight: 600; outline: none; cursor: pointer;"
        >
          <option value="America/Caracas"
            >🇻🇪 Venezuela (UTC-4) — America/Caracas</option
          >
          <option value="America/Bogota"
            >🇨🇴 Colombia / Perú (UTC-5) — America/Bogota</option
          >
          <option value="America/Santo_Domingo"
            >🇩🇴 República Dominicana (UTC-4) — America/Santo_Domingo</option
          >
          <option value="America/New_York"
            >🇺🇸 EE.UU. Este (UTC-5/UTC-4 EST) — America/New_York</option
          >
          <option value="UTC">🌐 Estándar Internacional UTC (UTC+00:00)</option>
        </select>
      </div>

      <!-- Sección: Parámetros Predeterminados para HTTP Listening (ISAPI) -->
      <div
        style="margin-top: 28px; padding-top: 24px; border-top: 1px solid #334155; margin-bottom: 24px;"
      >
        <div
          style="display: flex; align-items: center; gap: 10px; margin-bottom: 16px;"
        >
          <span style="font-size: 20px;">⚡</span>
          <div>
            <h3
              style="margin: 0; font-size: 16px; font-weight: 800; color: #f8fafc;"
            >
              Parámetros de Inyección HTTP Listening (ISAPI)
            </h3>
            <span style="font-size: 12px; color: #94a3b8;">
              Valores guardados en la tabla 'configuracion' de PostgreSQL
            </span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <label
              for="isapi-ip-domain"
              style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;"
            >
              * IP / Dominio Inyección Hikvision (`isapi_ip_domain`)
            </label>
            <input
              id="isapi-ip-domain"
              type="text"
              bind:value={systemConfig.isapi_ip_domain}
              style="width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 10px; color: #38bdf8; font-size: 14px; font-weight: 700; font-family: monospace; outline: none;"
              placeholder="190.72.102.210"
            />
          </div>

          <div>
            <label
              for="isapi-url-path"
              style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;"
            >
              * Ruta URL Receptora (`isapi_url`)
            </label>
            <input
              id="isapi-url-path"
              type="text"
              bind:value={systemConfig.isapi_url}
              style="width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 10px; color: #38bdf8; font-size: 14px; font-weight: 700; font-family: monospace; outline: none;"
              placeholder="/api/attlogs/sync"
            />
          </div>

          <div
            style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;"
          >
            <div>
              <label
                for="isapi-port-no"
                style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;"
              >
                * Puerto (`isapi_port`)
              </label>
              <input
                id="isapi-port-no"
                type="number"
                bind:value={systemConfig.isapi_port}
                style="width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 10px; color: #38bdf8; font-size: 14px; font-weight: 700; font-family: monospace; outline: none;"
                placeholder="8015"
              />
            </div>

            <div>
              <label
                for="isapi-protocol-select"
                style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;"
              >
                * Protocolo (`isapi_protocol`)
              </label>
              <select
                id="isapi-protocol-select"
                bind:value={systemConfig.isapi_protocol}
                style="width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #475569; border-radius: 10px; color: #f8fafc; font-size: 14px; font-weight: 700; outline: none; cursor: pointer;"
              >
                <option value="HTTP">HTTP</option>
                <option value="HTTPS">HTTPS</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button
          on:click={saveSystemConfig}
          disabled={isSavingConfig}
          type="button"
          class="btn-flow"
          style="padding: 12px 24px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; border: none; border-radius: 10px; font-weight: 800; font-size: 14px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);"
        >
          {isSavingConfig
            ? "Guardando Ajustes..."
            : "💾 Guardar Configuración en PostgreSQL"}
        </button>
      </div>
    </div>
  {:else}
    <!-- Table Container Card for Other 5 Entities -->
    <div
      style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); overflow: hidden; color: #0f172a;"
    >
      <!-- Top Toolbar: Full Width Search & Header Button -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;"
      >
        <div
          style="position: relative; display: flex; align-items: center; width: 100%; max-width: 600px;"
        >
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Buscar en {activeTab}..."
            style="width: 100%; padding: 8px 12px 8px 34px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13.5px; outline: none;"
          />
          <span
            style="position: absolute; left: 12px; font-size: 14px; color: #94a3b8; pointer-events: none;"
            >🔍</span
          >
        </div>

        <button
          on:click={openCreateModal}
          type="button"
          class="btn-flow"
          style="padding: 9px 18px; font-size: 13px; font-weight: 700; white-space: nowrap;"
        >
          Nuevo registro
        </button>
      </div>

      <!-- Table Section -->
      <div style="overflow-x: auto;">
        <table
          style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;"
        >
          <thead>
            <tr
              style="background: #f1f5f9; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;"
            >
              <th style="padding: 10px 14px;">ID</th>

              {#if activeTab === "salas"}
                <th style="padding: 10px 14px;">Nombre de la Sala / Sucursal</th
                >
                <th style="padding: 10px 14px;">Nombre Comercial</th>
                <th style="padding: 10px 14px;"
                  >Tipo Instalación (SALA / GALPÓN)</th
                >
                <th style="padding: 10px 14px;">RIF</th>
                <th style="padding: 10px 14px;">Ubicación</th>
                <th style="padding: 10px 14px;">Correo</th>
                <th style="padding: 10px 14px;">Teléfono</th>
              {:else if activeTab === "paginas"}
                <th style="padding: 10px 14px;">Nombre de la Página</th>
                <th style="padding: 10px 14px; text-align: center;"
                  >Módulos / Orden</th
                >
              {:else if activeTab === "modulos"}
                <th style="padding: 10px 14px;">Nombre del Módulo</th>
                <th style="padding: 10px 14px;">Página Asociada (Foránea)</th>
                <th style="padding: 10px 14px;">Ruta URL</th>
              {:else if activeTab === "dispositivos"}
                <th style="padding: 10px 14px;">Nombre Dispositivo</th>
                <th style="padding: 10px 14px;">Sala Pertenece (Foránea)</th>
                <th style="padding: 10px 14px;">IP Local</th>
                <th style="padding: 10px 14px;">IP Remota</th>
                <th style="padding: 10px 14px;">IP Panel Remota</th>
                <th style="padding: 10px 14px;">Usuario</th>
                <th style="padding: 10px 14px;">Clave</th>
              {:else if activeTab === "usuarios"}
                <th style="padding: 10px 14px;">Nombre y Apellido</th>
                <th style="padding: 10px 14px;">Usuario</th>
                <th style="padding: 10px 14px;">Contraseña</th>
              {/if}

              <th style="padding: 10px 14px; text-align: right;">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {#each filteredItems as item (item.id)}
              {@const isEditing = editingInlineId === item.id}
              <tr
                style="border-bottom: 1px solid #f1f5f9; background: {isEditing
                  ? '#f0f9ff'
                  : '#ffffff'};"
              >
                <td
                  style="padding: 8px 14px; font-family: monospace; color: #334155; font-weight: 600;"
                  >#{item.id}</td
                >

                {#if activeTab === "salas"}
                  <td style="padding: 8px 14px; font-weight: 700;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.nombre}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.nombre}</span>{/if}</td
                  >
                  <td style="padding: 8px 14px;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.nombre_comercial}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.nombre_comercial || "—"}</span
                      >{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; font-weight: 700; color: #334155;"
                  >
                    {#if isEditing}
                      <select
                        bind:value={inlineDraft.grupo_id}
                        style="padding: 4px 6px; border-radius: 4px; border: 1px solid #cbd5e1; font-weight: 700;"
                      >
                        <option value={1}>SALA</option>
                        <option value={2}>GALPÓN</option>
                      </select>
                    {:else}
                      <span>{getGrupoNombre(item.grupo_id)}</span>
                    {/if}
                  </td>
                  <td style="padding: 8px 14px;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.rif}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.rif || "—"}</span>{/if}</td
                  >
                  <td style="padding: 8px 14px;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.ubicacion}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.ubicacion || "—"}</span>{/if}</td
                  >
                  <td style="padding: 8px 14px;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.correo}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.correo || "—"}</span>{/if}</td
                  >
                  <td style="padding: 8px 14px;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.telefono}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.telefono || "—"}</span>{/if}</td
                  >
                {:else if activeTab === "paginas"}
                  <td style="padding: 8px 14px; font-weight: 700;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.nombre}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.nombre}</span>{/if}</td
                  >
                  <td style="padding: 8px 14px; text-align: center;">
                    <button
                      type="button"
                      on:click={() => openOrderModulosModal(item)}
                      style="display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; border: 1.5px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(37, 99, 235, 0.08);"
                      on:mouseenter={(e) => {
                        e.currentTarget.style.background = "#dbeafe";
                        e.currentTarget.style.borderColor = "#93c5fd";
                      }}
                      on:mouseleave={(e) => {
                        e.currentTarget.style.background = "#eff6ff";
                        e.currentTarget.style.borderColor = "#bfdbfe";
                      }}
                      title="Definir el orden de los módulos de esta página"
                    >
                      <span style="font-size: 13px;">↕️</span>
                      <span
                        >Ordenar Módulos ({($masterModulosStore || []).filter(
                          (m) => Number(m.page_id) === Number(item.id),
                        ).length})</span
                      >
                    </button>
                  </td>
                {:else if activeTab === "modulos"}
                  <td style="padding: 8px 14px; font-weight: 700;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.nombre}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.nombre}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; color: #2563eb; font-weight: 600;"
                  >
                    {#if isEditing}
                      <select
                        bind:value={inlineDraft.page_id}
                        style="padding: 4px 6px; border-radius: 4px; border: 1px solid #cbd5e1;"
                      >
                        {#each $masterPaginasStore as p}<option value={p.id}
                            >{p.nombre}</option
                          >{/each}
                      </select>
                    {:else}
                      <span>{getPaginaNombre(item.page_id)}</span>
                    {/if}
                  </td>
                  <td
                    style="padding: 8px 14px; font-family: monospace; color: #2563eb;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.ruta}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.ruta}</span>{/if}</td
                  >
                {:else if activeTab === "dispositivos"}
                  <td style="padding: 8px 14px; font-weight: 700;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.nombre}
                        class="form-input"
                        style="padding: 3px 6px; font-size: 12.5px;"
                      />{:else}<span>{item.nombre}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; color: #2563eb; font-weight: 600;"
                  >
                    {#if isEditing}
                      <select
                        bind:value={inlineDraft.sala_id}
                        style="padding: 4px 6px; border-radius: 4px; border: 1px solid #cbd5e1; font-size: 12.5px;"
                      >
                        {#each $masterSalasStore as s}<option value={s.id}
                            >{s.nombre}</option
                          >{/each}
                      </select>
                    {:else}
                      <span>{getSalaNombre(item.sala_id)}</span>
                    {/if}
                  </td>
                  <td
                    style="padding: 8px 14px; font-family: monospace; color: #475569;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.ip_local}
                        class="form-input"
                        style="padding: 3px 6px; font-size: 12.5px;"
                      />{:else}<span>{item.ip_local || "—"}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; font-family: monospace; color: #2563eb; font-weight: 600;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.ip_remota}
                        class="form-input"
                        style="padding: 3px 6px; font-size: 12.5px;"
                      />{:else}<span>{item.ip_remota || "—"}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; font-family: monospace; color: #059669; font-weight: 600;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.ip_panel}
                        class="form-input"
                        style="padding: 3px 6px; font-size: 12.5px;"
                      />{:else}<span>{item.ip_panel || "—"}</span>{/if}</td
                  >
                  <td style="padding: 8px 14px;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.usuario}
                        class="form-input"
                        style="padding: 3px 6px; font-size: 12.5px;"
                      />{:else}<span>{item.usuario || "admin"}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; font-family: monospace; color: #ef4444;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.clave}
                        class="form-input"
                        style="padding: 3px 6px; font-size: 12.5px;"
                      />{:else}<span>{item.clave || "••••••"}</span>{/if}</td
                  >
                {:else if activeTab === "usuarios"}
                  <td style="padding: 8px 14px; font-weight: 700;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.nombre_apellido}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>{item.nombre_apellido}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; font-weight: 700; font-family: monospace; color: #2563eb;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.usuario}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>@{item.usuario}</span>{/if}</td
                  >
                  <td
                    style="padding: 8px 14px; font-family: monospace; color: #64748b;"
                    >{#if isEditing}<input
                        bind:value={inlineDraft.password}
                        class="form-input"
                        style="padding: 3px 6px;"
                      />{:else}<span>••••••</span>{/if}</td
                  >
                {/if}

                <!-- Actions -->
                <td
                  style="padding: 8px 14px; text-align: right; white-space: nowrap;"
                >
                  {#if isEditing}
                    <button
                      on:click={() => saveInlineEdit(item.id)}
                      type="button"
                      class="btn-flow-sec"
                      style="padding: 4px 8px; font-size: 12px;"
                      title="Guardar">💾</button
                    >
                    <button
                      on:click={() => (editingInlineId = null)}
                      type="button"
                      class="btn-flow-sec"
                      style="padding: 4px 8px; font-size: 12px;"
                      title="Cancelar">❌</button
                    >
                  {:else}
                    {#if activeTab === "dispositivos"}
                      <button
                        on:click={() => executeDirectIsapiInjection(item)}
                        type="button"
                        class="btn-flow-sec"
                        style="padding: 4px 8px; font-size: 12px; color: #dc2626; border-color: #fca5a5; background: #fef2f2; font-weight: 700; gap: 4px;"
                        disabled={injectingDeviceId === item.id}
                        title="Inyectar parámetros guardados en Configuración directamente al biométrico"
                      >
                        {#if injectingDeviceId === item.id}
                          ⏳ Inyectando...
                        {:else}
                          ⚡ HTTP Listener
                        {/if}
                      </button>
                    {/if}
                    <button
                      on:click={() => startInlineEdit(item)}
                      type="button"
                      class="btn-flow-sec"
                      style="padding: 4px 8px; font-size: 12px;"
                      title="Editar">Editar</button
                    >
                    <button
                      on:click={() => promptDelete(item)}
                      type="button"
                      class="btn-flow-sec"
                      style="padding: 4px 8px; font-size: 12px; color: #ef4444; border-color: #fca5a5;"
                      title="Eliminar">Eliminar</button
                    >
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Table Footer -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 13px; color: #475569;"
      >
        <div>
          Total Registros en {activeTab}:
          <strong style="color: #0f172a;">{filteredItems.length}</strong>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- Modal para Crear Registro -->
{#if isCreateModalOpen}
  <div
    style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 16px;"
  >
    <div
      style="background: #ffffff; border-radius: 12px; width: 100%; max-width: 520px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); border: 1px solid #e2e8f0; color: #0f172a;"
    >
      <div
        style="padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background: #f8fafc;"
      >
        <h3 style="margin: 0; font-size: 15px; font-weight: 800;">
          Nuevo registro
        </h3>
        <button
          on:click={() => (isCreateModalOpen = false)}
          type="button"
          style="background: none; border: none; font-size: 18px; cursor: pointer; color: #94a3b8;"
          >✕</button
        >
      </div>

      <div
        style="padding: 20px; display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow-y: auto;"
      >
        {#if activeTab === "salas"}
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Nombre de la Sala / Sucursal
              <input
                bind:value={createForm.nombre}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. Casino Royal PLC"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Nombre Comercial
              <input
                bind:value={createForm.nombre_comercial}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. Casino Royal, C.A."
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Tipo Instalación (SALA / GALPÓN)
              <select
                bind:value={createForm.grupo_id}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 700;"
              >
                <option value={1}>SALA (Casino / Sala de Juego)</option>
                <option value={2}>GALPÓN (Depósito / Almacén)</option>
              </select>
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              RIF
              <input
                bind:value={createForm.rif}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. J-12345678-9"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Ubicación
              <input
                bind:value={createForm.ubicacion}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
              />
            </label>
          </div>
        {:else if activeTab === "paginas"}
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Nombre de la Página
              <input
                bind:value={createForm.nombre}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. AUDITORÍA"
              />
            </label>
          </div>
        {:else if activeTab === "modulos"}
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Nombre del Módulo
              <input
                bind:value={createForm.nombre}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. Bitácora de Eventos"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Página Asociada (Foránea)
              <select
                bind:value={createForm.page_id}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
              >
                {#each $masterPaginasStore as p}<option value={p.id}
                    >{p.nombre}</option
                  >{/each}
              </select>
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Ruta URL
              <input
                bind:value={createForm.ruta}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. /cecom/bitacora"
              />
            </label>
          </div>
        {:else if activeTab === "dispositivos"}
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Nombre del Dispositivo
              <input
                bind:value={createForm.nombre}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. Puerta Servidores ( Marques )"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Sala Pertenece (Foránea)
              <select
                bind:value={createForm.sala_id}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
              >
                {#each $masterSalasStore as s}<option value={s.id}
                    >{s.nombre}</option
                  >{/each}
              </select>
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              IP Local
              <input
                bind:value={createForm.ip_local}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. 190.153.101.14:8070"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              IP Remota
              <input
                bind:value={createForm.ip_remota}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. 190.153.101.14:8087"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              IP Panel Remota
              <input
                bind:value={createForm.ip_panel}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. 190.153.101.14:8090"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Usuario
              <input
                bind:value={createForm.usuario}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Clave
              <input
                bind:value={createForm.clave}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
              />
            </label>
          </div>
        {:else if activeTab === "usuarios"}
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Nombre y Apellido
              <input
                bind:value={createForm.nombre_apellido}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. Anthony Silva"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Usuario
              <input
                bind:value={createForm.usuario}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="Ej. anthony"
              />
            </label>
          </div>
          <div>
            <label
              style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;"
            >
              Contraseña
              <input
                type="password"
                bind:value={createForm.password}
                class="form-input"
                style="width: 100%; padding: 7px 10px; font-size: 13px; margin-top: 4px; display: block; font-weight: 400;"
                placeholder="••••••"
              />
            </label>
          </div>
        {/if}
      </div>

      <div
        style="padding: 14px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; align-items: center; justify-content: flex-end; gap: 10px;"
      >
        <button
          on:click={() => (isCreateModalOpen = false)}
          type="button"
          class="btn-flow-sec"
          style="padding: 7px 14px; font-size: 13px;">Cancelar</button
        >
        <button
          on:click={handleSaveCreate}
          type="button"
          class="btn-flow"
          style="padding: 7px 16px; font-size: 13px; font-weight: 700;"
          >Guardar Nuevo</button
        >
      </div>
    </div>
  </div>
{/if}

<!-- Styled Delete Confirmation Modal -->
<DeleteModal
  isOpen={isDeleteModalOpen}
  item={itemToDelete}
  entityType={getSingularEntity(activeTab)}
  on:confirm={handleConfirmDelete}
  on:close={() => (isDeleteModalOpen = false)}
/>

<BlockedDeleteModal
  isOpen={isBlockedModalOpen}
  {blockedData}
  on:close={() => (isBlockedModalOpen = false)}
/>

<!-- Modal para Ordenar Módulos con Drag & Drop -->
<OrderModulosModal
  show={isOrderModulosModalOpen}
  pagina={selectedPaginaToOrder}
  modulos={$masterModulosStore}
  on:saved={() => loadMasterStoresFromBackend()}
  on:close={() => {
    isOrderModulosModalOpen = false;
    selectedPaginaToOrder = null;
  }}
/>

<!-- Modal Inyectar HTTP Listening (ISAPI / Network Service) -->
{#if isIsapiModalOpen}
  <div
    style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px;"
  >
    <div
      style="background: #ffffff; border-radius: 16px; width: 100%; max-width: 520px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); overflow: hidden; font-family: system-ui, sans-serif;"
    >
      <div
        style="padding: 16px 20px; background: #0f172a; color: #ffffff; display: flex; align-items: center; justify-content: space-between;"
      >
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 20px;">⚡</span>
          <div>
            <h3
              style="margin: 0; font-size: 15px; font-weight: 800; color: #ffffff;"
            >
              Inyectar HTTP Listening (ISAPI Digest)
            </h3>
            <p style="margin: 2px 0 0 0; font-size: 11.5px; color: #94a3b8;">
              Configuración remota de red para biométricos Hikvision
            </p>
          </div>
        </div>
        <button
          on:click={() => (isIsapiModalOpen = false)}
          type="button"
          style="background: transparent; border: none; color: #94a3b8; font-size: 18px; cursor: pointer;"
          >✕</button
        >
      </div>

      <div
        style="padding: 20px; display: flex; flex-direction: column; gap: 14px;"
      >
        <div
          style="padding: 10px 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 12px;"
        >
          <div
            style="display: flex; justify-content: space-between; margin-bottom: 4px;"
          >
            <strong style="color: #0f172a;">Dispositivo:</strong>
            <span style="color: #2563eb; font-weight: 700;"
              >{isapiSelectedDevice?.nombre}</span
            >
            (#{isapiSelectedDevice?.id})
          </div>
          <div style="display: flex; justify-content: space-between;">
            <strong style="color: #0f172a;">IP Destino ISAPI:</strong>
            <span
              style="font-family: monospace; color: #059669; font-weight: 700;"
              >{isapiSelectedDevice?.ip_remota ||
                isapiSelectedDevice?.ip_local ||
                "127.0.0.1"}</span
            >
          </div>
        </div>

        <div>
          <label
            style="display: block; font-size: 11.5px; font-weight: 800; color: #334155; text-transform: uppercase; margin-bottom: 4px;"
          >
            * Event Alarm IP/Domain Name
          </label>
          <input
            bind:value={isapiForm.ip_domain}
            class="form-input"
            style="width: 100%; padding: 8px 12px; font-size: 13px; font-family: monospace;"
            placeholder="190.72.102.210"
          />
        </div>

        <div>
          <label
            style="display: block; font-size: 11.5px; font-weight: 800; color: #334155; text-transform: uppercase; margin-bottom: 4px;"
          >
            * URL
          </label>
          <input
            bind:value={isapiForm.url}
            class="form-input"
            style="width: 100%; padding: 8px 12px; font-size: 13px; font-family: monospace;"
            placeholder="/api/attlogs/sync"
          />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label
              style="display: block; font-size: 11.5px; font-weight: 800; color: #334155; text-transform: uppercase; margin-bottom: 4px;"
            >
              * Port
            </label>
            <input
              type="number"
              bind:value={isapiForm.port}
              class="form-input"
              style="width: 100%; padding: 8px 12px; font-size: 13px; font-family: monospace;"
              placeholder="8015"
            />
          </div>

          <div>
            <label
              style="display: block; font-size: 11.5px; font-weight: 800; color: #334155; text-transform: uppercase; margin-bottom: 4px;"
            >
              * Protocol
            </label>
            <div
              style="display: flex; align-items: center; gap: 16px; padding: 7px 0;"
            >
              <label
                style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; cursor: pointer; color: #0f172a;"
              >
                <input
                  type="radio"
                  bind:group={isapiForm.protocol}
                  value="HTTP"
                /> HTTP
              </label>
              <label
                style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; cursor: pointer; color: #0f172a;"
              >
                <input
                  type="radio"
                  bind:group={isapiForm.protocol}
                  value="HTTPS"
                /> HTTPS
              </label>
            </div>
          </div>
        </div>
      </div>

      <div
        style="padding: 14px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; align-items: center; justify-content: flex-end; gap: 10px;"
      >
        <button
          on:click={() => (isIsapiModalOpen = false)}
          type="button"
          class="btn-flow-sec"
          style="padding: 7px 14px; font-size: 13px;">Cancelar</button
        >
        <button
          on:click={submitIsapiInjection}
          disabled={isapiSubmitting}
          type="button"
          class="btn-flow"
          style="padding: 7px 16px; font-size: 13px; font-weight: 800; background: #dc2626; border-color: #b91c1c; color: #ffffff;"
        >
          {#if isapiSubmitting}
            ⏳ Enviando por ISAPI (Digest)...
          {:else}
            🚀 Inyectar por ISAPI (Digest)
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
