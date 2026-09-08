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
  getDescargas, getLatestDescargas, uploadDescarga, deleteDescarga,
  getJuegos, getJuegosFilterOptions, createJuego, updateJuego, deleteJuego,
  getMesas, getMesasFilterOptions, createMesa, updateMesa, deleteMesa, restoreMesa, purgeMesa,
  getEstados, createEstado, updateEstado, deleteEstado,
  getSociedades, createSociedad, updateSociedad, deleteSociedad,
  getValores, createValor, updateValor, deleteValor,
  getJuegosMaquinas, createJuegoMaquina, updateJuegoMaquina, deleteJuegoMaquina,
  getMarcas, createMarca, updateMarca, deleteMarca,
  getModelos, getModelosFilterOptions, createModelo, updateModelo, deleteModelo,
  getTipos, createTipo, updateTipo, deleteTipo,
  getModos, createModo, updateModo, deleteModo,
  getLegal, createLegal, updateLegal, deleteLegal,
  getExcepciones, createExcepcion, updateExcepcion, deleteExcepcion,
  getFechasPatrias, createFechaPatria, updateFechaPatria, deleteFechaPatria,
  getMaquinas, getMaquinasFilterOptions, getMaquinaById, createMaquina, updateMaquina, deleteMaquina,
  getLlaves, getLlavesFilterOptions, createLlave, updateLlave, deleteLlave, restoreLlave, purgeLlave,
  getLibros, getLibroById, getLibrosFilterOptions, createLibro, updateLibro, deleteLibro,
  getLibroDropMesas, createLibroDropMesa, deleteLibroDropMesa,
  getLibroControlLlaves, createLibroControlLlaves, updateLibroControlLlavesHoras, deleteLibroControlLlaves,
  getLibroIncidenciasGenerales, createLibroIncidenciaGeneral, updateLibroIncidenciaGeneralHora, deleteLibroIncidenciaGeneral,
  getLibroControlClientes, getClientesSugerencias, createLibroControlCliente, updateLibroControlCliente, deleteLibroControlCliente,
  getLibroDatos, saveLibroDatos
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


  // Horarios (antiguo Plantillas Horarios)
  fastify.get('/master/horarios', getPlantillasHorarios);
  fastify.get('/api/master/horarios', getPlantillasHorarios);
  fastify.get('/master/horarios/filter-options', getPlantillasHorariosFilterOptions);
  fastify.get('/api/master/horarios/filter-options', getPlantillasHorariosFilterOptions);
  fastify.post('/master/horarios', createPlantillaHorario);
  fastify.post('/api/master/horarios', createPlantillaHorario);
  fastify.put('/master/horarios/:id', updatePlantillaHorario);
  fastify.put('/api/master/horarios/:id', updatePlantillaHorario);
  fastify.delete('/master/horarios/:id', deletePlantillaHorario);
  fastify.delete('/api/master/horarios/:id', deletePlantillaHorario);

  // Plantillas Horarios (Alias retrocompatible)
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

  fastify.post('/master/cortes', { bodyLimit: 100 * 1024 * 1024 }, createCorte);
  fastify.post('/api/master/cortes', { bodyLimit: 100 * 1024 * 1024 }, createCorte);
  fastify.post('/cortes', { bodyLimit: 100 * 1024 * 1024 }, createCorte);

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

  // Juegos (Mesas en vivo)
  fastify.get('/master/juegos', getJuegos);
  fastify.get('/api/master/juegos', getJuegos);
  fastify.get('/master/juegos/filter-options', getJuegosFilterOptions);
  fastify.get('/api/master/juegos/filter-options', getJuegosFilterOptions);
  fastify.post('/master/juegos', createJuego);
  fastify.post('/api/master/juegos', createJuego);
  fastify.put('/master/juegos/:id', updateJuego);
  fastify.put('/api/master/juegos/:id', updateJuego);
  fastify.delete('/master/juegos/:id', deleteJuego);
  fastify.delete('/api/master/juegos/:id', deleteJuego);

  // Mesas (Mesas en vivo: Activas y Borradas)
  fastify.get('/master/mesas', getMesas);
  fastify.get('/api/master/mesas', getMesas);
  fastify.get('/master/mesas/filter-options', getMesasFilterOptions);
  fastify.get('/api/master/mesas/filter-options', getMesasFilterOptions);
  fastify.post('/master/mesas', createMesa);
  fastify.post('/api/master/mesas', createMesa);
  fastify.put('/master/mesas/:id', updateMesa);
  fastify.put('/api/master/mesas/:id', updateMesa);
  fastify.delete('/master/mesas/:id', deleteMesa);
  fastify.delete('/api/master/mesas/:id', deleteMesa);
  fastify.post('/master/mesas/:id/restore', restoreMesa);
  fastify.post('/api/master/mesas/:id/restore', restoreMesa);
  fastify.delete('/master/mesas/:id/purge', purgeMesa);
  fastify.delete('/api/master/mesas/:id/purge', purgeMesa);

  // Llaves (CECOM: Activas y Borradas)
  fastify.get('/master/llaves', getLlaves);
  fastify.get('/api/master/llaves', getLlaves);
  fastify.get('/master/llaves/filter-options', getLlavesFilterOptions);
  fastify.get('/api/master/llaves/filter-options', getLlavesFilterOptions);
  fastify.post('/master/llaves', createLlave);
  fastify.post('/api/master/llaves', createLlave);
  fastify.put('/master/llaves/:id', updateLlave);
  fastify.put('/api/master/llaves/:id', updateLlave);
  fastify.delete('/master/llaves/:id', deleteLlave);
  fastify.delete('/api/master/llaves/:id', deleteLlave);
  fastify.post('/master/llaves/:id/restore', restoreLlave);
  fastify.post('/api/master/llaves/:id/restore', restoreLlave);
  fastify.delete('/master/llaves/:id/purge', purgeLlave);
  fastify.delete('/api/master/llaves/:id/purge', purgeLlave);

  // Libros (CECOM: Libro)
  fastify.get('/master/libros', getLibros);
  fastify.get('/api/master/libros', getLibros);
  fastify.get('/master/libros/:id', getLibroById);
  fastify.get('/api/master/libros/:id', getLibroById);
  fastify.get('/master/libros/filter-options', getLibrosFilterOptions);
  fastify.get('/api/master/libros/filter-options', getLibrosFilterOptions);
  fastify.post('/master/libros', createLibro);
  fastify.post('/api/master/libros', createLibro);
  fastify.put('/master/libros/:id', updateLibro);
  fastify.put('/api/master/libros/:id', updateLibro);
  fastify.delete('/master/libros/:id', deleteLibro);
  fastify.delete('/api/master/libros/:id', deleteLibro);

  // Drop Mesas (CECOM: Libro Drop de Mesas)
  fastify.get('/master/libros/:id/drop-mesas', getLibroDropMesas);
  fastify.get('/api/master/libros/:id/drop-mesas', getLibroDropMesas);
  fastify.post('/master/libros/:id/drop-mesas', createLibroDropMesa);
  fastify.post('/api/master/libros/:id/drop-mesas', createLibroDropMesa);
  fastify.delete('/master/libros/:id/drop-mesas/:dropId', deleteLibroDropMesa);
  fastify.delete('/api/master/libros/:id/drop-mesas/:dropId', deleteLibroDropMesa);

  // Control Llaves (CECOM: Libro Control de Llaves)
  fastify.get('/master/libros/:id/control-llaves', getLibroControlLlaves);
  fastify.get('/api/master/libros/:id/control-llaves', getLibroControlLlaves);
  fastify.post('/master/libros/:id/control-llaves', createLibroControlLlaves);
  fastify.post('/api/master/libros/:id/control-llaves', createLibroControlLlaves);
  fastify.put('/master/libros/:id/control-llaves/:controlId/horas', updateLibroControlLlavesHoras);
  fastify.put('/api/master/libros/:id/control-llaves/:controlId/horas', updateLibroControlLlavesHoras);
  fastify.delete('/master/libros/:id/control-llaves/:controlId', deleteLibroControlLlaves);
  fastify.delete('/api/master/libros/:id/control-llaves/:controlId', deleteLibroControlLlaves);

  // Incidencias Generales (CECOM: Libro Incidencias Generales)
  fastify.get('/master/libros/:id/incidencias-generales', getLibroIncidenciasGenerales);
  fastify.get('/api/master/libros/:id/incidencias-generales', getLibroIncidenciasGenerales);
  fastify.post('/master/libros/:id/incidencias-generales', createLibroIncidenciaGeneral);
  fastify.post('/api/master/libros/:id/incidencias-generales', createLibroIncidenciaGeneral);
  fastify.put('/master/libros/:id/incidencias-generales/:incidenciaId/hora', updateLibroIncidenciaGeneralHora);
  fastify.put('/api/master/libros/:id/incidencias-generales/:incidenciaId/hora', updateLibroIncidenciaGeneralHora);
  fastify.put('/master/libros/:id/incidencias-generales/:incidenciaId', updateLibroIncidenciaGeneralHora);
  fastify.put('/api/master/libros/:id/incidencias-generales/:incidenciaId', updateLibroIncidenciaGeneralHora);
  fastify.delete('/master/libros/:id/incidencias-generales/:incidenciaId', deleteLibroIncidenciaGeneral);
  fastify.delete('/api/master/libros/:id/incidencias-generales/:incidenciaId', deleteLibroIncidenciaGeneral);

  // Control Clientes (CECOM: Libro Control de Clientes)
  fastify.get('/master/libros/control-clientes/sugerencias', getClientesSugerencias);
  fastify.get('/api/master/libros/control-clientes/sugerencias', getClientesSugerencias);
  fastify.get('/master/libros/:id/control-clientes/sugerencias', getClientesSugerencias);
  fastify.get('/api/master/libros/:id/control-clientes/sugerencias', getClientesSugerencias);
  fastify.get('/master/libros/:id/control-clientes', getLibroControlClientes);
  fastify.get('/api/master/libros/:id/control-clientes', getLibroControlClientes);
  fastify.post('/master/libros/:id/control-clientes', createLibroControlCliente);
  fastify.post('/api/master/libros/:id/control-clientes', createLibroControlCliente);
  fastify.put('/master/libros/:id/control-clientes/:controlId', updateLibroControlCliente);
  fastify.put('/api/master/libros/:id/control-clientes/:controlId', updateLibroControlCliente);
  fastify.delete('/master/libros/:id/control-clientes/:controlId', deleteLibroControlCliente);
  fastify.delete('/api/master/libros/:id/control-clientes/:controlId', deleteLibroControlCliente);

  // Datos Operativos (CECOM: Libro Datos)
  fastify.get('/master/libros/:id/datos', getLibroDatos);
  fastify.get('/api/master/libros/:id/datos', getLibroDatos);
  fastify.post('/master/libros/:id/datos', saveLibroDatos);
  fastify.post('/api/master/libros/:id/datos', saveLibroDatos);
  fastify.put('/master/libros/:id/datos', saveLibroDatos);
  fastify.put('/api/master/libros/:id/datos', saveLibroDatos);


  // ==========================================
  // 🎰 CONFIGURACIÓN DE MÁQUINAS (CONF.M: MAQUINAS)
  // ==========================================

  // 1. Estados
  fastify.get('/master/estados', getEstados);
  fastify.get('/api/master/estados', getEstados);
  fastify.post('/master/estados', createEstado);
  fastify.post('/api/master/estados', createEstado);
  fastify.put('/master/estados/:id', updateEstado);
  fastify.put('/api/master/estados/:id', updateEstado);
  fastify.delete('/master/estados/:id', deleteEstado);
  fastify.delete('/api/master/estados/:id', deleteEstado);

  // 2. Sociedades
  fastify.get('/master/sociedades', getSociedades);
  fastify.get('/api/master/sociedades', getSociedades);
  fastify.post('/master/sociedades', createSociedad);
  fastify.post('/api/master/sociedades', createSociedad);
  fastify.put('/master/sociedades/:id', updateSociedad);
  fastify.put('/api/master/sociedades/:id', updateSociedad);
  fastify.delete('/master/sociedades/:id', deleteSociedad);
  fastify.delete('/api/master/sociedades/:id', deleteSociedad);

  // 3. Valores
  fastify.get('/master/valores', getValores);
  fastify.get('/api/master/valores', getValores);
  fastify.post('/master/valores', createValor);
  fastify.post('/api/master/valores', createValor);
  fastify.put('/master/valores/:id', updateValor);
  fastify.put('/api/master/valores/:id', updateValor);
  fastify.delete('/master/valores/:id', deleteValor);
  fastify.delete('/api/master/valores/:id', deleteValor);

  // 4. Juegos Máquinas
  fastify.get('/master/juegos-maquinas', getJuegosMaquinas);
  fastify.get('/api/master/juegos-maquinas', getJuegosMaquinas);
  fastify.post('/master/juegos-maquinas', createJuegoMaquina);
  fastify.post('/api/master/juegos-maquinas', createJuegoMaquina);
  fastify.put('/master/juegos-maquinas/:id', updateJuegoMaquina);
  fastify.put('/api/master/juegos-maquinas/:id', updateJuegoMaquina);
  fastify.delete('/master/juegos-maquinas/:id', deleteJuegoMaquina);
  fastify.delete('/api/master/juegos-maquinas/:id', deleteJuegoMaquina);

  // 5. Marcas
  fastify.get('/master/marcas', getMarcas);
  fastify.get('/api/master/marcas', getMarcas);
  fastify.post('/master/marcas', createMarca);
  fastify.post('/api/master/marcas', createMarca);
  fastify.put('/master/marcas/:id', updateMarca);
  fastify.put('/api/master/marcas/:id', updateMarca);
  fastify.delete('/master/marcas/:id', deleteMarca);
  fastify.delete('/api/master/marcas/:id', deleteMarca);

  // 6. Modelos
  fastify.get('/master/modelos/filter-options', getModelosFilterOptions);
  fastify.get('/api/master/modelos/filter-options', getModelosFilterOptions);
  fastify.get('/master/modelos', getModelos);
  fastify.get('/api/master/modelos', getModelos);
  fastify.post('/master/modelos', createModelo);
  fastify.post('/api/master/modelos', createModelo);
  fastify.put('/master/modelos/:id', updateModelo);
  fastify.put('/api/master/modelos/:id', updateModelo);
  fastify.delete('/master/modelos/:id', deleteModelo);
  fastify.delete('/api/master/modelos/:id', deleteModelo);

  // 7. Tipos
  fastify.get('/master/tipos', getTipos);
  fastify.get('/api/master/tipos', getTipos);
  fastify.post('/master/tipos', createTipo);
  fastify.post('/api/master/tipos', createTipo);
  fastify.put('/master/tipos/:id', updateTipo);
  fastify.put('/api/master/tipos/:id', updateTipo);
  fastify.delete('/master/tipos/:id', deleteTipo);
  fastify.delete('/api/master/tipos/:id', deleteTipo);

  // 8. Modos
  fastify.get('/master/modos', getModos);
  fastify.get('/api/master/modos', getModos);
  fastify.post('/master/modos', createModo);
  fastify.post('/api/master/modos', createModo);
  fastify.put('/master/modos/:id', updateModo);
  fastify.put('/api/master/modos/:id', updateModo);
  fastify.delete('/master/modos/:id', deleteModo);
  fastify.delete('/api/master/modos/:id', deleteModo);

  // 9. Legal
  fastify.get('/master/legal', getLegal);
  fastify.get('/api/master/legal', getLegal);
  fastify.post('/master/legal', createLegal);
  fastify.post('/api/master/legal', createLegal);
  fastify.put('/master/legal/:id', updateLegal);
  fastify.put('/api/master/legal/:id', updateLegal);
  fastify.delete('/master/legal/:id', deleteLegal);
  fastify.delete('/api/master/legal/:id', deleteLegal);

  // 10. Excepciones
  fastify.get('/master/excepciones', getExcepciones);
  fastify.get('/api/master/excepciones', getExcepciones);
  fastify.post('/master/excepciones', createExcepcion);
  fastify.post('/api/master/excepciones', createExcepcion);
  fastify.put('/master/excepciones/:id', updateExcepcion);
  fastify.put('/api/master/excepciones/:id', updateExcepcion);
  fastify.delete('/master/excepciones/:id', deleteExcepcion);
  fastify.delete('/api/master/excepciones/:id', deleteExcepcion);

  // 11. Fechas Patrias
  fastify.get('/master/fechas-patrias', getFechasPatrias);
  fastify.get('/api/master/fechas-patrias', getFechasPatrias);
  fastify.post('/master/fechas-patrias', createFechaPatria);
  fastify.post('/api/master/fechas-patrias', createFechaPatria);
  fastify.put('/master/fechas-patrias/:id', updateFechaPatria);
  fastify.put('/api/master/fechas-patrias/:id', updateFechaPatria);
  fastify.delete('/master/fechas-patrias/:id', deleteFechaPatria);
  fastify.delete('/api/master/fechas-patrias/:id', deleteFechaPatria);

  // 12. Máquinas (CRUD Principal)
  fastify.get('/master/maquinas', getMaquinas);
  fastify.get('/api/master/maquinas', getMaquinas);
  fastify.get('/master/maquinas/filter-options', getMaquinasFilterOptions);
  fastify.get('/api/master/maquinas/filter-options', getMaquinasFilterOptions);
  fastify.get('/master/maquinas/:id', getMaquinaById);
  fastify.get('/api/master/maquinas/:id', getMaquinaById);
  fastify.post('/master/maquinas', createMaquina);
  fastify.post('/api/master/maquinas', createMaquina);
  fastify.put('/master/maquinas/:id', updateMaquina);
  fastify.put('/api/master/maquinas/:id', updateMaquina);
  fastify.delete('/master/maquinas/:id', deleteMaquina);
  fastify.delete('/api/master/maquinas/:id', deleteMaquina);



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
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    reply.raw.write('retry: 5000\n\n');

    // Heartbeat ping cada 15 segundos para evitar que Nginx / proxies cierren por inactividad
    const keepAlive = setInterval(() => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.write(': ping\n\n');
      }
    }, 15000);

    const onNewAttlog = (data) => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.write(`event: new_attlog\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    attlogEvents.on('new_attlog', onNewAttlog);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
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
  fastify.post('/master/descargas/upload', { bodyLimit: 250 * 1024 * 1024 }, uploadDescarga);
  fastify.post('/api/master/descargas/upload', { bodyLimit: 250 * 1024 * 1024 }, uploadDescarga);
  fastify.delete('/master/descargas/:id', deleteDescarga);
  fastify.delete('/api/master/descargas/:id', deleteDescarga);
}
