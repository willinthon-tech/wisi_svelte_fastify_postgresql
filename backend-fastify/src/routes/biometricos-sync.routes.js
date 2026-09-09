import {
  auditarSalaBiometricos,
  agregarEmpleadosABiometrico,
  actualizarEmpleadosEnBiometrico,
  eliminarUsuariosDeBiometrico
} from '../controllers/biometricos-sync.controller.js';

export default async function biometricosSyncRoutes(fastify, options) {
  // 1. Auditar biométricos y paneles de una sala
  fastify.get('/api/biometricos/auditar-sala/:salaId', auditarSalaBiometricos);

  // 2. Agregar empleados seleccionados a un biométrico (y panel)
  fastify.post('/api/biometricos/agregar-empleados', agregarEmpleadosABiometrico);

  // 3. Actualizar datos (nombre, foto, tarjeta) de empleados en biométrico (y panel)
  fastify.post('/api/biometricos/actualizar-empleados', actualizarEmpleadosEnBiometrico);

  // 4. Eliminar usuarios seleccionados de un biométrico (y panel)
  fastify.post('/api/biometricos/eliminar-usuarios', eliminarUsuariosDeBiometrico);
}
