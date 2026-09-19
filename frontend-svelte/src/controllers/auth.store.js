import { writable } from 'svelte/store';
import { loginAuthModel, getMeAuthModel } from '../models/auth.model.js';
import { navigateToRoute } from './router.store.js';

// Read initial session state from localStorage
const initialAuth = typeof localStorage !== 'undefined' ? localStorage.getItem('wisi_auth') === 'true' : false;
const initialUser = (typeof localStorage !== 'undefined' && localStorage.getItem('wisi_user')) 
  ? JSON.parse(localStorage.getItem('wisi_user')) 
  : null;
const initialSalas = (() => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('wisi_salas');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
})();

export const currentUserStore = writable(initialUser);
export const isAuthenticatedStore = writable(initialAuth);
export const userSalasStore = writable(initialSalas);
export const selectedSalaStore = writable(1);

export const navMenuStore = writable([
  {
    uuid: '05734605-9d74-42de-802b-55704afeddd9',
    nombre: 'CECOM',
    icono: 'file',
    modulos: [
      { uuid: 'mod-cecom-libro', nombre: 'Libro', ruta: '/cecom/libro', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-cecom-clientes', nombre: 'Clientes', ruta: '/cecom/clientes', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-cecom-llaves', nombre: 'Llaves', ruta: '/cecom/llaves', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-cecom-llaves-b', nombre: 'Llaves Borradas', ruta: '/cecom/llaves-borradas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] }
    ]
  },
  {
    uuid: '71e865d8-169a-4ff0-9c15-a1a368501ec8',
    nombre: 'RRHH',
    icono: 'file',
    modulos: [
      { uuid: 'mod-rrhh-marcajes', nombre: 'Marcajes', ruta: '/rrhh/marcajes', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-empleados', nombre: 'Empleados', ruta: '/rrhh/empleados', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-cargos', nombre: 'Cargos', ruta: '/rrhh/cargos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-asignaciones', nombre: 'Asignaciones', ruta: '/rrhh/asignaciones', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-areas', nombre: 'Areas', ruta: '/rrhh/areas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-deptos', nombre: 'Departamentos', ruta: '/rrhh/departamentos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-registros', nombre: 'Registros', ruta: '/rrhh/registros', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-desincorporados', nombre: 'Desincorporados', ruta: '/rrhh/desincorporados', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-carnet', nombre: 'Carnet', ruta: '/rrhh/carnet', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-cumpleanos', nombre: 'Cumpleaños', ruta: '/rrhh/cumpleanos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-calendario', nombre: 'Calendario', ruta: '/rrhh/calendario', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-rrhh-cortes', nombre: 'Cortes', ruta: '/rrhh/cortes', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] }
    ]
  },
  {
    uuid: '9a64bbc1-4e84-4fb4-b66c-78dfb3e5e091',
    nombre: 'CONF.M: MAQUINAS',
    icono: 'file',
    modulos: [
      { uuid: 'b1605f01-5b1a-4f84-afdd-537caf2c7678', nombre: 'Máquinas', ruta: '/configuracion/maquinas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '62eaa4df-8466-4ad9-876c-d34e9b9055d3', nombre: 'Estados', ruta: '/configuracion/estados', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '11d13c1f-88bc-4245-bf7e-bd550c2d6424', nombre: 'Sociedades', ruta: '/configuracion/sociedades', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '2ec54cc0-4a06-4885-a20f-3e5a5c7d4266', nombre: 'Valores', ruta: '/configuracion/valores', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '158a9bff-f23d-4f42-9196-c1661e516e32', nombre: 'Juegos', ruta: '/configuracion/juegos-maquinas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '73a401c8-07fc-4824-9ff2-1c57a8ad9552', nombre: 'Marcas', ruta: '/configuracion/marcas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '5982130f-8bcd-498a-8233-8f2dd4582b15', nombre: 'Modelos', ruta: '/configuracion/modelos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'd5d8ecee-2c48-42c0-abbe-fecd3e3d9387', nombre: 'Tipos', ruta: '/configuracion/tipos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'f214acec-737c-477c-8cfb-8c974e39ab4c', nombre: 'Modos', ruta: '/configuracion/modos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'ab5d4cd0-9d84-413c-8001-6570efe02bbe', nombre: 'Legal', ruta: '/configuracion/legal', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '6b601f8a-b30f-4523-92c2-6fea0d151387', nombre: 'Rangos', ruta: '/configuracion/rangos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] }
    ]
  },
  {
    uuid: 'c0e6fa7a-7b34-4989-a59d-57863502cb4c',
    nombre: 'MESAS EN VIVO',
    icono: 'file',
    modulos: [
      { uuid: 'mod-mesas-mesas', nombre: 'Mesas', ruta: '/gestion-de-mesas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-mesas-juegos', nombre: 'Juegos', ruta: '/mesas/juegos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'mod-mesas-borradas', nombre: 'Mesas Borradas', ruta: '/mesas/mesas-borradas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] }
    ]
  },
  {
    uuid: 'b37ea319-497c-49ae-bd71-1b17ab60fb16',
    nombre: 'CONF.M: CECOM',
    icono: 'file',
    modulos: [
      { uuid: 'f6cc58ea-b74c-462a-8d36-4b08f46cd077', nombre: 'Tipo Clientes', ruta: '/configuracion/tipo-clientes', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '7b9ccfd3-bfe0-4e02-bd68-3221494f432d', nombre: 'Métodos de Pago', ruta: '/configuracion/metodos-pago', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '435bd067-fe42-49b0-b525-210b7c19a1fc', nombre: 'Tipo Incidencias', ruta: '/configuracion/tipo-incidencias', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] }
    ]
  },
  {
    uuid: '26cb7129-363f-44bd-b45a-55dac3e92799',
    nombre: 'CONF.M: RRHH',
    icono: 'file',
    modulos: [
      { uuid: 'd3dbf58d-cda0-4a44-9773-ab2af79c76c9', nombre: 'Horarios', ruta: '/configuracion/horarios', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: 'd2992a2a-642a-4b29-8547-772c8f1963a3', nombre: 'Excepciones', ruta: '/configuracion/excepciones', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] },
      { uuid: '4827f008-2c8b-44d9-be39-6ff3f4ee744e', nombre: 'Fechas Patrias', ruta: '/configuracion/fechas-patrias', permisos: ['VER', 'AGREGAR', 'EDITAR', 'ELIMINAR'] }
    ]
  }
]);

