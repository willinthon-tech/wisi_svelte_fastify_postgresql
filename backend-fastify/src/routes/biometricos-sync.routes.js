import {
  auditarSalaBiometricos,
  agregarEmpleadosABiometrico,
  actualizarEmpleadosEnBiometrico,
  eliminarUsuariosDeBiometrico,
  getSalaContextoBiometricos,
  reportarSyncBiometricos
} from '../controllers/biometricos-sync.controller.js';

export default async function biometricosSyncRoutes(fastify, options) {
  // 1. Obtener contexto completo de sala (dispositivos locales y empleados con URLs de fotos)
  fastify.get('/api/biometricos/sala-contexto/:salaId', getSalaContextoBiometricos);

  // 2. Reportar asociaciones de sincronización a Postgres
  fastify.post('/api/biometricos/reportar-sync', reportarSyncBiometricos);

  // 3. Auditar biométricos y paneles de una sala
  fastify.get('/api/biometricos/auditar-sala/:salaId', auditarSalaBiometricos);

  // 4. Agregar empleados seleccionados a un biométrico (y panel)
  fastify.post('/api/biometricos/agregar-empleados', agregarEmpleadosABiometrico);

  // 5. Actualizar datos (nombre, foto, tarjeta) de empleados en biométrico (y panel)
  fastify.post('/api/biometricos/actualizar-empleados', actualizarEmpleadosEnBiometrico);

  // 6. Eliminar usuarios seleccionados de un biométrico (y panel)
  fastify.post('/api/biometricos/eliminar-usuarios', eliminarUsuariosDeBiometrico);
}
