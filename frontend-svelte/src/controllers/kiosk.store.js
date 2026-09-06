import { writable } from 'svelte/store';
import { triggerToast } from './ui.store.js';

const initialKiosk = typeof localStorage !== 'undefined' ? localStorage.getItem('wisi_kiosk_mode') === 'true' : false;
export const isKioskModeStore = writable(initialKiosk);

/**
 * Detecta si la interfaz nativa de Kiosco de Android está disponible
 */
export function hasAndroidKioskBridge() {
  return typeof window !== 'undefined' && typeof window.AndroidKiosk !== 'undefined';
}

/**
 * Inicializa el estado de Modo Kiosco al arrancar la aplicación
 */
export function initKioskMode() {
  if (typeof window === 'undefined') return;

  const saved = localStorage.getItem('wisi_kiosk_mode') === 'true';
  if (saved) {
    applyKioskState(true, false);
  }
}

/**
 * Aplica el estado de kiosco en Android nativo y en el navegador
 */
function applyKioskState(enable, notify = true) {
  if (typeof window === 'undefined') return;

  isKioskModeStore.set(enable);
  try {
    localStorage.setItem('wisi_kiosk_mode', enable ? 'true' : 'false');
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
      if (notify) triggerToast('🔒 Modo Pantalla Completa activado', 'info');
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      if (notify) triggerToast('🔓 Modo Pantalla Completa desactivado', 'info');
    }
  } catch (e) {}
}

export function enterKioskMode() {
  applyKioskState(true, true);
}

export function exitKioskMode() {
  applyKioskState(false, true);
}

export function toggleKioskMode() {
  let current = false;
  isKioskModeStore.subscribe(val => current = val)();
  applyKioskState(!current, true);
}
