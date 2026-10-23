<script>
  import { onMount, onDestroy } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { masterSalasStore, userSalasStore as masterUserSalasStore } from "../../controllers/master.store.js";
  import { currentUserStore, userSalasStore as authUserSalasStore } from "../../controllers/auth.store.js";
  import { getDispositivosCamaras, getCamaras } from "../../services/cecomVideo.service.js";
  import { isTauriWindows } from "../../services/tauriIsapi.service.js";
  import { 
    getCecomDefaultPaths, 
    startCecomVideoDownload, 
    listenDownloadProgress, 
    openMediaFile, 
    showInFolder, 
    promptSaveVideoDialog,
    promptSelectFolderDialog
  } from "../../services/tauriVideo.service.js";

  let salas = [];
  let selectedSalaUuid = "";
  let dispositivos = [];
  let camaras = [];
  let selectedCameraUuids = [];
  let camaraSearchQuery = "";

  // Zona horaria estándar de Venezuela (America/Caracas -4)
  function getCaracasNow() {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = {};
    for (const p of formatter.formatToParts(d)) {
      parts[p.type] = p.value;
    }
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: hour.padStart(2, '0'),
      minute: parts.minute.padStart(2, '0'),
      second: parts.second.padStart(2, '0'),
      dateStr: `${parts.year}-${parts.month}-${parts.day}`,
      timeStr: `${hour.padStart(2, '0')}:${parts.minute.padStart(2, '0')}:${parts.second.padStart(2, '0')}`
    };
  }

  function formatDmy(dateStr) {
    if (!dateStr || typeof dateStr !== 'string' || !dateStr.includes('-')) return dateStr || '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function getLocalDateStr(offsetDays = 0) {
    const c = getCaracasNow();
    const d = new Date(Number(c.year), Number(c.month) - 1, Number(c.day));
    if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function changeDateBy(days) {
    if (!fecha) {
      fecha = getLocalDateStr();
      return;
    }
    const [y, m, d] = fecha.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() + days);

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const nextFecha = `${year}-${month}-${day}`;

    const todayStr = getLocalDateStr();
    if (nextFecha > todayStr) {
      fecha = todayStr;
      return;
    }
    fecha = nextFecha;
  }

  // Parámetros de descarga
  let fecha = getLocalDateStr();
  let horaInicio = "12:00:00";
  let horaFin = "12:30:00";
  let streamType = "main"; // main (Principal 1080p/4K) o sub (Secundario rápido)
  let unificarVideos = false; // Interruptor para unificar videos en un solo archivo

  // Detección de cruce de días (empieza un día y termina en la madrugada del día siguiente)
  $: isCruceDias = Boolean(horaInicio && horaFin && horaFin <= horaInicio);

  // Fecha del día de cierre
  $: fechaCierre = (() => {
    if (!fecha) return "";
    if (isCruceDias) {
      const [y, m, d] = fecha.split('-').map(Number);
      const nextDay = new Date(y, m - 1, d + 1);
      const yStr = nextDay.getFullYear();
      const mStr = String(nextDay.getMonth() + 1).padStart(2, '0');
      const dStr = String(nextDay.getDate()).padStart(2, '0');
      return `${yStr}-${mStr}-${dStr}`;
    }
    return fecha;
  })();

  // Validación de coherencia temporal en zona horaria America/Caracas
  $: timeValidation = (() => {
    if (!fecha || !horaInicio || !horaFin) {
      return { isValid: false, error: "Especifica la fecha y el rango de horas." };
    }

    if (horaInicio === horaFin) {
      return { isValid: false, error: "La hora de inicio y fin no pueden ser idénticas." };
    }

    const caracas = getCaracasNow();

    // 1. La fecha de inicio no puede ser futura
    if (fecha > caracas.dateStr) {
      return {
        isValid: false,
        error: `La fecha (${formatDmy(fecha)}) no puede ser futura. Hoy es ${formatDmy(caracas.dateStr)} (Caracas).`
      };
    }

    // 2. Si la fecha de inicio es HOY en Caracas:
    if (fecha === caracas.dateStr) {
      // Hora de inicio no puede superar la hora actual
      if (horaInicio > caracas.timeStr) {
        return {
          isValid: false,
          error: `Hora inicio (${horaInicio}) supera la hora actual (${caracas.timeStr} Caracas). No hay grabaciones futuras.`
        };
      }

      // No se puede cruzar al día de mañana desde hoy
      if (isCruceDias) {
        return {
          isValid: false,
          error: `No puedes cruzar a mañana (${formatDmy(fechaCierre)}) desde hoy. El grabador solo almacena hasta el presente.`
        };
      }

      // Hora fin no puede superar la hora actual de hoy
      if (horaFin > caracas.timeStr) {
        return {
          isValid: false,
          error: `Hora fin (${horaFin}) supera la hora actual de hoy (${caracas.timeStr} Caracas).`
        };
      }
    }

    // 3. Si la fecha de inicio es del PASADO:
    if (fecha < caracas.dateStr && isCruceDias) {
      // Si el cierre cae exactamente hoy:
      if (fechaCierre === caracas.dateStr) {
        if (horaFin > caracas.timeStr) {
          return {
            isValid: false,
            error: `El cierre es hoy (${formatDmy(fechaCierre)}) y la hora fin (${horaFin}) supera la hora actual (${caracas.timeStr} Caracas).`
          };
        }
      } else if (fechaCierre > caracas.dateStr) {
        return {
          isValid: false,
          error: `La fecha de cierre (${formatDmy(fechaCierre)}) no puede ser futura.`
        };
      }
    }

    return { isValid: true, error: null };
  })();

  $: isRangeValid = timeValidation.isValid;
  $: rangeError = timeValidation.error;

  let isLoadingDispositivos = false;
  let isLoadingCamaras = false;

  // Rutas locales de Windows para CECOM
  let targetVideosDir = "";
  let sdkPath = "";
  let sdkAvailable = false;
  let unlistenProgress = null;

  // Cola de descargas activas en sesión
  let downloadQueue = [];

  // Obtener IDs de salas asociadas al usuario logueado
  $: assignedSalaIds = (() => {
    const user = $currentUserStore;
    const userId = user?.uuid || user?.id;

    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas
        .map((s) => (typeof s === "object" ? (s.uuid || s.id) : s))
        .filter(Boolean)
        .map(String);
    }

    const masterMap = $masterUserSalasStore;
    if (
      masterMap &&
      typeof masterMap === "object" &&
      !Array.isArray(masterMap)
    ) {
      const userList = userId ? (masterMap[userId] || masterMap[String(userId)] || (user?.id ? masterMap[user.id] : null)) : null;
      if (Array.isArray(userList) && userList.length > 0) {
        return userList
          .map((s) => (typeof s === "object" ? (s.uuid || s.id) : s))
          .filter(Boolean)
          .map(String);
      }
    }

    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? (s.uuid || s.id) : s))
        .filter(Boolean)
        .map(String);
    }

    return [];
  })();

  // Filtrar para mostrar ÚNICAMENTE las salas asociadas al usuario logueado
  $: salas = (() => {
    const all = ($masterSalasStore || []).filter(s => !s.grupo_id || Number(s.grupo_id) !== 2);

    if (assignedSalaIds && assignedSalaIds.length > 0) {
      const filtered = all.filter(s => assignedSalaIds.includes(String(s.uuid || s.id)));
      if (filtered.length > 0) return filtered;

      // Fallback si masterSalasStore aún no ha sincronizado pero authUserSalasStore tiene los objetos
      if (Array.isArray($authUserSalasStore) && $authUserSalasStore.length > 0) {
        return $authUserSalasStore.filter(s => typeof s === 'object' && (!s.grupo_id || Number(s.grupo_id) !== 2));
      }
      if ($currentUserStore && Array.isArray($currentUserStore.salas) && $currentUserStore.salas.length > 0) {
        return $currentUserStore.salas.filter(s => typeof s === 'object' && (!s.grupo_id || Number(s.grupo_id) !== 2));
      }
      return [];
    }

    if (Array.isArray($authUserSalasStore) && $authUserSalasStore.length > 0) {
      return $authUserSalasStore.filter(s => typeof s === 'object' && (!s.grupo_id || Number(s.grupo_id) !== 2));
    }

    return all;
  })();

  // Sincronizar selección de sala automáticamente con las salas asociadas del usuario
  $: {
    if (salas && salas.length > 0) {
      const exists = salas.some(s => String(s.uuid || s.id) === String(selectedSalaUuid));
      if (!exists || !selectedSalaUuid) {
        selectedSalaUuid = salas[0].uuid || salas[0].id;
        onSalaChange();
      }
    } else {
      selectedSalaUuid = "";
      dispositivos = [];
      camaras = [];
      selectedCameraUuids = [];
    }
  }

  onMount(async () => {

    // Inicializar rutas y escucha nativa en Windows
    if (isTauriWindows()) {
      const paths = await getCecomDefaultPaths();
      if (paths) {
        targetVideosDir = localStorage.getItem("cecom_custom_videos_dir") || paths.dest_dir || "";
        sdkPath = localStorage.getItem("cecom_custom_sdk_path") || paths.sdk_converter_path || "";
        sdkAvailable = paths.sdk_available || !!sdkPath;
      }

      unlistenProgress = await listenDownloadProgress((payload) => {
        downloadQueue = downloadQueue.map(item => {
          if (item.id === payload.task_id) {
            const isDone = payload.status === "completed";
            const isErr = payload.status === "error";
            return {
              ...item,
              progress: payload.percent,
              status: payload.stage,
              outputPath: payload.output_file || item.outputPath,
              canOpen: isDone,
              isError: isErr,
              errorMsg: payload.error || null
            };
          }
          return item;
        });

        if (payload.status === "completed") {
          triggerToast(`✅ Video descargado y guardado en disco: ${payload.output_file}`, "success");
        } else if (payload.status === "error") {
          triggerToast(`❌ Error en grabador/descarga: ${payload.error || "Fallo en extracción"}`, "error");
        }
      });
    }
  });

  onDestroy(() => {
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
  });

  async function onSalaChange() {
    selectedCameraUuids = [];
    camaras = [];
    dispositivos = [];

    if (!selectedSalaUuid) return;

    isLoadingDispositivos = true;
    isLoadingCamaras = true;
    try {
      const [resDevs, resCams] = await Promise.all([
        getDispositivosCamaras({ sala_uuid: selectedSalaUuid }),
        getCamaras({ sala_uuid: selectedSalaUuid })
      ]);

      if (resDevs && resDevs.success) {
        dispositivos = resDevs.data || [];
      }
      if (resCams && resCams.success) {
        camaras = resCams.data || [];
      }
    } catch (err) {
      console.error("Error al cargar dispositivos y cámaras de la sala:", err);
      triggerToast(`Error al obtener grabadores: ${err.message}`, "error");
    } finally {
      isLoadingDispositivos = false;
      isLoadingCamaras = false;
    }
  }

  // Agrupar cámaras bajo su respectivo DVR / NVR y ordenar grabadores alfanuméricamente
  $: groupedDevices = [...dispositivos]
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', undefined, { numeric: true, sensitivity: 'base' }))
    .map(dev => {
      const devId = String(dev.uuid || dev.id);
      const devCams = camaras
        .filter(c => String(c.dispositivo_camara_uuid) === devId)
        .sort((a, b) => (Number(a.numero_canal) || 0) - (Number(b.numero_canal) || 0));

      return {
        ...dev,
        camaras: devCams
      };
    });

  function normalizeStr(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // Filtro de búsqueda en tiempo real (por canal, nombre de cámara, tipo, IP o grabador)
  $: filteredGroupedDevices = groupedDevices.map(dev => {
    const rawQ = (camaraSearchQuery || '').trim();
    if (!rawQ) return dev;

    const q = normalizeStr(rawQ);
    const cleanQ = q.replace(/\s+/g, '');

    // 1. Filtrar cámaras que coincidan por nombre, canal o tipo
    const filteredCams = dev.camaras.filter(c => {
      const numStr = String(c.numero_canal || '');
      const nameStr = normalizeStr(c.nombre);
      const tipoStr = normalizeStr(c.tipo);
      const chStr = `ch${numStr}`;
      const canalStr = `canal${numStr}`;

      return (
        numStr === q ||
        numStr === cleanQ ||
        nameStr.includes(q) ||
        tipoStr.includes(q) ||
        chStr.includes(cleanQ) ||
        canalStr.includes(cleanQ)
      );
    });

    // 2. Si coincide el nombre o IP del grabador
    const devMatches = normalizeStr(dev.nombre).includes(q) || (dev.ip_local && dev.ip_local.includes(q));

    const camsToShow = filteredCams.length > 0
      ? filteredCams
      : (devMatches ? dev.camaras : []);

    return {
      ...dev,
      camaras: camsToShow
    };
  }).filter(dev => {
    if (!camaraSearchQuery.trim()) return true;
    return dev.camaras.length > 0;
  });

  $: selectedCamarasList = camaras.filter(c => selectedCameraUuids.includes(c.uuid || c.id));

  function toggleCamera(camUuid) {
    if (!camUuid) return;
    if (selectedCameraUuids.includes(camUuid)) {
      selectedCameraUuids = selectedCameraUuids.filter(id => id !== camUuid);
    } else {
      selectedCameraUuids = [...selectedCameraUuids, camUuid];
    }
  }

  $: visibleCamIds = filteredGroupedDevices.flatMap(d => (d.camaras || []).map(c => c.uuid || c.id).filter(Boolean));
  $: isAllVisibleSelected = visibleCamIds.length > 0 && visibleCamIds.every(id => selectedCameraUuids.includes(id));

  function toggleSelectAll() {
    if (isAllVisibleSelected) {
      selectedCameraUuids = [];
      triggerToast("Selección limpiada", "info");
    } else {
      const set = new Set([...selectedCameraUuids, ...visibleCamIds]);
      selectedCameraUuids = Array.from(set);
      triggerToast(`${selectedCameraUuids.length} cámaras seleccionadas`, "info");
    }
  }

  function toggleDvrCameras(dev) {
    const devCamIds = (dev.camaras || []).map(c => c.uuid || c.id).filter(Boolean);
    if (devCamIds.length === 0) return;

    const allChecked = devCamIds.every(id => selectedCameraUuids.includes(id));
    if (allChecked) {
      selectedCameraUuids = selectedCameraUuids.filter(id => !devCamIds.includes(id));
    } else {
      const set = new Set([...selectedCameraUuids, ...devCamIds]);
      selectedCameraUuids = Array.from(set);
    }
  }

  function copyCamRtsp(cam, dev) {
    const ip = dev?.ip_local || cam?.dispositivo_ip || "127.0.0.1";
    const port = dev?.puerto_rtsp || cam?.puerto_rtsp || 554;
    const user = dev?.usuario || cam?.dispositivo_usuario || "admin";
    const ch = cam.numero_canal || 1;
    const streamId = streamType === "main" ? "1" : "2";
    const url = `rtsp://${user}:*****@${ip}:${port}/Streaming/Channels/${ch}0${streamId}`;
    navigator.clipboard.writeText(url);
    triggerToast(`RTSP del Canal ${ch} copiado`, "success");
  }

  function setQuickTimeRange(minutes) {
    const now = new Date();
    const past = new Date(now.getTime() - minutes * 60000);

    const fNow = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Caracas',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const fPast = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Caracas',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });

    const partsNow = {};
    for (const p of fNow.formatToParts(now)) partsNow[p.type] = p.value;
    const partsPast = {};
    for (const p of fPast.formatToParts(past)) partsPast[p.type] = p.value;

    const hNow = partsNow.hour === '24' ? '00' : partsNow.hour;
    const hPast = partsPast.hour === '24' ? '00' : partsPast.hour;

    horaFin = `${hNow.padStart(2, '0')}:${partsNow.minute.padStart(2, '0')}:${partsNow.second.padStart(2, '0')}`;
    horaInicio = `${hPast.padStart(2, '0')}:${partsPast.minute.padStart(2, '0')}:${partsPast.second.padStart(2, '0')}`;
    fecha = `${partsPast.year}-${partsPast.month}-${partsPast.day}`;

    triggerToast(`Rango fijado: últimos ${minutes} minutos (Hora Caracas)`, "info");
  }

  async function handleStartDownload() {
    if (selectedCameraUuids.length === 0) {
      triggerToast("Selecciona al menos una cámara en el panel derecho", "warning");
      return;
    }

    if (!isRangeValid) {
      triggerToast(rangeError || "El rango de fecha y hora no es válido.", "warning");
      return;
    }

    if (!isTauriWindows()) {
      triggerToast("La descarga nativa por SDK requiere ejecutar la app en Windows.", "warning");
      return;
    }

    const salaObj = salas.find(s => String(s.uuid || s.id) === String(selectedSalaUuid));
    const salaNombre = (salaObj?.nombre || "SALA").replace(/\s+/g, "_");
    const fClean = fecha.replace(/-/g, "");
    const hStartClean = horaInicio.replace(/:/g, "");
    const hEndClean = horaFin.replace(/:/g, "");
    const timeRangeStr = isCruceDias
      ? `${fClean}_${hStartClean}-al-${(fechaCierre || fecha).replace(/-/g, "")}_${hEndClean}`
      : `${fClean}_${hStartClean}-${hEndClean}`;

    const targets = selectedCamarasList;
    if (targets.length === 0) {
      triggerToast("No se encontraron los datos de las cámaras seleccionadas", "warning");
      return;
    }

    // Formatear fechas para Converter.exe de Hikvision: YYYY,M,D,H,m,s
    const [startH, startM, startS] = horaInicio.split(":").map(Number);
    const [endH, endM, endS] = horaFin.split(":").map(Number);
    const [fYear, fMonth, fDay] = fecha.split("-").map(Number);
    const [endYear, endMonth, endDay] = (fechaCierre || fecha).split("-").map(Number);

    const inicioStr = `${fYear},${fMonth},${fDay},${startH},${startM},${startS || 0}`;
    const finStr = `${endYear},${endMonth},${endDay},${endH},${endM},${endS || 0}`;

    // CASO 1: Una sola cámara seleccionada -> Diálogo "Guardar como..." de Windows
    if (targets.length === 1) {
      const cam = targets[0];
      const dev = dispositivos.find(d => String(d.uuid || d.id) === String(cam.dispositivo_camara_uuid)) || {
        nombre: cam.dispositivo_nombre || "NVR",
        ip_local: cam.dispositivo_ip,
        usuario: cam.dispositivo_usuario,
        clave: cam.dispositivo_clave
      };

      const devNombre = (dev?.nombre || "NVR").replace(/\s+/g, "_");
      const camNombre = (cam?.nombre || `CH${cam?.numero_canal || 1}`).replace(/\s+/g, "_");
      const defaultFilename = `${salaNombre}_${devNombre}_${camNombre}_${timeRangeStr}.mp4`;

      let suggested = defaultFilename;
      if (targetVideosDir) {
        suggested = `${targetVideosDir}\\${defaultFilename}`;
      }

      let chosenPath = null;
      try {
        chosenPath = await promptSaveVideoDialog(suggested);
      } catch (e) {
        console.error("Error abriendo diálogo de guardado:", e);
      }

      if (!chosenPath) return; // Usuario canceló

      const lastSlash = Math.max(chosenPath.lastIndexOf('\\'), chosenPath.lastIndexOf('/'));
      if (lastSlash > 0) {
        targetVideosDir = chosenPath.substring(0, lastSlash);
        localStorage.setItem("cecom_custom_videos_dir", targetVideosDir);
      }

      const finalFilename = chosenPath.split(/[\\/]/).pop() || defaultFilename;
      const taskId = "DL-" + Date.now().toString().slice(-6);

      const downloadItem = {
        id: taskId,
        filename: finalFilename,
        device: dev.nombre,
        ip: dev.ip_local,
        canal: cam.numero_canal,
        camaraNombre: cam.nombre,
        fecha: isCruceDias ? `${formatDmy(fecha)} ➔ ${formatDmy(fechaCierre)}` : formatDmy(fecha),
        rango: isCruceDias
          ? `${formatDmy(fecha)} ${horaInicio} al ${formatDmy(fechaCierre)} ${horaFin}`
          : `${horaInicio} a ${horaFin}`,
        streamType: streamType === "main" ? "Principal (Full HD/4K)" : "Secundario (Rápido)",
        unificar: unificarVideos,
        status: "Conectando con el grabador por SDK...",
        progress: 5,
        createdAt: new Date().toLocaleTimeString(),
        canOpen: false,
        isError: false,
        errorMsg: null,
        outputPath: chosenPath
      };

      downloadQueue = [downloadItem, ...downloadQueue];

      try {
        triggerToast(`Iniciando extracción de: ${finalFilename}`, "info");
        const outPath = await startCecomVideoDownload({
          taskId,
          ip: dev.ip_local,
          usuario: dev.usuario || "admin",
          clave: dev.clave || "",
          canal: cam.numero_canal,
          inicioStr,
          finStr,
          outputFilename: finalFilename,
          destinationPath: chosenPath,
          modo: streamType === "sub" ? "f" : null
        });

        downloadQueue = downloadQueue.map(i => i.id === taskId ? { ...i, outputPath: outPath || chosenPath } : i);
      } catch (err) {
        console.error("Error al iniciar descarga nativa:", err);
        downloadQueue = downloadQueue.map(i => i.id === taskId ? { 
          ...i, 
          progress: 0, 
          status: "Fallo al iniciar", 
          isError: true, 
          errorMsg: err.message || String(err) 
        } : i);
        triggerToast(`Error al iniciar descarga: ${err.message || err}`, "error");
      }

      return;
    }

    // CASO 2: Múltiples cámaras seleccionadas -> Diálogo para seleccionar carpeta destino una sola vez
    let chosenFolder = null;
    try {
      chosenFolder = await promptSelectFolderDialog();
    } catch (e) {
      console.error("Error abriendo diálogo de carpeta:", e);
    }

    if (!chosenFolder) {
      if (targetVideosDir) {
        chosenFolder = targetVideosDir;
      } else {
        return; // Usuario canceló la selección de carpeta
      }
    } else {
      targetVideosDir = chosenFolder;
      localStorage.setItem("cecom_custom_videos_dir", targetVideosDir);
    }

    triggerToast(`Iniciando extracción de ${targets.length} cámaras en lote...`, "info");

    for (const cam of targets) {
      const dev = dispositivos.find(d => String(d.uuid || d.id) === String(cam.dispositivo_camara_uuid)) || {
        nombre: cam.dispositivo_nombre || "NVR",
        ip_local: cam.dispositivo_ip,
        usuario: cam.dispositivo_usuario,
        clave: cam.dispositivo_clave
      };

      const devNombre = (dev?.nombre || "NVR").replace(/\s+/g, "_");
      const camNombre = (cam?.nombre || `CH${cam?.numero_canal || 1}`).replace(/\s+/g, "_");
      const filename = `${salaNombre}_${devNombre}_${camNombre}_${timeRangeStr}.mp4`;
      const fullPath = `${chosenFolder}\\${filename}`;
      const taskId = "DL-" + Date.now().toString().slice(-6) + "-" + Math.floor(Math.random() * 1000);

      const downloadItem = {
        id: taskId,
        filename,
        device: dev.nombre,
        ip: dev.ip_local,
        canal: cam.numero_canal,
        camaraNombre: cam.nombre,
        fecha: isCruceDias ? `${formatDmy(fecha)} ➔ ${formatDmy(fechaCierre)}` : formatDmy(fecha),
        rango: isCruceDias
          ? `${formatDmy(fecha)} ${horaInicio} al ${formatDmy(fechaCierre)} ${horaFin}`
          : `${horaInicio} a ${horaFin}`,
        streamType: streamType === "main" ? "Principal (Full HD/4K)" : "Secundario (Rápido)",
        unificar: unificarVideos,
        status: "En cola de extracción...",
        progress: 3,
        createdAt: new Date().toLocaleTimeString(),
        canOpen: false,
        isError: false,
        errorMsg: null,
        outputPath: fullPath
      };

      downloadQueue = [downloadItem, ...downloadQueue];

      // Lanzar cada descarga por SDK
      startCecomVideoDownload({
        taskId,
        ip: dev.ip_local,
        usuario: dev.usuario || "admin",
        clave: dev.clave || "",
        canal: cam.numero_canal,
        inicioStr,
        finStr,
        outputFilename: filename,
        destinationPath: fullPath,
        modo: streamType === "sub" ? "f" : null
      }).then(outPath => {
        downloadQueue = downloadQueue.map(i => i.id === taskId ? { ...i, outputPath: outPath || fullPath } : i);
      }).catch(err => {
        console.error(`Error al extraer cámara ${cam.nombre}:`, err);
        downloadQueue = downloadQueue.map(i => i.id === taskId ? {
          ...i,
          progress: 0,
          status: "Fallo al iniciar",
          isError: true,
          errorMsg: err.message || String(err)
        } : i);
      });
    }
  }

  async function openFileLocation(item) {
    if (item.outputPath) {
      try {
        await openMediaFile(item.outputPath);
      } catch (err) {
        triggerToast(`Error al abrir video: ${err}`, "error");
      }
    } else {
      triggerToast(`Archivo: ${item.filename}`, "info");
    }
  }

  async function openFileInExplorer(item) {
    if (item.outputPath) {
      try {
        await showInFolder(item.outputPath);
      } catch (err) {
        triggerToast(`Error al abrir carpeta: ${err}`, "error");
      }
    }
  }
