import { get } from 'svelte/store';
import { currentUserStore, userSalasStore as authUserSalasStore } from './auth.store.js';
import { toBackendUrl } from '../config/api.config.js';

export function getUserModuleActions(route) {
  const user = get(currentUserStore);
  const userId = user?.id || 1;
  const permsMap = get(userModulePermissionsStore)[userId] || {};
  const modulos = get(masterModulosStore) || [];

  const cleanRoute = route ? String(route).replace(/^#\/?/, '').replace(/^\//, '').trim() : '';
  const mod = modulos.find(m => m.ruta && m.ruta.replace(/^\//, '') === cleanRoute);

  if (!mod) {
    return { canView: true, canAdd: true, canEdit: true, canDelete: true, canReport: true };
  }

  const userPerms = permsMap[mod.id] || [];
  return {
    canView: userPerms.includes('VER'),
    canAdd: userPerms.includes('AGREGAR'),
    canEdit: userPerms.includes('EDITAR'),
    canDelete: userPerms.includes('BORRAR'),
    canReport: userPerms.includes('REPORTE')
  };
}

export function getActiveUserAssignedSalaIds() {
  const userMap = get(userSalasStore) || {};
  const user = get(currentUserStore);
  const currentUserSalas = user?.id ? (userMap[user.id] || []) : [];
  if (currentUserSalas && currentUserSalas.length > 0) {
    return currentUserSalas;
  }
  const authSalas = get(authUserSalasStore) || [];
  if (authSalas && authSalas.length > 0) {
    return authSalas.map(s => typeof s === 'object' ? s.id : s);
  }
  return [];
}

export function filterOptionsByActiveSalas(items = [], salaIdKey = 'sala_id') {
  const assignedIds = getActiveUserAssignedSalaIds();
  if (!assignedIds || assignedIds.length === 0) return items;
  return items.filter(item => {
    if (!item) return false;
    if (salaIdKey === 'id' && item.id) return assignedIds.includes(item.id);
    if (item[salaIdKey]) return assignedIds.includes(item[salaIdKey]);
    if (item.sala_id) return assignedIds.includes(item.sala_id);
    return true;
  });
}

import { writable } from 'svelte/store';

// Helper to load from localStorage with fallback
function loadStore(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const data = localStorage.getItem(`wisi_master_${key}`);
    if (!data) return fallback;
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

// Helper to save store to localStorage
function saveStore(key, data) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`wisi_master_${key}`, JSON.stringify(data));
  } catch (err) {
    console.error('Error saving to localStorage', err);
  }
}

export const masterSalasStore = writable(loadStore('salas_v5', []));
export const masterPaginasStore = writable(loadStore('paginas_v5', []));
export const masterModulosStore = writable(loadStore('modulos_v5', []));
export const masterDispositivosStore = writable(loadStore('dispositivos_v6', []));
export const masterUsuariosStore = writable(loadStore('usuarios_v4', []));
export const userSalasStore = writable(loadStore('user_salas_v4', {}));
export const userModulePermissionsStore = writable(loadStore('user_perms_v4', {}));

// Sync stores to localStorage automatically
masterSalasStore.subscribe(val => saveStore('salas_v5', val));
masterPaginasStore.subscribe(val => saveStore('paginas_v5', val));
masterModulosStore.subscribe(val => saveStore('modulos_v5', val));
masterDispositivosStore.subscribe(val => saveStore('dispositivos_v6', val));
masterUsuariosStore.subscribe(val => saveStore('usuarios_v4', val));
userSalasStore.subscribe(val => saveStore('user_salas_v4', val));
userModulePermissionsStore.subscribe(val => saveStore('user_perms_v4', val));

// Load real-time master data from PostgreSQL backend in parallel using Promise.allSettled
export async function loadMasterStoresFromBackend() {
  const fetchEntity = async (entityName, store) => {
    try {
      const res = await fetch(`/api/master/${entityName}?limit=all`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          store.set(json.data);
        }
      }
    } catch (err) {
      console.warn(`Error fetching ${entityName} from backend:`, err);
    }
  };

  const fetchUserSalas = async () => {
    try {
      const resSalas = await fetch('/api/master/user-salas');
      if (resSalas.ok) {
        const json = await resSalas.json();
        if (json && json.success && json.data) {
          userSalasStore.update(curr => ({ ...curr, ...json.data }));
        }
      }
    } catch (err) {
      console.warn('Error fetching user salas from backend:', err);
    }
  };

  const fetchUserPerms = async () => {
    try {
      const resPerms = await fetch('/api/master/user-permissions');
      if (resPerms.ok) {
        const json = await resPerms.json();
        if (json && json.success && json.data) {
          userModulePermissionsStore.update(curr => ({ ...curr, ...json.data }));
        }
      }
    } catch (err) {
      console.warn('Error fetching user permissions from backend:', err);
    }
  };

  // Carga ultra rápida en paralelo de todas las tablas maestras
  await Promise.allSettled([
    fetchEntity('horarios', masterPlantillasHorariosStore),
    fetchEntity('departamentos', masterDepartamentosStore),
    fetchEntity('areas', masterAreasStore),
    fetchEntity('cargos', masterCargosStore),
    fetchEntity('empleados', masterEmpleadosStore),
    fetchEntity('usuarios', masterUsuariosStore),
    fetchEntity('salas', masterSalasStore),
    fetchEntity('paginas', masterPaginasStore),
    fetchEntity('modulos', masterModulosStore),
    fetchEntity('dispositivos', masterDispositivosStore),
    fetchEntity('descargas', masterDescargasStore),
    fetchEntity('juegos', masterJuegosStore),
    fetchEntity('mesas', masterMesasStore),
    fetchEntity('estados', masterEstadosStore),
    fetchEntity('sociedades', masterSociedadesStore),
    fetchEntity('valores', masterValoresStore),
    fetchEntity('juegos-maquinas', masterJuegosMaquinasStore),
    fetchEntity('marcas', masterMarcasStore),
    fetchEntity('modelos', masterModelosStore),
    fetchEntity('tipos', masterTiposStore),
    fetchEntity('modos', masterModosStore),
    fetchEntity('legal', masterLegalStore),
    fetchEntity('excepciones', masterExcepcionesStore),
    fetchEntity('fechas-patrias', masterFechasPatriasStore),
    fetchUserSalas(),
    fetchUserPerms()
  ]);
}

