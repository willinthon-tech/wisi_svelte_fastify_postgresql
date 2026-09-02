import { getDbStatus } from '../config/db.js';

export function getHealthModel() {
  const dbStatus = getDbStatus();
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbStatus
  };
}
