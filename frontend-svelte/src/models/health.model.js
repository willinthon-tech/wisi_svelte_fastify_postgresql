import { getCloudBaseUrl } from '../config/api.config.js';

export async function fetchHealthModel() {
  try {
    const base = getCloudBaseUrl();
    const apiBase = base.endsWith('/api') ? base : `${base}/api`;
    const res = await fetch(`${apiBase}/health`);
    if (!res.ok) throw new Error('Health check error');
    return await res.json();
  } catch (err) {
    return {
      status: 'offline',
      database: { connected: false, mode: 'Modo Offline / No Conectado' }
    };
  }
}
