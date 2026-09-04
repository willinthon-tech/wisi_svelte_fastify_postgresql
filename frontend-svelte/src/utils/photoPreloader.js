/**
 * Gestor Global y Persistente de Precarga de Fotografías WISI
 * Almacena en window.__wisiGlobalPhotoCache los objetos Image decodificados en RAM
 * para garantizar que la navegación entre fotos en modales sea instantánea (0ms).
 */

if (typeof window !== 'undefined' && !window.__wisiGlobalPhotoCache) {
  window.__wisiGlobalPhotoCache = new Map();
}

export function getGlobalImageCache() {
  if (typeof window !== 'undefined') {
    if (!window.__wisiGlobalPhotoCache) window.__wisiGlobalPhotoCache = new Map();
    return window.__wisiGlobalPhotoCache;
  }
  return new Map();
}

/**
 * Retorna true si la foto ya fue completamente descargada y decodificada en memoria
 */
export function isPhotoLoaded(url) {
  if (!url || typeof window === 'undefined') return true;
  const cache = getGlobalImageCache();
  const entry = cache.get(url);
  if (!entry) return false;
  if (entry.hasError) return true; // Marcado como fallido, no hay que esperar
  if (entry.loaded) return true;
  return Boolean(entry.img && entry.img.complete && entry.img.naturalWidth > 0);
}

/**
 * Retorna el elemento Image si ya está cargado con éxito, o null
 */
export function getLoadedImage(url) {
  if (!url || typeof window === 'undefined') return null;
  const cache = getGlobalImageCache();
  const entry = cache.get(url);
  if (entry && entry.loaded && !entry.hasError && entry.img && entry.img.naturalWidth > 0) {
    return entry.img;
  }
  return null;
}

/**
 * Precarga y decodifica una imagen en RAM
 */
export function preloadPhoto(url) {
  if (!url || typeof window === 'undefined') return Promise.resolve(null);
  const cache = getGlobalImageCache();

  if (cache.has(url)) {
    const entry = cache.get(url);
    if (entry.loaded || entry.hasError) {
      return Promise.resolve(entry.img);
    }
    if (entry.promise) return entry.promise;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';

  const promise = new Promise((resolve) => {
    let settled = false;

    const onFinishSuccess = async () => {
      if (!settled) {
        settled = true;
        try {
          if (typeof img.decode === 'function') {
            await img.decode();
          }
        } catch {
          // Ignorar fallo de decode
        }
        cache.set(url, { img, loaded: true, hasError: false, promise: null });
        resolve(img);
      }
    };

    const onFinishError = () => {
      if (!settled) {
        settled = true;
        cache.set(url, { img, loaded: true, hasError: true, promise: null });
        resolve(img);
      }
    };

    img.onload = onFinishSuccess;
    img.onerror = onFinishError;

    // Timeout de seguridad de 2.5 segundos para no colgar la UI si la red es lenta o la imagen no existe
    setTimeout(onFinishError, 2500);
  });

  cache.set(url, { img, loaded: false, hasError: false, promise });
  img.src = url;
  return promise;
}

/**
 * Precarga en paralelo un lote de URLs de imágenes
 */
export function preloadPhotosBatch(urls = []) {
  if (!Array.isArray(urls) || urls.length === 0) return Promise.resolve();
  const validUrls = urls.filter((u) => u && typeof u === 'string' && u.trim().length > 0);
  const promises = validUrls.map((u) => preloadPhoto(u));
  return Promise.allSettled(promises);
}
