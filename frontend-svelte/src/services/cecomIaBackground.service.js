/**
 * cecomIaBackground.service.js
 * Servicio en segundo plano para la IA de Mesas CECOM.
 * 
 * Monitorea y registra continuamente las mesas de juego activas
 * sin necesidad de que el operador esté dentro de la pantalla de IA.
 * Emite eventos en tiempo real hacia las vistas "IA Tiempo Real" e "IA Novedades".
 */

import { writable } from 'svelte/store';
import { getCecomIaEventos, createCecomIaEvento, getMesasConCamaras, getCecomIaLiveStatus } from './cecomVideo.service.js';
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

  // 2. Monitoreo en tiempo real de movimiento/juego e IA YOLO (Muestreo ultrarrápido a 600ms)
  sampleLiveMesasMotion();
  if (motionInterval) clearInterval(motionInterval);
  motionInterval = setInterval(() => {
    sampleLiveMesasMotion();
  }, 600);
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
/**
 * Sincroniza las mesas con cámaras con el Motor de IA Python (YOLO)
 */
async function syncMesasWithAiEngine() {
  if (cachedMesas.length === 0) return;
  try {
    const payload = cachedMesas.map(m => ({
      uuid: m.mesa_uuid || m.uuid || m.id,
      nombre: m.mesa_nombre || m.nombre,
      juego_nombre: m.juego_nombre || 'Baccarat',
      dispositivo_ip: m.dispositivo_ip,
      numero_canal: m.numero_canal,
      dispositivo_usuario: m.dispositivo_usuario || 'admin',
      dispositivo_clave: m.dispositivo_clave || '',
      sala_uuid: m.sala_uuid
    }));

    await fetch('http://127.0.0.1:5005/sync_mesas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesas: payload }),
      signal: AbortSignal.timeout(2500)
    });
  } catch (err) {
    // Motor IA aún levantándose o fuera de línea
  }
}

/**
 * Procesa los datos en vivo emitidos por el Motor YOLO Python
 */
