import { loginController, getMeController } from '../controllers/auth.controller.js';

export default async function authRoutes(fastify, options) {
  fastify.post('/auth/login', loginController);
  fastify.get('/auth/me', getMeController);
}
