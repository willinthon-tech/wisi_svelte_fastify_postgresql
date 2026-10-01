import {
  getDispositivosCamaras,
  createDispositivoCamara,
  updateDispositivoCamara,
  deleteDispositivoCamara,
  syncCanalesDispositivo,
  getCamaras,
  getMesasCamaras,
  setMesaCamaras,
  getCecomIaEventos,
  createCecomIaEvento,
  marcarEventoAtendido
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
  fastify.get('/api/cecom/mesas/:mesaUuid/camaras', getMesasCamaras);
  fastify.post('/api/cecom/mesas/:mesaUuid/camaras', setMesaCamaras);

  // Eventos de IA (Tiempo Real y Novedades)
  fastify.get('/api/cecom/ia-eventos', getCecomIaEventos);
  fastify.post('/api/cecom/ia-eventos', createCecomIaEvento);
  fastify.put('/api/cecom/ia-eventos/:uuid/atendido', marcarEventoAtendido);
}