</script>

<div class="descarga-container">
  <div class="main-grid">
    <!-- Panel Izquierdo: Configuración de la Solicitud -->
    <div class="card config-card">
      <h2 class="card-title">
        Parámetros de Extracción
      </h2>

      <!-- 1. Selección de Sala del Casino -->
      <div class="form-group" style="margin-bottom: 16px;">
        <label for="sala-select" class="form-label">1. Sala del Casino</label>
        <select id="sala-select" class="form-select" bind:value={selectedSalaUuid} on:change={onSalaChange} disabled={salas.length === 0}>
          {#if salas.length === 0}
            <option value="">No tienes salas asociadas a tu usuario</option>
          {:else}
            {#each salas as s}
              <option value={s.uuid || s.id}>{s.nombre}</option>
            {/each}
          {/if}
        </select>
      </div>

      <!-- 2. Rango de Fecha y Hora -->
      <div class="form-group" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <label for="fecha-input" class="form-label" style="margin: 0;">Fecha del Evento</label>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button
              type="button"
              class="btn-nav-day"
              title="Día anterior"
              on:click={() => changeDateBy(-1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button
              type="button"
              class="btn-nav-day"
              title="Día siguiente"
              disabled={fecha >= getLocalDateStr()}
              on:click={() => changeDateBy(1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <input id="fecha-input" type="date" class="form-input" bind:value={fecha} max={getLocalDateStr()} />
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
        <div class="form-group" style="margin: 0;">
          <label for="hora-inicio-input" class="form-label" style="margin: 0 0 4px 0; white-space: nowrap;">Hora Inicio</label>
          <input
            id="hora-inicio-input"
            type="time"
            step="1"
            class="form-input"
            class:input-invalid={!isRangeValid && fecha === getCaracasNow().dateStr && horaInicio > getCaracasNow().timeStr}
            bind:value={horaInicio}
          />
        </div>

        <div class="form-group" style="margin: 0;">
          <label for="hora-fin-input" class="form-label" style="margin: 0 0 4px 0; white-space: nowrap;">Hora Fin</label>
          <input
            id="hora-fin-input"
            type="time"
            step="1"
            class="form-input"
            class:input-invalid={!isRangeValid}
            bind:value={horaFin}
          />
          {#if isCruceDias}
            <div
              class="badge-cierre-under"
              class:cierre-invalid={!isRangeValid}
              title={isRangeValid ? `Cierre del video: ${formatDmy(fechaCierre)}` : rangeError}
            >
              (Cierre: {formatDmy(fechaCierre)})
            </div>
          {/if}
        </div>
      </div>

      {#if !isRangeValid && rangeError}
        <div class="time-error-box">
          <span>{rangeError}</span>
        </div>
      {/if}

      <!-- Accesos Rápidos de Tiempo (Hoy) -->
      <div class="quick-ranges">
        <span class="quick-label">Accesos rápidos ( Hoy )</span>
        <div class="quick-ranges-grid">
          <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(1)}>1 min</button>
          <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(3)}>3 min</button>
          <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(5)}>5 min</button>
          <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(10)}>10 min</button>
          <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(15)}>15 min</button>
          <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(30)}>30 min</button>
        </div>
      </div>

      <!-- 3. Opciones de Extracción: Stream y Unificación (Row con 2 Col-6) -->
      <div class="row switches-row">
        <!-- Col 6: Interruptor Main Stream / Sub Stream -->
        <div class="col-6">
          <div
            class="switch-card"
            class:active={streamType === 'main'}
            on:click={() => streamType = streamType === 'main' ? 'sub' : 'main'}
            role="button"
            tabindex="0"
            title="Cambiar entre Main Stream y Sub Stream"
          >
            <div class="toggle-switch" on:click|stopPropagation>
              <input
                type="checkbox"
                id="toggle-stream"
                checked={streamType === 'main'}
                on:change={(e) => streamType = e.target.checked ? 'main' : 'sub'}
              />
              <label for="toggle-stream" class="slider"></label>
            </div>
            <strong class="switch-state-text">
              {streamType === 'main' ? 'Main Stream' : 'Sub Stream'}
            </strong>
          </div>
        </div>

        <!-- Col 6: Interruptor Unificar Videos -->
        <div class="col-6">
          <div
            class="switch-card"
            class:active={unificarVideos}
            on:click={() => unificarVideos = !unificarVideos}
            role="button"
            tabindex="0"
            title="Unificar grabaciones en un solo archivo"
          >
            <div class="toggle-switch" on:click|stopPropagation>
              <input
                type="checkbox"
                id="toggle-unificar"
                checked={unificarVideos}
                on:change={(e) => unificarVideos = e.target.checked}
              />
              <label for="toggle-unificar" class="slider"></label>
            </div>
            <strong class="switch-state-text">
              {unificarVideos ? 'Videos unificados' : 'Videos separados'}
            </strong>
          </div>
        </div>
      </div>

      <!-- Resumen visual de selección -->
      <div class="selected-summary-box" class:has-selection={selectedCameraUuids.length > 0 && isRangeValid} class:has-error={!isRangeValid}>
        {#if selectedCameraUuids.length === 0}
          <div class="summary-empty">
            <div>
              <strong>Ninguna cámara seleccionada</strong>
              <p>Marca una o varias cámaras en el panel derecho para habilitar la descarga.</p>
            </div>
          </div>
        {:else if !isRangeValid}
          <div class="summary-warning">
            <div>
              <strong style="color: #b91c1c;">Rango de tiempo no válido</strong>
              <p style="color: #dc2626; margin: 2px 0 0 0;">{rangeError}</p>
            </div>
          </div>
        {:else}
          <div class="summary-ready">
            <div>
              <strong>{selectedCameraUuids.length} {selectedCameraUuids.length === 1 ? 'cámara lista' : 'cámaras listas'} para extracción</strong>
              <p>
                Rango: {#if isCruceDias}
                  <strong>{formatDmy(fecha)} {horaInicio}</strong> al <strong>{formatDmy(fechaCierre)} {horaFin}</strong>
                {:else}
                  {formatDmy(fecha)} de {horaInicio} a {horaFin}
                {/if}
                {#if unificarVideos && selectedCameraUuids.length > 1}
                  • <strong style="color: #1d4ed8;">(Videos unificados)</strong>
                {/if}
              </p>
            </div>
          </div>
        {/if}
      </div>

      <!-- Botón de Descarga Primario -->
      <div class="action-footer">
        <button
          type="button"
          class="btn-download"
          on:click={handleStartDownload}
          disabled={!isRangeValid || selectedCameraUuids.length === 0}
        >
          Iniciar Descarga {selectedCameraUuids.length > 0 ? `(${selectedCameraUuids.length} ${selectedCameraUuids.length === 1 ? 'cámara' : 'cámaras'})` : ''}
        </button>
      </div>
    </div>

    <!-- Panel Derecho: Grabadores como Título y Cámaras con Checkbox -->
    <div class="card camaras-selection-card">
      <div class="card-header-flex">
        <div>
          <h2 class="card-title" style="margin: 0;">
            Cámaras y Canales por Grabador
          </h2>
          <span class="card-subtitle">
            {#if isLoadingDispositivos || isLoadingCamaras}
              Cargando grabadores y canales...
            {:else}
              {dispositivos.length} grabador{dispositivos.length === 1 ? '' : 'es'} • {camaras.length} canal{camaras.length === 1 ? '' : 'es'}
            {/if}
          </span>
        </div>
        <div class="selection-pill" class:active={selectedCameraUuids.length > 0}>
          {selectedCameraUuids.length} seleccionada{selectedCameraUuids.length === 1 ? '' : 's'}
        </div>
      </div>

      <!-- Barra de herramientas: Búsqueda y Botones de selección masiva -->
      <div class="cam-toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            class="search-input"
            placeholder="Buscar por canal, nombre o IP..."
            bind:value={camaraSearchQuery}
          />
          {#if camaraSearchQuery}
            <button type="button" class="btn-clear-search" on:click={() => (camaraSearchQuery = "")}>✕</button>
          {/if}
        </div>
        <div class="toolbar-actions">
          <button
            type="button"
            class="btn-tool"
            class:active={isAllVisibleSelected}
            on:click={toggleSelectAll}
            disabled={visibleCamIds.length === 0}
            title={isAllVisibleSelected ? "Desmarcar todas las cámaras" : "Marcar todas las cámaras"}
          >
            {isAllVisibleSelected ? 'Desmarcar todas' : 'Marcar todas'}
          </button>
        </div>
      </div>

      <!-- Contenedor scrollable de Grabadores y Cámaras -->
      <div class="dvr-list-container">
        {#if isLoadingDispositivos || isLoadingCamaras}
          <div class="loading-state">
            <span class="spin" style="font-size: 26px;">⏳</span>
            <p>Cargando grabadores y cámaras de la sala...</p>
          </div>
        {:else if dispositivos.length === 0}
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <p>No hay grabadores registrados en esta sala.</p>
          </div>
        {:else if filteredGroupedDevices.length === 0}
          <div class="empty-state">
            <span class="empty-icon">🔎</span>
            <p>No se encontraron cámaras que coincidan con "{camaraSearchQuery}".</p>
          </div>
        {:else}
          {#each filteredGroupedDevices as dev (dev.uuid || dev.id)}
            {@const devCamIds = (dev.camaras || []).map(c => c.uuid || c.id).filter(Boolean)}
            {@const devSelectedCount = devCamIds.filter(id => selectedCameraUuids.includes(id)).length}
            {@const isAllDevSelected = devCamIds.length > 0 && devSelectedCount === devCamIds.length}

            <div class="dvr-group-card">
              <!-- Encabezado del DVR / NVR como Título -->
              <div class="dvr-group-header">
                <div class="dvr-title-left">
                  <span class="dvr-name">{dev.nombre}</span>
                </div>

                <div class="dvr-actions-right">
                  <span class="dvr-badge" class:has-selection={devSelectedCount > 0}>
                    {devSelectedCount} / {dev.camaras.length}
                  </span>
                  <button
                    type="button"
                    class="btn-dvr-toggle"
                    class:active={isAllDevSelected}
                    on:click={() => toggleDvrCameras(dev)}
                    title={isAllDevSelected ? "Desmarcar grabador completo" : "Marcar todas las cámaras de este grabador"}
                  >
                    {isAllDevSelected ? 'Desmarcar DVR' : 'Marcar DVR'}
                  </button>
                </div>
              </div>

              <!-- Lista de Cámaras del DVR con Checkbox -->
              {#if dev.camaras.length === 0}
                <div class="dvr-no-cams">
                  Sin canales sincronizados en este grabador.
                </div>
              {:else}
                <div class="camaras-grid">
                  {#each dev.camaras as cam (cam.uuid || cam.id)}
                    {@const camId = cam.uuid || cam.id}
                    {@const isChecked = selectedCameraUuids.includes(camId)}

                    <button
                      type="button"
                      class="cam-btn"
                      class:selected={isChecked}
                      on:click={() => toggleCamera(camId)}
                      title={cam.nombre ? `${cam.nombre} (Canal ${cam.numero_canal})` : `Canal ${cam.numero_canal}`}
                    >
                      {cam.numero_canal}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  <!-- Cola de Descargas Activas -->
  <div class="card queue-card">
    <div class="queue-header">
      <h2 class="card-title" style="margin: 0;">
        Cola de Descargas de la Sesión ({downloadQueue.length})
      </h2>
      {#if downloadQueue.length > 0}
        <button type="button" class="btn-clear" on:click={() => (downloadQueue = [])}>
          Limpiar Lista
        </button>
      {/if}
    </div>

    {#if downloadQueue.length === 0}
      <div class="empty-queue">
        <span>📁</span>
        <p>No hay descargas en curso ni solicitadas en esta sesión.</p>
      </div>
    {:else}
      <div class="queue-list">
        {#each downloadQueue as item (item.id)}
          <div class="queue-item" class:item-error={item.isError}>
            <div class="item-left">
              <span class="file-icon">{item.isError ? '⚠️' : '🎬'}</span>
              <div>
                <div class="item-name font-mono">{item.filename}</div>
                <div class="item-meta">
                  <span>{item.device}</span> • 
                  <span>Canal {item.canal} ({item.camaraNombre})</span> • 
                  <span>{item.fecha} [{item.rango}]</span> • 
                  <span>{item.streamType}</span>
                </div>
                {#if item.outputPath}
                  <div class="item-filepath font-mono">
                    📍 {item.outputPath}
                  </div>
                {/if}
                {#if item.isError && item.errorMsg}
                  <div class="item-error-msg">
                    ❌ {item.errorMsg}
                  </div>
                {/if}
              </div>
            </div>

            <div class="item-right">
              {#if !item.isError}
                <div class="progress-container">
                  <div class="progress-bar" style="width: {item.progress}%;"></div>
                </div>
              {/if}
              <div class="progress-status">
                <span class="status-badge" class:done={item.progress === 100} class:error={item.isError}>
                  {item.status}
                </span>
                {#if !item.isError}
                  <span class="percent font-mono">{item.progress}%</span>
                {/if}
              </div>
              {#if item.canOpen}
                <div class="actions-group">
                  <button type="button" class="btn-open-file" on:click={() => openFileLocation(item)}>
                    ▶️ Abrir MP4
                  </button>
                  <button type="button" class="btn-open-folder" on:click={() => openFileInExplorer(item)}>
                    📂 Ver en Carpeta
                  </button>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .descarga-container {
    padding: 20px;
    max-width: 100%;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .main-grid {
    display: grid;
    grid-template-columns: 3fr 9fr;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 1200px) {
    .main-grid {
      grid-template-columns: 1fr;
    }
  }

  .card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 22px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04);
  }

  .card-title {
    font-size: 15px;
    font-weight: 800;
    color: #1e293b;
    margin: 0 0 18px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .form-row {
    display: flex;
    gap: 14px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .flex-1 {
    flex: 1;
    min-width: 180px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
  }

  .form-select, .form-input {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    font-size: 13.5px;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .form-select:focus, .form-input:focus {
    border-color: #2563eb;
    background: #ffffff;
  }

  .quick-ranges {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .quick-label {
    font-size: 11.5px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .quick-ranges-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .btn-chip {
    padding: 6px 4px;
    font-size: 11.5px;
    font-weight: 700;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
    width: 100%;
  }

  .btn-chip:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .btn-nav-day {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border-radius: 5px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-nav-day:hover:not(:disabled) {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .btn-nav-day:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    background: #f1f5f9;
    border-color: #e2e8f0;
    color: #94a3b8;
  }

  .switches-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-bottom: 16px;
    width: 100%;
  }

  .switches-row .col-6 {
    min-width: 0;
    width: 100%;
  }

  .switch-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 10px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    transition: all 0.15s ease;
    min-height: 66px;
    text-align: center;
  }

  .switch-card:hover {
    border-color: #cbd5e1;
    background: #f1f5f9;
  }

  .switch-card.active {
    background: #eff6ff;
    border-color: #93c5fd;
    box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
  }

  /* Interruptor / Toggle Switch centrado en el medio */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 38px;
    height: 20px;
    margin: 0 auto;
    flex-shrink: 0;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
    position: absolute;
  }

  .toggle-switch .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #cbd5e1;
    transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 20px;
    margin: 0;
  }

  .toggle-switch .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: #ffffff;
    transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch input:checked + .slider {
    background-color: #2563eb;
  }

  .toggle-switch input:checked + .slider:before {
    transform: translateX(18px);
  }

  .switch-state-text {
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .switch-card.active .switch-state-text {
    color: #1d4ed8;
  }

  .badge-cierre-under {
    margin-top: 4px;
    font-size: 11px;
    font-weight: 700;
    color: #1d4ed8;
    background: #dbeafe;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    border: 1px solid #bfdbfe;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-cierre-under.cierre-invalid {
    color: #b91c1c;
    background: #fee2e2;
    border-color: #fca5a5;
  }

  .input-invalid {
    border-color: #ef4444 !important;
    background-color: #fef2f2 !important;
  }

  .time-error-box {
    margin-bottom: 12px;
    padding: 7px 10px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    font-size: 11.5px;
    color: #b91c1c;
    display: flex;
    align-items: center;
    gap: 6px;
    line-height: 1.35;
  }

  .selected-summary-box.has-error {
    background: #fef2f2;
    border: 1px solid #fca5a5;
  }

  .summary-warning {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .btn-download {
    width: 100%;
    padding: 13px 20px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #ffffff;
    border: none;
    border-radius: 10px;
    font-size: 14.5px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    transition: transform 0.1s ease, box-shadow 0.15s ease;
  }

  .btn-download:disabled {
    background: #94a3b8;
    cursor: not-allowed;
    box-shadow: none;
  }

  .btn-download:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45);
  }

  /* Selector de Cámaras por DVR */
  .camaras-selection-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 20px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04);
  }

  .card-header-flex {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .card-subtitle {
    font-size: 12px;
    color: #64748b;
    margin-top: 2px;
    display: block;
  }

  .selection-pill {
    font-size: 12px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 20px;
    background: #f1f5f9;
    color: #64748b;
    border: 1px solid #cbd5e1;
    transition: all 0.15s ease;
  }

  .selection-pill.active {
    background: #dbeafe;
    color: #1d4ed8;
    border-color: #93c5fd;
  }

  .cam-toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    background: #f8fafc;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 4px 10px;
    flex: 1;
    min-width: 180px;
  }

  .search-icon {
    font-size: 13px;
    opacity: 0.6;
  }

  .search-input {
    border: none;
    outline: none;
    width: 100%;
    font-size: 12.5px;
    background: transparent;
    color: #0f172a;
  }

  .btn-clear-search {
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
  }

  .toolbar-actions {
    display: flex;
    gap: 6px;
  }

  .btn-tool {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    color: #334155;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-tool:hover:not(.active):not(:disabled) {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
  }

  .btn-tool.active {
    background: #fee2e2;
    border-color: #fca5a5;
    color: #b91c1c;
  }

  .btn-tool.active:hover {
    background: #fecaca;
  }

  .btn-tool:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .dvr-list-container {
    max-height: calc(100vh - 240px);
    min-height: 480px;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    padding-right: 4px;
    align-content: start;
  }

  @media (max-width: 900px) {
    .dvr-list-container {
      grid-template-columns: 1fr;
    }
  }

  .dvr-list-container::-webkit-scrollbar {
    width: 6px;
  }

  .dvr-list-container::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;
  }

  .dvr-group-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dvr-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e2e8f0;
  }

  .dvr-title-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dvr-icon {
    font-size: 18px;
  }

  .dvr-name {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .dvr-meta {
    font-size: 11.5px;
    color: #64748b;
    margin-left: 4px;
    font-family: ui-monospace, monospace;
  }

  .dvr-actions-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dvr-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 12px;
    background: #e2e8f0;
    color: #475569;
  }

  .dvr-badge.has-selection {
    background: #dbeafe;
    color: #1d4ed8;
  }

  .btn-dvr-toggle {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 5px;
    cursor: pointer;
    color: #334155;
    transition: all 0.15s ease;
  }

  .btn-dvr-toggle.active {
    background: #fee2e2;
    border-color: #fca5a5;
    color: #b91c1c;
  }

  .btn-dvr-toggle:hover:not(.active) {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
  }

  .dvr-no-cams {
    font-size: 12px;
    color: #94a3b8;
    font-style: italic;
    padding: 4px 0;
  }

  .camaras-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 4px;
  }

  @media (max-width: 1400px) {
    .camaras-grid {
      grid-template-columns: repeat(8, 1fr);
    }
  }

  @media (max-width: 1000px) {
    .camaras-grid {
      grid-template-columns: repeat(6, 1fr);
    }
  }

  @media (max-width: 650px) {
    .camaras-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .cam-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 2px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    color: #334155;
    font-size: 12px;
    font-weight: 800;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    cursor: pointer;
    user-select: none;
    transition: all 0.12s ease;
    min-width: 0;
    width: 100%;
    white-space: nowrap;
    text-align: center;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .cam-btn:hover:not(.selected) {
    background: #eff6ff;
    border-color: #93c5fd;
    color: #1d4ed8;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }

  .cam-btn.selected {
    background: #2563eb;
    border-color: #1d4ed8;
    color: #ffffff;
    font-weight: 800;
    box-shadow: 0 2px 5px rgba(37, 99, 235, 0.35);
  }

  .cam-btn.selected:hover {
    background: #1d4ed8;
  }

  .btn-rtsp-mini {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 4px;
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }

  .btn-rtsp-mini:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.05);
  }

  .selected-summary-box {
    margin-top: 12px;
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: 8px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    font-size: 12.5px;
    transition: all 0.2s ease;
  }

  .selected-summary-box.has-selection {
    background: #f0fdf4;
    border: 1px solid #86efac;
  }

  .summary-empty, .summary-ready {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .summary-empty strong {
    color: #64748b;
  }

  .summary-empty p {
    margin: 2px 0 0 0;
    font-size: 11.5px;
    color: #94a3b8;
  }

  .summary-ready strong {
    color: #166534;
  }

  .summary-ready p {
    margin: 2px 0 0 0;
    font-size: 11.5px;
    color: #15803d;
  }

  .loading-state, .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px 20px;
    color: #64748b;
    font-size: 13px;
  }

  .empty-icon {
    font-size: 36px;
    display: block;
    margin-bottom: 8px;
  }

  /* Queue */
  .queue-card {
    margin-top: 6px;
  }

  .queue-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .btn-clear {
    background: none;
    border: 1px solid #cbd5e1;
    color: #64748b;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .empty-queue {
    text-align: center;
    padding: 30px;
    color: #94a3b8;
    font-size: 13px;
  }

  .empty-queue span {
    font-size: 32px;
    display: block;
    margin-bottom: 6px;
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .queue-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    flex-wrap: wrap;
    gap: 14px;
  }

  .item-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .file-icon {
    font-size: 26px;
  }

  .item-name {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
  }

  .item-meta {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 3px;
  }

  .item-right {
    min-width: 240px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .progress-container {
    width: 100%;
    height: 8px;
    background: #e2e8f0;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: #2563eb;
    transition: width 0.3s ease;
  }

  .progress-status {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }

  .status-badge {
    color: #2563eb;
    font-weight: 700;
  }

  .status-badge.done {
    color: #059669;
  }

  .status-badge.error {
    color: #dc2626;
  }

  .storage-info-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .storage-meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .storage-icon {
    font-size: 20px;
  }

  .storage-title {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
  }

  .storage-path {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    word-break: break-all;
  }

  .btn-storage-open {
    padding: 6px 12px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-storage-open:hover {
    background: #f8fafc;
    border-color: #94a3b8;
  }

  .storage-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .btn-storage-change {
    padding: 6px 12px;
    background: #eff6ff;
    border: 1px solid #93c5fd;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #1d4ed8;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-storage-change:hover {
    background: #dbeafe;
    border-color: #3b82f6;
  }

  .dest-config-panel {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dest-config-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }

  .dest-config-label {
    font-size: 11.5px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
  }

  .btn-dest-change {
    padding: 4px 10px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: #2563eb;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-dest-change:hover {
    background: #eff6ff;
    border-color: #93c5fd;
  }

  .dest-config-path {
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    background: #ffffff;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px dashed #cbd5e1;
    word-break: break-all;
  }

  .dest-checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: #475569;
    cursor: pointer;
    user-select: none;
    margin-top: 2px;
  }

  .dest-checkbox-row input {
    cursor: pointer;
  }

  .item-filepath {
    font-size: 11px;
    color: #0284c7;
    margin-top: 4px;
    word-break: break-all;
  }

  .item-error-msg {
    font-size: 11.5px;
    color: #dc2626;
    margin-top: 4px;
    font-weight: 600;
  }

  .actions-group {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .btn-open-file {
    padding: 6px 12px;
    background: #059669;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-open-file:hover {
    background: #047857;
  }

  .btn-open-folder {
    padding: 6px 12px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-open-folder:hover {
    background: #1d4ed8;
  }
</style>
