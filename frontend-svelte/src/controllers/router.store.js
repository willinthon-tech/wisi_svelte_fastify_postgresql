import { writable } from 'svelte/store';

export const currentRouteStore = writable('dashboard');

export function isPublicRoute(route) {
  const clean = route ? String(route).replace(/^#\/?/, '').replace(/^\//, '').trim() : '';
  return clean === 'willinthontech' || 
         clean.startsWith('reportes/rrhh/corte/') || 
         clean.startsWith('reportes/cecom/libro/') || 
         clean.startsWith('reportes/cecom/ibro/') ||
         clean.startsWith('reportes/maquinas');
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
