const API_BASE = '/api';

export async function loginAuthModel(usuario, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al iniciar sesión');
  return json;
}

export async function getMeAuthModel() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('wisi_token') : null;
  const storedUser = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('wisi_user') || 'null') : null;
  const userId = storedUser?.id || '';

  const headers = token ? { 'Authorization': token } : {};
  const res = await fetch(`${API_BASE}/auth/me?user_id=${userId}`, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al consultar información de usuario');
  return json;
}
