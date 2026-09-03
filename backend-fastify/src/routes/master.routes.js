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
  getAttlogs, getLatestAttlogs, getAttlogsFilterOptions, getAttlogsStats, syncAttlogs, getLastAttlogEventTime, getAttlogPosition,
  getConfiguracion, updateConfiguracion,
  getUserSalasMap, updateUserSalas, getUserPermissionsMap, updateUserPermissions,
  getDepartamentos, getDepartamentosFilterOptions, createDepartamento, updateDepartamento, deleteDepartamento,
  getAreas, getAreasFilterOptions, createArea, updateArea, deleteArea,
  getCargos, getCargosFilterOptions, createCargo, updateCargo, deleteCargo,
  getEmpleados, getEmpleadosFilterOptions, checkEmpleadoCedula, getEmpleadoDispositivos, createEmpleado, updateEmpleado, deleteEmpleado,
  getFeriados, getFeriadosFilterOptions, createFeriado, updateFeriado, deleteFeriado,
  getCumpleanos
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

  // Servir fotografías de marcajes en /attlogs/:id/image o /attlogs/:id.jpg con fallback automático a foto de perfil o avatar
  const serveAttlogImage = async (request, reply) => {
    const { id } = request.params;
    const cleanTerm = String(id).replace(/\.[^/.]+$/, "").replace(/^#/, "").trim();
    const filename = `${cleanTerm}.jpg`;

    const searchDirs = [
      path.join(process.cwd(), 'attlogs'),
      path.join(process.cwd(), 'empleados'),
      path.join(process.cwd(), 'photos')
    ];

    // 1. Direct file match on disk
    for (const dir of searchDirs) {
      const fullPath = path.join(dir, filename);
      if (fs.existsSync(fullPath)) {
        reply.type('image/jpeg');
        return fs.createReadStream(fullPath);
      }
    }

    // 2. Lookup attlog in DB by ID to find employee_no / cedula
    if (cleanTerm && isPgConnected && sql) {
      try {
        const attlogId = Number(cleanTerm);
        let empNo = null;

        if (!isNaN(attlogId)) {
          const attRows = await sql`
            SELECT employee_no, nombre FROM attlogs WHERE id = ${attlogId} LIMIT 1
          `;
          if (attRows.length > 0) {
            empNo = String(attRows[0].employee_no || '').replace(/^#/, '').trim();
          }
        }

        const targetTerm = empNo || cleanTerm;

        // 3. Lookup employee profile photo by cedula or ID
        const empRows = await sql`
          SELECT id, foto, cedula FROM empleados 
          WHERE cedula = ${targetTerm} 
             OR cedula = 'V' || ${targetTerm} 
             OR cedula = REPLACE(${targetTerm}, 'V', '')
             OR CAST(id AS TEXT) = ${targetTerm}
          LIMIT 1
        `;

        if (empRows.length > 0) {
          const emp = empRows[0];
          const candidateFiles = [
            `${emp.id}.jpg`,
            `${emp.cedula}.jpg`,
            emp.foto ? path.basename(emp.foto) : null
          ].filter(Boolean);

          for (const cand of candidateFiles) {
            for (const dir of searchDirs) {
              const altPath = path.join(dir, cand);
              if (fs.existsSync(altPath)) {
                reply.type('image/jpeg');
                return fs.createReadStream(altPath);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Error in photo fallback lookup:', e);
      }
    }

    // 4. Ultimate Fallback: Stream SVG avatar placeholder with 200 OK so browser console NEVER logs 404!
    reply.type('image/svg+xml').status(200);
    return reply.send(DEFAULT_AVATAR_SVG);
  };

  fastify.get('/attlogs/:id/image', serveAttlogImage);
  fastify.get('/api/attlogs/:id/image', serveAttlogImage);
  fastify.get('/master/attlogs/:id/image', serveAttlogImage);
  fastify.get('/attlogs/photo/:id', serveAttlogImage);
  fastify.get('/api/attlogs/photo/:id', serveAttlogImage);
  fastify.get('/attlogs/:id.jpg', serveAttlogImage);
  fastify.get('/api/attlogs/:id.jpg', serveAttlogImage);
  fastify.get('/master/attlogs/:id.jpg', serveAttlogImage);
}
