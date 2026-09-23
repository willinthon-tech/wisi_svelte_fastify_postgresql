import { writable, get } from 'svelte/store';
import { isTauriWindows } from '../services/tauriIsapi.service.js';
import { triggerToast } from './ui.store.js';
import { loadMasterStoresFromBackend } from './master.store.js';

// Constantes inyectadas por Vite en build time
export const LOCAL_APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
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
 * Comparador semántico de versiones (e.g. '1.0.5' vs '1.0.4')
 * Retorna: 1 si v1 > v2, -1 si v1 < v2, 0 si son iguales
 */
export function compareSemVer(v1, v2) {
  if (!v1 || !v2) return 0;
  const clean1 = String(v1).replace(/^v/i, '').trim();
  const clean2 = String(v2).replace(/^v/i, '').trim();

  const parts1 = clean1.split('.').map(p => parseInt(p, 10) || 0);
  const parts2 = clean2.split('.').map(p => parseInt(p, 10) || 0);

  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
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

    // 1. Consultar endpoint central de versión del backend
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
      let newWebVersion = versionData?.version_web || null;

      // Consultar version.json estático emitido por Vite
      try {
        const resJson = await fetch(`/version.json?_t=${Date.now()}`, { cache: 'no-store' });
        if (resJson.ok) {
          const vJson = await resJson.json();
          if (vJson) {
            if (vJson.buildTime && LOCAL_BUILD_TIME > 0 && vJson.buildTime > LOCAL_BUILD_TIME) {
              isWebOutdated = true;
            }
            if (vJson.version && compareSemVer(vJson.version, LOCAL_APP_VERSION) > 0) {
              isWebOutdated = true;
            }
            if (vJson.version) newWebVersion = vJson.version;
          }
        }
      } catch (errJson) {
        // Fallback si no está version.json
      }

      // Si la versión configurada en el backend es mayor a la local
      if (versionData?.version_web && compareSemVer(versionData.version_web, LOCAL_APP_VERSION) > 0) {
        isWebOutdated = true;
      }

      // Si se detectó una versión nueva en Web, activar actualización automática e invisible
      if (isWebOutdated && !isAutoRefreshingWeb) {
        isAutoRefreshingWeb = true;
        triggerToast(
          `🚀 Nueva versión detectada (${newWebVersion || 'reciente'}). Actualizando sistema automáticamente...`,
          'info'
        );
        setTimeout(() => {
          executeHardRefresh();
        }, 1800);
        return versionData;
      }

      // Si no hay cambio de código, refrescar silenciosamente las tablas maestras
      if (options.isSilent) {
        loadMasterStoresFromBackend().catch(() => {});
      }
    }

    // --- PLATAFORMA WINDOWS (Desktop Tauri) ---
    else if (platform === 'windows') {
      const remoteWinVersion = versionData?.version_windows || '1.0.0';
      const isNewer = compareSemVer(remoteWinVersion, LOCAL_APP_VERSION) > 0;

      if (isNewer) {
        availableUpdateStore.set({
          platform: 'windows',
          platformName: 'Windows',
          platformIcon: '🪟',
          currentVersion: LOCAL_APP_VERSION,
          remoteVersion: remoteWinVersion,
          downloadUrl: versionData?.url_descarga_windows || '',
          notes: versionData?.notas_version || '',
          isForced: Boolean(versionData?.forzar_actualizacion),
          updatedAt: versionData?.updated_at
        });
        isVersionModalOpenStore.set(true);
      } else {
        // Siempre refrescar datos del backend en segundo plano
        loadMasterStoresFromBackend().catch(() => {});
      }
    }

    // --- PLATAFORMA ANDROID (Capacitor) ---
    else if (platform === 'android') {
      const remoteAndroidVersion = versionData?.version_android || '1.0.0';
      const isNewer = compareSemVer(remoteAndroidVersion, LOCAL_APP_VERSION) > 0;

      if (isNewer) {
        availableUpdateStore.set({
          platform: 'android',
          platformName: 'Android',
          platformIcon: '🤖',
          currentVersion: LOCAL_APP_VERSION,
          remoteVersion: remoteAndroidVersion,
          downloadUrl: versionData?.url_descarga_android || '',
          notes: versionData?.notas_version || '',
          isForced: Boolean(versionData?.forzar_actualizacion),
          updatedAt: versionData?.updated_at
        });
        isVersionModalOpenStore.set(true);
      } else {
        // Refrescar datos del backend en segundo plano
        loadMasterStoresFromBackend().catch(() => {});
      }
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

  // 1. Chequeo inicial a los 4 segundos del arranque
  setTimeout(() => {
    checkSystemVersion({ isSilent: true });
  }, 4000);

  // 2. Chequeo periódico cada 5 minutos
  if (versionCheckerInterval) clearInterval(versionCheckerInterval);
  versionCheckerInterval = setInterval(() => {
    checkSystemVersion({ isSilent: true });
  }, 5 * 60 * 1000);

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
