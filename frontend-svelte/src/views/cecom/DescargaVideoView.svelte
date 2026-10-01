<script>
  import { onMount, onDestroy } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { masterSalasStore } from "../../controllers/master.store.js";
  import { getDispositivosCamaras, getCamaras } from "../../services/cecomVideo.service.js";
  import { isTauriWindows } from "../../services/tauriIsapi.service.js";
  import { 
    getCecomDefaultPaths, 
    startCecomVideoDownload, 
    listenDownloadProgress, 
    openMediaFile, 
    showInFolder, 
    openFolder,
    promptSaveVideoDialog,
    promptSelectFolderDialog
  } from "../../services/tauriVideo.service.js";

  let salas = [];
  let selectedSalaUuid = "";
  let dispositivos = [];
  let selectedDeviceUuid = "";
  let camaras = [];
  let selectedCamaraUuid = "";

  function getLocalDateStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Parámetros de descarga
  let fecha = getLocalDateStr();
  let horaInicio = "12:00:00";
  let horaFin = "12:30:00";
  let streamType = "main"; // main (Principal 1080p/4K) o sub (Secundario rápido)

  let isLoadingDispositivos = false;
  let isLoadingCamaras = false;

  // Rutas locales de Windows para CECOM
  let targetVideosDir = "";
  let sdkPath = "";
  let sdkAvailable = false;
  let unlistenProgress = null;
  let alwaysPromptSave = true;

  // Cola de descargas activas en sesión
  let downloadQueue = [];

  $: salas = $masterSalasStore || [];

  onMount(async () => {
    if (salas.length > 0) {
      selectedSalaUuid = salas[0].uuid || salas[0].id;
      await onSalaChange();
    }

    // Inicializar rutas y escucha nativa en Windows
    if (isTauriWindows()) {
      const paths = await getCecomDefaultPaths();
      if (paths) {
        targetVideosDir = localStorage.getItem("cecom_custom_videos_dir") || paths.dest_dir || "";
        sdkPath = localStorage.getItem("cecom_custom_sdk_path") || paths.sdk_converter_path || "";
        sdkAvailable = paths.sdk_available || !!sdkPath;
        alwaysPromptSave = localStorage.getItem("cecom_always_prompt_save") !== "false";
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
    selectedDeviceUuid = "";
    selectedCamaraUuid = "";
    camaras = [];
    dispositivos = [];

    if (!selectedSalaUuid) return;

    isLoadingDispositivos = true;
    try {
      const res = await getDispositivosCamaras({ sala_uuid: selectedSalaUuid });
      if (res && res.success) {
        dispositivos = res.data || [];
        if (dispositivos.length > 0) {
          selectedDeviceUuid = dispositivos[0].uuid || dispositivos[0].id;
          await onDeviceChange();
        }
      }
    } catch (err) {
      console.error("Error al cargar dispositivos:", err);
      triggerToast(`Error al obtener grabadores: ${err.message}`, "error");
    } finally {
      isLoadingDispositivos = false;
    }
  }

  async function onDeviceChange() {
    selectedCamaraUuid = "";
    camaras = [];
    if (!selectedDeviceUuid) return;

    isLoadingCamaras = true;
    try {
      const res = await getCamaras({ dispositivo_camara_uuid: selectedDeviceUuid });
      if (res && res.success) {
        camaras = res.data || [];
        if (camaras.length > 0) {
          selectedCamaraUuid = camaras[0].uuid || camaras[0].id;
        }
      }
    } catch (err) {
      console.error("Error al cargar cámaras del dispositivo:", err);
      triggerToast(`Error al obtener canales: ${err.message}`, "error");
    } finally {
      isLoadingCamaras = false;
    }
  }

  $: currentDevice = dispositivos.find(d => String(d.uuid || d.id) === String(selectedDeviceUuid));
  $: currentCamara = camaras.find(c => String(c.uuid || c.id) === String(selectedCamaraUuid));

  // Generador de URL RTSP directa para visualización instantánea
  $: rtspUrl = (() => {
    if (!currentDevice || !currentCamara) return "";
    const ip = currentDevice.ip_local || "127.0.0.1";
    const port = currentDevice.puerto_rtsp || 554;
    const user = currentDevice.usuario || "admin";
    const ch = currentCamara.numero_canal || 1;
    const streamId = streamType === "main" ? "1" : "2";
    // Formato estándar Hikvision: /Streaming/Channels/{channel}0{stream}
    return `rtsp://${user}:*****@${ip}:${port}/Streaming/Channels/${ch}0${streamId}`;
  })();

  function setQuickTimeRange(minutes) {
    const now = new Date();
    const endStr = now.toTimeString().split(" ")[0];
    const startDate = new Date(now.getTime() - minutes * 60000);
    const startStr = startDate.toTimeString().split(" ")[0];
    horaInicio = startStr;
    horaFin = endStr;
    fecha = getLocalDateStr();
    triggerToast(`Rango fijado: últimos ${minutes} minutos`, "info");
  }

  function setShiftTimeRange(shift) {
    if (shift === "morning") {
      horaInicio = "07:00:00";
      horaFin = "15:00:00";
    } else if (shift === "evening") {
      horaInicio = "15:00:00";
      horaFin = "23:00:00";
    } else if (shift === "night") {
      horaInicio = "23:00:00";
      horaFin = "07:00:00";
    }
    triggerToast(`Turno seleccionado (${shift})`, "info");
  }

  function copyRtspUrl() {
    if (!rtspUrl) return;
    navigator.clipboard.writeText(rtspUrl);
    triggerToast("URL RTSP copiada al portapapeles", "success");
  }

  async function handleStartDownload() {
    if (!selectedDeviceUuid || !selectedCamaraUuid) {
      triggerToast("Selecciona el grabador y el canal deseado", "warning");
      return;
    }

    if (!fecha || !horaInicio || !horaFin) {
      triggerToast("Especifica la fecha y el rango de horas", "warning");
      return;
    }

    const dev = currentDevice;
    const cam = currentCamara;
    const salaObj = salas.find(s => String(s.uuid || s.id) === String(selectedSalaUuid));
    const salaNombre = (salaObj?.nombre || "SALA").replace(/\s+/g, "_");
    const devNombre = (dev?.nombre || "NVR").replace(/\s+/g, "_");
    const camNombre = (cam?.nombre || `CH${cam?.numero_canal || 1}`).replace(/\s+/g, "_");
    const fClean = fecha.replace(/-/g, "");
    const hStartClean = horaInicio.replace(/:/g, "");
    const hEndClean = horaFin.replace(/:/g, "");

    const defaultFilename = `${salaNombre}_${devNombre}_${camNombre}_${fClean}_${hStartClean}-${hEndClean}.mp4`;

    if (!isTauriWindows()) {
      triggerToast("La descarga nativa por SDK requiere ejecutar la app en Windows.", "warning");
      return;
    }

    // Ventana nativa de Windows para elegir dónde guardar ("¿Dónde quieres guardarlo?")
    let suggested = defaultFilename;
    if (targetVideosDir) {
      suggested = `${targetVideosDir}\\${defaultFilename}`;
    }

    let chosenPath = suggested;
    if (alwaysPromptSave) {
      try {
        chosenPath = await promptSaveVideoDialog(suggested);
      } catch (e) {
        console.error("Error abriendo diálogo de guardado:", e);
      }

      if (!chosenPath) {
        // El usuario canceló la ventana de guardar de Windows
        return;
      }
    }

    const lastSlash = Math.max(chosenPath.lastIndexOf('\\'), chosenPath.lastIndexOf('/'));
    if (lastSlash > 0) {
      const parentDir = chosenPath.substring(0, lastSlash);
      targetVideosDir = parentDir;
      localStorage.setItem("cecom_custom_videos_dir", parentDir);
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
      fecha,
      rango: `${horaInicio} a ${horaFin}`,
      streamType: streamType === "main" ? "Principal (Full HD/4K)" : "Secundario (Rápido)",
      status: "Conectando con el grabador por SDK...",
      progress: 5,
      createdAt: new Date().toLocaleTimeString(),
      canOpen: false,
      isError: false,
      errorMsg: null,
      outputPath: chosenPath
    };

    downloadQueue = [downloadItem, ...downloadQueue];

    // Formatear fechas para Converter.exe de Hikvision: YYYY,M,D,H,m,s
    const [startH, startM, startS] = horaInicio.split(":").map(Number);
    const [endH, endM, endS] = horaFin.split(":").map(Number);
    const [fYear, fMonth, fDay] = fecha.split("-").map(Number);

    const inicioStr = `${fYear},${fMonth},${fDay},${startH},${startM},${startS || 0}`;
    const finStr = `${fYear},${fMonth},${fDay},${endH},${endM},${endS || 0}`;

    try {
      triggerToast(`Iniciando extracción de video: ${finalFilename}`, "info");
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

  async function handleOpenTargetFolder() {
    if (targetVideosDir) {
      try {
        await openFolder(targetVideosDir);
      } catch (err) {
        triggerToast(`Error al abrir carpeta: ${err}`, "error");
      }
    }
  }

  async function handleChangeTargetFolder() {
    if (!isTauriWindows()) {
      triggerToast("La selección de carpeta requiere ejecutar la app en Windows.", "warning");
      return;
    }
    try {
      const selected = await promptSelectFolderDialog(targetVideosDir || "C:\\");
      if (selected) {
        targetVideosDir = selected;
        localStorage.setItem("cecom_custom_videos_dir", selected);
        triggerToast(`Carpeta de destino actualizada: ${selected}`, "success");
      }
    } catch (err) {
      console.error("Error al seleccionar carpeta:", err);
      triggerToast(`Error al seleccionar carpeta: ${err}`, "error");
    }
  }
</script>

<div class="descarga-container">
  <!-- Header Principal -->
  <div class="view-header">
    <div class="header-left">
      <div class="icon-badge">📹</div>
      <div>
        <h1 class="header-title">Descarga Rápida de Video CECOM</h1>
        <p class="header-subtitle">
          Extracción nativa de grabaciones desde NVR/DVR Hikvision por red local LAN sin re-codificación pesada de CPU (MP4 Remux Ultrarrápido).
        </p>
      </div>
    </div>
    <div class="header-badges">
      <span class="tech-badge">⚡ Native Stream Copy</span>
      <span class="tech-badge">🔒 Solo Red Local LAN</span>
      {#if isTauriWindows()}
        <span class="tech-badge windows">🪟 Windows Desktop</span>
      {/if}
    </div>
  </div>

  <div class="main-grid">
    <!-- Panel Izquierdo: Configuración de la Solicitud -->
    <div class="card config-card">
      <h2 class="card-title">
        <span class="material-icons-round">tune</span>
        Parámetros de Extracción
      </h2>

      <!-- 1. Selección de Sala y Grabador -->
      <div class="form-row">
        <div class="form-group flex-1">
          <label for="sala-select" class="form-label">1. Sala del Casino</label>
          <select id="sala-select" class="form-select" bind:value={selectedSalaUuid} on:change={onSalaChange}>
            {#each salas as s}
              <option value={s.uuid || s.id}>{s.nombre}</option>
            {/each}
          </select>
        </div>

        <div class="form-group flex-1">
          <label for="device-select" class="form-label">
            2. Grabador / NVR / DVR
            {#if isLoadingDispositivos}
              <span class="spin">⏳</span>
            {/if}
          </label>
          <select id="device-select" class="form-select" bind:value={selectedDeviceUuid} on:change={onDeviceChange} disabled={isLoadingDispositivos || dispositivos.length === 0}>
            {#if dispositivos.length === 0}
              <option value="">No hay grabadores registrados en esta sala</option>
            {:else}
              {#each dispositivos as dev}
                <option value={dev.uuid || dev.id}>
                  {dev.nombre} ({dev.tipo} - {dev.ip_local})
                </option>
              {/each}
            {/if}
          </select>
        </div>
      </div>

      <!-- 2. Selección de Canal / Cámara -->
      <div class="form-group">
        <label for="canal-select" class="form-label">
          3. Canal / Cámara a Descargar
          {#if isLoadingCamaras}
            <span class="spin">⏳</span>
          {/if}
        </label>
        <select id="canal-select" class="form-select" bind:value={selectedCamaraUuid} disabled={isLoadingCamaras || camaras.length === 0}>
          {#if camaras.length === 0}
            <option value="">No hay canales sincronizados en este grabador</option>
          {:else}
            {#each camaras as cam}
              <option value={cam.uuid || cam.id}>
                Canal {cam.numero_canal} - {cam.nombre} {cam.tipo ? `[${cam.tipo}]` : ''}
              </option>
            {/each}
          {/if}
        </select>
      </div>

      <!-- 3. Rango de Fecha y Hora -->
      <div class="form-row">
        <div class="form-group flex-1">
          <label for="fecha-input" class="form-label">Fecha del Evento</label>
          <input id="fecha-input" type="date" class="form-input" bind:value={fecha} />
        </div>

        <div class="form-group flex-1">
          <label for="hora-inicio-input" class="form-label">Hora Inicio (HH:MM:SS)</label>
          <input id="hora-inicio-input" type="time" step="1" class="form-input" bind:value={horaInicio} />
        </div>

        <div class="form-group flex-1">
          <label for="hora-fin-input" class="form-label">Hora Fin (HH:MM:SS)</label>
          <input id="hora-fin-input" type="time" step="1" class="form-input" bind:value={horaFin} />
        </div>
      </div>

      <!-- Atajos Rápidos de Tiempo -->
      <div class="quick-ranges">
        <span class="quick-label">Atajos Rápidos:</span>
        <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(15)}>Últimos 15 min</button>
        <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(30)}>Últimos 30 min</button>
        <button type="button" class="btn-chip" on:click={() => setQuickTimeRange(60)}>Última 1 hora</button>
        <button type="button" class="btn-chip shift" on:click={() => setShiftTimeRange('morning')}>Turno Mañana</button>
        <button type="button" class="btn-chip shift" on:click={() => setShiftTimeRange('evening')}>Turno Tarde</button>
        <button type="button" class="btn-chip shift" on:click={() => setShiftTimeRange('night')}>Turno Noche</button>
      </div>

      <!-- 4. Calidad y Flujo -->
      <div class="stream-select-box">
        <div class="stream-option">
          <input type="radio" id="stream-main" value="main" bind:group={streamType} />
          <label for="stream-main">
            <strong>Flujo Principal (Main Stream)</strong>
            <span>Máxima resolución (1080p / 4K). Recomendado para auditoría legal, cartas y conteo de fichas.</span>
          </label>
        </div>
        <div class="stream-option">
          <input type="radio" id="stream-sub" value="sub" bind:group={streamType} />
          <label for="stream-sub">
            <strong>Flujo Secundario (Sub Stream)</strong>
            <span>Resolución estándar (720p / D1). Descarga en segundos; ideal para inspecciones rápidas.</span>
          </label>
        </div>
      </div>

      <!-- 5. Destino de Guardado Local -->
      {#if isTauriWindows()}
        <div class="dest-config-panel">
          <div class="dest-config-header">
            <span class="dest-config-label">📁 Carpeta Local de Guardado:</span>
            <button type="button" class="btn-dest-change" on:click={handleChangeTargetFolder}>
              Seleccionar Carpeta...
            </button>
          </div>
          <div class="dest-config-path font-mono" title={targetVideosDir}>
            {targetVideosDir || "C:\\Users\\Public\\Downloads\\Wisi_Cecom_Videos"}
          </div>
          <label class="dest-checkbox-row">
            <input 
              type="checkbox" 
              bind:checked={alwaysPromptSave} 
              on:change={() => localStorage.setItem("cecom_always_prompt_save", String(alwaysPromptSave))} 
            />
            <span>Preguntar dónde guardar y confirmar nombre en cada descarga (Ventana "Guardar como...")</span>
          </label>
        </div>
      {/if}

      <!-- Botón de Descarga Primario -->
      <div class="action-footer">
        <button
          type="button"
          class="btn-download"
          on:click={handleStartDownload}
          disabled={!selectedDeviceUuid || !selectedCamaraUuid}
        >
          <span class="material-icons-round">file_download</span>
          Iniciar Descarga Inmediata (MP4 Remux)
        </button>
      </div>
    </div>

    <!-- Panel Derecho: RTSP & Información del Canal Seleccionado -->
    <div class="card info-card">
      <h2 class="card-title">
        <span class="material-icons-round">videocam</span>
        Detalle Técnico y Streaming en Vivo
      </h2>

      {#if currentDevice && currentCamara}
        <div class="device-summary">
          <div class="info-row">
            <span class="lbl">Grabador:</span>
            <span class="val font-mono">{currentDevice.nombre} ({currentDevice.tipo})</span>
          </div>
          <div class="info-row">
            <span class="lbl">IP Local LAN:</span>
            <span class="val font-mono badge-ip">{currentDevice.ip_local}:{currentDevice.puerto_http}</span>
          </div>
          <div class="info-row">
            <span class="lbl">Cámara / Canal:</span>
            <span class="val font-mono">CH {currentCamara.numero_canal} - {currentCamara.nombre}</span>
          </div>
          <div class="info-row">
            <span class="lbl">Protocolo SDK:</span>
            <span class="val badge-sdk">Hikvision NET_DVR Port {currentDevice.puerto_sdk || 8000}</span>
          </div>
        </div>

        <!-- Enlace RTSP Directo -->
        <div class="rtsp-box">
          <div class="rtsp-header">
            <span class="rtsp-title">URL de Flujo RTSP Directo (VLC / PotPlayer)</span>
            <button type="button" class="btn-copy" on:click={copyRtspUrl}>
              Copiar RTSP
            </button>
          </div>
          <input type="text" readonly class="rtsp-input" value={rtspUrl} />
          <p class="rtsp-note">
            💡 Puedes reproducir esta URL directamente en cualquier reproductor conectado al switch o red local del casino.
          </p>
        </div>
      {:else}
        <div class="empty-selection">
          <span class="empty-icon">🎥</span>
          <p>Selecciona una sala, grabador y canal para ver las opciones de conexión y streaming en tiempo real.</p>
        </div>
      {/if}

      <!-- Ventajas del Remuxing -->
      <div class="advantage-box">
        <div class="adv-title">🚀 Ventaja Tecnológica: Zero Re-Encoding</div>
        <p class="adv-text">
          A diferencia de los convertidores tradicionales que consumen el 100% de la CPU para re-renderizar video a MP4, esta herramienta extrae los paquetes H.264/H.265 del NVR y sólo reempaqueta el contenedor a MP4 en milisegundos.
        </p>
      </div>
    </div>
  </div>

  <!-- Cola de Descargas Activas -->
  <div class="card queue-card">
    <div class="queue-header">
      <h2 class="card-title" style="margin: 0;">
        <span class="material-icons-round">format_list_bulleted</span>
        Cola de Descargas de la Sesión ({downloadQueue.length})
      </h2>
      {#if downloadQueue.length > 0}
        <button type="button" class="btn-clear" on:click={() => (downloadQueue = [])}>
          Limpiar Lista
        </button>
      {/if}
    </div>

    <!-- Barra de Estado de Almacenamiento Local -->
    {#if isTauriWindows()}
      <div class="storage-info-bar">
        <div class="storage-meta">
          <span class="storage-icon">💾</span>
          <div>
            <div class="storage-title">Carpeta Local de Destino:</div>
            <div class="storage-path font-mono">{targetVideosDir || "C:\\Users\\Public\\Downloads\\Wisi_Cecom_Videos"}</div>
          </div>
        </div>
        <div class="storage-actions">
          <button type="button" class="btn-storage-change" on:click={handleChangeTargetFolder}>
            📁 Cambiar Carpeta
          </button>
          <button type="button" class="btn-storage-open" on:click={handleOpenTargetFolder}>
            📂 Abrir Carpeta de Videos
          </button>
        </div>
      </div>
    {/if}

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
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #ffffff;
    padding: 20px 24px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .icon-badge {
    font-size: 32px;
    background: #eff6ff;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid #bfdbfe;
  }

  .header-title {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
  }

  .header-subtitle {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .header-badges {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .tech-badge {
    font-size: 11.5px;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 20px;
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .tech-badge.windows {
    background: #e0f2fe;
    color: #0369a1;
    border-color: #bae6fd;
  }

  .main-grid {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 20px;
  }

  @media (max-width: 1024px) {
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
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 18px;
    padding: 10px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .quick-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
  }

  .btn-chip {
    padding: 4px 10px;
    font-size: 11.5px;
    font-weight: 700;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-chip:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .btn-chip.shift {
    background: #f1f5f9;
  }

  .stream-select-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 22px;
  }

  .stream-option {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: #f8fafc;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    cursor: pointer;
  }

  .stream-option input {
    margin-top: 3px;
    cursor: pointer;
  }

  .stream-option label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    cursor: pointer;
    font-size: 13px;
    color: #1e293b;
  }

  .stream-option label span {
    font-size: 11.5px;
    color: #64748b;
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

  /* Info Card */
  .device-summary {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #f8fafc;
    padding: 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    margin-bottom: 16px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
  }

  .lbl {
    color: #64748b;
    font-weight: 600;
  }

  .val {
    color: #0f172a;
    font-weight: 700;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .badge-ip {
    background: #e2e8f0;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .badge-sdk {
    background: #ecfdf5;
    color: #065f46;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 700;
  }

  .rtsp-box {
    background: #0f172a;
    color: #f8fafc;
    padding: 14px;
    border-radius: 8px;
    margin-bottom: 16px;
  }

  .rtsp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .rtsp-title {
    font-size: 11.5px;
    font-weight: 700;
    color: #94a3b8;
  }

  .btn-copy {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .rtsp-input {
    width: 100%;
    background: #1e293b;
    border: 1px solid #334155;
    color: #38bdf8;
    padding: 8px 10px;
    font-size: 12px;
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    outline: none;
  }

  .rtsp-note {
    font-size: 11px;
    color: #94a3b8;
    margin: 8px 0 0 0;
  }

  .empty-selection {
    text-align: center;
    padding: 30px;
    color: #64748b;
    font-size: 13px;
  }

  .empty-icon {
    font-size: 40px;
    display: block;
    margin-bottom: 8px;
  }

  .advantage-box {
    background: #eff6ff;
    border-left: 4px solid #2563eb;
    padding: 12px 14px;
    border-radius: 6px;
  }

  .adv-title {
    font-size: 12px;
    font-weight: 800;
    color: #1e40af;
    margin-bottom: 4px;
  }

  .adv-text {
    font-size: 11.5px;
    color: #334155;
    line-height: 1.5;
    margin: 0;
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