export async function saveUserSalasToBackend(userId, salaIds) {
  try {
    await fetch(`/api/master/user-salas/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salas: salaIds })
    });
  } catch (err) {
    console.warn('Error saving user salas to backend:', err);
  }
}

export async function saveUserPermissionsToBackend(userId, permissionsMap) {
  try {
    await fetch(`/api/master/user-permissions/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: permissionsMap })
    });
  } catch (err) {
    console.warn('Error saving user permissions to backend:', err);
  }
}

// CRUD Actions Generator for 100% Real-Time PostgreSQL Sync
export function createMasterEntityActions(store, entityName) {
  return {
    add: async (item) => {
      let createdItem = { ...item };
      try {
        const res = await fetch(`/api/master/${entityName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createdItem)
        });
        const json = await res.json();
        if (!res.ok || (json && json.success === false)) {
          throw new Error(json.error || `Error al crear en ${entityName}`);
        }
        await loadMasterStoresFromBackend();
        return json.data;
      } catch (err) {
        console.warn(`Backend sync error for ${entityName} creation:`, err);
        throw err;
      }
    },
    update: async (id, draft) => {
      try {
        const res = await fetch(`/api/master/${entityName}/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft })
        });
        const json = await res.json();
        if (!res.ok || (json && json.success === false)) {
          throw new Error(json.error || `Error al actualizar en ${entityName}`);
        }
        await loadMasterStoresFromBackend();
        return json.data;
      } catch (err) {
        console.warn(`Backend sync error for ${entityName} update:`, err);
        throw err;
      }
    },
    delete: async (id) => {
      try {
        const res = await fetch(`/api/master/${entityName}/${id}`, {
          method: 'DELETE'
        });
        const json = await res.json();
        if (json && json.blocked) {
          return json;
        }
        if (!res.ok || (json && json.success === false)) {
          throw new Error(json.error || `Error al eliminar en ${entityName}`);
        }
        await loadMasterStoresFromBackend();
        return json;
      } catch (err) {
        console.warn(`Backend sync error for ${entityName} deletion:`, err);
        throw err;
      }
    }
  };
}


