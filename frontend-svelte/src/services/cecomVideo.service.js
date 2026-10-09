/**
 * cecomVideo.service.js
 * Servicio para gestión de NVRs, DVRs, Cámaras y Asociación con Mesas
 * Compatible con la API Fastify (PostgreSQL) y llamadas nativas Tauri en Windows (LAN)
 */

import { callLocalIsapi, isTauriWindows } from './tauriIsapi.service.js';
import { getCloudBaseUrl } from '../config/api.config.js';

/**
 * Normaliza las peticiones a la API
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
  const baseUrl = getCloudBaseUrl();
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);

  const url = `${baseUrl.replace(/\/+$/, '')}/api/cecom${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const res = await fetch(url, options);
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

export async function getMesasConCamaras(params = {}) {
  const query = new URLSearchParams();
  if (params.sala_uuid && params.sala_uuid !== 'all') query.append('sala_uuid', params.sala_uuid);
  const qs = query.toString();
  return await apiRequest(`/mesas-con-camaras${qs ? `?${qs}` : ''}`);
}

export async function getMesaCamaras(mesaUuid) {
  return await apiRequest(`/mesas/${mesaUuid}/camaras`);
}

export async function setMesaCamaras(mesaUuid, camaras) {
  return await apiRequest(`/mesas/${mesaUuid}/camaras`, 'POST', { camaras });
}

export async function clearCecomIaEventos(params = {}) {
  const query = new URLSearchParams();
  if (params.sala_uuid && params.sala_uuid !== 'all') query.append('sala_uuid', params.sala_uuid);
  const qs = query.toString();
  return await apiRequest(`/ia-eventos${qs ? `?${qs}` : ''}`, 'DELETE');
}

// ====================================================================
// AUTO-DESCUBRIMIENTO LOCAL ISAPI (EN APP DE ESCRITORIO WINDOWS)
// ====================================================================

/**
 * Escanea los canales reales de un NVR/DVR directamente desde la red local
 * y verifica puertos físicos habilitados vs deshabilitados vía ISAPI
 */
