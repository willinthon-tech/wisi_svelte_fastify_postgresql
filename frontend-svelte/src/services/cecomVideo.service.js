/**
 * cecomVideo.service.js
 * Servicio para gestión de NVRs, DVRs, Cámaras y Asociación con Mesas
 * Compatible con la API Fastify (PostgreSQL) y llamadas nativas Tauri en Windows (LAN)
 */

import { callLocalIsapi, isTauriWindows } from './tauriIsapi.service.js';

const API_BASE = '/api/cecom';

/**
 * Normaliza las peticiones a la API
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Error ${res.status}: ${res.statusText}`);
  }
  return data;
}

// ====================================================================
// DISPOSITIVOS CÁMARAS (NVR, DVR, CÁMARAS IP)
// ====================================================================

export async function getDispositivosCamaras(params = {}) {
  const query = new URLSearchParams();
  if (params.sala_uuid) query.append('sala_uuid', params.sala_uuid);
  if (params.search) query.append('search', params.search);
  if (params.active !== undefined) query.append('active', params.active);

  const qs = query.toString();
  return await apiRequest(`/dispositivos-camaras${qs ? `?${qs}` : ''}`);
}

export async function createDispositivoCamara(data) {
  return await apiRequest('/dispositivos-camaras', 'POST', data);
}

export async function updateDispositivoCamara(uuid, data) {
  return await apiRequest(`/dispositivos-camaras/${uuid}`, 'PUT', data);
}

export async function deleteDispositivoCamara(uuid) {
  return await apiRequest(`/dispositivos-camaras/${uuid}`, 'DELETE');
}

export async function syncCanalesDispositivo(uuid, canales) {
  return await apiRequest(`/dispositivos-camaras/${uuid}/sync-canales`, 'POST', { canales });
}

// ====================================================================
// LISTADO DE CÁMARAS (CANALES)
// ====================================================================

export async function getCamaras(params = {}) {
  const query = new URLSearchParams();
  if (params.sala_uuid) query.append('sala_uuid', params.sala_uuid);
  if (params.dispositivo_camara_uuid) query.append('dispositivo_camara_uuid', params.dispositivo_camara_uuid);
  if (params.search) query.append('search', params.search);
  if (params.active !== undefined) query.append('active', params.active);

  const qs = query.toString();
  return await apiRequest(`/camaras${qs ? `?${qs}` : ''}`);
}

// ====================================================================
// ASOCIACIÓN MESAS <-> CÁMARAS (PARA IA DE MESAS)
// ====================================================================

export async function getMesaCamaras(mesaUuid) {
  return await apiRequest(`/mesas/${mesaUuid}/camaras`);
}

export async function setMesaCamaras(mesaUuid, camaras) {
  return await apiRequest(`/mesas/${mesaUuid}/camaras`, 'POST', { camaras });
}

// ====================================================================
// AUTO-DESCUBRIMIENTO LOCAL ISAPI (EN APP DE ESCRITORIO WINDOWS)
// ====================================================================

/**
 * Escanea los canales reales de un NVR/DVR directamente desde la red local
 */
