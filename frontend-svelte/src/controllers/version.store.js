import { writable, get } from 'svelte/store';
import { isTauriWindows } from '../services/tauriIsapi.service.js';
import { triggerToast } from './ui.store.js';
import { loadMasterStoresFromBackend } from './master.store.js';
import { toBackendUrl } from '../config/api.config.js';

// Versión local inyectada en build time
export const LOCAL_APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v6';
export const LOCAL_BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? Number(__BUILD_TIME__) : 0;

// Stores reactivos
export const systemVersionStore = writable(null);
export const isVersionModalOpenStore = writable(false);
export const availableUpdateStore = writable(null);
export const isCheckingVersionStore = writable(false);
export const isUpdatingWebStore = writable(false);

/**
 * Detecta la plataforma en la que corre la aplicación: 'windows' | 'android' | 'web'
 */
export function getAppPlatform() {
  if (typeof window === 'undefined') return 'web';
  if (isTauriWindows()) return 'windows';

  const isAndroid = (typeof window.Capacitor !== 'undefined' && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android') ||
    (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) && (window.location.hostname === 'localhost' || window.location.protocol === 'capacitor:'));

  if (isAndroid) return 'android';
  return 'web';
}

/**
 * Parsea el número de versión entero (e.g. 'v6' -> 6, 'app-wisi-windows-v7-...' -> 7, '6.0.0' -> 6)
 */
export function parseVersionNumber(val) {
  if (!val) return 1;
  if (typeof val === 'number') return Math.max(1, Math.floor(val));
  const str = String(val).trim();
  const match = str.match(/(?:-v|^v)(\d+)/i) || str.match(/(\d+)/);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }
  return 1;
}

/**
 * Obtiene la versión local de la aplicación leyendo la etiqueta <meta name="app-version-num"> del HTML o bundle compilado
 */
