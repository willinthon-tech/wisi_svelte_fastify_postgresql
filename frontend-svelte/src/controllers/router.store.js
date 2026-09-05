import { writable } from 'svelte/store';

export const currentRouteStore = writable('dashboard');

export function isPublicRoute(route) {
  const clean = route ? String(route).replace(/^#\/?/, '').replace(/^\//, '').trim() : '';
  return clean === 'willinthontech' || clean.startsWith('reportes/rrhh/corte/');
}

export function initRouter() {
  if (typeof window === 'undefined') return;

  function parseLocation() {
    let route = window.location.hash.replace(/^#\/?/, '').trim();
    if (!route) {
      const pathname = window.location.pathname.replace(/^\//, '').trim();
      if (pathname === 'willinthontech' || pathname.startsWith('reportes/rrhh/corte/')) {
        route = pathname;
      }
    }
    if (!route) {
      window.location.hash = '#/dashboard';
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
  window.location.hash = `#/${cleanRoute}`;
  currentRouteStore.set(cleanRoute);
}
