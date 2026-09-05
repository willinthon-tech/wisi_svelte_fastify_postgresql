import { 
  getMarcajePersonalReportModel,
  saveExcepcionHorarioModel,
  deleteExcepcionHorarioModel,
  getMarcajesRapidosModel,
  updateAttlogStatusModel
} from '../models/reports.model.js';
import { attlogEvents } from '../events/attlog.events.js';

export async function getMarcajePersonalReport(req, reply) {
  try {
    const { 
      fecha_desde, 
      fecha_hasta, 
      sala_id, 
      sala_ids, 
      user_sala_ids,
      dispositivo_ids, 
      departamento_id, 
      departamento_ids,
      area_id, 
      area_ids,
      cargo_id, 
      cargo_ids,
      sexo, 
      search 
    } = req.query;

    const result = await getMarcajePersonalReportModel({
      fecha_desde,
      fecha_hasta,
      sala_id,
      sala_ids,
      user_sala_ids,
      dispositivo_ids,
      departamento_id,
      departamento_ids,
      area_id,
      area_ids,
      cargo_id,
      cargo_ids,
      sexo,
      search
    });

    return reply.send(result);
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      success: false,
      error: 'Error interno al generar el reporte de marcaje personal',
      details: error.message
    });
  }
}

export async function saveExcepcionHorario(req, reply) {
  try {
    const result = await saveExcepcionHorarioModel(req.body);
    if (result.success) {
      attlogEvents.emit('excepcion_updated', result.data);
    }
    return reply.send(result);
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      success: false,
      error: 'Error al guardar la excepción de horario',
      details: error.message
    });
  }
}

export async function deleteExcepcionHorario(req, reply) {
  try {
    const { id } = req.params;
    const result = await deleteExcepcionHorarioModel(id);
    if (result.success) {
      attlogEvents.emit('excepcion_deleted', { id });
    }
    return reply.send(result);
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      success: false,
      error: 'Error al eliminar la excepción de horario',
      details: error.message
    });
  }
}

export async function getMarcajesRapidos(req, reply) {
  try {
    const { empleado_id, fecha } = req.query;
    const result = await getMarcajesRapidosModel({ empleado_id, fecha });
    return reply.send(result);
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      success: false,
      error: 'Error al consultar marcajes rápidos del empleado',
      details: error.message
    });
  }
}

export async function updateAttlogStatus(req, reply) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    const result = await updateAttlogStatusModel(id, status);
    if (result.success) {
      attlogEvents.emit('attlog_updated', result.data);
    }
    return reply.send(result);
  } catch (error) {
    req.log.error(error);
    return reply.status(500).send({
      success: false,
      error: 'Error al actualizar estado del marcaje',
      details: error.message
    });
  }
}

