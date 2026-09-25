import { get, writable, derived } from 'svelte/store';
import { currentUserStore, userSalasStore as authUserSalasStore } from './auth.store.js';
import { currentRouteStore } from './router.store.js';
import { toBackendUrl } from '../config/api.config.js';
import { 
  saveLocalItems, 
  replaceLocalItems,
  getLocalItems, 
  upsertLocalItem, 
  deleteLocalItem, 
  queueOutboxAction,
  generateSafeUuid
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
  const modUuid = mod ? (mod.uuid || mod.id) : null;
  const modNombre = mod ? mod.nombre : clean;

  // Superadmin bypass: los administradores del sistema siempre tienen acceso irrestricto
  const username = (user?.usuario || '').trim().toLowerCase();
  const isAdmin = username === 'admin' || username === 'willinthon' || user?.is_admin === true || user?.rol === 'admin';
  if (isAdmin) {
    return {
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      isModule: !!mod,
      moduleUuid: modUuid,
      moduleId: modUuid,
      moduleNombre: modNombre
    };
  }

  if (!mod) {
    return { canView: true, canAdd: true, canEdit: true, canDelete: true, isModule: false };
  }

  const userUuid = user?.uuid || user?.id || null;
  const userPerms = (userUuid && permsMapAll && (permsMapAll[userUuid] || (user?.id && permsMapAll[user.id]))) 
    ? (permsMapAll[userUuid]?.[modUuid] || permsMapAll[userUuid]?.[mod.id] || (user?.id && permsMapAll[user.id]?.[modUuid]) || []) 
    : [];

  return {
    canView: userPerms.includes('VER'),
    canAdd: userPerms.includes('AGREGAR'),
    canEdit: userPerms.includes('EDITAR'),
    canDelete: userPerms.includes('ELIMINAR') || userPerms.includes('BORRAR'),
    isModule: true,
    moduleUuid: modUuid,
    moduleId: modUuid,
    moduleNombre: mod.nombre
  };
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
  // No saturar localStorage con colecciones masivas que superen el límite de 5MB
  if (key === 'empleados_v1' || (Array.isArray(data) && data.length > 300)) return;
  try {
    localStorage.setItem(`wisi_master_${key}`, JSON.stringify(data));
  } catch (err) {
    console.error('Error saving to localStorage', err);
  }
}

export const masterSalasStore = writable(loadStore('salas_v5', []));
export const masterPaginasStore = writable(loadStore('paginas_v6', []));
export const masterModulosStore = writable(loadStore('modulos_v6', []));
export const masterDispositivosStore = writable(loadStore('dispositivos_v6', []));
export const masterUsuariosStore = writable(loadStore('usuarios_v4', []));
export const userSalasStore = writable(loadStore('user_salas_v4', {}));
export const userModulePermissionsStore = writable(loadStore('user_perms_v4', {}));

// Sync stores to localStorage automatically
masterSalasStore.subscribe(val => saveStore('salas_v5', val));
masterPaginasStore.subscribe(val => saveStore('paginas_v6', val));
masterModulosStore.subscribe(val => saveStore('modulos_v6', val));
masterDispositivosStore.subscribe(val => saveStore('dispositivos_v6', val));
masterUsuariosStore.subscribe(val => saveStore('usuarios_v4', val));
userSalasStore.subscribe(val => saveStore('user_salas_v4', val));
userModulePermissionsStore.subscribe(val => saveStore('user_perms_v4', val));

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

export function getActiveUserAssignedSalaUuids() {
  const userMap = get(userSalasStore) || {};
  const user = get(currentUserStore);
  const uid = user?.uuid || user?.id;
  const currentUserSalas = uid ? (userMap[uid] || userMap[String(uid)] || (user?.id ? userMap[user.id] : null) || []) : [];
  if (currentUserSalas && currentUserSalas.length > 0) {
    return currentUserSalas.map(s => String(typeof s === 'object' ? (s.uuid || s.id) : s));
  }
  const authSalas = get(authUserSalasStore) || [];
  if (authSalas && authSalas.length > 0) {
    return authSalas.map(s => String(typeof s === 'object' ? (s.uuid || s.id) : s));
  }
  return [];
}

export const getActiveUserAssignedSalaIds = getActiveUserAssignedSalaUuids;

