/**
 * cecomIaBackground.service.js
 * Servicio en segundo plano para la IA de Mesas CECOM.
 * 
 * Monitorea y registra continuamente las mesas de juego activas
 * sin necesidad de que el operador esté dentro de la pantalla de IA.
 * Emite eventos en tiempo real hacia las vistas "IA Tiempo Real" e "IA Novedades".
 */

import { writable } from 'svelte/store';
import { getCecomIaEventos, createCecomIaEvento, getMesasConCamaras } from './cecomVideo.service.js';
import { callLocalIsapi, isTauriWindows } from './tauriIsapi.service.js';

// Estado en tiempo real de cada mesa (para badges superiores de estado en vivo)
export const mesasLiveStatusStore = writable({});

// Flujo de eventos en tiempo real e histórico reciente
export const cecomIaLiveEventsStore = writable([]);

// Estado del worker
let isWorkerRunning = false;
let pollingInterval = null;
let motionInterval = null;

// Memoria de fotogramas y actividad por mesa para detección de movimiento/juego
const frameHistoryMap = {};
const lastDbEmitTimeMap = {};
const idleStartTimeMap = {};
let cachedMesas = [];
let lastMesaFetchTime = 0;

/**
 * Calcula un hash ligero y representativo de la muestra de bytes de la imagen
 */
function getFrameSampleHash(str) {
  if (!str) return 0;
  let hash = 0;
  const len = str.length;
  const step = Math.max(1, Math.floor(len / 120));
  for (let i = 0; i < len; i += step) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Inicializa el worker en segundo plano
 */
export function initCecomIaBackgroundWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  console.log('🤖 [CECOM IA] Worker de fondo iniciado. Monitoreando mesas activas y cámaras en LAN...');

  // 1. Carga inicial y sondeo periódico de eventos en base de datos
  pollRecentEvents();
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(() => {
    pollRecentEvents();
  }, 5000);

  // 2. Monitoreo en tiempo real de movimiento/juego de cámaras físicas (exclusivo Windows Tauri)
  if (isTauriWindows()) {
    sampleLiveMesasMotion();
    if (motionInterval) clearInterval(motionInterval);
    motionInterval = setInterval(() => {
      sampleLiveMesasMotion();
    }, 2500);
  }
}

/**
 * Detiene el worker
 */
export function stopCecomIaBackgroundWorker() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (motionInterval) {
    clearInterval(motionInterval);
    motionInterval = null;
  }
  isWorkerRunning = false;
  console.log('🛑 [CECOM IA] Worker de fondo detenido.');
}

/**
 * Muestrea fotogramas de las cámaras asignadas a las mesas para detectar jugadas en vivo
 */