export function getLocalHtmlVersionNum() {
  if (typeof document !== 'undefined') {
    const metaNum = document.querySelector('meta[name="app-version-num"]');
    if (metaNum && metaNum.content) {
      const parsed = parseInt(metaNum.content, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const metaVer = document.querySelector('meta[name="app-version"]');
    if (metaVer && metaVer.content) {
      const parsed = parseVersionNumber(metaVer.content);
      if (parsed > 0) return parsed;
    }
  }
  const compiled = typeof __APP_VERSION_NUM__ !== 'undefined' ? Number(__APP_VERSION_NUM__) : null;
  if (compiled && !isNaN(compiled) && compiled > 0) return compiled;
  return parseVersionNumber(LOCAL_APP_VERSION) || 6;
}

/**
 * Obtiene el build time local leyendo la etiqueta <meta name="build-time"> del HTML o bundle compilado
 */
export function getLocalHtmlBuildTime() {
  if (typeof document !== 'undefined') {
    const metaTime = document.querySelector('meta[name="build-time"]');
    if (metaTime && metaTime.content) {
      const parsed = Number(metaTime.content);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return LOCAL_BUILD_TIME;
}

/**
 * Verifica en el arranque si la versión o build del DOM HTML / Bundle actual es más reciente
 * que la última registrada en el almacenamiento persistente (localStorage).
 * Esto es FUNDAMENTAL para Windows (Tauri .exe) y Android (Capacitor .apk):
 * Cuando el usuario instala una nueva versión (.exe o .apk), la WebView local mantiene
 * residuos de caché, Service Workers y estados viejos.
 * Esta función detecta que se abrió un nuevo instalador/versión, purga de raíz todas las cachés
 * viejas (CacheStorage, Service Workers), sincroniza los datos frescos desde PostgreSQL
 * con loadMasterStoresFromBackend(true) y recarga limpiamente el WebView sin necesidad
 * de que el usuario tenga que presionar manualmente el botón de refrescar.
 */
export async function checkAppVersionOnStartup() {
  if (typeof window === 'undefined') return;

  const platform = getAppPlatform();
  const htmlVerNum = getLocalHtmlVersionNum();
  const htmlBuildTime = getLocalHtmlBuildTime();

  // 1. Verificar si venimos de un reinicio limpio post-actualización
  try {
    const justUpgraded = sessionStorage.getItem('wisi_just_upgraded_reload');
    if (justUpgraded) {
      sessionStorage.removeItem('wisi_just_upgraded_reload');
      triggerToast(`🚀 ¡WISI actualizado a la versión v${htmlVerNum}! Datos y caché sincronizados.`, 'success');
      return;
    }
  } catch (_) {}

  // 2. Leer versión previamente instalada/registrada en este dispositivo
  let savedVer = null;
  let savedBuildTime = null;
  try {
    savedVer = localStorage.getItem('wisi_installed_app_version');
    savedBuildTime = localStorage.getItem('wisi_installed_build_time');
  } catch (_) {}

  const parsedSavedVer = savedVer ? parseVersionNumber(savedVer) : null;
  const parsedSavedBuildTime = savedBuildTime ? Number(savedBuildTime) : null;

  // 3. Determinar si es una actualización sobre una versión anterior
  const isUpgrade = (parsedSavedVer !== null && htmlVerNum > parsedSavedVer) ||
    (parsedSavedBuildTime !== null && htmlBuildTime > 0 && parsedSavedBuildTime > 0 && htmlBuildTime > parsedSavedBuildTime);

  const isFirstRun = parsedSavedVer === null;

  if (isUpgrade || isFirstRun) {
    console.log(`[VersionStore] 🚀 Detectada versión v${htmlVerNum} (build: ${htmlBuildTime}) en ${platform}. ${isUpgrade ? '¡Actualización detectada!' : 'Instalación inicial'}`);

    // Guardar inmediatamente la versión actual en localStorage para evitar bucles
    try {
      localStorage.setItem('wisi_installed_app_version', String(htmlVerNum));
      if (htmlBuildTime > 0) {
        localStorage.setItem('wisi_installed_build_time', String(htmlBuildTime));
      }
    } catch (_) {}

    // Si es una actualización sobre una versión previa (e.g. nuevo .exe o .apk instalado):
    if (isUpgrade) {
      console.log(`[VersionStore] Purgando automáticamente cachés viejas y sincronizando datos...`);

      // A) Limpiar todos los caches locales de CacheStorage
      if ('caches' in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        } catch (e) {
          console.warn('[VersionStore] Error limpiando CacheStorage:', e);
        }
      }

      // B) Desregistrar Service Workers activos para que no sirvan chunks viejos
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
        } catch (e) {
          console.warn('[VersionStore] Error desregistrando service workers:', e);
        }
      }

      // C) Forzar carga de datos frescos desde PostgreSQL
      try {
        await loadMasterStoresFromBackend(true);
      } catch (e) {}

      // D) En Windows o Android, el motor WebView mantiene scripts y DOM en memoria viva;
      // un reinicio limpio asegura que arranque con 100% de los nuevos archivos y componentes
      if (platform === 'windows' || platform === 'android') {
        try {
          sessionStorage.setItem('wisi_just_upgraded_reload', '1');
        } catch (_) {}
        setTimeout(() => {
          window.location.reload();
        }, 150);
        return;
      }

      triggerToast(`🚀 ¡WISI actualizado a la versión v${htmlVerNum}! Datos y caché sincronizados.`, 'success');
    }
  }
}

/**
 * Ejecuta una recarga limpia completa idéntica a Ctrl + F5:
 * Limpia caches de Service Worker, desregistra workers viejos y recarga la ventana.
 */
export async function executeHardRefresh(customMessage = null) {
  if (typeof window === 'undefined') return;

  isUpdatingWebStore.set(true);

  if (customMessage) {
    triggerToast(customMessage, 'info');
  }

  try {
    // 1. Limpiar todos los caches locales de CacheStorage
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    // 2. Desregistrar Service Workers activos para que al recargar tome el nuevo bundle
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        await reg.unregister();
      }
    }

    // 3. Forzar actualización de datos en memoria y backend
    try {
      await loadMasterStoresFromBackend(true);
    } catch (e) {}

  } catch (err) {
    console.warn('[VersionStore] Advertencia al limpiar caché:', err);
  }

  // Recarga forzada idéntica a presionar el botón circular de la barra
  setTimeout(() => {
    window.location.reload();
  }, 250);
}

let isAutoRefreshingWeb = false;

/**
 * Consulta la versión del sistema en el backend y valida si hay actualizaciones
 */
