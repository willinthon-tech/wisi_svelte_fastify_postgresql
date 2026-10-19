import { writable } from 'svelte/store';
import { triggerToast } from './ui.store.js';

/**
 * Detecta si la interfaz nativa de Kiosco de Android está disponible
 */
export function hasAndroidKioskBridge() {
  return (
    (typeof window !== 'undefined' && typeof window.AndroidKiosk !== 'undefined') ||
    (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.())
  );
}

// En Web y Desktop inicializa en false para evitar bloqueos no deseados
const initialKiosk = typeof localStorage !== 'undefined' && hasAndroidKioskBridge() 
  ? localStorage.getItem('wisi_kiosk_mode') === 'true' 
  : false;

export const isKioskModeStore = writable(initialKiosk);
export const isKioskPasswordModalOpenStore = writable(false);

// Sincronizar salida de pantalla completa en navegadores con la tecla Esc
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !hasAndroidKioskBridge()) {
      isKioskModeStore.set(false);
      try { localStorage.removeItem('wisi_kiosk_mode'); } catch (e) {}
    }
  });
}

/**
 * Inicializa el estado de Modo Kiosco al arrancar la aplicación (solo en Android nativo)
 */
export function initKioskMode() {
  if (typeof window === 'undefined') return;

  if (hasAndroidKioskBridge()) {
    const saved = localStorage.getItem('wisi_kiosk_mode') === 'true';
    if (saved) {
      applyKioskState(true, false);
    }
  } else {
    // Limpiar residuos en web
    try { localStorage.removeItem('wisi_kiosk_mode'); } catch (e) {}
    isKioskModeStore.set(false);
  }
}

/**
 * Aplica el estado de kiosco en Android nativo y en el navegador
 */
function applyKioskState(enable, notify = true) {
  if (typeof window === 'undefined') return;

  isKioskModeStore.set(enable);
  try {
    if (enable) {
      localStorage.setItem('wisi_kiosk_mode', 'true');
    } else {
      localStorage.removeItem('wisi_kiosk_mode');
    }
  } catch (e) {}

  // 1. Si estamos en Android nativo con el puente AndroidKiosk o Capacitor
  if (hasAndroidKioskBridge()) {
    try {
      if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.KioskPlugin?.setKiosk) {
        window.Capacitor.Plugins.KioskPlugin.setKiosk({ enable });
      }
      if (typeof window !== 'undefined' && window.AndroidKiosk?.setKiosk) {
        window.AndroidKiosk.setKiosk(enable);
      }
      if (notify) {
        triggerToast(enable ? '🔒 Modo Kiosco 100% activado' : '🔓 Modo Kiosco desactivado', 'info');
      }
      return;
    } catch (e) {
      console.warn('[Kiosk] Error comunicando con AndroidKiosk:', e);
    }
  }

  // 2. Modo Kiosco web/desktop (Pantalla completa estándar de la API Fullscreen)
  try {
    if (enable) {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      if (notify) triggerToast('🔒 Pantalla Completa activada', 'info');
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      if (notify) triggerToast('🔓 Pantalla Completa desactivada', 'info');
    }
  } catch (e) {}
}

export function enterKioskMode() {
  applyKioskState(true, true);
}

export function exitKioskMode() {
  applyKioskState(false, true);
}

export function requestExitKioskMode() {
  isKioskPasswordModalOpenStore.set(true);
}

/**
 * Manejador del botón de Modo Kiosco:
 * - Si está apagado: se activa de inmediato.
 * - Si está encendido: exige la contraseña del usuario antes de desactivar.
 */
export function handleKioskToggleClick() {
  let current = false;
  isKioskModeStore.subscribe(val => current = val)();
  if (current) {
    requestExitKioskMode();
  } else {
    enterKioskMode();
  }
}

export function toggleKioskMode() {
  handleKioskToggleClick();
}

/**
 * Salida Forzada / Emergencia:
 * Desactiva inmediatamente el modo kiosco y cierra/mata la aplicación para volver al sistema operativo
 */
export async function forceExitApp() {
  // 1. Limpiar flags locales de kiosco
  isKioskModeStore.set(false);
  try {
    localStorage.removeItem('wisi_kiosk_mode');
    localStorage.removeItem('wisi_kiosk_active');
  } catch (e) {}

  // 2. Salir de pantalla completa web si estuviese
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    try { document.exitFullscreen().catch(() => {}); } catch (e) {}
  }

  // 3. Puente nativo AndroidKiosk (desactiva kiosco y mata la app directamente en Java)
  if (typeof window !== 'undefined' && window.AndroidKiosk) {
    try {
      if (typeof window.AndroidKiosk.exitKiosk === 'function') {
        window.AndroidKiosk.exitKiosk();
      }
      if (typeof window.AndroidKiosk.forceExit === 'function') {
        window.AndroidKiosk.forceExit();
        return;
      }
    } catch (e) {
      console.warn('Error en AndroidKiosk forceExit:', e);
    }
  }

  // 4. Plugin Capacitor KioskPlugin o App
  try {
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.KioskPlugin?.forceExit) {
      await window.Capacitor.Plugins.KioskPlugin.forceExit();
      return;
    }
    if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.App?.exitApp) {
      await window.Capacitor.Plugins.App.exitApp();
      return;
    }
  } catch (e) {}

  // 5. Tauri (Desktop)
  try {
    if (typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)) {
      if (window.__TAURI__?.process?.exit) {
        await window.__TAURI__.process.exit(0);
        return;
      }
    }
  } catch (e) {}

  // 6. Web Fallback
  try {
    window.close();
  } catch (e) {}
}