export function filterOptionsByActiveSalas(items = [], salaKey = 'sala_uuid') {
  const assignedUuids = getActiveUserAssignedSalaUuids().map(String);
  return items.filter(item => {
    if (!item) return false;
    if (item.grupo_uuid && Number(item.grupo_uuid) === 2) return false;
    if (item.grupo_id && Number(item.grupo_id) === 2) return false;
    if (!assignedUuids || assignedUuids.length === 0) return true;
    if (item[salaKey]) return assignedUuids.includes(String(item[salaKey]));
    if (item.sala_uuid) return assignedUuids.includes(String(item.sala_uuid));
    if (item.sala_id) return assignedUuids.includes(String(item.sala_id));
    if (item.uuid && (salaKey === 'uuid' || salaKey === 'id' || salaKey === 'sala_uuid' || salaKey === 'sala_id')) {
      return assignedUuids.includes(String(item.uuid));
    }
    if (item.id && (salaKey === 'uuid' || salaKey === 'id' || salaKey === 'sala_uuid' || salaKey === 'sala_id')) {
      return assignedUuids.includes(String(item.id));
    }
    return true;
  });
}

// Load real-time master data from PostgreSQL backend in parallel using Promise.allSettled
let lastMasterStoresLoadTime = 0;
let isOnlineListenerAttached = false;

if (typeof window !== 'undefined' && !isOnlineListenerAttached) {
  isOnlineListenerAttached = true;
  window.addEventListener('online', () => {
    loadMasterStoresFromBackend(true).catch(() => {});
  });
}

