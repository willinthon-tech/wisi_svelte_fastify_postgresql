// Filtrar errores benignos arrojados por Chrome DevTools / extensiones externas (ej. web-vitals startTime / reportAllChanges en scripts VM)
if (typeof window !== 'undefined') {
  const isIgnored = (msg, src, stack) => {
    const str = `${msg || ''} ${src || ''} ${stack || ''}`.toLowerCase();
    return str.includes('reportallchanges') ||
           (str.includes('starttime') && (str.includes('undefined') || str.includes('null') || str.includes('vm') || str.includes('cannot read propert')));
  };

  window.addEventListener('error', (event) => {
    if (isIgnored(event?.message, event?.filename, event?.error?.stack)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const r = event?.reason;
    if (isIgnored(r?.message, '', r?.stack)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

import { setupGlobalFetchInterceptor } from './config/api.config.js';
setupGlobalFetchInterceptor();

import { isTauriWindows } from './services/tauriIsapi.service.js';
import { registerSW } from 'virtual:pwa-register';

if (typeof window !== 'undefined') {
  const isNativeApp = isTauriWindows() ||
    Boolean(window.Capacitor?.isNativePlatform?.()) ||
    (/Android/i.test(navigator.userAgent) && (window.location.hostname === 'localhost' || window.location.protocol === 'capacitor:'));

  if (isNativeApp) {
    // En Windows (Tauri) y Android (Capacitor), NUNCA usar Service Worker.
    // Desregistrar cualquier Service Worker residual de versiones anteriores y purgar CacheStorage.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const reg of regs) {
          reg.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
  } else {
    // Solo en navegador Web / PWA
    registerSW({ immediate: true });
  }
}

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')
});

export default app;
