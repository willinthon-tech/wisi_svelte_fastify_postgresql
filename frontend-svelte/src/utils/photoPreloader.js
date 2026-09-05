/**
 * Gestor Global y Persistente de Precarga de Fotografías WISI
 * Almacena en window.__wisiGlobalBlobCache los Blob ObjectURLs decodificados en RAM
 * para garantizar que la navegación entre fotos sea instantánea (0ms) y NO repita peticiones de red.
 */

if (typeof window !== 'undefined') {
  if (!window.__wisiGlobalPhotoCache) window.__wisiGlobalPhotoCache = new Map();
  if (!window.__wisiGlobalBlobCache) window.__wisiGlobalBlobCache = new Map();
}

export function getGlobalImageCache() {
  if (typeof window !== 'undefined') {
    if (!window.__wisiGlobalPhotoCache) window.__wisiGlobalPhotoCache = new Map();
    return window.__wisiGlobalPhotoCache;
  }
  return new Map();
}

export function getGlobalBlobCache() {
  if (typeof window !== 'undefined') {
    if (!window.__wisiGlobalBlobCache) window.__wisiGlobalBlobCache = new Map();
    return window.__wisiGlobalBlobCache;
  }
  return new Map();
}

/**
 * Retorna el ObjectURL local en memoria si ya fue precargado, o el URL original
 */
export function getCachedBlobUrl(url) {
  if (!url || typeof window === 'undefined') return url;
  if (url.startsWith('blob:')) return url;
  const blobCache = getGlobalBlobCache();
  if (blobCache.has(url)) {
    return blobCache.get(url);
  }
  return url;
}

/**
 * Retorna true si la foto ya fue completamente descargada y está lista en memoria
 */
export function isPhotoLoaded(url) {
  if (!url || typeof window === 'undefined') return false;
  if (url.startsWith('blob:')) return true;
  const blobCache = getGlobalBlobCache();
  if (blobCache.has(url)) return true;

  const cache = getGlobalImageCache();
  const entry = cache.get(url);
  if (!entry) return false;
  if (entry.hasError) return false;
  return Boolean(entry.loaded);
}

/**
 * Retorna el elemento Image o BlobURL si ya está cargado con éxito, o null
 */
export function getLoadedImage(url) {
  if (!url || typeof window === 'undefined') return null;
  const blobCache = getGlobalBlobCache();
  if (blobCache.has(url)) return blobCache.get(url);

  const cache = getGlobalImageCache();
  const entry = cache.get(url);
  if (entry && entry.loaded && !entry.hasError) {
    return entry.blobUrl || entry.img || null;
  }
  return null;
}

/**
 * Precarga y convierte una foto a Blob ObjectURL persistente en RAM
 */
export function preloadPhoto(url) {
  if (!url || typeof window === 'undefined') {
    return Promise.resolve({ url, blobUrl: url, loaded: true, hasError: false });
  }

  if (url.startsWith('blob:')) {
    return Promise.resolve({ url, blobUrl: url, loaded: true, hasError: false });
  }

  const blobCache = getGlobalBlobCache();
  if (blobCache.has(url)) {
    const bUrl = blobCache.get(url);
    return Promise.resolve({ url, blobUrl: bUrl, loaded: true, hasError: false });
  }

  const cache = getGlobalImageCache();
  if (cache.has(url)) {
    const entry = cache.get(url);
    if (entry.loaded && !entry.hasError && entry.blobUrl) {
      return Promise.resolve(entry);
    }
    if (entry.promise) return entry.promise;
  }

  const promise = (async () => {
    let timeoutId = null;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      timeoutId = setTimeout(() => {
        if (controller) controller.abort();
      }, 10000);

      const fetchOptions = {
        mode: 'cors',
        credentials: 'omit'
      };
      if (controller) fetchOptions.signal = controller.signal;

      const res = await fetch(url, fetchOptions);
      if (timeoutId) clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Empty photo blob');
      }

      const blobUrl = URL.createObjectURL(blob);
      blobCache.set(url, blobUrl);

      // Decodificar imagen para calentamiento de GPU/RAM
      const img = new Image();
      img.src = blobUrl;
      try {
        if (typeof img.decode === 'function') {
          await img.decode();
        }
      } catch {
        // Ignorar si decode falla
      }

      const successEntry = {
        url,
        blobUrl,
        img,
        loaded: true,
        hasError: false,
        naturalWidth: img.naturalWidth || 100,
        promise: null
      };
      cache.set(url, successEntry);
      return successEntry;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      const errorEntry = {
        url,
        blobUrl: null,
        img: null,
        loaded: true,
        hasError: true,
        promise: null
      };
      cache.set(url, errorEntry);
      return errorEntry;
    }
  })();

  cache.set(url, { url, blobUrl: null, loaded: false, hasError: false, promise });
  return promise;
}

/**
 * Precarga en paralelo un lote de URLs de imágenes a Blob ObjectURLs
 */
export function preloadPhotosBatch(urls = []) {
  if (!Array.isArray(urls) || urls.length === 0) return Promise.resolve();
  const validUrls = urls.filter((u) => u && typeof u === 'string' && u.trim().length > 0);
  const promises = validUrls.map((u) => preloadPhoto(u));
  return Promise.allSettled(promises);
}