export async function loadMasterStoresFromBackend(force = false) {
  const now = Date.now();
  if (!force && (now - lastMasterStoresLoadTime) < 25000) {
    return; // Evita peticiones masivas y re-renders del DOM (flasheo de menú) al cambiar de vista
  }
  lastMasterStoresLoadTime = now;

  const fetchEntity = async (entityName, store, localStoreKey = entityName) => {
    let currentStoreVal = [];
    store.subscribe(v => currentStoreVal = v)();

    // 1. Cargar de inmediato desde IndexedDB local SOLO si el store en memoria está vacío (cold start inicial)
    try {
      const localData = await getLocalItems(localStoreKey);
      if (Array.isArray(localData) && localData.length > 0) {
        if (!currentStoreVal || currentStoreVal.length === 0) {
          if (store && typeof store.set === 'function') store.set(localData);
          currentStoreVal = localData;
        }
      }
    } catch (e) {
      // Continuar si IndexedDB aún está cargando
    }

    // 2. Si no hay conexión, mantener copia local
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    try {
      const token = (typeof localStorage !== 'undefined') ? (localStorage.getItem('wisi_token') || localStorage.getItem('token')) : null;
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const assignedSalas = getActiveUserAssignedSalaUuids();
      if (assignedSalas && assignedSalas.length > 0) {
        headers['x-user-salas'] = assignedSalas.join(',');
      }

      let qUrl = `/api/master/${entityName}?limit=all`;
      if (assignedSalas && assignedSalas.length > 0) {
        qUrl += `&user_sala_ids=${encodeURIComponent(assignedSalas.join(','))}`;
      }

      const res = await fetch(toBackendUrl(qUrl), { headers });
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          // El servidor es la fuente autorizada de verdad
          if (store && typeof store.set === 'function') store.set(json.data);
          replaceLocalItems(localStoreKey, json.data).catch(() => {});
        }
      }
    } catch (err) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        console.warn(`Error fetching ${entityName} from backend (usando copia local):`, err);
      }
    }
  };

  const fetchUserSalas = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const resSalas = await fetch(toBackendUrl('/api/master/user-salas'));
      if (resSalas.ok) {
        const json = await resSalas.json();
        if (json && json.success && json.data) {
          userSalasStore.update(curr => {
            const isDifferent = JSON.stringify(curr) !== JSON.stringify(json.data);
            return isDifferent ? { ...curr, ...json.data } : curr;
          });
        }
      }
    } catch (err) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        console.warn('Error fetching user salas from backend:', err);
      }
    }
  };

  const fetchUserPerms = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const resPerms = await fetch(toBackendUrl('/api/master/user-permissions'));
      if (resPerms.ok) {
        const json = await resPerms.json();
        if (json && json.success && json.data) {
          userModulePermissionsStore.update(curr => {
            const isDifferent = JSON.stringify(curr) !== JSON.stringify(json.data);
            return isDifferent ? { ...curr, ...json.data } : curr;
          });
        }
      }
    } catch (err) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        console.warn('Error fetching user permissions from backend:', err);
      }
    }
  };

  // Carga organizada en lotes de 5 para no saturar las conexiones de PostgreSQL ni congelar el navegador
  const entityList = [
    ['horarios', masterPlantillasHorariosStore, 'horarios'],
    ['departamentos', masterDepartamentosStore, 'departamentos'],
    ['areas', masterAreasStore, 'areas'],
    ['cargos', masterCargosStore, 'cargos'],
    ['empleados', masterEmpleadosStore, 'empleados'],
    ['usuarios', masterUsuariosStore, 'usuarios'],
    ['salas', masterSalasStore, 'salas'],
    ['paginas', masterPaginasStore, 'paginas'],
    ['modulos', masterModulosStore, 'modulos'],
    ['dispositivos', masterDispositivosStore, 'dispositivos'],
    ['descargas', masterDescargasStore, 'descargas'],
    ['juegos', masterJuegosStore, 'juegos'],
    ['mesas', masterMesasStore, 'mesas'],
    ['llaves', masterLlavesStore, 'llaves'],
    ['libros', masterLibrosStore, 'libros'],
    ['estados', masterEstadosStore, 'estados'],
    ['sociedades', masterSociedadesStore, 'sociedades'],
    ['valores', masterValoresStore, 'valores'],
    ['juegos-maquinas', masterJuegosMaquinasStore, 'juegos_maquinas'],
    ['marcas', masterMarcasStore, 'marcas'],
    ['modelos', masterModelosStore, 'modelos'],
    ['tipos', masterTiposStore, 'tipos'],
    ['modos', masterModosStore, 'modos'],
    ['legal', masterLegalStore, 'legal'],
    ['excepciones', masterExcepcionesStore, 'excepciones'],
    ['fechas-patrias', masterFechasPatriasStore, 'fechas_patrias'],
    ['tipo-clientes', masterTipoClientesStore, 'tipo_clientes'],
    ['metodos-pago', masterMetodosPagoStore, 'metodos_pago'],
    ['tipo-incidencias', masterTipoIncidenciasStore, 'tipo_incidencias'],
    ['rangos', masterRangosStore, 'rangos'],
    ['clientes', masterClientesStore, 'clientes'],
    ['cortes', masterCortesStore, 'cortes'],
    ['maquinas', masterMaquinasStore, 'maquinas']
  ];

  const BATCH_SIZE = 5;
  for (let i = 0; i < entityList.length; i += BATCH_SIZE) {
    const chunk = entityList.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(chunk.map(([e, s, l]) => fetchEntity(e, s, l)));
  }

  await Promise.allSettled([
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
 * evitando peticiones masivas y garantizando aislamiento estricto de salas.
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

    const assignedSalas = getActiveUserAssignedSalaUuids();
    let url = toBackendUrl(`/api/sync/delta?since=${encodeURIComponent(lastSync)}`);
    if (assignedSalas && assignedSalas.length > 0) {
      url += `&user_sala_ids=${encodeURIComponent(assignedSalas.join(','))}`;
    }

    const token = (typeof localStorage !== 'undefined') ? (localStorage.getItem('wisi_token') || localStorage.getItem('token')) : null;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (assignedSalas && assignedSalas.length > 0) headers['x-user-salas'] = assignedSalas.join(',');

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[DeltaSync] Servidor respondió con estado ${res.status}. Conservando datos locales para evitar sobrecarga.`);
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
      'libros': { store: masterLibrosStore, local: 'libros' },
      'cortes': { store: masterCortesStore, local: 'cortes' },
      'maquinas': { store: masterMaquinasStore, local: 'maquinas' }
    };

    let totalChanges = 0;
    const hasSalaRestriction = assignedSalas && assignedSalas.length > 0;

    for (const [tbl, data] of Object.entries(json.changes)) {
      const mapping = tableToStoreMap[tbl];
      const localStoreKey = mapping?.local || tbl;
      const store = mapping?.store;

      const rawUpserted = Array.isArray(data.upserted) ? data.upserted : [];
      const deleted = Array.isArray(data.deleted) ? data.deleted : [];

      if (rawUpserted.length === 0 && deleted.length === 0) continue;

      // Filtrado estricto por sala en cliente como defensa en profundidad
      const upserted = rawUpserted.filter(item => {
        if (!item) return false;
        if (!hasSalaRestriction) return true;
        const itemSala = item.sala_uuid || item.sala_id;
        if (itemSala) {
          return assignedSalas.includes(String(itemSala));
        }
        if (tbl === 'salas') {
          return assignedSalas.includes(String(item.uuid || item.id));
        }
        return true;
      });

      // Actualizar base de datos local IndexedDB
      for (const item of upserted) {
        upsertLocalItem(localStoreKey, item).catch(() => {});
      }
      for (const del of deleted) {
        deleteLocalItem(localStoreKey, del.uuid || del.id).catch(() => {});
      }

      if (store) {
        store.update(currentItems => {
          let items = Array.isArray(currentItems) ? [...currentItems] : [];
          const deletedUuids = new Set(deleted.map(d => String(d.uuid || d.id)));

          // 1. Descartar eliminados (Soft delete o borrado)
          if (deletedUuids.size > 0) {
            items = items.filter(it => !deletedUuids.has(String(it.uuid || it.id)));
          }

          // 2. Upsert (actualizar registro modificado o insertar si es nuevo)
          for (const up of upserted) {
            const upUuid = String(up.uuid || up.id);
            const idx = items.findIndex(it => String(it.uuid || it.id) === upUuid);
            if (idx >= 0) {
              items[idx] = { ...items[idx], ...up };
            } else {
              items.push(up);
            }
          }

          // 3. Re-ordenar cronológicamente para que nunca queden desordenados
          if (items.length > 1) {
            items.sort((a, b) => {
              const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
              const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
              if (tA && tB && tA !== tB) return tB - tA;
              return 0;
            });
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
      console.log(`[DeltaSync] Sincronización delta aplicada con éxito: ${totalChanges} cambios reflejados con aislamiento de salas.`);
    }
  } catch (err) {
    console.warn('[DeltaSync] Error sincronizando delta:', err);
  } finally {
    isSyncingDelta = false;
  }
}

export async function saveUserSalasToBackend(userId, salaIds) {
  try {
    await fetch(toBackendUrl(`/api/master/user-salas/${userId}`), {
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
    await fetch(toBackendUrl(`/api/master/user-permissions/${userId}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: permissionsMap })
    });
  } catch (err) {
    console.warn('Error saving user permissions to backend:', err);
  }
}

