import {
  getDispositivosCamaras,
  createDispositivoCamara,
  updateDispositivoCamara,
  deleteDispositivoCamara,
  syncCanalesDispositivo,
  getCamaras,
  getMesasCamaras,
  getMesasConCamaras,
  setMesaCamaras,
  getCecomIaEventos,
  createCecomIaEvento,
  marcarEventoAtendido,
  clearCecomIaEventos,
  syncIaLiveStatus,
  getIaLiveStatus
} from '../controllers/cecom-video.controller.js';

export default async function cecomVideoRoutes(fastify, options) {
  // Dispositivos Cámaras (NVR, DVR, Cámaras IP)
  fastify.get('/api/cecom/dispositivos-camaras', getDispositivosCamaras);
  fastify.post('/api/cecom/dispositivos-camaras', createDispositivoCamara);
  fastify.put('/api/cecom/dispositivos-camaras/:uuid', updateDispositivoCamara);
  fastify.delete('/api/cecom/dispositivos-camaras/:uuid', deleteDispositivoCamara);
  fastify.post('/api/cecom/dispositivos-camaras/:uuid/sync-canales', syncCanalesDispositivo);

  // Listado de Cámaras (para Descargas y Filtros)
  fastify.get('/api/cecom/camaras', getCamaras);

  // Asociación Mesas <-> Cámaras (para IA de Mesas)
  fastify.get('/api/cecom/mesas-con-camaras', getMesasConCamaras);
  fastify.get('/api/cecom/mesas/:mesaUuid/camaras', getMesasCamaras);
  fastify.post('/api/cecom/mesas/:mesaUuid/camaras', setMesaCamaras);

  // Eventos de IA (Tiempo Real y Novedades)
  fastify.get('/api/cecom/ia-eventos', getCecomIaEventos);
  fastify.post('/api/cecom/ia-eventos', createCecomIaEvento);
  fastify.delete('/api/cecom/ia-eventos', clearCecomIaEventos);
  fastify.put('/api/cecom/ia-eventos/:uuid/atendido', marcarEventoAtendido);

  // Estado Centralizado de IA en Vivo (disponible para todas las PCs y clientes)
  fastify.post('/api/cecom/ia-live-sync', syncIaLiveStatus);
  fastify.get('/api/cecom/ia-live-status', getIaLiveStatus);
}

