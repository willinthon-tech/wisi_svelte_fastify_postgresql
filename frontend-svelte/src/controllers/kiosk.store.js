import { writable } from 'svelte/store';
import { triggerToast } from './ui.store.js';

/**
 * Detecta si la interfaz nativa de Kiosco de Android está disponible
 */
export function hasAndroidKioskBridge() {
  return typeof window !== 'undefined' && typeof window.AndroidKiosk !== 'undefined';
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

  // 1. Si estamos en Android nativo con el puente AndroidKiosk
  if (hasAndroidKioskBridge()) {
    try {
      window.AndroidKiosk.setKiosk(enable);
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
