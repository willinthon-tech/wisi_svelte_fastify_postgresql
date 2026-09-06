import { loginController, getMeController, verifyPasswordController } from '../controllers/auth.controller.js';
import { registerDeviceToken, unregisterDeviceToken, getPushDiagnostics } from '../services/push.service.js';

export default async function authRoutes(fastify, options) {
  fastify.post('/auth/login', loginController);
  fastify.post('/auth/verify-password', verifyPasswordController);
  fastify.get('/auth/me', getMeController);

  // Diagnóstico de estado de Firebase y Tokens FCM
  fastify.get('/auth/push-status', async (request, reply) => {
    const diag = await getPushDiagnostics();
    return { success: true, diagnostics: diag };
  });

  // Registro de Token FCM para Notificaciones Push de Android
  fastify.post('/auth/fcm-token', async (request, reply) => {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body || {});
    const { user_id, token, platform } = body;
    request.log.info({ user_id, platform, tokenSnippet: token?.substring(0, 15) }, '[FCM] Dispositivo registrado para notificaciones');
    
    await registerDeviceToken({ user_id, token, platform });
    return { success: true, message: 'Dispositivo vinculado a notificaciones push exitosamente' };
  });

  // Desvincular Token FCM al cerrar sesión
  fastify.post('/auth/fcm-token/unregister', async (request, reply) => {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body || {});
    const { token } = body;
    await unregisterDeviceToken({ token });
    return { success: true, message: 'Dispositivo desvinculado exitosamente' };
  });
}
