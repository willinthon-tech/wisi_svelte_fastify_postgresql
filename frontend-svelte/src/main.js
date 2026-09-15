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

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')
});

export default app;
