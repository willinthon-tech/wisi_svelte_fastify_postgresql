import {
  getDepartamentosCiclos, getDepartamentosCiclosFilterOptions,
  getPlantillasHorarios, getPlantillasHorariosFilterOptions, createPlantillaHorario, updatePlantillaHorario, deletePlantillaHorario,
  getDepartamentoEmpleadosCiclos, updateDepartamentoEmpleadosCiclos,
  handleZkIclockCdata,
  getUsuarios, createUsuario, updateUsuario, deleteUsuario,
  getSalas, createSala, updateSala, deleteSala,
  getPaginas, createPagina, updatePagina, deletePagina,
  getModulos, createModulo, updateModulo, deleteModulo, reorderModulos,
  getDispositivos, createDispositivo, updateDispositivo, injectDispositivoPushConfig, injectHikvisionIsapiHttpListening, deleteDispositivo,
  getAttlogs, getLatestAttlogs, getAttlogsFilterOptions, getAttlogsStats, syncAttlogs, getLastAttlogEventTime, getAttlogPosition, getAttlogDetail,
  getConfiguracion, updateConfiguracion,
  getUserSalasMap, updateUserSalas, getUserPermissionsMap, updateUserPermissions,
  getDepartamentos, getDepartamentosFilterOptions, createDepartamento, updateDepartamento, deleteDepartamento,
  getAreas, getAreasFilterOptions, createArea, updateArea, deleteArea,
  getCargos, getCargosFilterOptions, createCargo, updateCargo, deleteCargo,
  getEmpleados, getEmpleadosFilterOptions, checkEmpleadoCedula, getEmpleadoDispositivos, createEmpleado, updateEmpleado, deleteEmpleado,
  getFeriados, getFeriadosFilterOptions, createFeriado, updateFeriado, deleteFeriado,
  getCumpleanos, getCarnets,
  getCortes, getCorteById, createCorte, deleteCorte, getCortesFilterOptions,
  getDescargas, getLatestDescargas, uploadDescarga, deleteDescarga
} from '../controllers/master.controller.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql, isPgConnected } from '../config/db.js';
import { attlogEvents } from '../events/attlog.events.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const attlogsDir = path.join(__dirname, '../../attlogs');

