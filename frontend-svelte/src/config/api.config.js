import { Capacitor } from '@capacitor/core';

// Configuración Centralizada y Global de API y Endpoints WISI Space

export const CLOUD_SERVER_HOST = 'willinthon.wisi.space';
export const CLOUD_SERVER_ORIGIN = `https://${CLOUD_SERVER_HOST}`;

/**
 * Detecta si la aplicación se está ejecutando dentro de un contenedor nativo (Tauri en Windows o Capacitor en Android)
 */
export function isTauriApp() {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
      return true;
    }
  } catch (e) {}
  if (typeof window.Capacitor !== 'undefined') {
    return true;
  }
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
    return true;
  }
  const loc = window.location;
  if (loc) {
    if (loc.hostname === 'tauri.localhost' || loc.origin?.includes('tauri.localhost') || loc.protocol === 'tauri:' || loc.protocol === 'capacitor:') {
      return true;
    }
    // Android WebView en Capacitor carga comúnmente en https://localhost o http://localhost
    const isAndroidUa = typeof navigator !== 'undefined' && navigator.userAgent && /Android|wv/i.test(navigator.userAgent);
    if ((loc.hostname === 'localhost' || loc.origin?.includes('localhost')) && isAndroidUa) {
      return true;
    }
  }
  return false;
}

export const isNativeApp = isTauriApp;

export function getCloudBaseUrl() {
  if (typeof window !== 'undefined') {
    // 1. URL personalizada definida manualmente por el usuario o administrador
    const savedCustomUrl = localStorage.getItem('wisi_custom_cloud_url');
    if (savedCustomUrl && savedCustomUrl.trim().startsWith('http')) {
      return savedCustomUrl.trim().replace(/\/+$/, '');
    }

    // 2. Si estamos dentro de la app nativa (Tauri en Windows o Capacitor en Android)
    if (isTauriApp()) {
      return CLOUD_SERVER_ORIGIN;
    }

    const { hostname, origin } = window.location;
    // 3. Si estamos en desarrollo local en navegador web de PC (localhost o 127.0.0.1)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3030';
    }
    // 4. En producción en dominio real web (ej. https://willinthon.wisi.space)
    return origin;
  }
  return CLOUD_SERVER_ORIGIN;
}

export function getWsUrl() {
  if (typeof window !== 'undefined') {
    const cloudBase = getCloudBaseUrl();
    try {
      const urlObj = new URL(cloudBase);
      const wsProto = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${urlObj.host}/ws/attlogs`;
    } catch {
      // Fallback si la URL no parsea
    }

    if (isTauriApp()) {
      return `wss://${CLOUD_SERVER_HOST}/ws/attlogs`;
    }

    const { hostname, protocol, host } = window.location;
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'ws://localhost:3030/ws/attlogs';
    }
    return `${wsProto}//${host}/ws/attlogs`;
  }
  return `wss://${CLOUD_SERVER_HOST}/ws/attlogs`;
}

/**
 * Convierte cualquier ruta relativa de backend o multimedia (ej: /empleados/12.jpg, /attlogs/5.jpg)
 * en una URL absoluta que apunta directamente al servidor cloud en la VPS.
 */
export function toBackendUrl(path) {
  if (!path || typeof path !== 'string') return '';
  const clean = path.trim();
  if (clean.startsWith('data:') || clean.startsWith('blob:')) return clean;
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  const base = getCloudBaseUrl();
  const normalized = clean.startsWith('/') ? clean : `/${clean}`;
  return `${base}${normalized}`;
}

/**
 * Interceptor global de window.fetch.
 * Redirige automáticamente todas las peticiones relativas (/api, /attlogs, /empleados, /salas, etc.)
 * al servidor backend cloud (https://willinthon.wisi.space) cuando se ejecuta en Tauri o cuando sea necesario.
 */