export const masterDepartamentosStore = writable(loadStore('departamentos_v1', []));
export const masterAreasStore = writable(loadStore('areas_v1', []));
export const masterCargosStore = writable(loadStore('cargos_v1', []));
export const masterEmpleadosStore = writable(loadStore('empleados_v1', []));
export const masterJuegosStore = writable(loadStore('juegos_v1', []));
export const masterMesasStore = writable(loadStore('mesas_v1', []));

masterDepartamentosStore.subscribe(val => saveStore('departamentos_v1', val));
masterAreasStore.subscribe(val => saveStore('areas_v1', val));
masterCargosStore.subscribe(val => saveStore('cargos_v1', val));
masterEmpleadosStore.subscribe(val => saveStore('empleados_v1', val));
masterJuegosStore.subscribe(val => saveStore('juegos_v1', val));
masterMesasStore.subscribe(val => saveStore('mesas_v1', val));

export const masterDepartamentosActions = createMasterEntityActions(masterDepartamentosStore, 'departamentos');
export const masterAreasActions = createMasterEntityActions(masterAreasStore, 'areas');
export const masterCargosActions = createMasterEntityActions(masterCargosStore, 'cargos');
export const masterEmpleadosActions = createMasterEntityActions(masterEmpleadosStore, 'empleados');
export const masterJuegosActions = createMasterEntityActions(masterJuegosStore, 'juegos');
export const masterMesasActions = {
  ...createMasterEntityActions(masterMesasStore, 'mesas'),
  restore: async (id) => {
    try {
      const res = await fetch(`/api/master/mesas/${id}/restore`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Error al restaurar mesa');
      }
      await loadMasterStoresFromBackend();
      return json;
    } catch (err) {
      console.warn('Backend sync error for mesa restore:', err);
      throw err;
    }
  },
  purge: async (id) => {
    try {
      const res = await fetch(`/api/master/mesas/${id}/purge`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Error al eliminar mesa definitivamente');
      }
      await loadMasterStoresFromBackend();
      return json;
    } catch (err) {
      console.warn('Backend sync error for mesa purge:', err);
      throw err;
    }
  }
};

export const masterSalasActions = createMasterEntityActions(masterSalasStore, 'salas');
export const masterPaginasActions = createMasterEntityActions(masterPaginasStore, 'paginas');
export const masterModulosActions = {
  ...createMasterEntityActions(masterModulosStore, 'modulos'),
  reorder: async (orderedList = []) => {
    try {
      const res = await fetch('/api/master/modulos/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: orderedList })
      });
      const json = await res.json();
      if (!res.ok || (json && json.success === false)) {
        throw new Error(json.error || 'Error al reordenar módulos');
      }
      await loadMasterStoresFromBackend();
      return json;
    } catch (err) {
      console.warn('Backend sync error for modulos reorder:', err);
      throw err;
    }
  }
};
export const masterDispositivosActions = createMasterEntityActions(masterDispositivosStore, 'dispositivos');
export const masterUsuariosActions = createMasterEntityActions(masterUsuariosStore, 'usuarios');

export const masterHorariosStore = writable(loadStore('horarios_v1', []));
export const masterPlantillasHorariosStore = masterHorariosStore;
masterHorariosStore.subscribe(val => saveStore('horarios_v1', val));
export const masterHorariosActions = createMasterEntityActions(masterHorariosStore, 'horarios');
export const masterPlantillasHorariosActions = masterHorariosActions;

