import { get, writable, derived } from 'svelte/store';
import { currentUserStore, userSalasStore as authUserSalasStore } from './auth.store.js';
import { currentRouteStore } from './router.store.js';
import { toBackendUrl } from '../config/api.config.js';
import { 
  saveLocalItems, 
  getLocalItems, 
  upsertLocalItem, 
  deleteLocalItem, 
  queueOutboxAction 
} from '../services/localDb.service.js';

const ROUTE_ALIASES = {
  'libro': 'cecom/libro',
  'libros': 'cecom/libro',
  'clientes': 'cecom/clientes',
  'llaves': 'cecom/llaves',
  'llaves-borradas': 'cecom/llaves-borradas',
  'marcajes': 'rrhh/marcajes',
  'empleados': 'rrhh/empleados',
  'cargos': 'rrhh/cargos',
  'asignaciones': 'rrhh/asignaciones',
  'areas': 'rrhh/areas',
  'departamentos': 'rrhh/departamentos',
  'registros': 'rrhh/registros',
  'desincorporados': 'rrhh/desincorporados',
  'carnet': 'rrhh/carnet',
  'cumpleanos': 'rrhh/cumpleanos',
  'calendario': 'rrhh/calendario',
  'cortes': 'rrhh/cortes',
  'maquinas': 'configuracion/maquinas',
  'maquinas/maquinas': 'configuracion/maquinas',
  'estados': 'configuracion/estados',
  'sociedades': 'configuracion/sociedades',
  'valores': 'configuracion/valores',
  'maquinas/juegos': 'configuracion/juegos',
  'juegos-maquinas': 'configuracion/juegos',
  'marcas': 'configuracion/marcas',
  'modelos': 'configuracion/modelos',
  'tipos': 'configuracion/tipos',
  'modos': 'configuracion/modos',
  'legal': 'configuracion/legal',
  'rangos': 'configuracion/rangos',
  'cecom/rangos': 'configuracion/rangos',
  'maquinas/rangos': 'configuracion/rangos',
  'mesas': 'mesas-en-vivo/mesas',
  'gestion-de-mesas': 'mesas-en-vivo/mesas',
  'mesas/juegos': 'configuracion/juegos',
  'mesas-en-vivo/juegos': 'configuracion/juegos',
  'mesas-borradas': 'mesas-en-vivo/mesas-borradas',
  'tipo-clientes': 'configuracion/tipo-clientes',
  'metodos-pago': 'configuracion/metodos-pago',
  'tipo-incidencias': 'configuracion/tipo-incidencias',
  'cecom/tipo-incidencias': 'configuracion/tipo-incidencias',
  'horarios': 'configuracion/horarios',
  'rrhh/horarios': 'configuracion/horarios',
  'plantillas': 'configuracion/horarios',
  'configuracion/plantillas': 'configuracion/horarios',
  'rrhh/plantillas': 'configuracion/horarios',
  'excepciones': 'configuracion/excepciones',
  'fechas-patrias': 'configuracion/fechas-patrias'
};

const NON_MODULE_ROUTES = [
  'dashboard',
  'analytics',
  'products',
  'companies',
  'invoice',
  'components',
  'vector-maps',
  'drag',
  'profile',
  'auth',
  'settings',
  'master',
  'willinthontech'
];

export function normalizeModuleRoute(route) {
  if (!route) return '';
  let clean = String(route).replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].trim().toLowerCase();
  
  if (clean.startsWith('cecom/libro') || clean.startsWith('libro') || /^\d+(\/|$)/.test(clean)) {
    return 'cecom/libro';
  }

  if (ROUTE_ALIASES[clean]) {
    return ROUTE_ALIASES[clean];
  }

  return clean;
}

