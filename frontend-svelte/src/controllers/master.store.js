import { get } from 'svelte/store';
import { currentUserStore, userSalasStore as authUserSalasStore } from './auth.store.js';

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

// Default Seed Data for Master Control Panel
const initialSalas = [
  { id: 1, grupo_id: 1, nombre: 'Monagas Royal Casino', nombre_comercial: 'Monagas Royal Casino, C.A.', rif: 'J-50354350-7', ubicacion: 'Av Alirio Ugarte PelayoInstalaciones del Hotel StaufferMaturin Estado Monagas.', correo: 'rrhh@monagasroyalcasino.com', telefono: '0412-019.37.73' },
  { id: 2, grupo_id: 1, nombre: 'Roraima', nombre_comercial: 'Casino Roraima Inn', rif: 'J-30606591-6', ubicacion: 'Av Monseñor Zabaleta Edif Roraima Inn Piso 0 al 3 Local Roraima Inn Sector Castillito Puerto Ordaz Guayana Bolivar Zona Postal 8050', correo: 'rrhhcasinororaima2023@gmail.com', telefono: '0424-968.86.12' },
  { id: 3, grupo_id: 1, nombre: 'Gan Casino PLC', nombre_comercial: 'Gan Casino PLC', rif: 'J-12345678-0', ubicacion: 'Puerto La Cruz', correo: 'contacto@gancasino.com', telefono: '0281-265.43.21' },
  { id: 4, grupo_id: 1, nombre: 'Charaima', nombre_comercial: 'Charaima', rif: 'J-87654321-9', ubicacion: 'Charaima', correo: 'info@charaima.com', telefono: '0295-888.77.66' },
  { id: 5, grupo_id: 1, nombre: 'Casino Caribe Plaza', nombre_comercial: 'Casino Caribe Plaza', rif: 'J-99887766-5', ubicacion: 'Caribe Plaza', correo: 'contacto@caribeplaza.com', telefono: '0295-999.00.11' },
  { id: 6, grupo_id: 1, nombre: 'Gran Casino El Marques', nombre_comercial: 'Gran Casino El Marques', rif: 'J-11223344-8', ubicacion: 'El Marqués, Caracas', correo: 'rrhh@marquescasino.com', telefono: '0212-234.56.78' },
  { id: 7, grupo_id: 1, nombre: 'Gran Casino San Cristobal', nombre_comercial: 'Gran Casino San Cristobal', rif: 'J-55667788-3', ubicacion: 'San Cristóbal, Táchira', correo: 'contacto@sancristobal.com', telefono: '0276-345.67.89' },
  { id: 8, grupo_id: 1, nombre: 'Casino Ciudad Bolivar', nombre_comercial: 'Casino Ciudad Bolivar', rif: 'J-44332211-0', ubicacion: 'Ciudad Bolivar', correo: 'contacto@ciudadbolivar.com', telefono: '0285-654.32.10' }
];

const initialPaginas = [
  { id: 1, nombre: 'CECOM' },
  { id: 2, nombre: 'RRHH' },
  { id: 3, nombre: 'MAQUINAS' },
  { id: 7, nombre: 'MESAS EN VIVO' }
];

