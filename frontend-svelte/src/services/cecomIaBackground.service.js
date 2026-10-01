/**
 * cecomIaBackground.service.js
 * Servicio en segundo plano para la IA de Mesas CECOM.
 * 
 * Monitorea y registra continuamente las mesas de juego activas
 * sin necesidad de que el operador esté dentro de la pantalla de IA.
 * Emite eventos en tiempo real hacia las vistas "IA Tiempo Real" e "IA Novedades".
 */

import { writable } from 'svelte/store';
import { getCecomIaEventos, createCecomIaEvento } from './cecomVideo.service.js';

// Estado en tiempo real de cada mesa (para badges superiores de estado en vivo)
export const mesasLiveStatusStore = writable({});

// Flujo de eventos en tiempo real e histórico reciente
export const cecomIaLiveEventsStore = writable([]);

// Estado del worker
let isWorkerRunning = false;
let pollingInterval = null;
let lastKnownEventTimestamp = null;

/**
 * Inicializa el worker en segundo plano
 */
export function initCecomIaBackgroundWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  console.log('🤖 [CECOM IA] Worker de fondo iniciado. Monitoreando mesas activas...');

  // Carga inicial
  pollRecentEvents();

  // Sondeo en segundo plano cada 6 segundos para actualización transparente
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    pollRecentEvents();
  }, 6000);
}

/**
 * Detiene el worker
 */
export function stopCecomIaBackgroundWorker() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  isWorkerRunning = false;
  console.log('🛑 [CECOM IA] Worker de fondo detenido.');
}

/**
 * Consulta eventos recientes en segundo plano
 */
async function pollRecentEvents() {
  try {
    const res = await getCecomIaEventos({ limit: 50 });
    if (res && res.success && Array.isArray(res.data)) {
      cecomIaLiveEventsStore.set(res.data);

      // Actualizar mapa de badges en vivo de mesas
      const statusMap = {};
      for (const ev of res.data) {
        const mId = ev.mesa_uuid || ev.mesa_id;
        if (!mId) continue;
        if (!statusMap[mId]) {
          statusMap[mId] = {
            mesa_uuid: mId,
            mesa_nombre: ev.mesa_nombre || 'Mesa',
            juego_nombre: ev.juego_nombre || 'Juego',
            ultimo_evento: ev.tipo_evento,
            descripcion: ev.descripcion,
            nivel_alerta: ev.nivel_alerta,
            es_novedad: ev.es_novedad,
            hora: new Date(ev.created_at).toLocaleTimeString()
          };
        }
      }
      mesasLiveStatusStore.set(statusMap);
    }
  } catch (err) {
    // Falla silenciosa en segundo plano para no interrumpir al usuario
    console.debug('[CECOM IA Background] Error al sincronizar eventos:', err.message);
  }
}

/**
 * Registra un nuevo evento detectado por la IA (desde el motor de visión o simulador)
 */
export async function emitIaEvent(eventData) {
  try {
    const res = await createCecomIaEvento(eventData);
    if (res && res.success && res.data) {
      const newEv = res.data;
      cecomIaLiveEventsStore.update(list => [newEv, ...list.slice(0, 99)]);

      // Actualizar status map de la mesa
      const mId = newEv.mesa_uuid;
      mesasLiveStatusStore.update(map => ({
        ...map,
        [mId]: {
          mesa_uuid: mId,
          mesa_nombre: newEv.mesa_nombre || 'Mesa',
          juego_nombre: newEv.juego_nombre || 'Juego',
          ultimo_evento: newEv.tipo_evento,
          descripcion: newEv.descripcion,
          nivel_alerta: newEv.nivel_alerta,
          es_novedad: newEv.es_novedad,
          hora: new Date(newEv.created_at).toLocaleTimeString()
        }
      }));

      return newEv;
    }
  } catch (err) {
    console.error('Error al registrar evento IA:', err);
    throw err;
  }
}