// CRUD Actions Generator for 100% Instant 0ms Local-First Execution with Real-Time PostgreSQL Sync & Outbox
export function createMasterEntityActions(store, entityName, localStoreName = entityName) {
  return {
    add: async (item) => {
      let createdItem = { ...item };
      if (!createdItem.uuid) {
        createdItem.uuid = generateSafeUuid();
      }
      delete createdItem.id;
      if (!createdItem.created_at) {
        createdItem.created_at = new Date().toISOString();
      }

      // 1. Inmediatez absoluta (0ms): actualizar memoria reactiva Svelte al instante
      store.update(list => [createdItem, ...(Array.isArray(list) ? list.filter(x => String(x.uuid || x.id) !== String(createdItem.uuid)) : [])]);

      // 2. Persistencia local inmediata en IndexedDB (<5ms)
      upsertLocalItem(localStoreName, createdItem).catch(e => console.warn(`[LocalDb] Error upserting ${localStoreName}:`, e));

      // 3. Sincronización con el servidor
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: localStoreName,
          action: 'create',
          endpoint: `/api/master/${entityName}`,
          method: 'POST',
          payload: createdItem,
          uuid: createdItem.uuid
        });
        return createdItem;
      }

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(toBackendUrl(`/api/master/${entityName}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createdItem),
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json && json.success !== false) {
          const serverData = json.data || createdItem;
          await upsertLocalItem(localStoreName, serverData);
          store.update(list => (Array.isArray(list) ? list.map(it => (String(it.uuid || it.id) === String(createdItem.uuid)) ? { ...it, ...serverData } : it) : []));
          return serverData;
        } else {
          throw new Error(json?.error || `Error servidor al crear en ${entityName}`);
        }
      } catch (err) {
        console.warn(`[LocalDb] Sincronización diferida para ${entityName} (encolando outbox):`, err.message);
        await queueOutboxAction({
          entity: localStoreName,
          action: 'create',
          endpoint: `/api/master/${entityName}`,
          method: 'POST',
          payload: createdItem,
          uuid: createdItem.uuid
        });
        return createdItem;
      }
    },
    update: async (targetUuidOrId, draft) => {
      const targetUuid = typeof targetUuidOrId === 'object' ? (targetUuidOrId.uuid || targetUuidOrId.id) : targetUuidOrId;
      const updatedItem = { uuid: targetUuid, id: targetUuid, ...draft, updated_at: new Date().toISOString() };

      // 1. Inmediatez absoluta (0ms): actualizar memoria reactiva Svelte al instante
      store.update(list => (Array.isArray(list) ? list.map(it => (String(it.uuid || it.id) === String(targetUuid)) ? { ...it, ...updatedItem } : it) : []));

      // 2. Persistencia local inmediata en IndexedDB (<5ms)
      upsertLocalItem(localStoreName, updatedItem).catch(e => console.warn(`[LocalDb] Error updating ${localStoreName}:`, e));

      // 3. Sincronización con el servidor
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
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

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(toBackendUrl(`/api/master/${entityName}/${targetUuid}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft }),
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json && json.success !== false) {
          const serverData = json.data || updatedItem;
          await upsertLocalItem(localStoreName, serverData);
          store.update(list => (Array.isArray(list) ? list.map(it => (String(it.uuid || it.id) === String(targetUuid)) ? { ...it, ...serverData } : it) : []));
          return serverData;
        } else {
          throw new Error(json?.error || `Error servidor al actualizar en ${entityName}`);
        }
      } catch (err) {
        console.warn(`[LocalDb] Sincronización diferida para ${entityName} (encolando outbox):`, err.message);
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

      // Obtener copia previa para rollback si el backend lo bloquea por integridad referencial
      let previousItem = null;
      try {
        const currentList = get(store) || [];
        previousItem = currentList.find(it => String(it.uuid || it.id) === String(targetUuid));
      } catch (e) {}

      // 1. Inmediatez absoluta (0ms): eliminar de memoria reactiva Svelte
      store.update(list => (Array.isArray(list) ? list.filter(it => String(it.uuid || it.id) !== String(targetUuid)) : []));

      // 2. Persistencia local inmediata en IndexedDB (<5ms)
      deleteLocalItem(localStoreName, targetUuid).catch(e => console.warn(`[LocalDb] Error deleting ${localStoreName}:`, e));

      // 3. Sincronización con backend (o Outbox si offline)
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: localStoreName,
          action: 'delete',
          endpoint: `/api/master/${entityName}/${targetUuid}`,
          method: 'DELETE',
          targetId: targetUuid
        });
        return { success: true, offline: true };
      }

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(toBackendUrl(`/api/master/${entityName}/${targetUuid}`), {
          method: 'DELETE',
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));

        if (json && json.blocked) {
          // Rollback local si hay dependencias activas bloqueantes en PostgreSQL
          if (previousItem) {
            store.update(list => [previousItem, ...(Array.isArray(list) ? list : [])]);
            upsertLocalItem(localStoreName, previousItem).catch(() => {});
          }
          return json;
        }

        if (!res.ok || (json && json.success === false)) {
          throw new Error(json?.error || `Error al eliminar en ${entityName}`);
        }

        return json || { success: true };
      } catch (err) {
        console.warn(`[LocalDb] Fallo de red al eliminar en ${entityName}, encolando outbox:`, err.message);
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
      const res = await fetch(toBackendUrl(`/api/master/mesas/${id}/restore`), { method: 'POST' });
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
      const res = await fetch(toBackendUrl(`/api/master/mesas/${id}/purge`), { method: 'DELETE' });
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
      const res = await fetch(toBackendUrl(`/api/master/llaves/${id}/restore`), { method: 'POST' });
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
      const res = await fetch(toBackendUrl(`/api/master/llaves/${id}/purge`), { method: 'DELETE' });
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
      const res = await fetch(toBackendUrl('/api/master/modulos/reorder'), {
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
  upload: async ({ fileBase64, filename, size, sizeText, versionNum }) => {
    try {
      const res = await fetch(toBackendUrl('/api/master/descargas/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, filename, size, sizeText, versionNum })
      });
      if (res.status === 413) {
        throw new Error('El instalador es demasiado pesado para el servidor web (Error 413). Se requiere aumentar client_max_body_size en NGINX.');
      }
      const json = await res.json();
      if (!res.ok || (json && json.success === false)) {
        throw new Error(json.error || 'Error al subir instalador');
      }
      await loadMasterStoresFromBackend(true);
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

// ==========================================
// CORTES HISTÓRICOS DE ASISTENCIA (RRHH)
// ==========================================
export const masterCortesStore = writable(loadStore('cortes_v1', []));
masterCortesStore.subscribe(val => saveStore('cortes_v1', val));
export const masterCortesActions = createMasterEntityActions(masterCortesStore, 'cortes');

// ==========================================
// MÁQUINAS (CONF.M: MAQUINAS)
// ==========================================
export const masterMaquinasStore = writable(loadStore('maquinas_v1', []));
masterMaquinasStore.subscribe(val => saveStore('maquinas_v1', val));
export const masterMaquinasActions = createMasterEntityActions(masterMaquinasStore, 'maquinas');

