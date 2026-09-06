import { triggerToast } from '../controllers/ui.store.js';

/**
 * Descarga archivos de forma universal y confiable en Android (Capacitor), Windows (Tauri) y Web.
 * En Android delega la descarga al DownloadManager nativo del sistema operativo mediante AndroidKiosk.
 * 
 * @param {string} url - URL completa o relativa del archivo a descargar
 * @param {string} filename - Nombre sugerido del archivo (ej. app-wisi.apk)
 * @param {string} mimeType - Tipo MIME (ej. application/vnd.android.package-archive)
 */
export function handleDownloadApp(url, filename = 'archivo', mimeType = 'application/octet-stream') {
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

  // 3. Navegador Web (Desktop / Mobile Web)
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
