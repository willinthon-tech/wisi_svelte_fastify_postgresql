import { 
  getMarcajePersonalReport,
  saveExcepcionHorario,
  saveExcepcionRangoHorario,
  deleteExcepcionHorario,
  getMarcajesRapidos,
  updateAttlogStatus
} from '../controllers/reports.controller.js';

export async function reportsRoutes(fastify, opts) {
  fastify.get('/api/reports/marcaje-personal', getMarcajePersonalReport);
  fastify.get('/api/reports/marcajes-rapidos', getMarcajesRapidos);
  fastify.post('/api/reports/excepciones', saveExcepcionHorario);
  fastify.post('/api/reports/excepciones-rango', saveExcepcionRangoHorario);
  fastify.delete('/api/reports/excepciones/:id', deleteExcepcionHorario);
  fastify.put('/api/reports/attlogs/:id/status', updateAttlogStatus);
}