export async function checkSystemVersion(options = { isSilent: false }) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  if (get(isCheckingVersionStore)) return null;

  isCheckingVersionStore.set(true);

  try {
    const platform = getAppPlatform();

    // 1. Consultar endpoint central de versión del backend (alimentado directamente por la tabla descargas)
    const resVersion = await fetch(`/api/system/version?_t=${Date.now()}`);
    let versionData = null;
    if (resVersion.ok) {
      const json = await resVersion.json();
      if (json && json.success && json.data) {
        versionData = json.data;
        systemVersionStore.set(versionData);
      }
    }

    // 2. Comportamiento según la plataforma:

    // --- PLATAFORMA WEB (PWA / Navegador) ---
    if (platform === 'web') {
      let isWebOutdated = false;
      const currentBuildTime = getLocalHtmlBuildTime();
      const currentVerNum = getLocalHtmlVersionNum();

      // Consultar el index.html del servidor con cache-busting para leer sus etiquetas <meta>
      try {
        const resHtml = await fetch(`/?_t=${Date.now()}`, { cache: 'no-store' });
        if (resHtml.ok) {
          const htmlText = await resHtml.text();
          
          // Extraer la etiqueta <meta name="build-time" content="..."> del servidor
          const timeMatch = htmlText.match(/<meta\s+name=["']build-time["']\s+content=["'](\d+)["']/i);
          if (timeMatch && timeMatch[1]) {
            const serverBuildTime = Number(timeMatch[1]);
            if (serverBuildTime > currentBuildTime) {
              isWebOutdated = true;
            }
          }

          // Extraer la etiqueta <meta name="app-version-num" content="..."> del servidor
          const verMatch = htmlText.match(/<meta\s+name=["']app-version-num["']\s+content=["'](\d+)["']/i);
          if (verMatch && verMatch[1]) {
            const serverVerNum = parseInt(verMatch[1], 10);
            if (serverVerNum > currentVerNum) {
              isWebOutdated = true;
            }
          }
        }
      } catch (errHtml) {}

      // Fallback a version.json si está disponible
      if (!isWebOutdated) {
        try {
          const resJson = await fetch(`/version.json?_t=${Date.now()}`, { cache: 'no-store' });
          if (resJson.ok) {
            const vJson = await resJson.json();
            if (vJson && vJson.buildTime && currentBuildTime > 0 && vJson.buildTime > currentBuildTime) {
              isWebOutdated = true;
            }
          }
        } catch (e) {}
      }

      // Si se detectó una nueva versión en el HTML del servidor:
      if (isWebOutdated && !isAutoRefreshingWeb) {
        isAutoRefreshingWeb = true;
        triggerToast('🚀 Nueva versión web detectada en el servidor. Actualizando aplicación...', 'info');
        setTimeout(() => {
          executeHardRefresh();
        }, 1500);
        return versionData;
      }

      // Refrescar silenciosamente datos en segundo plano
      loadMasterStoresFromBackend(true).catch(() => {});
    }

    // --- PLATAFORMA WINDOWS (Desktop Tauri) ---
    else if (platform === 'windows') {
      const winData = versionData?.windows || {};
      const remoteWinVer = parseVersionNumber(winData.version_num) || parseVersionNumber(winData.archivo) || 1;
      const localWinVer = getLocalHtmlVersionNum();
      const isNewer = remoteWinVer > localWinVer;
      const rawWinUrl = winData.download_url || (winData.archivo ? `/api/downloads/${winData.archivo}` : '');

      if (isNewer) {
        availableUpdateStore.set({
          platform: 'windows',
          platformName: 'Windows',
          platformIcon: '🪟',
          currentVersion: localWinVer,
          remoteVersion: remoteWinVer,
          downloadUrl: rawWinUrl ? toBackendUrl(rawWinUrl) : '',
          filename: winData.archivo,
          peso: winData.peso,
          fecha: winData.fecha
        });
        isVersionModalOpenStore.set(true);
      }

      // Siempre refrescar datos del backend en segundo plano de forma automática
      loadMasterStoresFromBackend(true).catch(() => {});
    }

    // --- PLATAFORMA ANDROID (Capacitor) ---
    else if (platform === 'android') {
      const androidData = versionData?.android || {};
      const remoteAndroidVer = parseVersionNumber(androidData.version_num) || parseVersionNumber(androidData.archivo) || 1;
      const localAndroidVer = getLocalHtmlVersionNum();
      const isNewer = remoteAndroidVer > localAndroidVer;
      const rawAndroidUrl = androidData.download_url || (androidData.archivo ? `/api/downloads/${androidData.archivo}` : '');

      if (isNewer) {
        availableUpdateStore.set({
          platform: 'android',
          platformName: 'Android',
          platformIcon: '🤖',
          currentVersion: localAndroidVer,
          remoteVersion: remoteAndroidVer,
          downloadUrl: rawAndroidUrl ? toBackendUrl(rawAndroidUrl) : '',
          filename: androidData.archivo,
          peso: androidData.peso,
          fecha: androidData.fecha
        });
        isVersionModalOpenStore.set(true);
      }

      // Siempre refrescar datos del backend en segundo plano de forma automática
      loadMasterStoresFromBackend(true).catch(() => {});
    }

    return versionData;
  } catch (err) {
    console.warn('[VersionStore] Error al verificar versión del sistema:', err);
    return null;
  } finally {
    isCheckingVersionStore.set(false);
  }
}

let versionCheckerInterval = null;

/**
 * Inicia el vigilante periódico de versiones en segundo plano
 */
export function initVersionChecker() {
  if (typeof window === 'undefined') return;

  // 0. Ejecutar de inmediato el saneamiento de versión de inicio (Windows / Android / Web)
  checkAppVersionOnStartup().catch(() => {});

  // 1. Chequeo de versiones en el servidor a los 4 segundos del arranque
  setTimeout(() => {
    checkSystemVersion({ isSilent: true });
  }, 4000);

  // 2. Chequeo periódico cada 3 minutos (mantiene datos sincronizados en segundo plano)
  if (versionCheckerInterval) clearInterval(versionCheckerInterval);
  versionCheckerInterval = setInterval(() => {
    checkSystemVersion({ isSilent: true });
  }, 3 * 60 * 1000);

  // 3. Chequeo cuando la pestaña o aplicación vuelve a primer plano (focus / visible)
  window.addEventListener('focus', () => {
    checkSystemVersion({ isSilent: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkSystemVersion({ isSilent: true });
    }
  });
}
