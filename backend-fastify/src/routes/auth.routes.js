import { loginController, getMeController } from '../controllers/auth.controller.js';
import { registerDeviceToken } from '../services/push.service.js';

export default async function authRoutes(fastify, options) {
  fastify.post('/auth/login', loginController);
  fastify.get('/auth/me', getMeController);

  // Registro de Token FCM para Notificaciones Push de Android
  fastify.post('/auth/fcm-token', async (request, reply) => {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body || {});
    const { user_id, token, platform } = body;
    request.log.info({ user_id, platform, tokenSnippet: token?.substring(0, 15) }, '[FCM] Dispositivo registrado para notificaciones');
    
    await registerDeviceToken({ user_id, token, platform });
    return { success: true, message: 'Dispositivo vinculado a notificaciones push exitosamente' };
  });
}