export default async function masterRoutes(fastify, options) {

  // Ciclos Horarios
  fastify.get('/master/departamentos-ciclos', getDepartamentosCiclos);
  fastify.get('/api/master/departamentos-ciclos', getDepartamentosCiclos);
  fastify.get('/master/departamentos-ciclos/filter-options', getDepartamentosCiclosFilterOptions);
  fastify.get('/api/master/departamentos-ciclos/filter-options', getDepartamentosCiclosFilterOptions);
  fastify.get('/master/departamentos-ciclos/:deptId/empleados', getDepartamentoEmpleadosCiclos);
  fastify.get('/api/master/departamentos-ciclos/:deptId/empleados', getDepartamentoEmpleadosCiclos);
  fastify.post('/master/departamentos-ciclos/:deptId/empleados', updateDepartamentoEmpleadosCiclos);
  fastify.post('/api/master/departamentos-ciclos/:deptId/empleados', updateDepartamentoEmpleadosCiclos);


  // Plantillas Horarios
  fastify.get('/master/plantillas-horarios', getPlantillasHorarios);
  fastify.get('/api/master/plantillas-horarios', getPlantillasHorarios);
  fastify.get('/master/plantillas-horarios/filter-options', getPlantillasHorariosFilterOptions);
  fastify.get('/api/master/plantillas-horarios/filter-options', getPlantillasHorariosFilterOptions);
  fastify.post('/master/plantillas-horarios', createPlantillaHorario);
  fastify.post('/api/master/plantillas-horarios', createPlantillaHorario);
  fastify.put('/master/plantillas-horarios/:id', updatePlantillaHorario);
  fastify.put('/api/master/plantillas-horarios/:id', updatePlantillaHorario);
  fastify.delete('/master/plantillas-horarios/:id', deletePlantillaHorario);
  fastify.delete('/api/master/plantillas-horarios/:id', deletePlantillaHorario);

  // Calendario (Fechas Patrias por Sala y Nacionales)
  fastify.get('/master/calendario', getFeriados);
  fastify.get('/api/master/calendario', getFeriados);
  fastify.get('/calendario', getFeriados);

  fastify.get('/master/calendario/filter-options', getFeriadosFilterOptions);
  fastify.get('/api/master/calendario/filter-options', getFeriadosFilterOptions);

  fastify.post('/master/calendario', createFeriado);
  fastify.post('/api/master/calendario', createFeriado);
  fastify.post('/calendario', createFeriado);

  fastify.put('/master/calendario/:id', updateFeriado);
  fastify.put('/api/master/calendario/:id', updateFeriado);
  fastify.put('/calendario/:id', updateFeriado);

  fastify.delete('/master/calendario/:id', deleteFeriado);
  fastify.delete('/api/master/calendario/:id', deleteFeriado);
  fastify.delete('/calendario/:id', deleteFeriado);

  // Cumpleaños de Empleados
  fastify.get('/master/cumpleanos', getCumpleanos);
  fastify.get('/api/master/cumpleanos', getCumpleanos);
  fastify.get('/cumpleanos', getCumpleanos);

  // Carnets de Empleados
  fastify.get('/master/carnets', getCarnets);
  fastify.get('/api/master/carnets', getCarnets);
  fastify.get('/carnets', getCarnets);

  // Cortes Históricos de Asistencia
  fastify.get('/master/cortes', getCortes);
  fastify.get('/api/master/cortes', getCortes);
  fastify.get('/cortes', getCortes);

  fastify.get('/master/cortes/filter-options', getCortesFilterOptions);
  fastify.get('/api/master/cortes/filter-options', getCortesFilterOptions);

  fastify.get('/master/cortes/:id', getCorteById);
  fastify.get('/api/master/cortes/:id', getCorteById);

  fastify.post('/master/cortes', createCorte);
  fastify.post('/api/master/cortes', createCorte);
  fastify.post('/cortes', createCorte);

  fastify.delete('/master/cortes/:id', deleteCorte);
  fastify.delete('/api/master/cortes/:id', deleteCorte);
  fastify.delete('/cortes/:id', deleteCorte);

  // Configuracion del sistema
  fastify.get('/configuracion', getConfiguracion);
  fastify.get('/api/configuracion', getConfiguracion);
  fastify.post('/configuracion', updateConfiguracion);
  fastify.post('/api/configuracion', updateConfiguracion);
  fastify.put('/api/configuracion', updateConfiguracion);

  // User Salas & User Permissions
  fastify.get('/master/user-salas', getUserSalasMap);
  fastify.post('/master/user-salas/:userId', updateUserSalas);
  fastify.put('/master/user-salas/:userId', updateUserSalas);
  fastify.get('/master/user-permissions', getUserPermissionsMap);
  fastify.post('/master/user-permissions/:userId', updateUserPermissions);
  fastify.put('/master/user-permissions/:userId', updateUserPermissions);

  // Usuarios
  fastify.get('/master/usuarios', getUsuarios);
  fastify.post('/master/usuarios', createUsuario);
  fastify.put('/master/usuarios/:id', updateUsuario);
  fastify.delete('/master/usuarios/:id', deleteUsuario);

  // Salas
  fastify.get('/master/salas', getSalas);
  fastify.post('/master/salas', createSala);
  fastify.put('/master/salas/:id', updateSala);
  fastify.delete('/master/salas/:id', deleteSala);

  // Paginas
  fastify.get('/master/paginas', getPaginas);
  fastify.post('/master/paginas', createPagina);
  fastify.put('/master/paginas/:id', updatePagina);
  fastify.delete('/master/paginas/:id', deletePagina);

  // Modulos
  fastify.get('/master/modulos', getModulos);
  fastify.get('/api/master/modulos', getModulos);
  fastify.put('/master/modulos/reorder', reorderModulos);
  fastify.put('/api/master/modulos/reorder', reorderModulos);
  fastify.post('/master/modulos', createModulo);
  fastify.post('/api/master/modulos', createModulo);
  fastify.put('/master/modulos/:id', updateModulo);
  fastify.put('/api/master/modulos/:id', updateModulo);
  fastify.delete('/master/modulos/:id', deleteModulo);
  fastify.delete('/api/master/modulos/:id', deleteModulo);

    // Departamentos
  fastify.get('/master/departamentos', getDepartamentos);
  fastify.get('/master/departamentos/filter-options', getDepartamentosFilterOptions);
  fastify.post('/master/departamentos', createDepartamento);
  fastify.put('/master/departamentos/:id', updateDepartamento);
  fastify.delete('/master/departamentos/:id', deleteDepartamento);

  // Áreas
  fastify.get('/master/areas', getAreas);
  fastify.get('/master/areas/filter-options', getAreasFilterOptions);
  fastify.post('/master/areas', createArea);
  fastify.put('/master/areas/:id', updateArea);
  fastify.delete('/master/areas/:id', deleteArea);

  // Cargos
  fastify.get('/master/cargos', getCargos);
  fastify.get('/master/cargos/filter-options', getCargosFilterOptions);
  fastify.post('/master/cargos', createCargo);
  fastify.put('/master/cargos/:id', updateCargo);
  fastify.delete('/master/cargos/:id', deleteCargo);

  // Empleados
  fastify.get('/master/empleados', getEmpleados);
  fastify.get('/master/empleados/filter-options', getEmpleadosFilterOptions);
  fastify.get('/master/empleados/check-cedula', checkEmpleadoCedula);
  fastify.get('/master/empleados/:id/dispositivos', getEmpleadoDispositivos);
  fastify.post('/master/empleados', createEmpleado);
  fastify.put('/master/empleados/:id', updateEmpleado);
  fastify.delete('/master/empleados/:id', deleteEmpleado);

  // Configuracion
  fastify.get('/master/configuracion', getConfiguracion);
  fastify.post('/master/configuracion', updateConfiguracion);
  fastify.put('/master/configuracion', updateConfiguracion);

  // Dispositivos
  fastify.get('/master/dispositivos', getDispositivos);
  fastify.post('/master/dispositivos', createDispositivo);
  fastify.put('/master/dispositivos/:id', updateDispositivo);
  fastify.post('/master/dispositivos/:id/inject-push-config', injectDispositivoPushConfig);
  fastify.post('/master/dispositivos/:id/isapi-http-listening', injectHikvisionIsapiHttpListening);
  fastify.delete('/master/dispositivos/:id', deleteDispositivo);  // Attlogs (Marcajes)
  fastify.get('/attlogs', getAttlogs);
  fastify.get('/attlogs/latest', getLatestAttlogs);
  fastify.get('/attlogs/filter-options', getAttlogsFilterOptions);
  fastify.get('/api/attlogs/filter-options', getAttlogsFilterOptions);
  fastify.all('/attlogs/sync-photos-disk', async (req, reply) => {
    const { syncDiskPhotosWithDb } = await import('../../sync_photos_disk.js');
    const result = await syncDiskPhotosWithDb();
    return { success: true, ...result };
  });
  fastify.all('/api/attlogs/sync-photos-disk', async (req, reply) => {
    const { syncDiskPhotosWithDb } = await import('../../sync_photos_disk.js');
    const result = await syncDiskPhotosWithDb();
    return { success: true, ...result };
  });
  fastify.get('/attlogs/stats', getAttlogsStats);
  fastify.get('/attlogs/last-event-time', getLastAttlogEventTime);
  fastify.get('/attlogs/dispositivo/:id/last-event-time', getLastAttlogEventTime);
  fastify.get('/attlogs/:id/position', getAttlogPosition);
  fastify.get('/api/attlogs/:id/position', getAttlogPosition);
  fastify.get('/attlogs/:id/detail', getAttlogDetail);
  fastify.get('/api/attlogs/:id/detail', getAttlogDetail);
  fastify.post('/attlogs/sync', syncAttlogs);
  fastify.post('/hikvision/alarm', syncAttlogs);
  fastify.post('/event', syncAttlogs);
  fastify.post('/ISAPI/Event/notification/alertStream', syncAttlogs);

  // Streaming en tiempo real para marcajes (Server-Sent Events)
  const streamAttlogs = (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    reply.raw.write('retry: 3000\n\n');

    const onNewAttlog = (data) => {
      reply.raw.write(`event: new_attlog\ndata: ${JSON.stringify(data)}\n\n`);
    };

    attlogEvents.on('new_attlog', onNewAttlog);

    request.raw.on('close', () => {
      attlogEvents.removeListener('new_attlog', onNewAttlog);
    });
  };

  fastify.get('/attlogs/stream', streamAttlogs);
  fastify.get('/api/attlogs/stream', streamAttlogs);
  fastify.get('/master/attlogs/stream', streamAttlogs);

  // Default SVG avatar fallback (streamed with 200 OK if no image file exists anywhere!)
  const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect width="128" height="128" fill="#e2e8f0"/>
    <circle cx="64" cy="48" r="24" fill="#94a3b8"/>
    <path d="M 24 108 C 24 84, 40 76, 64 76 C 88 76, 104 84, 104 108 Z" fill="#94a3b8"/>
  </svg>`;

  // Módulo de Descargas
  fastify.get('/master/descargas', getDescargas);
  fastify.get('/api/master/descargas', getDescargas);
  fastify.get('/master/descargas/latest', getLatestDescargas);
  fastify.get('/api/master/descargas/latest', getLatestDescargas);
  fastify.post('/master/descargas/upload', uploadDescarga);
  fastify.post('/api/master/descargas/upload', uploadDescarga);
  fastify.delete('/master/descargas/:id', deleteDescarga);
  fastify.delete('/api/master/descargas/:id', deleteDescarga);
}