function processAiEngineResults(aiData, now) {
  mesasLiveStatusStore.update(map => {
    const next = { ...map };
    for (const [mId, liveAi] of Object.entries(aiData)) {
      const mesa = cachedMesas.find(x => String(x.mesa_uuid || x.uuid || x.id) === String(mId));
      const hasCards = (liveAi.punto && liveAi.punto.length > 0) ||
                       (liveAi.banca && liveAi.banca.length > 0) ||
                       (liveAi.dealer_cards && liveAi.dealer_cards.length > 0);
      const isMoving = hasCards && (liveAi.estado_mesa === 'REPARTIENDO' || liveAi.estado_mesa === 'NORMAL');

      let juegoTipo = liveAi.juego_tipo;
      if (!juegoTipo) {
        const txt = `${mesa?.mesa_nombre || liveAi.mesa_nombre || ''} ${mesa?.juego_nombre || liveAi.juego || ''}`.toUpperCase();
        if (txt.includes('RA') || txt.includes('RT') || txt.includes('RULETA') || txt.includes('ROULETTE')) juegoTipo = 'RULETA';
        else if (txt.includes('TX') || txt.includes('TB') || txt.includes('TEXAS') || txt.includes('HOLDEM') || txt.includes('BONUS')) juegoTipo = 'TEXAS_BONUS';
        else if (txt.includes('PK') || txt.includes('CARIBE') || txt.includes('STUD')) juegoTipo = 'POKER_CARIBENO';
        else if (txt.includes('POKER') && !txt.includes('TEXAS')) juegoTipo = 'POKER_CARIBENO';
        else if (txt.includes('BJ') || txt.includes('BLACKJACK')) juegoTipo = 'BLACKJACK';
        else juegoTipo = 'BACCARAT';
      }

      const isBanca = Boolean(liveAi.is_presentando_banca || liveAi.estado_mesa === 'PRESENTANDO_BANCA' || liveAi.ganador === 'PRESENTANDO BANCA');

      let badgeEvento = 'SIN JUGADA (EN ESPERA)';
      if (isBanca) {
        badgeEvento = '🟡 PRESENTANDO BANCA';
      } else if (juegoTipo === 'RULETA') {
        badgeEvento = 'CILINDRO / PAÑO ACTIVO';
      } else if (!hasCards && (liveAi.estado_mesa === 'ESPERANDO' || liveAi.estado_mesa === 'SIN JUGADA' || liveAi.ganador === 'SIN JUGADA' || liveAi.ganador === 'ESPERANDO')) {
        badgeEvento = 'SIN JUGADA (EN ESPERA)';
      } else if (liveAi.ganador && liveAi.ganador !== 'ESPERANDO' && liveAi.ganador !== 'SIN JUGADA') {
        badgeEvento = (juegoTipo === 'POKER_CARIBENO' || juegoTipo === 'TEXAS_BONUS') ? liveAi.ganador : `${liveAi.ganador} GANA`;
      } else if (liveAi.estado_mesa === 'REPARTIENDO') {
        badgeEvento = 'REPARTIENDO CARTAS...';
      } else {
        badgeEvento = liveAi.estado_mesa || 'SIN JUGADA (EN ESPERA)';
      }

      let desc = liveAi.detalle || (juegoTipo === 'RULETA' ? 'Ruleta Americana (0, 00, 1-36)' : 'Mesa despejada (En espera)');
      if (isBanca) {
        desc = liveAi.detalle || 'Presentación de banca (Conteo e inventario de fichas en paño)';
      } else if (juegoTipo === 'RULETA') {
        desc = 'Mesa de Ruleta Americana activa (0, 00, 1-36)';
      } else if (!hasCards) {
        desc = 'Mesa despejada - Sin jugada activa en paño';
      } else if (liveAi.resultado && liveAi.resultado.descripcion) {
        desc = `${liveAi.resultado.descripcion} | ${liveAi.detalle}`;
      }

      let resolvedJuegoNombre = mesa?.juego_nombre || liveAi.juego;
      if (!resolvedJuegoNombre || resolvedJuegoNombre === 'General') {
        if (juegoTipo === 'TEXAS_BONUS') resolvedJuegoNombre = 'Texas Bonus';
        else if (juegoTipo === 'RULETA') resolvedJuegoNombre = 'Ruleta Americana';
        else if (juegoTipo === 'POKER_CARIBENO') resolvedJuegoNombre = 'Poker Caribeño';
        else if (juegoTipo === 'BLACKJACK') resolvedJuegoNombre = 'Blackjack';
        else resolvedJuegoNombre = 'Baccarat';
      }

      next[mId] = {
        mesa_uuid: mId,
        mesa_nombre: mesa?.mesa_nombre || liveAi.mesa_nombre || 'Mesa',
        juego_nombre: resolvedJuegoNombre,
        ultimo_evento: badgeEvento,
        descripcion: desc,
        nivel_alerta: 'INFO',
        es_novedad: false,
        is_moving: isMoving,
        hora: liveAi.hora || new Date().toLocaleTimeString(),
        // DATOS REALES DE YOLO Y REGLAS DE CASINO:
        ai_active: true,
        juego_tipo: juegoTipo,
        is_presentando_banca: isBanca,
        banca_stacks: liveAi.banca_stacks || 0,
        scoreP: liveAi.scoreP ?? 0,
        scoreB: liveAi.scoreB ?? 0,
        ganador: liveAi.ganador || 'SIN JUGADA',
        punto: liveAi.punto || [],
        banca: liveAi.banca || [],
        dealer_cards: liveAi.dealer_cards || ((juegoTipo === 'POKER_CARIBENO' || juegoTipo === 'TEXAS_BONUS') ? (liveAi.punto?.concat(liveAi.banca || []) || []) : []),
        dealer_jugada: liveAi.dealer_jugada || '',
        califica: liveAi.califica,
        detalle: liveAi.detalle || '',
        estado_mesa: liveAi.estado_mesa || 'SIN JUGADA',
        resultado: liveAi.resultado || {},
        image_b64: liveAi.image_b64 || '',
        timestamp: liveAi.timestamp || (now / 1000)
      };

      // Registro automático en BD de Wisi cuando concluye la mano
      if (liveAi.resultado?.listo && isMoving) {
        const lastEmit = lastDbEmitTimeMap[mId] || 0;
        if (now - lastEmit > 30000) {
          lastDbEmitTimeMap[mId] = now;
          emitIaEvent({
            sala_uuid: mesa?.sala_uuid,
            mesa_uuid: mId,
            mesa_nombre: mesa?.mesa_nombre || liveAi.mesa_nombre,
            juego_nombre: mesa?.juego_nombre || liveAi.juego,
            tipo_evento: 'JUGADA',
            descripcion: juegoTipo === 'POKER_CARIBENO'
              ? `Poker Caribeño - ${liveAi.ganador}: ${liveAi.dealer_jugada || liveAi.detalle}`
              : `${liveAi.ganador} (${liveAi.scoreP} a ${liveAi.scoreB}) • ${liveAi.detalle}`,
            nivel_alerta: 'INFO',
            es_novedad: false,
            metadata: {
              juego_tipo: juegoTipo,
              califica: liveAi.califica,
              dealer_jugada: liveAi.dealer_jugada,
              scoreP: liveAi.scoreP,
              scoreB: liveAi.scoreB,
              ganador: liveAi.ganador,
              punto: liveAi.punto,
              banca: liveAi.banca,
              detalle: liveAi.detalle
            }
          }).catch(err => console.debug('[CECOM IA] Error registrando jugada en BD:', err.message));
        }
      }
    }
    return next;
  });
}