async function sampleLiveMesasMotion() {
  if (!isTauriWindows()) return;

  const now = Date.now();
  // Refrescar lista de mesas con cámaras cada 20 segundos
  if (now - lastMesaFetchTime > 20000 || cachedMesas.length === 0) {
    try {
      const res = await getMesasConCamaras();
      if (res && res.success && Array.isArray(res.data)) {
        cachedMesas = res.data;
        lastMesaFetchTime = now;
      }
    } catch (e) {
      console.debug('[CECOM IA Live] Error al refrescar mesas:', e.message);
    }
  }

  if (cachedMesas.length === 0) return;

  // Evaluar movimiento en cada mesa asociada
  for (const mesa of cachedMesas) {
    const mesaUuid = mesa.mesa_uuid || mesa.uuid || mesa.id;
    const ip = mesa.dispositivo_ip;
    const canal = parseInt(mesa.numero_canal);
    const user = mesa.dispositivo_usuario || 'admin';
    const clave = mesa.dispositivo_clave || '';

    if (!mesaUuid || !ip || isNaN(canal)) continue;

    try {
      // Solicitar captura instantánea al canal del grabador
      const resPic = await callLocalIsapi(
        ip,
        `/ISAPI/Streaming/channels/${canal}01/picture`,
        'GET',
        null,
        user,
        clave,
        3
      );

      if (resPic && resPic.ok && resPic.data) {
        const currentLen = resPic.data.length;
        const currentHash = getFrameSampleHash(resPic.data);
        const prev = frameHistoryMap[mesaUuid];

        if (prev) {
          const lenDiff = Math.abs(currentLen - prev.len);
          const hashDiff = currentHash !== prev.hash;

          // Se detecta movimiento en el paño cuando el tamaño de la trama JPEG o la muestra de bytes fluctúan
          const isMoving = lenDiff > 80 || (hashDiff && lenDiff > 30);

          if (isMoving) {
            idleStartTimeMap[mesaUuid] = null;
            frameHistoryMap[mesaUuid] = {
              len: currentLen,
              hash: currentHash,
              isMoving: true,
              consecutiveMoves: (prev.consecutiveMoves || 0) + 1,
              lastMoveTime: now
            };

            // Actualizar badge en tiempo real inmediatamente
            mesasLiveStatusStore.update(map => ({
              ...map,
              [mesaUuid]: {
                mesa_uuid: mesaUuid,
                mesa_nombre: mesa.mesa_nombre || 'Mesa',
                juego_nombre: mesa.juego_nombre || 'Juego',
                ultimo_evento: 'JUGANDO - MANO EN PROCESO',
                descripcion: `Movimiento continuo detectado en paño (${mesa.camara_nombre || `Canal ${canal}`})`,
                nivel_alerta: 'INFO',
                es_novedad: false,
                is_moving: true,
                hora: new Date().toLocaleTimeString()
              }
            }));

            // Si el movimiento es sostenido (más de 2 ciclos = ~5 segundos de juego),
            // y no se ha emitido un registro a BD en los últimos 35 segundos para esta mesa:
            const lastEmit = lastDbEmitTimeMap[mesaUuid] || 0;
            if ((prev.consecutiveMoves || 0) >= 2 && now - lastEmit > 35000) {
              lastDbEmitTimeMap[mesaUuid] = now;
              emitIaEvent({
                sala_uuid: mesa.sala_uuid,
                mesa_uuid: mesaUuid,
                mesa_nombre: mesa.mesa_nombre,
                juego_nombre: mesa.juego_nombre,
                tipo_evento: 'JUGADA',
                descripcion: `Mano en juego registrada por sensor de video (${mesa.camara_nombre || `Canal ${canal}`})`,
                nivel_alerta: 'INFO',
                es_novedad: false
              }).catch(err => console.debug('[CECOM IA] Error emitiendo evento:', err.message));
            }
          } else {
            // Sin movimiento en este ciclo
            if (!idleStartTimeMap[mesaUuid]) {
              idleStartTimeMap[mesaUuid] = now;
            }

            frameHistoryMap[mesaUuid] = {
              len: currentLen,
              hash: currentHash,
              isMoving: false,
              consecutiveMoves: 0,
              lastMoveTime: prev.lastMoveTime || now
            };

            // Si lleva más de 10 segundos sin movimiento, pasar a "EN ESPERA"
            const idleDuration = now - idleStartTimeMap[mesaUuid];
            if (idleDuration >= 10000) {
              mesasLiveStatusStore.update(map => {
                const curr = map[mesaUuid];
                if (!curr || !curr.is_moving) return map;
                return {
                  ...map,
                  [mesaUuid]: {
                    ...curr,
                    ultimo_evento: 'EN ESPERA',
                    descripcion: 'Mesa despejada - En espera de próxima mano',
                    is_moving: false
                  }
                };
              });
            }
          }
        } else {
          // Primer frame de referencia
          frameHistoryMap[mesaUuid] = {
            len: currentLen,
            hash: currentHash,
            isMoving: false,
            consecutiveMoves: 0,
            lastMoveTime: now
          };
        }
      }
    } catch (e) {
      console.debug(`[CECOM IA Live] Error en captura de canal ${canal} (${ip}):`, e.message);
    }
  }
}

/**
 * Consulta eventos recientes en segundo plano desde la base de datos
 */
async function pollRecentEvents() {
  try {
    const res = await getCecomIaEventos({ limit: 50 });
    if (res && res.success && Array.isArray(res.data)) {
      cecomIaLiveEventsStore.set(res.data);

      // Actualizar mapa de badges en vivo de mesas solo si la mesa no está actualmente en movimiento activo
      mesasLiveStatusStore.update(currentMap => {
        const statusMap = { ...currentMap };
        for (const ev of res.data) {
          const mId = ev.mesa_uuid || ev.mesa_id;
          if (!mId) continue;
          if (!statusMap[mId] || (!statusMap[mId].is_moving && statusMap[mId].ultimo_evento !== 'JUGANDO - MANO EN PROCESO')) {
            statusMap[mId] = {
              mesa_uuid: mId,
              mesa_nombre: ev.mesa_nombre || statusMap[mId]?.mesa_nombre || 'Mesa',
              juego_nombre: ev.juego_nombre || statusMap[mId]?.juego_nombre || 'Juego',
              ultimo_evento: ev.tipo_evento,
              descripcion: ev.descripcion,
              nivel_alerta: ev.nivel_alerta,
              es_novedad: ev.es_novedad,
              is_moving: false,
              hora: new Date(ev.created_at).toLocaleTimeString()
            };
          }
        }
        return statusMap;
      });
    }
  } catch (err) {
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
