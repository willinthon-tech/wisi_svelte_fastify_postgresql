import { isTauriWindows } from './tauriIsapi.service.js';

let unlistenProgress = null;

async function getInvoke() {
  if (typeof window === 'undefined') return null;
  if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
    return window.__TAURI_INTERNALS__.invoke;
  }
  try {
    const tauriCore = await import('@tauri-apps/api/core');
    return tauriCore.invoke;
  } catch (e) {
    console.warn('[tauriVideo] Tauri core not available:', e);
    return null;
  }
}

/**
 * Obtiene rutas por defecto de guardado y detector de Converter.exe
 */
export async function getCecomDefaultPaths() {
  if (!isTauriWindows()) {
    return {
      dest_dir: 'Descargas (Web/Nube)',
      sdk_converter_path: '',
      sdk_available: false
    };
  }
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke('get_cecom_default_paths');
  } catch (e) {
    console.error('Error obteniendo rutas CECOM en Tauri:', e);
    return null;
  }
}

/**
 * Abre el video MP4 con el reproductor nativo de Windows (VLC, Películas y TV, etc.)
 */
export async function openMediaFile(filePath) {
  if (!isTauriWindows()) return;
  const invoke = await getInvoke();
  if (!invoke) return;
  return await invoke('open_media_file', { filePath });
}

/**
 * Abre la carpeta en el Explorador de Windows con el archivo MP4 seleccionado
 */
export async function showInFolder(filePath) {
  if (!isTauriWindows()) return;
  const invoke = await getInvoke();
  if (!invoke) return;
  return await invoke('show_in_folder', { filePath });
}

/**
 * Abre la carpeta contenedora en el Explorador de Windows
 */
export async function openFolder(folderPath) {
  if (!isTauriWindows()) return;
  const invoke = await getInvoke();
  if (!invoke) return;
  return await invoke('open_folder', { folderPath });
}

/**
 * Suscribe un callback a los eventos de progreso de descarga emitidos por Tauri
 */
export async function listenDownloadProgress(callback) {
  if (!isTauriWindows()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
    const unlisten = await listen('cecom_download_progress', (event) => {
      if (callback && event.payload) {
        callback(event.payload);
      }
    });
    unlistenProgress = unlisten;
    return unlisten;
  } catch (e) {
    console.warn('[tauriVideo] No se pudo suscribir a eventos Tauri:', e);
    return () => {};
  }
}

/**
 * Abre el diálogo nativo de Windows (Guardar como...) para que el usuario elija dónde guardar el video
 */
export async function promptSaveVideoDialog(defaultName) {
  if (!isTauriWindows()) return null;
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke('prompt_save_video_dialog', { defaultName: defaultName || 'video.mp4' });
  } catch (e) {
    console.error('Error abriendo diálogo de guardado nativo:', e);
    return null;
  }
}

/**
 * Inicia la descarga nativa con el módulo interno de la SDK de Hikvision
 */
export async function startCecomVideoDownload({
  taskId,
  ip,
  usuario,
  clave,
  canal,
  inicioStr,
  finStr,
  outputFilename,
  destinationPath,
  modo
}) {
  if (!isTauriWindows()) {
    throw new Error('La descarga nativa por SDK local solo está disponible en la versión de Windows.');
  }
  const invoke = await getInvoke();
  if (!invoke) {
    throw new Error('API nativa de Tauri no inicializada.');
  }

  return await invoke('start_cecom_video_download', {
    taskId,
    ip,
    usuario: usuario || 'admin',
    clave: clave || '',
    canal: String(canal),
    inicioStr,
    finStr,
    outputFilename,
    destinationPath: destinationPath || null,
    modo: modo || null
  });
}