/**
 * Muestrea fotogramas y consulta el Motor YOLO de IA
 */
async function sampleLiveMesasMotion() {
  const now = Date.now();
  // Refrescar lista de mesas con cámaras cada 20 segundos
  if (now - lastMesaFetchTime > 20000 || cachedMesas.length === 0) {
    try {
      const res = await getMesasConCamaras();
      if (res && res.success && Array.isArray(res.data)) {
        cachedMesas = res.data;
        lastMesaFetchTime = now;
        syncMesasWithAiEngine();
      }
    } catch (e) {
      console.debug('[CECOM IA Live] Error al refrescar mesas:', e.message);
    }
  }

  if (cachedMesas.length === 0) return;

  // 1. INTENTO PRIMARIO: Consultar el Motor de IA Python Local (YOLO en 127.0.0.1:5005)
  try {
    const aiRes = await fetch('http://127.0.0.1:5005/all_mesas', { signal: AbortSignal.timeout(3500) });
    if (aiRes.ok) {
      const aiData = await aiRes.json();
      if (aiData && typeof aiData === 'object' && Object.keys(aiData).length > 0) {
        processAiEngineResults(aiData, now);
        return; // Éxito con Motor de IA YOLO local
      }
    }
  } catch (errAi) {
    // Si no hay motor Python local, procedemos a consultar el Hub central de Wisi
  }

  // 2. INTENTO SECUNDARIO (MULTI-PC): Consultar el estado sincronizado de IA en el backend central (wisi.space)
  try {
    const hubRes = await getCecomIaLiveStatus();
    if (hubRes && hubRes.success && hubRes.data && Object.keys(hubRes.data).length > 0) {
      processAiEngineResults(hubRes.data, now);
      return; // Éxito con datos transmitidos por el backend central
    }
  } catch (errHub) {
    // Backend central no disponible o sin sincronización aún
  }

  if (!isTauriWindows()) return;

  // 3. FALLBACK TERCIARIO: En caso de no haber conexión con el motor, mantener estado en espera sin falsos positivos
  for (const mesa of cachedMesas) {
    const mesaUuid = mesa.mesa_uuid || mesa.uuid || mesa.id;
    const canal = parseInt(mesa.numero_canal);

    mesasLiveStatusStore.update(map => {
      const curr = map[mesaUuid];
      if (curr && curr.image_b64) return map; // Preservar si ya tiene imagen IA
      return {
        ...map,
        [mesaUuid]: {
          mesa_uuid: mesaUuid,
          mesa_nombre: mesa.mesa_nombre || 'Mesa',
          juego_nombre: mesa.juego_nombre || 'Juego',
          ultimo_evento: 'SIN JUGADA (EN ESPERA)',
          descripcion: `Mesa despejada (Canal ${canal || 1}) - En espera de jugada`,
          nivel_alerta: 'INFO',
          es_novedad: false,
          is_moving: false,
          ai_active: true,
          hora: new Date().toLocaleTimeString()
        }
      };
    });
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
          if (!statusMap[mId] || !statusMap[mId].image_b64) {
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