export function setupGlobalFetchInterceptor() {
  if (typeof window === 'undefined' || window.__WISI_FETCH_INTERCEPTED__) return;
  window.__WISI_FETCH_INTERCEPTED__ = true;

  const originalFetch = window.fetch;
  const backendPrefixes = ['/api', '/attlogs', '/empleados', '/salas', '/reports', '/ws'];

  window.fetch = async function(input, init) {
    const isTauri = isTauriApp();
    const cloudBase = getCloudBaseUrl();

    let targetUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    let rewrittenUrl = null;

    if (typeof targetUrl === 'string' && targetUrl.length > 0) {
      // 1. Petición relativa directa: ej. '/api/auth/login', '/api/master/usuarios'
      const isRelativeBackend = backendPrefixes.some(
        p => targetUrl === p || targetUrl.startsWith(`${p}/`) || targetUrl.startsWith(`${p}?`)
      );

      if (isRelativeBackend) {
        rewrittenUrl = `${cloudBase}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
      }
      // 2. WebView de Tauri / Capacitor resuelve rutas relativas contra localhost nativo
      else if (isTauri && (
        targetUrl.startsWith('http://tauri.localhost') || 
        targetUrl.startsWith('https://tauri.localhost') || 
        targetUrl.startsWith('tauri://localhost') ||
        targetUrl.startsWith('capacitor://localhost') ||
        targetUrl.startsWith('http://localhost') || 
        targetUrl.startsWith('https://localhost')
      )) {
        try {
          const u = new URL(targetUrl);
          if (backendPrefixes.some(p => u.pathname === p || u.pathname.startsWith(`${p}/`))) {
            rewrittenUrl = `${cloudBase}${u.pathname}${u.search}`;
          }
        } catch (e) {
          // ignore error parse
        }
      }
      // 3. Fallback de localhost:3030 residual dentro de Tauri
      else if (isTauri && (targetUrl.startsWith('http://localhost:3030') || targetUrl.startsWith('http://127.0.0.1:3030'))) {
        try {
          const u = new URL(targetUrl);
          rewrittenUrl = `${cloudBase}${u.pathname}${u.search}`;
        } catch (e) {
          // ignore error parse
        }
      }
    }

    if (rewrittenUrl) {
      if (typeof input === 'string') {
        return originalFetch.call(this, rewrittenUrl, init);
      } else if (input instanceof Request) {
        const newReq = new Request(rewrittenUrl, input);
        return originalFetch.call(this, newReq, init);
      }
    }

    return originalFetch.call(this, input, init);
  };
}

// Inicializar interceptor de fetch automáticamente al cargar el módulo
if (typeof window !== 'undefined') {
  setupGlobalFetchInterceptor();
}

export const CLOUD_BASE_URL = getCloudBaseUrl();

/**
 * Directorio Global de Endpoints de la Aplicación.
 * Agregar aquí cualquier nuevo endpoint que se vaya creando en el sistema.
 */
export const ENDPOINTS = {
  // Autenticación
  AUTH_LOGIN: `${CLOUD_BASE_URL}/api/auth/login`,
  AUTH_VERIFY: `${CLOUD_BASE_URL}/api/auth/verify`,

  // Panel Máster / Administración
  USUARIOS: `${CLOUD_BASE_URL}/api/master/usuarios`,
  SALAS: `${CLOUD_BASE_URL}/api/master/salas`,
  PAGINAS: `${CLOUD_BASE_URL}/api/master/paginas`,
  MODULOS: `${CLOUD_BASE_URL}/api/master/modulos`,
  DISPOSITIVOS: `${CLOUD_BASE_URL}/api/master/dispositivos`,

  // Agente y Marcajes (attlogs)
  ATTLOGS: `${CLOUD_BASE_URL}/api/attlogs`,
  ATTLOGS_SYNC: `${CLOUD_BASE_URL}/api/attlogs/sync`,
  ATTLOG_IMAGE: (id) => `${CLOUD_BASE_URL}/attlogs/${id}/image`,

  // Recursos Operativos (CECOM, RRHH, Máquinas, Mesas, Llaves)
  LIBROS: `${CLOUD_BASE_URL}/api/libros`,
  EMPLEADOS: `${CLOUD_BASE_URL}/api/empleados`,
  CARGOS: `${CLOUD_BASE_URL}/api/cargos`,
  AREAS: `${CLOUD_BASE_URL}/api/areas`,
  DEPARTAMENTOS: `${CLOUD_BASE_URL}/api/departamentos`,
  HORARIOS: `${CLOUD_BASE_URL}/api/horarios`,
  MAQUINAS: `${CLOUD_BASE_URL}/api/maquinas`,
  MESAS: `${CLOUD_BASE_URL}/api/mesas`,
  LLAVES: `${CLOUD_BASE_URL}/api/llaves`
};

// Aliases de conveniencia
export const AGENT_SYNC_ENDPOINT_URL = ENDPOINTS.ATTLOGS_SYNC;
