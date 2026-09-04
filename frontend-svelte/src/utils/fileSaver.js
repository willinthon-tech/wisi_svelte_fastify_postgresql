import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Convierte un Blob en una cadena base64 de forma asíncrona.
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Detecta si el entorno es un dispositivo móvil real (smartphone o tablet)
 */
function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
    return true;
  }
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

/**
 * Detecta si la app corre dentro de Tauri (ej. Windows Desktop)
 */
function isTauri() {
  if (typeof window === 'undefined') return false;
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return true;
  const loc = window.location;
  if (loc && (loc.hostname === 'tauri.localhost' || loc.protocol === 'tauri:')) {
    return true;
  }
  return false;
}

/**
 * Guarda o comparte un archivo (imagen PNG, JPG, PDF, etc.) de forma universal
 * en Android (Capacitor), Windows (Tauri), y Navegadores Web.
 * 
 * @param {Object} options
 * @param {Blob} options.blob - El contenido binario del archivo
 * @param {string} options.fileName - Nombre del archivo con extensión (ej: Ficha_V123456_2026.png)
 * @param {string} [options.dialogTitle] - Título del diálogo nativo para compartir/guardar
 * @param {string} [options.mimeType] - Tipo MIME (default: 'image/png')
 * @returns {Promise<boolean>}
 */
export async function saveOrShareFile({ blob, fileName, dialogTitle = 'Guardar Imagen', mimeType = 'image/png' }) {
  if (!blob) {
    throw new Error('No hay contenido binario para guardar el archivo.');
  }

  // 1. Plataforma Nativa Móvil: Android / iOS (Capacitor)
  const isCapacitorNative = typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  if (isCapacitorNative) {
    try {
      const dataUrl = await blobToBase64(blob);

      // Guardar en el Cache de la aplicación
      const cacheResult = await Filesystem.writeFile({
        path: fileName,
        data: dataUrl,
        directory: Directory.Cache
      });

      // Intentar guardar copia en Documentos/WISI
      try {
        await Filesystem.writeFile({
          path: `WISI/${fileName}`,
          data: dataUrl,
          directory: Directory.Documents,
          recursive: true
        });
      } catch (docErr) {
        console.warn('[FileSaver] No se pudo guardar copia secundaria en Documents:', docErr);
      }

      // Desplegar la hoja nativa de Android de Guardar / Compartir (WhatsApp, Galería, Drive, etc.)
      const shareAvailable = await Share.canShare();
      if (shareAvailable.value) {
        await Share.share({
          title: fileName,
          text: fileName,
          url: cacheResult.uri,
          dialogTitle: dialogTitle
        });
        return true;
      }
    } catch (nativeErr) {
      console.warn('[FileSaver] Falló guardado nativo con Capacitor, intentando fallback:', nativeErr);
    }
  }

  // 2. Plataforma Nativa de Escritorio: Windows (Tauri)
  if (isTauri()) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));

      let invokeFn = null;
      if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
        invokeFn = window.__TAURI_INTERNALS__.invoke;
      } else {
        try {
          const tauriCore = await import('@tauri-apps/api/core');
          invokeFn = tauriCore.invoke;
        } catch (e) {
          console.warn('[FileSaver] No se pudo cargar @tauri-apps/api/core:', e);
        }
      }

      if (invokeFn) {
        const savedPath = await invokeFn('save_file_to_downloads', { fileName, bytes });
        console.log('[FileSaver] Archivo guardado con éxito en Windows:', savedPath);
        return true;
      }
    } catch (tauriErr) {
      console.warn('[FileSaver] Error con comando nativo Tauri, intentando fallback de navegador:', tauriErr);
    }
  }

  // 3. Navegador Web Móvil (SOLO en teléfonos/tablets Android/iOS en Chrome/Safari móvil)
  // IMPORTANTE: NUNCA ejecutar en Windows desktop porque en WebView2 cuelga la promesa
  if (isMobileDevice() && typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined') {
    try {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fileName,
          text: fileName
        });
        return true;
      }
    } catch (shareErr) {
      if (shareErr.name === 'AbortError') {
        return true; // El usuario canceló la hoja de compartir
      }
      console.warn('[FileSaver] Falló Web Share API en móvil:', shareErr);
    }
  }

  // 4. Navegadores de Escritorio (Chrome, Edge, Firefox en PC o fallback)
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);

  const clickEvent = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window
  });
  link.dispatchEvent(clickEvent);

  setTimeout(() => {
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    URL.revokeObjectURL(blobUrl);
  }, 6000);

  return true;
}
