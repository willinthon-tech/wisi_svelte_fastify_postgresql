import { triggerToast } from '../controllers/ui.store.js';
import { isTauriApp } from '../config/api.config.js';
import { saveOrShareFile } from './fileSaver.js';

/**
 * Descarga archivos de forma universal y confiable en Android (Capacitor), Windows (Tauri) y Web.
 * En Android delega la descarga al DownloadManager nativo del sistema operativo mediante AndroidKiosk.
 * En Windows (Tauri) guarda el archivo directamente en la carpeta Descargas del usuario y abre el explorador,
 * o delega la descarga al navegador predeterminado de Windows.
 * 
 * @param {string} url - URL completa o relativa del archivo a descargar
 * @param {string} filename - Nombre sugerido del archivo (ej. app-wisi.apk)
 * @param {string} mimeType - Tipo MIME (ej. application/vnd.android.package-archive)
 */
export async function handleDownloadApp(url, filename = 'archivo', mimeType = 'application/octet-stream') {
  if (!url) return;

  triggerToast(`Iniciando descarga de ${filename}...`, 'info');

  // 1. Android Nativo via AndroidKiosk Bridge (DownloadManager nativo con progreso en la barra de Android)
  if (typeof window !== 'undefined' && window.AndroidKiosk?.downloadFile) {
    try {
      window.AndroidKiosk.downloadFile(url, filename, mimeType);
      return;
    } catch (e) {
      console.warn('[Download] Error comunicando con AndroidKiosk:', e);
    }
  }

  // 2. Si estamos en Capacitor Nativo sin el bridge AndroidKiosk
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
    try {
      window.open(url, '_system');
      return;
    } catch (e) {
      console.warn('[Download] Error abriendo URL con _system:', e);
    }
  }

  // 3. Windows Nativo (Tauri Desktop)
  if (isTauriApp()) {
    try {
      // Intentar descargar directamente vía fetch y guardar en Descargas de Windows
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        await saveOrShareFile({
          blob,
          fileName: filename,
          dialogTitle: `Descargar ${filename}`,
          mimeType
        });
        triggerToast(`Descarga completada: ${filename} guardado en Descargas`, 'success');
        return;
      }
    } catch (errTauriFetch) {
      console.warn('[Download] Falló fetch directo en Tauri, abriendo navegador nativo:', errTauriFetch);
    }

    // Fallback en Tauri: Abrir la URL en el navegador predeterminado del sistema
    try {
      let invokeFn = null;
      if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        invokeFn = window.__TAURI_INTERNALS__.invoke;
      } else {
        const tauriCore = await import('@tauri-apps/api/core');
        invokeFn = tauriCore.invoke;
      }
      if (invokeFn) {
        await invokeFn('open_in_browser', { url });
        triggerToast(`Descarga abierta en tu navegador web`, 'success');
        return;
      }
    } catch (errOpen) {
      console.warn('[Download] Falló invoke open_in_browser en Tauri:', errOpen);
    }
  }

  // 4. Navegador Web (Desktop / Mobile Web)
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    }, 1500);
  } catch (e) {
    window.location.href = url;
  }
}
