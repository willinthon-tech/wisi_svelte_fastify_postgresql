import { 
  getMarcajePersonalReport,
  saveExcepcionHorario,
  saveExcepcionRangoHorario,
  deleteExcepcionHorario,
  getExcepcionesEmpleado,
  deleteExcepcionesRango,
  getMarcajesRapidos,
  updateAttlogStatus
} from '../controllers/reports.controller.js';

export async function reportsRoutes(fastify, opts) {
  fastify.get('/api/reports/marcaje-personal', getMarcajePersonalReport);
  fastify.get('/api/reports/marcajes-rapidos', getMarcajesRapidos);
  fastify.get('/api/reports/excepciones-empleado', getExcepcionesEmpleado);
  fastify.post('/api/reports/excepciones', saveExcepcionHorario);
  fastify.post('/api/reports/excepciones-rango', saveExcepcionRangoHorario);
  fastify.post('/api/reports/excepciones-rango/delete', deleteExcepcionesRango);
  fastify.delete('/api/reports/excepciones/:id', deleteExcepcionHorario);
  fastify.put('/api/reports/attlogs/:id/status', updateAttlogStatus);
}

