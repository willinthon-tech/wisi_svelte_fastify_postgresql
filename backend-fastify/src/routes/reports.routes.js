import { 
  getMarcajePersonalReport,
  saveExcepcionHorario,
  deleteExcepcionHorario,
  getMarcajesRapidos
} from '../controllers/reports.controller.js';

export async function reportsRoutes(fastify, opts) {
  fastify.get('/api/reports/marcaje-personal', getMarcajePersonalReport);
  fastify.get('/api/reports/marcajes-rapidos', getMarcajesRapidos);
  fastify.post('/api/reports/excepciones', saveExcepcionHorario);
  fastify.delete('/api/reports/excepciones/:id', deleteExcepcionHorario);
}
