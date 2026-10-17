import { writable, get } from 'svelte/store';

export const currentRouteStore = writable('dashboard');

export function isPublicRoute(route) {
  const clean = route ? String(route).replace(/^#\/?/, '').replace(/^\//, '').trim() : '';
  return clean === 'willinthontech' || 
         clean.startsWith('reportes/rrhh/corte/') || 
         clean.startsWith('reportes/cecom/libro/') || 
         clean.startsWith('reportes/cecom/ibro/') ||
         clean.startsWith('reportes/maquinas');
}

/**
 * Verifica si la ruta dada (o la activa si no se pasa parámetro) corresponde
 * a /herramientas o cualquiera de sus subrutas (ej: /herramientas/scoreboard-baccarat/...).
 */
export function isHerramientasRoute(route = null) {
  const target = (route !== null && route !== undefined) ? route : (typeof window !== 'undefined' ? get(currentRouteStore) : '');
  const clean = target ? String(target).toLowerCase().replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].trim() : '';
  if (
    clean === 'herramientas' ||
    clean.startsWith('herramientas/') ||
    clean === 'otros/herramientas' ||
    clean.startsWith('otros/herramientas/') ||
    clean.includes('scoreboard-baccarat')
  ) {
    return true;
  }
  if (typeof window !== 'undefined') {
    const hash = String(window.location.hash || '').toLowerCase().replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].trim();
    if (
      hash === 'herramientas' ||
      hash.startsWith('herramientas/') ||
      hash === 'otros/herramientas' ||
      hash.startsWith('otros/herramientas/') ||
      hash.includes('scoreboard-baccarat')
    ) {
      return true;
    }
    const path = String(window.location.pathname || '').toLowerCase().replace(/^\//, '').split('?')[0].trim();
    if (
      path === 'herramientas' ||
      path.startsWith('herramientas/') ||
      path === 'otros/herramientas' ||
      path.startsWith('otros/herramientas/') ||
      path.includes('scoreboard-baccarat')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Verifica si la ruta dada (o la activa si no se pasa parámetro) corresponde
 * única y exclusivamente a /dashboard.
 */
export function isDashboardRoute(route = null) {
  const target = (route !== null && route !== undefined) ? route : (typeof window !== 'undefined' ? get(currentRouteStore) : '');
  const clean = target ? String(target).toLowerCase().replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].trim() : '';
  if (clean === '' || clean === 'dashboard') {
    return true;
  }
  if (typeof window !== 'undefined') {
    const hash = String(window.location.hash || '').toLowerCase().replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].trim();
    if (hash === '' || hash === 'dashboard') {
      return true;
    }
  }
  return false;
}

export function initRouter() {
  if (typeof window === 'undefined') return;

  function parseLocation() {
    let hashRoute = window.location.hash.replace(/^#\/?/, '').trim();
    const pathname = window.location.pathname.replace(/^\//, '').trim();
    const search = window.location.search || '';

    // Si hay un hash activo pero el pathname de la URL contiene una ruta vieja (ej. /reportes/maquinas/shared/:uuid),
    // limpiamos el pathname para que la barra de direcciones quede normal: https://wisi.space/#/ruta
    if (hashRoute && pathname) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', `/#/${hashRoute}`);
      }
      currentRouteStore.set(hashRoute);
      return;
    }

    let route = hashRoute;
    if (!route) {
      if (pathname === 'willinthontech' || 
          pathname.startsWith('reportes/rrhh/corte/') || 
          pathname.startsWith('reportes/cecom/libro/') || 
          pathname.startsWith('reportes/cecom/ibro/') ||
          pathname.startsWith('reportes/maquinas')) {
        route = pathname + search;
      }
    }
    if (!route) {
      if (pathname && window.history && window.history.replaceState) {
        window.history.replaceState({}, '', '/#/dashboard');
      } else {
        window.location.hash = '#/dashboard';
      }
      currentRouteStore.set('dashboard');
    } else {
      currentRouteStore.set(route);
    }
  }

  parseLocation();

  window.addEventListener('hashchange', parseLocation);
  window.addEventListener('popstate', parseLocation);
}

export function navigateToRoute(route) {
  if (typeof window === 'undefined') return;
  const cleanRoute = String(route).replace(/^#\/?/, '').replace(/^\//, '').trim();
  const currentPath = window.location.pathname.replace(/^\//, '').trim();

  if (currentPath) {
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', `/#/${cleanRoute}`);
    } else {
      window.location.href = `/#/${cleanRoute}`;
    }
  } else {
    window.location.hash = `#/${cleanRoute}`;
  }
  currentRouteStore.set(cleanRoute);
}
