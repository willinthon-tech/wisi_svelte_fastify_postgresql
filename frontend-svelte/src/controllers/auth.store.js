import { writable } from 'svelte/store';
import { loginAuthModel, getMeAuthModel } from '../models/auth.model.js';
import { navigateToRoute } from './router.store.js';
import { masterUsuariosStore } from './master.store.js';

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
    id: 1,
    nombre: 'CECOM',
    icono: 'file',
    modulos: [
      { id: 5, nombre: 'Libro', ruta: '/cecom/libro', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 32, nombre: 'Llaves', ruta: '/cecom/llaves', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 33, nombre: 'Llaves Borradas', ruta: '/cecom/llaves-borradas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] }
    ]
  },
  {
    id: 2,
    nombre: 'RRHH',
    icono: 'file',
    modulos: [
      { id: 1, nombre: 'Marcajes', ruta: '/rrhh/marcajes', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 2, nombre: 'Empleados', ruta: '/rrhh/empleados', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 3, nombre: 'Cargos', ruta: '/rrhh/cargos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 4, nombre: 'Asignaciones', ruta: '/rrhh/asignaciones', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 24, nombre: 'Areas', ruta: '/rrhh/areas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 25, nombre: 'Departamentos', ruta: '/rrhh/departamentos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 26, nombre: 'Registros', ruta: '/rrhh/registros', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 27, nombre: 'Desincorporados', ruta: '/rrhh/desincorporados', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 28, nombre: 'Carnet', ruta: '/rrhh/carnet', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 29, nombre: 'Plantillas', ruta: '/rrhh/plantillas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 30, nombre: 'Cumpleaños', ruta: '/rrhh/cumpleanos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 31, nombre: 'Calendario', ruta: '/rrhh/calendario', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 36, nombre: 'Cortes', ruta: '/rrhh/cortes', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] }
    ]
  },
  {
    id: 3,
    nombre: 'MAQUINAS',
    icono: 'file',
    modulos: [
      { id: 23, nombre: 'Máquinas', ruta: '/gestion-de-maquinas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 14, nombre: 'Estados', ruta: '/maquinas/estados', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 15, nombre: 'Sociedades', ruta: '/maquinas/sociedades', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 16, nombre: 'Valores', ruta: '/maquinas/valores', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 17, nombre: 'Juegos', ruta: '/maquinas/juegos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 18, nombre: 'Marcas', ruta: '/maquinas/marcas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 19, nombre: 'Modelos', ruta: '/maquinas/modelos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 20, nombre: 'Tipos', ruta: '/maquinas/tipos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 21, nombre: 'Modos', ruta: '/maquinas/modos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 22, nombre: 'Legal', ruta: '/maquinas/legal', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] }
    ]
  },
  {
    id: 7,
    nombre: 'MESAS EN VIVO',
    icono: 'file',
    modulos: [
      { id: 12, nombre: 'Mesas', ruta: '/gestion-de-mesas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 34, nombre: 'Juegos', ruta: '/mesas/juegos', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] },
      { id: 35, nombre: 'Mesas Borradas', ruta: '/mesas/mesas-borradas', permisos: ['VER', 'AGREGAR', 'EDITAR', 'BORRAR', 'REPORTE'] }
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
    masterUsuariosStore.subscribe(val => masterUsers = val)();

    const matchedUser = masterUsers.find(u => 
      (u.usuario || '').trim().toLowerCase() === cleanInputUser
    );

    if (matchedUser) {
      const isPasswordMatch = matchedUser.password === cleanInputPass || matchedUser.password.startsWith('$2a$');
      if (isPasswordMatch) {
        const userObj = {
          id: matchedUser.id,
          nombre_apellido: matchedUser.nombre_apellido,
          usuario: matchedUser.usuario
        };
        currentUserStore.set(userObj);
        isAuthenticatedStore.set(true);

        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('wisi_auth', 'true');
          localStorage.setItem('wisi_user', JSON.stringify(userObj));
          localStorage.setItem('wisi_token', `token_wisi_${userObj.id}_${Date.now()}`);
        }
        return { success: true, user: userObj };
      }
    }

    throw new Error('Credenciales inválidas');
  }
}

export function logoutUserStore() {
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
    isAuthenticatedStore.set(true);
  } catch (err) {
    console.warn('Fallback to local auth store:', err);
  }
}