const initialModulos = [
  { id: 5, nombre: 'Libro', icono: 'settings', ruta: '/cecom/libro', page_id: 1 },
  { id: 32, nombre: 'Llaves', icono: 'settings', ruta: '/cecom/llaves', page_id: 1 },
  { id: 33, nombre: 'Llaves Borradas', icono: 'settings', ruta: '/cecom/llaves-borradas', page_id: 1 },
  { id: 1, nombre: 'Marcajes', icono: 'settings', ruta: '/rrhh/marcajes', page_id: 2 },
  { id: 2, nombre: 'Empleados', icono: 'settings', ruta: '/rrhh/empleados', page_id: 2 },
  { id: 3, nombre: 'Cargos', icono: 'settings', ruta: '/rrhh/cargos', page_id: 2 },
  { id: 4, nombre: 'Asignaciones', icono: 'settings', ruta: '/rrhh/asignaciones', page_id: 2 },
  { id: 24, nombre: 'Areas', icono: 'settings', ruta: '/rrhh/areas', page_id: 2 },
  { id: 25, nombre: 'Departamentos', icono: 'settings', ruta: '/rrhh/departamentos', page_id: 2 },
  { id: 26, nombre: 'Registros', icono: 'settings', ruta: '/rrhh/registros', page_id: 2 },
  { id: 27, nombre: 'Desincorporados', icono: 'settings', ruta: '/rrhh/desincorporados', page_id: 2 },
  { id: 28, nombre: 'Carnet', icono: 'settings', ruta: '/rrhh/carnet', page_id: 2 },
  { id: 29, nombre: 'Plantillas', icono: 'settings', ruta: '/rrhh/plantillas', page_id: 2 },
  { id: 30, nombre: 'Cumpleaños', icono: 'settings', ruta: '/rrhh/cumpleanos', page_id: 2 },
  { id: 31, nombre: 'Calendario', icono: 'calendar_month', ruta: '/rrhh/calendario', page_id: 2 },
  { id: 36, nombre: 'Cortes', icono: 'receipt_long', ruta: '/rrhh/cortes', page_id: 2 },
  { id: 23, nombre: 'Máquinas', icono: 'settings', ruta: '/maquinas/maquinas', page_id: 3 },
  { id: 14, nombre: 'Estados', icono: 'settings', ruta: '/maquinas/estados', page_id: 3 },
  { id: 15, nombre: 'Sociedades', icono: 'settings', ruta: '/maquinas/sociedades', page_id: 3 },
  { id: 16, nombre: 'Valores', icono: 'settings', ruta: '/maquinas/valores', page_id: 3 },
  { id: 17, nombre: 'Juegos', icono: 'settings', ruta: '/maquinas/juegos', page_id: 3 },
  { id: 18, nombre: 'Marcas', icono: 'settings', ruta: '/maquinas/marcas', page_id: 3 },
  { id: 19, nombre: 'Modelos', icono: 'settings', ruta: '/maquinas/modelos', page_id: 3 },
  { id: 20, nombre: 'Tipos', icono: 'settings', ruta: '/maquinas/tipos', page_id: 3 },
  { id: 21, nombre: 'Modos', icono: 'settings', ruta: '/maquinas/modos', page_id: 3 },
  { id: 22, nombre: 'Legal', icono: 'settings', ruta: '/maquinas/legal', page_id: 3 },
  { id: 12, nombre: 'Mesas', icono: 'settings', ruta: '/mesas-en-vivo/mesas', page_id: 7 },
  { id: 34, nombre: 'Juegos', icono: 'settings', ruta: '/mesas-en-vivo/juegos', page_id: 7 },
  { id: 35, nombre: 'Mesas Borradas', icono: 'settings', ruta: '/mesas-en-vivo/mesas-borradas', page_id: 7 }
];

