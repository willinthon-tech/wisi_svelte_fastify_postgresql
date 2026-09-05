// Filtrar errores benignos arrojados por Chrome DevTools / extensiones externas (ej. web-vitals startTime / reportAllChanges en scripts VM)
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const msg = event?.message || '';
    const src = event?.filename || '';
    if (
      (msg.includes('startTime') && (src.includes('VM') || !src || msg.includes('reportAllChanges'))) ||
      msg.includes('reportAllChanges')
    ) {
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