export async function loginUserStore(usuario, password) {
  const cleanInputUser = (usuario || '').trim().toLowerCase();
  const cleanInputPass = (password || '').trim();

  // 1. Try Backend API login first
  try {
    const data = await loginAuthModel(usuario, password);
    currentUserStore.set(data.user);
    if (data.salas) {
      userSalasStore.set(data.salas);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('wisi_salas', JSON.stringify(data.salas));
      }
    }
    if (data.menu) navMenuStore.set(data.menu);
    if (data.permissions && data.user) {
      const userUuid = data.user.uuid || data.user.id;
      try {
        const { userModulePermissionsStore } = await import('./master.store.js');
        userModulePermissionsStore.update(curr => ({
          ...curr,
          [userUuid]: data.permissions,
          [String(userUuid)]: data.permissions
        }));
      } catch (e) {
        console.warn('Error hydrating permissions on login:', e);
      }
    }
    isAuthenticatedStore.set(true);

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('wisi_auth', 'true');
      localStorage.setItem('wisi_user', JSON.stringify(data.user));
      if (data.token) localStorage.setItem('wisi_token', data.token);
    }
    navigateToRoute('dashboard');
    return data;
  } catch (err) {
    console.warn('Backend login API fallback to master store users:', err.message);

    // 2. Dynamic check in Master Admin Users Store
    let masterUsers = [];
    try {
      const { masterUsuariosStore } = await import('./master.store.js');
      masterUsuariosStore.subscribe(val => masterUsers = val)();
    } catch (e) {}

    const matchedUser = masterUsers.find(u => 
      (u.usuario || '').trim().toLowerCase() === cleanInputUser
    );

    if (matchedUser) {
      const isPasswordMatch = matchedUser.password === cleanInputPass || matchedUser.password.startsWith('$2a$');
      if (isPasswordMatch) {
        const userObj = {
          uuid: matchedUser.uuid || matchedUser.id,
          nombre_apellido: matchedUser.nombre_apellido,
          usuario: matchedUser.usuario
        };
        currentUserStore.set(userObj);
        isAuthenticatedStore.set(true);

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('wisi_auth', 'true');
          localStorage.setItem('wisi_user', JSON.stringify(userObj));
          localStorage.setItem('wisi_token', `token_wisi_${userObj.uuid}_${Date.now()}`);
        }
        return { success: true, user: userObj };
      }
    }

    throw new Error('Credenciales inválidas');
  }
}

export function logoutUserStore() {
  try {
    import('../services/push.service.js').then(m => m.unregisterPushNotifications?.()).catch(() => {});
  } catch (e) {}

  isAuthenticatedStore.set(false);
  currentUserStore.set(null);
  userSalasStore.set([]);
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('wisi_auth');
    localStorage.removeItem('wisi_user');
    localStorage.removeItem('wisi_token');
    localStorage.removeItem('wisi_salas');
  }
}

export async function loadUserSession() {
  if (typeof localStorage !== 'undefined' && localStorage.getItem('wisi_auth') !== 'true') {
    isAuthenticatedStore.set(false);
    currentUserStore.set(null);
    userSalasStore.set([]);
    return;
  }

  // Si estamos en modo offline sin conexión a internet, mantener la sesión local activa sin peticiones fallidas
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    isAuthenticatedStore.set(true);
    return;
  }

  try {
    const data = await getMeAuthModel();
    if (data.user) {
      currentUserStore.set(data.user);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('wisi_user', JSON.stringify(data.user));
      }
    }
    if (data.salas) {
      userSalasStore.set(data.salas);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('wisi_salas', JSON.stringify(data.salas));
      }
    }
    if (data.menu) navMenuStore.set(data.menu);
    if (data.permissions && data.user) {
      const userUuid = data.user.uuid || data.user.id;
      try {
        const { userModulePermissionsStore } = await import('./master.store.js');
        userModulePermissionsStore.update(curr => ({
          ...curr,
          [userUuid]: data.permissions,
          [String(userUuid)]: data.permissions
        }));
      } catch (e) {
        console.warn('Error hydrating permissions on loadUserSession:', e);
      }
    }
    isAuthenticatedStore.set(true);
  } catch (err) {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      console.warn('Fallback to local auth store:', err);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    loadUserSession().catch(() => {});
  });
}
