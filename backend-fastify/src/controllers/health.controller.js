import { getHealthModel } from '../models/health.model.js';

export async function getHealthController(request, reply) {
  try {
    const healthData = getHealthModel();
    return reply.status(200).send(healthData);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ status: 'error', message: 'Health check failed' });
  }
}
