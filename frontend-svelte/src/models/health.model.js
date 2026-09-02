const API_BASE = '/api';

export async function fetchHealthModel() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Health check error');
    return await res.json();
  } catch (err) {
    return {
      status: 'offline',
      database: { connected: false, mode: 'Modo Offline / No Conectado' }
    };
  }
}