export async function localScanGrabadorChannels(ipLocal, usuario = 'admin', clave = '') {
  if (!isTauriWindows()) {
    console.warn('El escaneo local ISAPI solo se ejecuta en la aplicación de escritorio Windows');
    return [];
  }

  const canalesEncontrados = [];

  // 1. Intentar obtener canales IP (NVRs o DVRs híbridos)
  try {
    const resProxies = await callLocalIsapi(
      ipLocal,
      '/ISAPI/ContentMgmt/InputProxy/channels',
      'GET',
      null,
      usuario,
      clave,
      5
    );

    if (resProxies && resProxies.ok && resProxies.data) {
      const xmlStr = String(resProxies.data);
      // Extraer canales InputProxyChannel mediante regex simple y veloz sin requerir xml2js pesado en navegador
      const channelBlocks = xmlStr.match(/<InputProxyChannel[\s\S]*?<\/InputProxyChannel>/gi) || [];

      for (const block of channelBlocks) {
        const idMatch = block.match(/<id>(\d+)<\/id>/i);
        const nameMatch = block.match(/<name>(.*?)<\/name>/i);
        const ipMatch = block.match(/<ipAddress>(.*?)<\/ipAddress>/i);

        if (idMatch) {
          const idCanal = parseInt(idMatch[1]);
          const nombre = nameMatch ? nameMatch[1].trim() : `Cámara IP ${idCanal}`;
          const ipOrigen = ipMatch ? ipMatch[1].trim() : '';

          canalesEncontrados.push({
            numero_canal: idCanal,
            nombre: nombre || `Cámara ${idCanal}`,
            tipo: 'IP',
            ip_origen: ipOrigen,
            audio_habilitado: false
          });
        }
      }
    }
  } catch (e) {
    console.log('No se obtuvieron canales InputProxy (posible DVR analógico puro):', e.message);
  }

  // 2. Intentar obtener canales de video analógicos estándar (DVRs)
  try {
    const resAnalog = await callLocalIsapi(
      ipLocal,
      '/ISAPI/System/Video/inputs/channels',
      'GET',
      null,
      usuario,
      clave,
      5
    );

    if (resAnalog && resAnalog.ok && resAnalog.data) {
      const xmlStr = String(resAnalog.data);
      const videoBlocks = xmlStr.match(/<VideoInputChannel[\s\S]*?<\/VideoInputChannel>/gi) || [];

      for (const block of videoBlocks) {
        const idMatch = block.match(/<id>(\d+)<\/id>/i);
        const nameMatch = block.match(/<name>(.*?)<\/name>/i);

        if (idMatch) {
          const idCanal = parseInt(idMatch[1]);
          // Evitar duplicar si ya vino en InputProxy
          if (!canalesEncontrados.some(c => c.numero_canal === idCanal)) {
            const nombre = nameMatch ? nameMatch[1].trim() : `Cámara Analógica ${idCanal}`;
            canalesEncontrados.push({
              numero_canal: idCanal,
              nombre: nombre || `Cámara ${idCanal}`,
              tipo: 'ANALOGICA',
              ip_origen: null,
              audio_habilitado: false
            });
          }
        }
      }
    }
  } catch (e) {
    console.log('No se obtuvieron canales VideoInputChannel:', e.message);
  }

  // Ordenar por número de canal ascendente
  canalesEncontrados.sort((a, b) => a.numero_canal - b.numero_canal);
  return canalesEncontrados;
}

// ====================================================================
// EVENTOS IA CECOM (TIEMPO REAL Y NOVEDADES)
// ====================================================================

export async function getCecomIaEventos(params = {}) {
  const query = new URLSearchParams();
  if (params.sala_uuid) query.append('sala_uuid', params.sala_uuid);
  if (params.mesa_uuid) query.append('mesa_uuid', params.mesa_uuid);
  if (params.juego_nombre) query.append('juego_nombre', params.juego_nombre);
  if (params.tipo_evento) query.append('tipo_evento', params.tipo_evento);
  if (params.es_novedad !== undefined) query.append('es_novedad', params.es_novedad);
  if (params.fecha_desde) query.append('fecha_desde', params.fecha_desde);
  if (params.fecha_hasta) query.append('fecha_hasta', params.fecha_hasta);
  if (params.search) query.append('search', params.search);
  if (params.limit) query.append('limit', params.limit);

  const qs = query.toString();
  return await apiRequest(`/ia-eventos${qs ? `?${qs}` : ''}`);
}

export async function createCecomIaEvento(data) {
  return await apiRequest('/ia-eventos', 'POST', data);
}

export async function marcarEventoAtendido(uuid, atendido_por = '') {
  return await apiRequest(`/ia-eventos/${uuid}/atendido`, 'PUT', { atendido_por });
}