export const masterDescargasStore = writable(loadStore('descargas_v1', []));
masterDescargasStore.subscribe(val => saveStore('descargas_v1', val));
export const masterDescargasActions = {
  ...createMasterEntityActions(masterDescargasStore, 'descargas'),
  upload: async ({ fileBase64, filename, size, sizeText }) => {
    try {
      const res = await fetch(toBackendUrl('/api/master/descargas/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, filename, size, sizeText })
      });
      if (res.status === 413) {
        throw new Error('El instalador es demasiado pesado para el servidor web (Error 413). Se requiere aumentar client_max_body_size en NGINX.');
      }
      const json = await res.json();
      if (!res.ok || (json && json.success === false)) {
        throw new Error(json.error || 'Error al subir instalador');
      }
      await loadMasterStoresFromBackend();
      return json.data;
    } catch (err) {
      console.warn('Backend sync error for descarga upload:', err);
      throw err;
    }
  }
};

// =========================================================================
// 🎰 STORES Y ACCIONES DE CONFIGURACIÓN DE MÁQUINAS (CONF.M: MAQUINAS)
// =========================================================================

export const masterEstadosStore = writable(loadStore('estados_v1', []));
export const masterSociedadesStore = writable(loadStore('sociedades_v1', []));
export const masterValoresStore = writable(loadStore('valores_v1', []));
export const masterJuegosMaquinasStore = writable(loadStore('juegos_maquinas_v1', []));
export const masterMarcasStore = writable(loadStore('marcas_v1', []));
export const masterModelosStore = writable(loadStore('modelos_v1', []));
export const masterTiposStore = writable(loadStore('tipos_v1', []));
export const masterModosStore = writable(loadStore('modos_v1', []));
export const masterLegalStore = writable(loadStore('legal_v1', []));

masterEstadosStore.subscribe(val => saveStore('estados_v1', val));
masterSociedadesStore.subscribe(val => saveStore('sociedades_v1', val));
masterValoresStore.subscribe(val => saveStore('valores_v1', val));
masterJuegosMaquinasStore.subscribe(val => saveStore('juegos_maquinas_v1', val));
masterMarcasStore.subscribe(val => saveStore('marcas_v1', val));
masterModelosStore.subscribe(val => saveStore('modelos_v1', val));
masterTiposStore.subscribe(val => saveStore('tipos_v1', val));
masterModosStore.subscribe(val => saveStore('modos_v1', val));
masterLegalStore.subscribe(val => saveStore('legal_v1', val));

export const masterEstadosActions = createMasterEntityActions(masterEstadosStore, 'estados');
export const masterSociedadesActions = createMasterEntityActions(masterSociedadesStore, 'sociedades');
export const masterValoresActions = createMasterEntityActions(masterValoresStore, 'valores');
export const masterJuegosMaquinasActions = createMasterEntityActions(masterJuegosMaquinasStore, 'juegos-maquinas');
export const masterMarcasActions = createMasterEntityActions(masterMarcasStore, 'marcas');
export const masterModelosActions = createMasterEntityActions(masterModelosStore, 'modelos');
export const masterTiposActions = createMasterEntityActions(masterTiposStore, 'tipos');
export const masterModosActions = createMasterEntityActions(masterModosStore, 'modos');
export const masterLegalActions = createMasterEntityActions(masterLegalStore, 'legal');

export const masterExcepcionesStore = writable(loadStore('excepciones_v1', []));
export const masterFechasPatriasStore = writable(loadStore('fechas_patrias_v1', []));

masterExcepcionesStore.subscribe(val => saveStore('excepciones_v1', val));
masterFechasPatriasStore.subscribe(val => saveStore('fechas_patrias_v1', val));

export const masterExcepcionesActions = createMasterEntityActions(masterExcepcionesStore, 'excepciones');
export const masterFechasPatriasActions = createMasterEntityActions(masterFechasPatriasStore, 'fechas-patrias');
