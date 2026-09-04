import { getCloudBaseUrl } from '../config/api.config.js';

function getApiBase() {
  const base = getCloudBaseUrl();
  return base.endsWith('/api') ? base : `${base}/api`;
}

export async function fetchItemsModel(params = {}) {
  const query = new URLSearchParams();
  if (params.search) query.append('search', params.search);
  if (params.category && params.category !== 'All') query.append('category', params.category);
  if (params.completed !== undefined) query.append('completed', params.completed);

  const res = await fetch(`${getApiBase()}/items?${query.toString()}`);
  if (!res.ok) throw new Error('Error al obtener lista de elementos');
  const json = await res.json();
  return json.data || [];
}

export async function createItemModel(itemData) {
  const res = await fetch(`${getApiBase()}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(itemData)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al crear elemento');
  return json.data;
}

export async function updateItemModel(id, itemData) {
  const res = await fetch(`${getApiBase()}/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(itemData)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al actualizar elemento');
  return json.data;
}

export async function toggleItemModel(id) {
  const res = await fetch(`${getApiBase()}/items/${id}/toggle`, {
    method: 'PATCH'
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al alternar estado');
  return json.data;
}

export async function deleteItemModel(id) {
  const res = await fetch(`${getApiBase()}/items/${id}`, {
    method: 'DELETE'
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al eliminar elemento');
  return true;
}