export async function localScanGrabadorChannels(ipLocal, usuario = 'admin', clave = '') {
  if (!isTauriWindows()) {
    console.warn('El escaneo local ISAPI solo se ejecuta en la aplicación de escritorio Windows');
    return [];
  }

  const canalesEncontrados = [];

  // 1. Obtener canales IP (NVRs o DVRs híbridos)
  // Consultamos tanto la configuración (/channels) como el estado en vivo (/channels/status)
  try {
    // 1.a Estado online/conectado de cada canal IP
    const statusMap = {};
    try {
      const resStatus = await callLocalIsapi(
        ipLocal,
        '/ISAPI/ContentMgmt/InputProxy/channels/status',
        'GET',
        null,
        usuario,
        clave,
        8
      );
      if (resStatus && resStatus.ok && resStatus.data) {
        const statusXml = String(resStatus.data);
        const statusBlocks = statusXml.match(/<InputProxyChannelStatus[\s\S]*?<\/InputProxyChannelStatus>/gi) || [];
        for (const sb of statusBlocks) {
          const sidMatch = sb.match(/<id>(\d+)<\/id>/i);
          const sonlineMatch = sb.match(/<online>(.*?)<\/online>/i);
          const sdetectMatch = sb.match(/<chanDetectResult>(.*?)<\/chanDetectResult>/i);
          if (sidMatch) {
            const sid = parseInt(sidMatch[1]);
            const isOnline = sonlineMatch ? sonlineMatch[1].trim().toLowerCase() === 'true' : false;
            const detectResult = sdetectMatch ? sdetectMatch[1].trim().toLowerCase() : '';
            statusMap[sid] = isOnline || detectResult === 'connect' || detectResult === 'ok';
          }
        }
      }
    } catch (e) {
      console.log('No se obtuvo InputProxy/channels/status:', e.message);
    }

    // 1.b Configuración, nombres e IPs de cada canal IP
    const resProxies = await callLocalIsapi(
      ipLocal,
      '/ISAPI/ContentMgmt/InputProxy/channels',
      'GET',
      null,
      usuario,
      clave,
      10
    );

    if (resProxies && resProxies.ok && resProxies.data) {
      const xmlStr = String(resProxies.data);
      const channelBlocks = xmlStr.match(/<InputProxyChannel[\s\S]*?<\/InputProxyChannel>/gi) || [];

      for (const block of channelBlocks) {
        const idMatch = block.match(/<id>(\d+)<\/id>/i);
        const nameMatch = block.match(/<name>(.*?)<\/name>/i);
        const ipMatch = block.match(/<ipAddress>(.*?)<\/ipAddress>/i);
        const onlineMatch = block.match(/<online>(.*?)<\/online>/i);

        if (idMatch) {
          const idCanal = parseInt(idMatch[1]);
          const nombre = nameMatch ? nameMatch[1].trim() : `Cámara IP ${idCanal}`;
          const ipOrigen = ipMatch ? ipMatch[1].trim() : '';

          // Si el slot del NVR no tiene IP asignada ni nombre personalizado, es un canal no configurado
          if (!ipOrigen && (!nameMatch || !nameMatch[1].trim())) {
            continue;
          }

          // Verificar si está online vía statusMap o etiqueta <online>
          let isOnline = true;
          if (statusMap[idCanal] !== undefined) {
            isOnline = statusMap[idCanal];
          } else if (onlineMatch) {
            isOnline = onlineMatch[1].trim().toLowerCase() === 'true';
          }

          canalesEncontrados.push({
            numero_canal: idCanal,
            nombre: nombre || `Cámara ${idCanal}`,
            tipo: 'IP',
            ip_origen: ipOrigen,
            audio_habilitado: false,
            activo: isOnline,
            habilitado: isOnline,
            estado: isOnline ? 'SEÑAL ACTIVA (IP)' : 'DESCONECTADO'
          });
        }
      }
    }
  } catch (e) {
    console.log('No se obtuvieron canales InputProxy (posible DVR analógico puro):', e.message);
  }

  // 1.c Fallback para NVRs que no exponen InputProxy: consultar Streaming/channels
  if (canalesEncontrados.length === 0) {
    try {
      const resStream = await callLocalIsapi(
        ipLocal,
        '/ISAPI/Streaming/channels',
        'GET',
        null,
        usuario,
        clave,
        8
      );
      if (resStream && resStream.ok && resStream.data) {
        const xmlStr = String(resStream.data);
        const streamBlocks = xmlStr.match(/<StreamingChannel[\s\S]*?<\/StreamingChannel>/gi) || [];
        const seenChannels = new Set();

        for (const block of streamBlocks) {
          const idMatch = block.match(/<id>(\d+)<\/id>/i);
          const nameMatch = block.match(/<channelName>(.*?)<\/channelName>/i);
          const enabledMatch = block.match(/<enabled>(.*?)<\/enabled>/i);
          const videoInIdMatch = block.match(/<dynVideoInputChannelID>(\d+)<\/dynVideoInputChannelID>/i);

          if (idMatch) {
            const rawId = parseInt(idMatch[1]);
            // En NVRs, 101 -> canal 1, 201 -> canal 2, 1001 -> canal 10
            // Solo procesamos el stream principal (terminado en 01 o 1)
            let canalNum = rawId;
            if (videoInIdMatch) {
              canalNum = parseInt(videoInIdMatch[1]);
            } else if (rawId >= 100) {
              canalNum = Math.floor(rawId / 100);
              if (rawId % 100 !== 1) continue; // Saltar sub-streams (102, 202, etc.)
            }

            if (seenChannels.has(canalNum)) continue;
            seenChannels.add(canalNum);

            const isEnabled = enabledMatch ? enabledMatch[1].trim().toLowerCase() === 'true' : true;
            const nombre = nameMatch ? nameMatch[1].trim() : `Cámara ${canalNum}`;

            canalesEncontrados.push({
              numero_canal: canalNum,
              nombre: nombre || `Cámara ${canalNum}`,
              tipo: 'IP',
              ip_origen: '',
              audio_habilitado: false,
              activo: isEnabled,
              habilitado: isEnabled,
              estado: isEnabled ? 'SEÑAL ACTIVA (STREAM)' : 'DESHABILITADO'
            });
          }
        }
      }
    } catch (e) {
      console.log('No se obtuvieron canales vía Streaming/channels:', e.message);
    }
  }

  // 2. Intentar obtener canales de video analógicos estándar (DVRs físicos)
  try {
    const resAnalog = await callLocalIsapi(
      ipLocal,
      '/ISAPI/System/Video/inputs/channels',
      'GET',
      null,
      usuario,
      clave,
      8
    );

    if (resAnalog && resAnalog.ok && resAnalog.data) {
      const xmlStr = String(resAnalog.data);
      const videoBlocks = xmlStr.match(/<VideoInputChannel[\s\S]*?<\/VideoInputChannel>/gi) || [];

      for (const block of videoBlocks) {
        const idMatch = block.match(/<id>(\d+)<\/id>/i);
        const nameMatch = block.match(/<name>(.*?)<\/name>/i);
        const videoEnabledMatch = block.match(/<videoInputEnabled>(.*?)<\/videoInputEnabled>/i);
        const resDescMatch = block.match(/<resDesc>(.*?)<\/resDesc>/i);
        const formatMatch = block.match(/<videoFormat>(.*?)<\/videoFormat>/i);

        if (idMatch) {
          const idCanal = parseInt(idMatch[1]);
          const videoEnabledStr = (videoEnabledMatch ? videoEnabledMatch[1].trim() : '').toLowerCase();
          const resDesc = resDescMatch ? resDescMatch[1].trim() : '';
          const videoFormat = formatMatch ? formatMatch[1].trim() : '';

          // Un puerto físico está deshabilitado si videoInputEnabled es 'false' o la resolución es 'NO VIDEO'
          const isNoVideo = resDesc.toUpperCase().includes('NO VIDEO') || videoFormat.toUpperCase() === 'NO_VIDEO';
          const isEnabled = videoEnabledStr !== 'false' && !isNoVideo;

          // Evitar duplicar si ya vino en InputProxy
          if (!canalesEncontrados.some(c => c.numero_canal === idCanal)) {
            const nombre = nameMatch ? nameMatch[1].trim() : `Cámara Analógica ${idCanal}`;
            canalesEncontrados.push({
              numero_canal: idCanal,
              nombre: nombre || `Cámara ${idCanal}`,
              tipo: 'ANALOGICA',
              ip_origen: null,
              audio_habilitado: false,
              resolucion: resDesc || videoFormat || '',
              activo: isEnabled,
              habilitado: isEnabled,
              estado: isEnabled ? `ACTIVO (${resDesc || 'SEÑAL OK'})` : 'DESHABILITADO / SIN SEÑAL'
            });
          }
        }
      }
    }
  } catch (e) {
    console.log('No se obtuvieron canales VideoInputChannel (normal en NVRs puros):', e.message);
  }

  // Ordenar por número de canal ascendente
  canalesEncontrados.sort((a, b) => a.numero_canal - b.numero_canal);
  return canalesEncontrados;
}

/**
 * Diagnóstico completo ISAPI de puertos físicos de un DVR/NVR
 */
export async function diagnosticarPuertosGrabadorIsapi(ipLocal, usuario = 'admin', clave = '') {
  const canales = await localScanGrabadorChannels(ipLocal, usuario, clave);
  const activos = canales.filter(c => c.activo);
  const deshabilitados = canales.filter(c => !c.activo);

  return {
    success: true,
    total_puertos: canales.length,
    puertos_activos: activos.length,
    puertos_deshabilitados: deshabilitados.length,
    canales,
    activos,
    deshabilitados
  };
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

export async function getCecomIaLiveStatus() {
  return await apiRequest('/ia-live-status');
}

export async function syncCecomIaLiveStatus(mesas) {
  return await apiRequest('/ia-live-sync', 'POST', { mesas });
}