const initialDispositivos = [
  { id: 3, nombre: 'Marcaje Personal ( Monagas )', sala_id: 1, ip_local: null, ip_remota: '186.167.73.66:8027', ip_panel: null, usuario: 'admin', clave: 'S0p0rt3S0p0rt3', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 4, nombre: 'Marcaje Personal ( Charaima )', sala_id: 4, ip_local: null, ip_remota: '170.81.146.200:8069', ip_panel: null, usuario: 'admin', clave: 'S0p0rt3S0p0rt3', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-10-06T23:59:59' },
  { id: 18, nombre: 'Marcaje Personal ( Marques )', sala_id: 6, ip_local: null, ip_remota: '190.153.101.14:8046', ip_panel: null, usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 19, nombre: 'Marcaje Personal ( PLC )', sala_id: 3, ip_local: null, ip_remota: '186.167.71.162:8061', ip_panel: null, usuario: 'admin', clave: 'Cas1n01234', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-10-07T23:59:59' },
  { id: 21, nombre: 'Marcaje Personal ( SC )', sala_id: 7, ip_local: null, ip_remota: '190.6.52.103:8039', ip_panel: null, usuario: 'admin', clave: 'Raijenny2011*', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-10-09T23:59:59' },
  { id: 24, nombre: 'Puerta Cecom ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8070', ip_remota: '190.153.101.14:8087', ip_panel: '190.153.101.14:8090', usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 25, nombre: 'Puerta Boveda ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8050', ip_remota: '190.153.101.14:8035', ip_panel: '190.153.101.14:8091', usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 26, nombre: 'Puerta Caja ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8050', ip_remota: '190.153.101.14:8036', ip_panel: '190.153.101.14:8092', usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 31, nombre: 'Marcaje CECOM ( Roraima )', sala_id: 2, ip_local: '192.168.100.113', ip_remota: '190.72.102.210:8091', ip_panel: null, usuario: 'admin', clave: 'Jjnc0412', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-11-30T23:59:59' },
  { id: 32, nombre: 'Puerta Arco ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8085', ip_remota: '190.153.101.14:8008', ip_panel: '190.153.101.14:8093', usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 34, nombre: 'Puerta Pasillo ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8085', ip_remota: '190.153.101.14:8009', ip_panel: '190.153.101.14:8094', usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 35, nombre: 'Puerta KFC ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8081', ip_remota: '190.153.101.14:8037', ip_panel: '190.153.101.14:8095', usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 36, nombre: 'Puerta Servidores ( Marques )', sala_id: 6, ip_local: '190.153.101.14:8070', ip_remota: '190.153.101.14:8088', ip_panel: null, usuario: 'admin', clave: 'Sigma2025', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 37, nombre: 'Puerta Cecom ( SC )', sala_id: 7, ip_local: null, ip_remota: '190.6.52.103:8040', ip_panel: null, usuario: 'admin', clave: 'Raijenny2011*', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 38, nombre: 'Marcaje Secundario ( SC )', sala_id: 7, ip_local: null, ip_remota: '190.6.52.103:8041', ip_panel: null, usuario: 'admin', clave: 'Raijenny2011*', marcaje_inicio: '2025-01-01T00:00:00', marcaje_fin: '2030-12-31T23:59:59' },
  { id: 39, nombre: 'Marcaje Personal ( Roraima )', sala_id: 2, ip_local: '192.168.3.174', ip_remota: '190.72.102.210:8030', ip_panel: null, usuario: 'admin', clave: 'Jjnc0412', marcaje_inicio: '2026-01-01T00:00:00', marcaje_fin: '2031-01-31T23:59:59' },
  { id: 40, nombre: 'Marcaje Personal ( Plaza )', sala_id: 5, ip_local: null, ip_remota: '190.72.102.210:8031', ip_panel: null, usuario: 'admin', clave: 'Jjnc0412', marcaje_inicio: '2026-06-30T00:00:00', marcaje_fin: '2031-06-30T23:59:59' }
];

const initialUsuarios = [
  { id: 1, nombre_apellido: 'Wilinthon Carriedo', usuario: 'wilinthon', password: '123456' },
  { id: 2, nombre_apellido: 'Anthony Operador', usuario: 'anthony', password: '123456' },
  { id: 3, nombre_apellido: 'Supervisor General', usuario: 'supervisor', password: '123456' },
  { id: 4, nombre_apellido: 'Carla Administradora', usuario: 'carla', password: '12345678' }
];

const initialUserSalas = {
  1: [1, 2, 3, 4, 5, 6, 7, 8],
  2: [1, 4],
  3: [2, 6],
  4: [1, 2, 3, 4, 5, 6, 7, 8]
};

const initialUserModulePermissions = {
  1: {
    5: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    32: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    33: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    2: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    23: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    12: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE']
  },
  2: {
    5: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    32: ['VER', 'AGREGAR'],
    12: ['VER', 'AGREGAR', 'EDITAR']
  },
  3: {
    2: ['VER', 'AGREGAR', 'EDITAR', 'REPORTE'],
    23: ['VER', 'AGREGAR', 'EDITAR', 'REPORTE']
  },
  4: {
    5: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    32: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    33: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    1: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    2: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    23: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'],
    12: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE']
  }
};

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

export const masterSalasStore = writable(loadStore('salas_v5', initialSalas));
export const masterPaginasStore = writable(loadStore('paginas_v5', initialPaginas));
export const masterModulosStore = writable(loadStore('modulos_v5', initialModulos));
export const masterDispositivosStore = writable(loadStore('dispositivos_v6', initialDispositivos));
export const masterUsuariosStore = writable(loadStore('usuarios_v4', initialUsuarios));
export const userSalasStore = writable(loadStore('user_salas_v4', initialUserSalas));
export const userModulePermissionsStore = writable(loadStore('user_perms_v4', initialUserModulePermissions));

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
        if (json && json.success && Array.isArray(json.data) && json.data.length > 0) {
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
    fetchEntity('plantillas-horarios', masterPlantillasHorariosStore),
    fetchEntity('departamentos', masterDepartamentosStore),
    fetchEntity('areas', masterAreasStore),
    fetchEntity('cargos', masterCargosStore),
    fetchEntity('empleados', masterEmpleadosStore),
    fetchEntity('usuarios', masterUsuariosStore),
    fetchEntity('salas', masterSalasStore),
    fetchEntity('paginas', masterPaginasStore),
    fetchEntity('modulos', masterModulosStore),
    fetchEntity('dispositivos', masterDispositivosStore),
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

masterDepartamentosStore.subscribe(val => saveStore('departamentos_v1', val));
masterAreasStore.subscribe(val => saveStore('areas_v1', val));
masterCargosStore.subscribe(val => saveStore('cargos_v1', val));
masterEmpleadosStore.subscribe(val => saveStore('empleados_v1', val));

export const masterDepartamentosActions = createMasterEntityActions(masterDepartamentosStore, 'departamentos');
export const masterAreasActions = createMasterEntityActions(masterAreasStore, 'areas');
export const masterCargosActions = createMasterEntityActions(masterCargosStore, 'cargos');
export const masterEmpleadosActions = createMasterEntityActions(masterEmpleadosStore, 'empleados');

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

export const masterPlantillasHorariosStore = writable(loadStore('plantillas_horarios_v1', []));
masterPlantillasHorariosStore.subscribe(val => saveStore('plantillas_horarios_v1', val));
export const masterPlantillasHorariosActions = createMasterEntityActions(masterPlantillasHorariosStore, 'plantillas-horarios');

