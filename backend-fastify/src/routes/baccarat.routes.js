import {
  getSessions,
  createSession,
  deleteLastSession,
  getMesaData,
  saveMesaData
} from '../controllers/baccarat.controller.js';

export async function baccaratRoutes(fastify, options) {
  // Rutas con prefijo /api/baccarat y /baccarat para máxima compatibilidad
  fastify.get('/api/baccarat/sessions', getSessions);
  fastify.get('/baccarat/sessions', getSessions);

  fastify.post('/api/baccarat/sessions', createSession);
  fastify.post('/baccarat/sessions', createSession);

  fastify.delete('/api/baccarat/sessions/last', deleteLastSession);
  fastify.delete('/baccarat/sessions/last', deleteLastSession);
  fastify.post('/api/baccarat/sessions/delete-last', deleteLastSession);
  fastify.post('/baccarat/sessions/delete-last', deleteLastSession);

  fastify.get('/api/baccarat/mesa-data', getMesaData);
  fastify.get('/baccarat/mesa-data', getMesaData);

  fastify.post('/api/baccarat/mesa-data', saveMesaData);
  fastify.post('/baccarat/mesa-data', saveMesaData);
}