export function findModuleByRoute(route, modulos = []) {
  const norm = normalizeModuleRoute(route);
  if (!norm) return null;

  let found = modulos.find(m => {
    if (!m.ruta) return false;
    const mRuta = m.ruta.replace(/^\//, '').trim().toLowerCase();
    return mRuta === norm;
  });
  if (found) return found;

  found = modulos.find(m => {
    if (!m.ruta) return false;
    const mRuta = m.ruta.replace(/^\//, '').trim().toLowerCase();
    return norm.startsWith(mRuta + '/');
  });
  if (found) return found;

  found = modulos.find(m => {
    if (!m.ruta) return false;
    const mRuta = m.ruta.replace(/^\//, '').trim().toLowerCase();
    const mAlias = ROUTE_ALIASES[mRuta] || mRuta;
    return mAlias === norm || norm.startsWith(mAlias + '/');
  });
  if (found) return found;

  const lastSegment = norm.split('/').pop();
  found = modulos.find(m => {
    if (!m.ruta) return false;
    const mRuta = m.ruta.replace(/^\//, '').trim().toLowerCase();
    return mRuta.split('/').pop() === lastSegment;
  });
  return found || null;
}

export function calculateUserModuleActions(route, user, permsMapAll, modulos = []) {
  const clean = route ? String(route).replace(/^#\/?/, '').replace(/^\//, '').split('?')[0].trim().toLowerCase() : '';
  if (!clean || NON_MODULE_ROUTES.includes(clean)) {
    return { canView: true, canAdd: true, canEdit: true, canDelete: true, isModule: false };
  }

  const mod = findModuleByRoute(clean, modulos);
  if (!mod) {
    return { canView: true, canAdd: true, canEdit: true, canDelete: true, isModule: false };
  }

  const userId = user?.id ?? null;
  const userPerms = (userId && permsMapAll && permsMapAll[userId]) ? (permsMapAll[userId][mod.id] || []) : [];

  return {
    canView: userPerms.includes('VER'),
    canAdd: userPerms.includes('AGREGAR'),
    canEdit: userPerms.includes('EDITAR'),
    canDelete: userPerms.includes('ELIMINAR') || userPerms.includes('BORRAR'),
    isModule: true,
    moduleId: mod.id,
    moduleNombre: mod.nombre
  };
}

export function getUserModuleActions(route) {
  const user = get(currentUserStore);
  const permsMap = get(userModulePermissionsStore) || {};
  const modulos = get(masterModulosStore) || [];
  const targetRoute = route || get(currentRouteStore);
  return calculateUserModuleActions(targetRoute, user, permsMap, modulos);
}

export const currentRoutePermissionsStore = derived(
  [currentUserStore, userModulePermissionsStore, masterModulosStore, currentRouteStore],
  ([$user, $permsMap, $modulos, $route]) => {
    return calculateUserModuleActions($route, $user, $permsMap, $modulos);
  }
);

export function getActiveUserAssignedSalaIds() {
  const userMap = get(userSalasStore) || {};
  const user = get(currentUserStore);
  const currentUserSalas = user?.id ? (userMap[user.id] || []) : [];
  if (currentUserSalas && currentUserSalas.length > 0) {
    return currentUserSalas.map(s => String(typeof s === 'object' ? s.id : s));
  }
  const authSalas = get(authUserSalasStore) || [];
  if (authSalas && authSalas.length > 0) {
    return authSalas.map(s => String(typeof s === 'object' ? s.id : s));
  }
  return [];
}

export function filterOptionsByActiveSalas(items = [], salaIdKey = 'sala_id') {
  const assignedIds = getActiveUserAssignedSalaIds().map(String);
  return items.filter(item => {
    if (!item) return false;
    if (item.grupo_id && Number(item.grupo_id) === 2) return false;
    if (!assignedIds || assignedIds.length === 0) return true;
    if (salaIdKey === 'id' && item.id) return assignedIds.includes(String(item.id));
    if (item[salaIdKey]) return assignedIds.includes(String(item[salaIdKey]));
    if (item.sala_id) return assignedIds.includes(String(item.sala_id));
    return true;
  });
}

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
  const fetchEntity = async (entityName, store, localStoreKey = entityName) => {
    // 1. Cargar de inmediato desde IndexedDB local (0ms al abrir la app o modo offline)
    try {
      const localData = await getLocalItems(localStoreKey);
      if (Array.isArray(localData) && localData.length > 0) {
        store.set(localData);
      }
    } catch (e) {
      // Continuar si IndexedDB aún está cargando
    }

    // 2. Si hay conexión a internet, refrescar desde el servidor y persistir en IndexedDB
    try {
      const res = await fetch(toBackendUrl(`/api/master/${entityName}?limit=all`));
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          store.set(json.data);
          saveLocalItems(localStoreKey, json.data).catch(() => {});
        }
      }
    } catch (err) {
      console.warn(`Error fetching ${entityName} from backend (usando copia local):`, err);
    }
  };

  const fetchUserSalas = async () => {
    try {
      const resSalas = await fetch(toBackendUrl('/api/master/user-salas'));
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
      const resPerms = await fetch(toBackendUrl('/api/master/user-permissions'));
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
    fetchEntity('horarios', masterPlantillasHorariosStore, 'horarios'),
    fetchEntity('departamentos', masterDepartamentosStore, 'departamentos'),
    fetchEntity('areas', masterAreasStore, 'areas'),
    fetchEntity('cargos', masterCargosStore, 'cargos'),
    fetchEntity('empleados', masterEmpleadosStore, 'empleados'),
    fetchEntity('usuarios', masterUsuariosStore, 'usuarios'),
    fetchEntity('salas', masterSalasStore, 'salas'),
    fetchEntity('paginas', masterPaginasStore, 'paginas'),
    fetchEntity('modulos', masterModulosStore, 'modulos'),
    fetchEntity('dispositivos', masterDispositivosStore, 'dispositivos'),
    fetchEntity('descargas', masterDescargasStore, 'descargas'),
    fetchEntity('juegos', masterJuegosStore, 'juegos'),
    fetchEntity('mesas', masterMesasStore, 'mesas'),
    fetchEntity('llaves', masterLlavesStore, 'llaves'),
    fetchEntity('libros', masterLibrosStore, 'libros'),
    fetchEntity('estados', masterEstadosStore, 'estados'),
    fetchEntity('sociedades', masterSociedadesStore, 'sociedades'),
    fetchEntity('valores', masterValoresStore, 'valores'),
    fetchEntity('juegos-maquinas', masterJuegosMaquinasStore, 'juegos_maquinas'),
    fetchEntity('marcas', masterMarcasStore, 'marcas'),
    fetchEntity('modelos', masterModelosStore, 'modelos'),
    fetchEntity('tipos', masterTiposStore, 'tipos'),
    fetchEntity('modos', masterModosStore, 'modos'),
    fetchEntity('legal', masterLegalStore, 'legal'),
    fetchEntity('excepciones', masterExcepcionesStore, 'excepciones'),
    fetchEntity('fechas-patrias', masterFechasPatriasStore, 'fechas_patrias'),
    fetchEntity('tipo-clientes', masterTipoClientesStore, 'tipo_clientes'),
    fetchEntity('metodos-pago', masterMetodosPagoStore, 'metodos_pago'),
    fetchEntity('tipo-incidencias', masterTipoIncidenciasStore, 'tipo_incidencias'),
    fetchEntity('rangos', masterRangosStore, 'rangos'),
    fetchEntity('clientes', masterClientesStore, 'clientes'),
    fetchUserSalas(),
    fetchUserPerms()
  ]);

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('wisi_last_delta_sync', new Date().toISOString());
  }
}

let isSyncingDelta = false;

/**
 * Motor de sincronización incremental Delta para tiendas maestras en el cliente (Local-First).
 * Solo consulta y aplica los registros que han cambiado desde la última sincronización,
 * evitando 33 peticiones paralelas pesadas y garantizando actualización en 0ms.
 */
export async function syncMasterStoresDelta() {
  if (isSyncingDelta) return;
  isSyncingDelta = true;

  try {
    const lastSync = (typeof localStorage !== 'undefined') ? localStorage.getItem('wisi_last_delta_sync') : null;

    // Si nunca ha habido una sincronización registrada en este cliente, cargar todo de inicio
    if (!lastSync) {
      await loadMasterStoresFromBackend();
      return;
    }

    const url = toBackendUrl(`/api/sync/delta?since=${encodeURIComponent(lastSync)}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[DeltaSync] Servidor respondió con error, ejecutando carga completa...');
      await loadMasterStoresFromBackend();
      return;
    }

    const json = await res.json();
    if (!json || !json.changes) return;

    // Mapeo exhaustivo entre todas las tablas de la base de datos y sus stores de Svelte en memoria
    const tableToStoreMap = {
      'clientes': { store: masterClientesStore, local: 'clientes' },
      'empleados': { store: masterEmpleadosStore, local: 'empleados' },
      'salas': { store: masterSalasStore, local: 'salas' },
      'departamentos': { store: masterDepartamentosStore, local: 'departamentos' },
      'areas': { store: masterAreasStore, local: 'areas' },
      'cargos': { store: masterCargosStore, local: 'cargos' },
      'horarios': { store: masterPlantillasHorariosStore, local: 'horarios' },
      'maquinas': { store: null, local: 'maquinas' },
      'mesas': { store: masterMesasStore, local: 'mesas' },
      'llaves': { store: masterLlavesStore, local: 'llaves' },
      'estados': { store: masterEstadosStore, local: 'estados' },
      'sociedades': { store: masterSociedadesStore, local: 'sociedades' },
      'valores': { store: masterValoresStore, local: 'valores' },
      'juegos': { store: masterJuegosStore, local: 'juegos' },
      'juegos_maquinas': { store: masterJuegosMaquinasStore, local: 'juegos_maquinas' },
      'marcas': { store: masterMarcasStore, local: 'marcas' },
      'modelos': { store: masterModelosStore, local: 'modelos' },
      'tipos': { store: masterTiposStore, local: 'tipos' },
      'modos': { store: masterModosStore, local: 'modos' },
      'legal': { store: masterLegalStore, local: 'legal' },
      'rangos': { store: masterRangosStore, local: 'rangos' },
      'metodos_pago': { store: masterMetodosPagoStore, local: 'metodos_pago' },
      'tipo_clientes': { store: masterTipoClientesStore, local: 'tipo_clientes' },
      'tipo_incidencias': { store: masterTipoIncidenciasStore, local: 'tipo_incidencias' },
      'dispositivos': { store: masterDispositivosStore, local: 'dispositivos' },
      'usuarios': { store: masterUsuariosStore, local: 'usuarios' },
      'libros': { store: masterLibrosStore, local: 'libros' }
    };

    let totalChanges = 0;

    for (const [tbl, data] of Object.entries(json.changes)) {
      const mapping = tableToStoreMap[tbl];
      const localStoreKey = mapping?.local || tbl;
      const store = mapping?.store;

      const upserted = Array.isArray(data.upserted) ? data.upserted : [];
      const deleted = Array.isArray(data.deleted) ? data.deleted : [];

      if (upserted.length === 0 && deleted.length === 0) continue;

      // Actualizar base de datos local IndexedDB
      for (const item of upserted) {
        upsertLocalItem(localStoreKey, item).catch(() => {});
      }
      for (const del of deleted) {
        deleteLocalItem(localStoreKey, del.id || del.uuid).catch(() => {});
      }

      if (store) {
        store.update(currentItems => {
          let items = Array.isArray(currentItems) ? [...currentItems] : [];
          const deletedIds = new Set(deleted.map(d => String(d.id || d.uuid)));

          // 1. Descartar eliminados (Soft delete o borrado)
          if (deletedIds.size > 0) {
            items = items.filter(it => !deletedIds.has(String(it.id || it.uuid)));
          }

          // 2. Upsert (actualizar registro modificado o insertar si es nuevo)
          for (const up of upserted) {
            const upId = String(up.id || up.uuid);
            const idx = items.findIndex(it => String(it.id || it.uuid) === upId);
            if (idx >= 0) {
              items[idx] = { ...items[idx], ...up };
            } else {
              items.push(up);
            }
          }
          return items;
        });
      }

      totalChanges += (upserted.length + deleted.length);
    }

    // Actualizar cursor de tiempo de sincronización con la marca de tiempo exacta del servidor
    if (json.timestamp && typeof localStorage !== 'undefined') {
      localStorage.setItem('wisi_last_delta_sync', json.timestamp);
    }

    if (totalChanges > 0) {
      console.log(`[DeltaSync] Sincronización delta aplicada con éxito: ${totalChanges} cambios reflejados en 0ms.`);
    }
  } catch (err) {
    console.warn('[DeltaSync] Error sincronizando delta:', err);
  } finally {
    isSyncingDelta = false;
  }
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

// CRUD Actions Generator for 100% Real-Time PostgreSQL Sync with Local-First Outbox Support
export function createMasterEntityActions(store, entityName, localStoreName = entityName) {
  return {
    add: async (item) => {
      let createdItem = { ...item };
      if (!createdItem.uuid && typeof crypto !== 'undefined' && crypto.randomUUID) {
        createdItem.uuid = crypto.randomUUID();
      }
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
        await upsertLocalItem(localStoreName, json.data || createdItem);
        await loadMasterStoresFromBackend();
        return json.data;
      } catch (err) {
        console.warn(`[LocalDb] Operando offline para crear en ${entityName}: guardando en IndexedDB y encolando outbox.`);
        const localSaved = await upsertLocalItem(localStoreName, createdItem);
        store.update(list => [createdItem, ...(Array.isArray(list) ? list : [])]);
        await queueOutboxAction({
          entity: localStoreName,
          action: 'create',
          endpoint: `/api/master/${entityName}`,
          method: 'POST',
          payload: createdItem,
          uuid: createdItem.uuid
        });
        return localSaved || createdItem;
      }
    },
    update: async (targetUuidOrId, draft) => {
      const targetUuid = typeof targetUuidOrId === 'object' ? (targetUuidOrId.uuid || targetUuidOrId.id) : targetUuidOrId;
      try {
        const res = await fetch(`/api/master/${entityName}/${targetUuid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft })
        });
        const json = await res.json();
        if (!res.ok || (json && json.success === false)) {
          throw new Error(json.error || `Error al actualizar en ${entityName}`);
        }
        await upsertLocalItem(localStoreName, json.data || { uuid: targetUuid, ...draft });
        await loadMasterStoresFromBackend();
        return json.data;
      } catch (err) {
        console.warn(`[LocalDb] Operando offline para actualizar en ${entityName}: guardando en IndexedDB y encolando outbox.`);
        const updatedItem = { uuid: targetUuid, id: targetUuid, ...draft, updated_at: new Date().toISOString() };
        await upsertLocalItem(localStoreName, updatedItem);
        store.update(list => (Array.isArray(list) ? list.map(it => (String(it.uuid || it.id) === String(targetUuid)) ? { ...it, ...draft } : it) : []));
        await queueOutboxAction({
          entity: localStoreName,
          action: 'update',
          endpoint: `/api/master/${entityName}/${targetUuid}`,
          method: 'PUT',
          payload: draft,
          targetId: targetUuid
        });
        return updatedItem;
      }
    },
    delete: async (targetUuidOrId) => {
      const targetUuid = typeof targetUuidOrId === 'object' ? (targetUuidOrId.uuid || targetUuidOrId.id) : targetUuidOrId;
      try {
        const res = await fetch(`/api/master/${entityName}/${targetUuid}`, {
          method: 'DELETE'
        });
        const json = await res.json();
        if (json && json.blocked) {
          return json;
        }
        if (!res.ok || (json && json.success === false)) {
          throw new Error(json.error || `Error al eliminar en ${entityName}`);
        }
        await deleteLocalItem(localStoreName, targetUuid);
        await loadMasterStoresFromBackend();
        return json;
      } catch (err) {
        console.warn(`[LocalDb] Operando offline para eliminar en ${entityName}: eliminando de IndexedDB y encolando outbox.`);
        await deleteLocalItem(localStoreName, targetUuid);
        store.update(list => (Array.isArray(list) ? list.filter(it => String(it.uuid || it.id) !== String(targetUuid)) : []));
        await queueOutboxAction({
          entity: localStoreName,
          action: 'delete',
          endpoint: `/api/master/${entityName}/${targetUuid}`,
          method: 'DELETE',
          targetId: targetUuid
        });
        return { success: true, offline: true };
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
export const masterLlavesStore = writable(loadStore('llaves_v1', []));
export const masterLibrosStore = writable(loadStore('libros_v1', []));

masterDepartamentosStore.subscribe(val => saveStore('departamentos_v1', val));
masterAreasStore.subscribe(val => saveStore('areas_v1', val));
masterCargosStore.subscribe(val => saveStore('cargos_v1', val));
masterEmpleadosStore.subscribe(val => saveStore('empleados_v1', val));
masterJuegosStore.subscribe(val => saveStore('juegos_v1', val));
masterMesasStore.subscribe(val => saveStore('mesas_v1', val));
masterLlavesStore.subscribe(val => saveStore('llaves_v1', val));
masterLibrosStore.subscribe(val => saveStore('libros_v1', val));

export const masterDepartamentosActions = createMasterEntityActions(masterDepartamentosStore, 'departamentos');
export const masterAreasActions = createMasterEntityActions(masterAreasStore, 'areas');
export const masterCargosActions = createMasterEntityActions(masterCargosStore, 'cargos');
export const masterEmpleadosActions = createMasterEntityActions(masterEmpleadosStore, 'empleados');
export const masterJuegosActions = createMasterEntityActions(masterJuegosStore, 'juegos');
export const masterLibrosActions = createMasterEntityActions(masterLibrosStore, 'libros');
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

export const masterLlavesActions = {
  ...createMasterEntityActions(masterLlavesStore, 'llaves'),
  restore: async (id) => {
    try {
      const res = await fetch(`/api/master/llaves/${id}/restore`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Error al restaurar llave');
      }
      await loadMasterStoresFromBackend();
      return json;
    } catch (err) {
      console.warn('Backend sync error for llave restore:', err);
      throw err;
    }
  },
  purge: async (id) => {
    try {
      const res = await fetch(`/api/master/llaves/${id}/purge`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || 'Error al eliminar llave definitivamente');
      }
      await loadMasterStoresFromBackend();
      return json;
    } catch (err) {
      console.warn('Backend sync error for llave purge:', err);
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
// STORES Y ACCIONES DE CONFIGURACIÓN DE MÁQUINAS (CONF.M: MAQUINAS)
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

// ==========================================
// CLIENTES, TIPO CLIENTES Y MÉTODOS DE PAGO
// ==========================================
export const masterTipoClientesStore = writable(loadStore('tipo_clientes_v1', []));
export const masterMetodosPagoStore = writable(loadStore('metodos_pago_v1', []));
export const masterClientesStore = writable(loadStore('clientes_v1', []));

masterTipoClientesStore.subscribe(val => saveStore('tipo_clientes_v1', val));
masterMetodosPagoStore.subscribe(val => saveStore('metodos_pago_v1', val));
masterClientesStore.subscribe(val => saveStore('clientes_v1', val));

export const masterTipoClientesActions = createMasterEntityActions(masterTipoClientesStore, 'tipo-clientes');
export const masterMetodosPagoActions = createMasterEntityActions(masterMetodosPagoStore, 'metodos-pago');
export const masterClientesActions = createMasterEntityActions(masterClientesStore, 'clientes');

// ==========================================
// TIPOS DE INCIDENCIA (CONF.M: CECOM)
// ==========================================
export const masterTipoIncidenciasStore = writable(loadStore('tipo_incidencias_v1', []));
masterTipoIncidenciasStore.subscribe(val => saveStore('tipo_incidencias_v1', val));
export const masterTipoIncidenciasActions = createMasterEntityActions(masterTipoIncidenciasStore, 'tipo-incidencias');

// ==========================================
// RANGOS (CONF.M: MAQUINAS)
// ==========================================
export const masterRangosStore = writable(loadStore('rangos_v1', []));
masterRangosStore.subscribe(val => saveStore('rangos_v1', val));
export const masterRangosActions = createMasterEntityActions(masterRangosStore, 'rangos');

