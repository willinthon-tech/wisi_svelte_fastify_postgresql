import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = process.env.PGPORT || 5432;
const PGDATABASE = process.env.PGDATABASE || 'wisi_db';
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

export let sql = null;
export let isPgConnected = false;

// Fallback in-memory stores for tables
export let inMemoryData = {
  configuracion: [
    { clave: 'timezone', valor: 'America/Caracas' }
  ],
  cortes: [],
  usuarios: [
    {
      id: 1,
      nombre_apellido: 'Wilinthon Carriedo',
      usuario: 'wilinthon',
      password: '123456',
      created_at: '2025-09-30T04:45:22.000Z',
      updated_at: '2025-09-30T04:45:22.000Z'
    },
    {
      id: 4,
      nombre_apellido: 'Carla Administradora',
      usuario: 'carla',
      password: '12345678',
      created_at: '2025-09-30T04:45:22.000Z',
      updated_at: '2025-09-30T04:45:22.000Z'
    }
  ],
  grupo_salas: [
    { id: 1, nombre: 'SALA', descripcion: 'Sala de juego / Casino' },
    { id: 2, nombre: 'GALPÓN', descripcion: 'Galpón / Depósito de almacenamiento' }
  ],
  salas: [
    { id: 1, grupo_id: 1, nombre: 'Monagas Royal Casino', nombre_comercial: 'Monagas Royal Casino, C.A.', rif: 'J-50354350-7', ubicacion: 'Av Alirio Ugarte PelayoInstalaciones del Hotel StaufferMaturin Estado Monagas.', correo: 'rrhh@monagasroyalcasino.com', telefono: '0412-019.37.73' },
    { id: 2, grupo_id: 1, nombre: 'Roraima', nombre_comercial: 'Casino Roraima Inn', rif: 'J-30606591-6', ubicacion: 'Av Monseñor Zabaleta Edif Roraima Inn Piso 0 al 3 Local Roraima Inn Sector Castillito Puerto Ordaz Guayana Bolivar Zona Postal 8050', correo: 'rrhhcasinororaima2023@gmail.com', telefono: '0424-968.86.12' },
    { id: 3, grupo_id: 1, nombre: 'Gan Casino PLC', nombre_comercial: 'Gan Casino PLC', rif: 'J-12345678-0', ubicacion: 'Puerto La Cruz', correo: 'contacto@gancasino.com', telefono: '0281-265.43.21' },
    { id: 4, grupo_id: 1, nombre: 'Charaima', nombre_comercial: 'Charaima', rif: 'J-87654321-9', ubicacion: 'Charaima', correo: 'info@charaima.com', telefono: '0295-888.77.66' },
    { id: 5, grupo_id: 1, nombre: 'Casino Caribe Plaza', nombre_comercial: 'Casino Caribe Plaza', rif: 'J-99887766-5', ubicacion: 'Caribe Plaza', correo: 'contacto@caribeplaza.com', telefono: '0295-999.00.11' },
    { id: 6, grupo_id: 1, nombre: 'Gran Casino El Marques', nombre_comercial: 'Gran Casino El Marques', rif: 'J-11223344-8', ubicacion: 'El Marqués, Caracas', correo: 'rrhh@marquescasino.com', telefono: '0212-234.56.78' },
    { id: 7, grupo_id: 1, nombre: 'Gran Casino San Cristobal', nombre_comercial: 'Gran Casino San Cristobal', rif: 'J-55667788-3', ubicacion: 'San Cristóbal, Táchira', correo: 'contacto@sancristobal.com', telefono: '0276-345.67.89' },
    { id: 8, grupo_id: 1, nombre: 'Casino Ciudad Bolivar', nombre_comercial: 'Casino Ciudad Bolivar', rif: 'J-44332211-0', ubicacion: 'Ciudad Bolivar', correo: 'contacto@ciudadbolivar.com', telefono: '0285-654.32.10' }
  ],
  user_salas: [
    { id: 32, user_id: 1, sala_id: 1 },
    { id: 33, user_id: 1, sala_id: 2 },
    { id: 34, user_id: 1, sala_id: 3 },
    { id: 35, user_id: 1, sala_id: 4 },
    { id: 36, user_id: 1, sala_id: 5 },
    { id: 37, user_id: 1, sala_id: 6 },
    { id: 38, user_id: 1, sala_id: 7 },
    { id: 39, user_id: 1, sala_id: 8 },
    { id: 40, user_id: 4, sala_id: 1 },
    { id: 41, user_id: 4, sala_id: 2 },
    { id: 42, user_id: 4, sala_id: 3 },
    { id: 43, user_id: 4, sala_id: 4 },
    { id: 44, user_id: 4, sala_id: 5 },
    { id: 45, user_id: 4, sala_id: 6 },
    { id: 46, user_id: 4, sala_id: 7 },
    { id: 47, user_id: 4, sala_id: 8 }
  ],
  paginas: [
    { id: 1, nombre: 'CECOM' },
    { id: 2, nombre: 'RRHH' },
    { id: 3, nombre: 'MAQUINAS' },
    { id: 7, nombre: 'MESAS EN VIVO' }
  ],
  modulos: [
    // Módulos de CECOM (page_id = 1)
    { id: 5, nombre: 'Libro', icono: 'settings', ruta: '/cecom/libro', page_id: 1 },
    { id: 32, nombre: 'Llaves', icono: 'settings', ruta: '/cecom/llaves', page_id: 1 },
    { id: 33, nombre: 'Llaves Borradas', icono: 'settings', ruta: '/cecom/llaves-borradas', page_id: 1 },
    // Módulos de RRHH (page_id = 2)
    { id: 1, nombre: 'Fotos Globales', icono: 'settings', ruta: '/rrhh/fotos-globales', page_id: 2 },
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
    // Módulos de MAQUINAS (page_id = 3)
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
    // Módulos de MESAS EN VIVO (page_id = 7)
    { id: 12, nombre: 'Mesas', icono: 'settings', ruta: '/mesas-en-vivo/mesas', page_id: 7 },
    { id: 34, nombre: 'Juegos', icono: 'settings', ruta: '/mesas-en-vivo/juegos', page_id: 7 },
    { id: 35, nombre: 'Mesas Borradas', icono: 'settings', ruta: '/mesas-en-vivo/mesas-borradas', page_id: 7 }
  ],
  dispositivos: [
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
  ],
  attlogs: [],
  permissions: [
    { id: 1, nombre: 'AGREGAR' },
    { id: 2, nombre: 'REPORTE' },
    { id: 3, nombre: 'EDITAR' },
    { id: 4, nombre: 'BORRAR' },
    { id: 5, nombre: 'VER' }
  ],
  user_module_permissions: [
    // Módulos de CECOM (5, 32, 33) y MESAS EN VIVO (12, 34, 35)
    { id: 21, user_id: 1, module_id: 5, permission_id: 5 },
    { id: 22, user_id: 1, module_id: 5, permission_id: 1 },
    { id: 23, user_id: 1, module_id: 5, permission_id: 3 },
    { id: 24, user_id: 1, module_id: 5, permission_id: 4 },
    { id: 25, user_id: 1, module_id: 5, permission_id: 2 },
    { id: 141, user_id: 1, module_id: 32, permission_id: 5 },
    { id: 142, user_id: 1, module_id: 32, permission_id: 1 },
    { id: 143, user_id: 1, module_id: 32, permission_id: 3 },
    { id: 144, user_id: 1, module_id: 32, permission_id: 4 },
    { id: 145, user_id: 1, module_id: 32, permission_id: 2 },
    { id: 146, user_id: 1, module_id: 33, permission_id: 5 },
    { id: 147, user_id: 1, module_id: 33, permission_id: 1 },
    { id: 148, user_id: 1, module_id: 33, permission_id: 3 },
    { id: 149, user_id: 1, module_id: 33, permission_id: 4 },
    { id: 150, user_id: 1, module_id: 33, permission_id: 2 },
    { id: 31, user_id: 1, module_id: 12, permission_id: 5 },
    { id: 32, user_id: 1, module_id: 12, permission_id: 1 },
    { id: 33, user_id: 1, module_id: 12, permission_id: 3 },
    { id: 34, user_id: 1, module_id: 12, permission_id: 4 },
    { id: 35, user_id: 1, module_id: 12, permission_id: 2 },
    { id: 151, user_id: 1, module_id: 34, permission_id: 5 },
    { id: 152, user_id: 1, module_id: 34, permission_id: 1 },
    { id: 153, user_id: 1, module_id: 34, permission_id: 3 },
    { id: 154, user_id: 1, module_id: 34, permission_id: 4 },
    { id: 155, user_id: 1, module_id: 34, permission_id: 2 },
    { id: 156, user_id: 1, module_id: 35, permission_id: 5 },
    { id: 157, user_id: 1, module_id: 35, permission_id: 1 },
    { id: 158, user_id: 1, module_id: 35, permission_id: 3 },
    { id: 159, user_id: 1, module_id: 35, permission_id: 4 },
    { id: 160, user_id: 1, module_id: 35, permission_id: 2 },
    // Módulos de RRHH (1..4, 24..31)
    { id: 1, user_id: 1, module_id: 1, permission_id: 5 },
    { id: 2, user_id: 1, module_id: 1, permission_id: 1 },
    { id: 3, user_id: 1, module_id: 1, permission_id: 3 },
    { id: 4, user_id: 1, module_id: 1, permission_id: 4 },
    { id: 5, user_id: 1, module_id: 1, permission_id: 2 },
    { id: 6, user_id: 1, module_id: 2, permission_id: 5 },
    { id: 7, user_id: 1, module_id: 2, permission_id: 1 },
    { id: 8, user_id: 1, module_id: 2, permission_id: 3 },
    { id: 9, user_id: 1, module_id: 2, permission_id: 4 },
    { id: 10, user_id: 1, module_id: 2, permission_id: 2 },
    { id: 11, user_id: 1, module_id: 3, permission_id: 5 },
    { id: 12, user_id: 1, module_id: 3, permission_id: 1 },
    { id: 13, user_id: 1, module_id: 3, permission_id: 3 },
    { id: 14, user_id: 1, module_id: 3, permission_id: 4 },
    { id: 15, user_id: 1, module_id: 3, permission_id: 2 },
    { id: 16, user_id: 1, module_id: 4, permission_id: 5 },
    { id: 17, user_id: 1, module_id: 4, permission_id: 1 },
    { id: 18, user_id: 1, module_id: 4, permission_id: 3 },
    { id: 19, user_id: 1, module_id: 4, permission_id: 4 },
    { id: 20, user_id: 1, module_id: 4, permission_id: 2 },
    { id: 101, user_id: 1, module_id: 24, permission_id: 5 },
    { id: 102, user_id: 1, module_id: 24, permission_id: 1 },
    { id: 103, user_id: 1, module_id: 24, permission_id: 3 },
    { id: 104, user_id: 1, module_id: 24, permission_id: 4 },
    { id: 105, user_id: 1, module_id: 24, permission_id: 2 },
    { id: 106, user_id: 1, module_id: 25, permission_id: 5 },
    { id: 107, user_id: 1, module_id: 25, permission_id: 1 },
    { id: 108, user_id: 1, module_id: 25, permission_id: 3 },
    { id: 109, user_id: 1, module_id: 25, permission_id: 4 },
    { id: 110, user_id: 1, module_id: 25, permission_id: 2 },
    { id: 111, user_id: 1, module_id: 26, permission_id: 5 },
    { id: 112, user_id: 1, module_id: 26, permission_id: 1 },
    { id: 113, user_id: 1, module_id: 26, permission_id: 3 },
    { id: 114, user_id: 1, module_id: 26, permission_id: 4 },
    { id: 115, user_id: 1, module_id: 26, permission_id: 2 },
    { id: 116, user_id: 1, module_id: 27, permission_id: 5 },
    { id: 117, user_id: 1, module_id: 27, permission_id: 1 },
    { id: 118, user_id: 1, module_id: 27, permission_id: 3 },
    { id: 119, user_id: 1, module_id: 27, permission_id: 4 },
    { id: 120, user_id: 1, module_id: 27, permission_id: 2 },
    { id: 121, user_id: 1, module_id: 28, permission_id: 5 },
    { id: 122, user_id: 1, module_id: 28, permission_id: 1 },
    { id: 123, user_id: 1, module_id: 28, permission_id: 3 },
    { id: 124, user_id: 1, module_id: 28, permission_id: 4 },
    { id: 125, user_id: 1, module_id: 28, permission_id: 2 },
    { id: 126, user_id: 1, module_id: 29, permission_id: 5 },
    { id: 127, user_id: 1, module_id: 29, permission_id: 1 },
    { id: 128, user_id: 1, module_id: 29, permission_id: 3 },
    { id: 129, user_id: 1, module_id: 29, permission_id: 4 },
    { id: 130, user_id: 1, module_id: 29, permission_id: 2 },
    { id: 131, user_id: 1, module_id: 30, permission_id: 5 },
    { id: 132, user_id: 1, module_id: 30, permission_id: 1 },
    { id: 133, user_id: 1, module_id: 30, permission_id: 3 },
    { id: 134, user_id: 1, module_id: 30, permission_id: 4 },
    { id: 135, user_id: 1, module_id: 30, permission_id: 2 },
    { id: 136, user_id: 1, module_id: 31, permission_id: 5 },
    { id: 137, user_id: 1, module_id: 31, permission_id: 1 },
    { id: 138, user_id: 1, module_id: 31, permission_id: 3 },
    { id: 139, user_id: 1, module_id: 31, permission_id: 4 },
    { id: 140, user_id: 1, module_id: 31, permission_id: 2 },
    // Módulos de MAQUINAS (23, 14..22)
    { id: 90, user_id: 1, module_id: 23, permission_id: 5 },
    { id: 91, user_id: 1, module_id: 23, permission_id: 1 },
    { id: 92, user_id: 1, module_id: 23, permission_id: 3 },
    { id: 93, user_id: 1, module_id: 23, permission_id: 4 },
    { id: 94, user_id: 1, module_id: 23, permission_id: 2 },
    { id: 45, user_id: 1, module_id: 14, permission_id: 5 },
    { id: 46, user_id: 1, module_id: 14, permission_id: 1 },
    { id: 47, user_id: 1, module_id: 14, permission_id: 3 },
    { id: 48, user_id: 1, module_id: 14, permission_id: 4 },
    { id: 49, user_id: 1, module_id: 14, permission_id: 2 },
    { id: 50, user_id: 1, module_id: 15, permission_id: 5 },
    { id: 51, user_id: 1, module_id: 15, permission_id: 1 },
    { id: 52, user_id: 1, module_id: 15, permission_id: 3 },
    { id: 53, user_id: 1, module_id: 15, permission_id: 4 },
    { id: 54, user_id: 1, module_id: 15, permission_id: 2 },
    { id: 55, user_id: 1, module_id: 16, permission_id: 5 },
    { id: 56, user_id: 1, module_id: 16, permission_id: 1 },
    { id: 57, user_id: 1, module_id: 16, permission_id: 3 },
    { id: 58, user_id: 1, module_id: 16, permission_id: 4 },
    { id: 59, user_id: 1, module_id: 16, permission_id: 2 },
    { id: 60, user_id: 1, module_id: 17, permission_id: 5 },
    { id: 61, user_id: 1, module_id: 17, permission_id: 1 },
    { id: 62, user_id: 1, module_id: 17, permission_id: 3 },
    { id: 63, user_id: 1, module_id: 17, permission_id: 4 },
    { id: 64, user_id: 1, module_id: 17, permission_id: 2 },
    { id: 65, user_id: 1, module_id: 18, permission_id: 5 },
    { id: 66, user_id: 1, module_id: 18, permission_id: 1 },
    { id: 67, user_id: 1, module_id: 18, permission_id: 3 },
    { id: 68, user_id: 1, module_id: 18, permission_id: 4 },
    { id: 69, user_id: 1, module_id: 18, permission_id: 2 },
    { id: 70, user_id: 1, module_id: 19, permission_id: 5 },
    { id: 71, user_id: 1, module_id: 19, permission_id: 1 },
    { id: 72, user_id: 1, module_id: 19, permission_id: 3 },
    { id: 73, user_id: 1, module_id: 19, permission_id: 4 },
    { id: 74, user_id: 1, module_id: 19, permission_id: 2 },
    { id: 75, user_id: 1, module_id: 20, permission_id: 5 },
    { id: 76, user_id: 1, module_id: 20, permission_id: 1 },
    { id: 77, user_id: 1, module_id: 20, permission_id: 3 },
    { id: 78, user_id: 1, module_id: 20, permission_id: 4 },
    { id: 79, user_id: 1, module_id: 20, permission_id: 2 },
    { id: 80, user_id: 1, module_id: 21, permission_id: 5 },
    { id: 81, user_id: 1, module_id: 21, permission_id: 1 },
    { id: 82, user_id: 1, module_id: 21, permission_id: 3 },
    { id: 83, user_id: 1, module_id: 21, permission_id: 4 },
    { id: 84, user_id: 1, module_id: 21, permission_id: 2 },
    { id: 85, user_id: 1, module_id: 22, permission_id: 5 },
    { id: 86, user_id: 1, module_id: 22, permission_id: 1 },
    { id: 87, user_id: 1, module_id: 22, permission_id: 3 },
    { id: 88, user_id: 1, module_id: 22, permission_id: 4 },
    { id: 89, user_id: 1, module_id: 22, permission_id: 2 }
  ],
  wisi_items: [
    {
      id: 1,
      title: '🚀 Configurar Backend Fastify',
      description: 'Crear endpoints de la API REST con Fastify y PostgreSQL (postgres.js)',
      category: 'Backend',
      priority: 'High',
      completed: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 2,
      title: '✨ Diseñar PWA con Svelte 5',
      description: 'Interfaz moderna Glassmorphism con Service Worker e instalación PWA',
      category: 'Frontend',
      priority: 'High',
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 3,
      title: '📊 Conectar Base de Datos PostgreSQL',
      description: 'Definición de tablas e índices para la base de datos de WISI',
      category: 'Database',
      priority: 'Medium',
      completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ]
};

export let inMemoryItems = inMemoryData.wisi_items;

export function setInMemoryItems(items) {
  inMemoryItems = items;
  inMemoryData.wisi_items = items;
}

export async function initDb() {
  try {
    sql = postgres({
      host: PGHOST,
      port: Number(PGPORT),
      database: PGDATABASE,
      username: PGUSER,
      password: PGPASSWORD,
      connect_timeout: 3,
      max_lifetime: 60,
      idle_timeout: 10,
      max: 10,
      onnotice: () => { }
    });

    // 1. Table usuarios
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre_apellido VARCHAR(255),
        usuario VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 2. Table grupo_salas
    await sql`
      CREATE TABLE IF NOT EXISTS grupo_salas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        descripcion TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. Table salas
    await sql`
      CREATE TABLE IF NOT EXISTS salas (
        id SERIAL PRIMARY KEY,
        grupo_id INTEGER REFERENCES grupo_salas(id) ON DELETE SET NULL,
        nombre VARCHAR(255) NOT NULL,
        nombre_comercial VARCHAR(255),
        rif VARCHAR(50),
        ubicacion TEXT,
        correo VARCHAR(100),
        telefono VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 4. Table user_salas
    await sql`
      CREATE TABLE IF NOT EXISTS user_salas (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 5. Table paginas
    await sql`
      CREATE TABLE IF NOT EXISTS paginas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 6. Table modulos
    await sql`
      CREATE TABLE IF NOT EXISTS modulos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        icono VARCHAR(50) DEFAULT 'settings',
        ruta VARCHAR(255) NOT NULL,
        page_id INTEGER REFERENCES paginas(id) ON DELETE CASCADE,
        orden INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      ALTER TABLE modulos ADD COLUMN IF NOT EXISTS orden INT DEFAULT 0;
    `;

    // 7. Table permissions
    await sql`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 8. Table user_module_permissions
    await sql`
      CREATE TABLE IF NOT EXISTS user_module_permissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        module_id INTEGER REFERENCES modulos(id) ON DELETE CASCADE,
        permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 10. Table attlogs
    await sql`
      CREATE TABLE IF NOT EXISTS attlogs (
        id SERIAL PRIMARY KEY,
        dispositivo_id INTEGER REFERENCES dispositivos(id) ON DELETE CASCADE,
        employee_no VARCHAR(100) NOT NULL,
        event_time TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        nombre VARCHAR(255),
        attendancestatus VARCHAR(100),
        currentverifymode VARCHAR(100),
        has_photo BOOLEAN DEFAULT FALSE,
        CONSTRAINT uk_attlog_record UNIQUE (dispositivo_id, employee_no, event_time)
      );
    `;

    // 11. Table configuracion
    await sql`
      CREATE TABLE IF NOT EXISTS configuracion (
        clave VARCHAR(100) PRIMARY KEY,
        valor TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      INSERT INTO configuracion (clave, valor)
      VALUES ('timezone', 'America/Caracas')
      ON CONFLICT (clave) DO NOTHING;
    `;

    // 12. Table departamentos
    await sql`
      CREATE TABLE IF NOT EXISTS departamentos (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        sala_id INT REFERENCES salas(id) ON DELETE SET NULL
      );
    `;

    // 13. Table areas
    await sql`
      CREATE TABLE IF NOT EXISTS areas (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        departamento_id INT REFERENCES departamentos(id) ON DELETE SET NULL
      );
    `;

    // 14. Table cargos
    await sql`
      CREATE TABLE IF NOT EXISTS cargos (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        area_id INT REFERENCES areas(id) ON DELETE SET NULL
      );
    `;

    // 15. Table empleados
    await sql`
      CREATE TABLE IF NOT EXISTS empleados (
        id INT PRIMARY KEY,
        foto TEXT,
        nombre VARCHAR(255) NOT NULL,
        cedula VARCHAR(255) NOT NULL,
        fecha_ingreso DATE,
        fecha_nacimiento DATE,
        sexo VARCHAR(50),
        cargo_id INT REFERENCES cargos(id) ON DELETE SET NULL,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Auto-rename legacy column fecha_cumpleanos to fecha_nacimiento if present
    try {
      await sql.unsafe(`ALTER TABLE empleados RENAME COLUMN fecha_cumpleanos TO fecha_nacimiento;
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_desincorporacion TEXT;`);
    } catch (e) {
      // Column already renamed or table new, ignore
    }

    // 16. Table empleado_dispositivos (Relación Empleado <-> Dispositivos para Permisos de Marcaje)
    await sql`
      CREATE TABLE IF NOT EXISTS empleado_dispositivos (
        id INT PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        dispositivo_id INT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 17. Table empleados_plantillas_horarios (Direct assignment of shift plantillas to employees)
    await sql`
      CREATE TABLE IF NOT EXISTS empleados_plantillas_horarios (
        id SERIAL PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        plantilla_horario_id INT NOT NULL REFERENCES plantillas_horarios(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_emp_plantilla UNIQUE(empleado_id, plantilla_horario_id)
      );
    `;

    // 18. Table excepciones_horarios (Shift exception overrides by employee and date)
    await sql`
      CREATE TABLE IF NOT EXISTS excepciones_horarios (
        id SERIAL PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        fecha DATE NOT NULL,
        plantilla_horario_id INT REFERENCES plantillas_horarios(id) ON DELETE CASCADE,
        es_libre BOOLEAN DEFAULT FALSE,
        observacion TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_emp_fecha_excepcion UNIQUE(empleado_id, fecha)
      );
    `;

    // 19. Table feriados (Fechas patrias y días feriados por sala y nacionales)
    await sql`
      CREATE TABLE IF NOT EXISTS feriados (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        sala_id INT REFERENCES salas(id) ON DELETE CASCADE,
        mes INT NOT NULL,
        dia INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 20. Table cortes (Históricos de cortes de asistencia congelados con snapshot JSON completo)
    await sql`
      CREATE TABLE IF NOT EXISTS cortes (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        sala_id INT REFERENCES salas(id) ON DELETE SET NULL,
        sala_nombre VARCHAR(255),
        fecha_desde DATE NOT NULL,
        fecha_hasta DATE NOT NULL,
        total_empleados INT DEFAULT 0,
        data JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Registrar módulo 36 Cortes
    await sql`
      INSERT INTO modulos (id, nombre, icono, ruta, page_id, orden) VALUES
      (36, 'Cortes', 'receipt_long', '/rrhh/cortes', 2, 28)
      ON CONFLICT (id) DO UPDATE SET nombre = 'Cortes', ruta = '/rrhh/cortes';
    `.catch(() => {});

    // Limpiar posibles duplicados anteriores del módulo Cortes
    await sql`
      DELETE FROM modulos 
      WHERE (LOWER(nombre) = 'cortes' OR ruta = '/rrhh/cortes') AND id != 36;
    `.catch(() => {});

    // Asignar permisos completos de Cortes al usuario 1
    await sql`
      INSERT INTO user_module_permissions (user_id, module_id, permission_id) VALUES
      (1, 36, 1), (1, 36, 2), (1, 36, 3), (1, 36, 4), (1, 36, 5)
      ON CONFLICT DO NOTHING;
    `.catch(() => {});

    // Actualizar nombre y ruta de módulo 31 a Calendario
    await sql`
      UPDATE modulos 
      SET nombre = 'Calendario', ruta = '/rrhh/calendario' 
      WHERE id = 31 OR LOWER(nombre) = 'feriados';
    `.catch(() => {});

    // Sembrar fechas patrias iniciales si la tabla feriados está vacía
    const feriadosCountRes = await sql`SELECT count(*)::int as count FROM feriados`.catch(() => [{ count: 0 }]);
    if (feriadosCountRes[0]?.count === 0) {
      await sql`
        INSERT INTO feriados (id, nombre, sala_id, mes, dia) VALUES
        (22, 'Fundación de Porlamar', 4, 3, 26),
        (23, 'Día de la Independencia de Margarita.', 4, 5, 4),
        (24, 'Natalicio de Santiago Mariño', 4, 7, 25),
        (25, 'Batalla de Matasiete', 4, 7, 31),
        (26, 'Día de la Asunción de la Virgen, patrona de la Diócesis de Margarita', 4, 8, 15),
        (27, 'Día de la Virgen del Valle, Patrona del Oriente venezolano', 4, 9, 8),
        (30, 'Lunes de Carnaval', 6, 2, 16),
        (31, 'Martes de Carnaval', 6, 2, 17),
        (32, 'Jueves Santo', 6, 4, 2),
        (33, 'Viernes Santo', 6, 4, 3),
        (34, 'Viernes Santo', 6, 4, 3),
        (35, 'BATALLA DE SAN FELIX', 2, 4, 11),
        (36, 'LUNES DE CARNAVAL', 1, 2, 16),
        (37, 'MARTES DE CARNAVAL', 1, 2, 17),
        (38, 'JUVES SANTO', 1, 4, 2),
        (39, 'VIERNES SANTO', 1, 4, 3),
        (40, 'LUNES DE CARNAVAL', 2, 2, 16),
        (41, 'MARTES DE CARNAVAL', 2, 2, 17),
        (42, 'DIA DE JUBILO NACIONAL PROVICIONAL', 1, 3, 18),
        (43, 'Jueves santo', 2, 4, 2),
        (44, 'Viernes santo', 2, 4, 3),
        (45, 'DECRETO REGIONAL MARINOS DE ANZOATEGUI', 3, 6, 19)
        ON CONFLICT (id) DO NOTHING;
      `.catch((e) => console.warn('Error sembrando feriados iniciales:', e));
      await sql`SELECT setval('feriados_id_seq', (SELECT COALESCE(MAX(id), 1) FROM feriados));`.catch(() => {});
    }

    // Existing wisi_items table
    await sql`
      CREATE TABLE IF NOT EXISTS wisi_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(50) DEFAULT 'General',
        priority VARCHAR(20) DEFAULT 'Medium',
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Seed defaults in PostgreSQL if empty
    const userCount = await sql`SELECT count(*)::int as count FROM usuarios`;
    if (userCount[0].count === 0) {
      await sql`
        INSERT INTO usuarios (id, nombre_apellido, usuario, password)
        VALUES (1, 'Wilinthon Carriedo', 'wilinthon', '123456')
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        INSERT INTO grupo_salas (id, nombre, descripcion) VALUES
        (1, 'Bingo', 'Salas de juego tipo Bingo'),
        (2, 'Casino VIP', 'Casinos de alta categoría'),
        (3, 'Slot Center', 'Salas de máquinas tragamonedas'),
        (4, 'Sportbook', 'Salas de apuestas deportivas')
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        INSERT INTO salas (id, grupo_id, nombre, nombre_comercial, rif, ubicacion, correo, telefono) VALUES
        (1, 2, 'Monagas Royal Casino', 'Monagas Royal Casino, C.A.', 'J-50354350-7', 'Av Alirio Ugarte Pelayo', 'rrhh@monagasroyal.com', '0412-019.37.73'),
        (2, 2, 'Roralma', 'Casino Roralma Inn', 'J-30606591-6', 'Av Monseñor Zabaleta Edif Roraima', 'rrhhasinororaima@gmail.com', '0424-968.86.12'),
        (3, 1, 'Gan Casino PLC', 'Gan Casino PLC', NULL, NULL, NULL, NULL),
        (4, 3, 'Charaima', 'Charaima', NULL, NULL, NULL, NULL),
        (5, 3, 'Caribe Plaza', 'Caribe Plaza', NULL, NULL, NULL, NULL),
        (6, 2, 'Gran Casino El Marques', 'Gran Casino El Marques', NULL, NULL, NULL, NULL),
        (7, 2, 'Gran Casino San Cristobal', 'Gran Casino San Cristobal', NULL, NULL, NULL, NULL)
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        INSERT INTO user_salas (user_id, sala_id) VALUES
        (1, 1), (1, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7)
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        INSERT INTO paginas (id, nombre) VALUES
        (1, 'CECOM'),
        (2, 'RRHH'),
        (3, 'MAQUINAS'),
        (7, 'MESAS EN VIVO')
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        INSERT INTO modulos (id, nombre, icono, ruta, page_id) VALUES
        (5, 'Libro', 'settings', '/libros', 1),
        (32, 'Llaves', 'settings', '/cecom/llaves', 1),
        (33, 'Llaves Borradas', 'settings', '/cecom/llaves-borradas', 1),
        (1, 'Fotos Globales', 'settings', '/marcajes', 2),
        (2, 'Empleados', 'settings', '/empleados', 2),
        (3, 'Cargos', 'settings', '/cargos', 2),
        (4, 'Asignaciones', 'settings', '/rrhh/asignaciones', 2),
        (24, 'Areas', 'settings', '/rrhh/areas', 2),
        (25, 'Departamentos', 'settings', '/rrhh/departamentos', 2),
        (26, 'Registros', 'settings', '/rrhh/registros', 2),
        (27, 'Desincorporados', 'settings', '/rrhh/desincorporados', 2),
        (28, 'Carnet', 'settings', '/rrhh/carnet', 2),
        (29, 'Plantillas', 'settings', '/rrhh/plantillas', 2),
        (30, 'Cumpleaños', 'settings', '/rrhh/cumpleanos', 2),
        (31, 'Calendario', 'calendar_month', '/rrhh/calendario', 2),
        (23, 'Máquinas', 'settings', '/gestion-de-maquinas', 3),
        (14, 'Estados', 'settings', '/maquinas/estados', 3),
        (15, 'Sociedades', 'settings', '/maquinas/sociedades', 3),
        (16, 'Valores', 'settings', '/maquinas/valores', 3),
        (17, 'Juegos', 'settings', '/maquinas/juegos', 3),
        (18, 'Marcas', 'settings', '/maquinas/marcas', 3),
        (19, 'Modelos', 'settings', '/maquinas/modelos', 3),
        (20, 'Tipos', 'settings', '/maquinas/tipos', 3),
        (21, 'Modos', 'settings', '/maquinas/modos', 3),
        (22, 'Legal', 'settings', '/maquinas/legal', 3),
        (12, 'Mesas', 'settings', '/gestion-de-mesas', 7),
        (34, 'Juegos', 'settings', '/mesas/juegos', 7),
        (35, 'Mesas Borradas', 'settings', '/mesas/mesas-borradas', 7)
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        UPDATE modulos 
        SET nombre = 'Registros', ruta = '/rrhh/registros' 
        WHERE id = 26 OR LOWER(nombre) = 'reportes';
      `;
      await sql`
        INSERT INTO permissions (id, nombre) VALUES
        (1, 'AGREGAR'), (2, 'REPORTE'), (3, 'EDITAR'), (4, 'BORRAR'), (5, 'VER')
        ON CONFLICT DO NOTHING;
      `;
      await sql`
        INSERT INTO user_module_permissions (user_id, module_id, permission_id) VALUES
        (1, 5, 5), (1, 5, 1), (1, 5, 3), (1, 5, 4), (1, 5, 2),
        (1, 32, 5), (1, 32, 1), (1, 32, 3), (1, 32, 4), (1, 32, 2),
        (1, 33, 5), (1, 33, 1), (1, 33, 3), (1, 33, 4), (1, 33, 2),
        (1, 12, 5), (1, 12, 1), (1, 12, 3), (1, 12, 4), (1, 12, 2),
        (1, 34, 5), (1, 34, 1), (1, 34, 3), (1, 34, 4), (1, 34, 2),
        (1, 35, 5), (1, 35, 1), (1, 35, 3), (1, 35, 4), (1, 35, 2),
        (1, 1, 5), (1, 1, 1), (1, 1, 3), (1, 1, 4), (1, 1, 2),
        (1, 2, 5), (1, 2, 1), (1, 2, 3), (1, 2, 4), (1, 2, 2),
        (1, 3, 5), (1, 3, 1), (1, 3, 3), (1, 3, 4), (1, 3, 2),
        (1, 4, 5), (1, 4, 1), (1, 4, 3), (1, 4, 4), (1, 4, 2),
        (1, 24, 5), (1, 24, 1), (1, 24, 3), (1, 24, 4), (1, 24, 2),
        (1, 25, 5), (1, 25, 1), (1, 25, 3), (1, 25, 4), (1, 25, 2),
        (1, 26, 5), (1, 26, 1), (1, 26, 3), (1, 26, 4), (1, 26, 2),
        (1, 27, 5), (1, 27, 1), (1, 27, 3), (1, 27, 4), (1, 27, 2),
        (1, 28, 5), (1, 28, 1), (1, 28, 3), (1, 28, 4), (1, 28, 2),
        (1, 29, 5), (1, 29, 1), (1, 29, 3), (1, 29, 4), (1, 29, 2),
        (1, 30, 5), (1, 30, 1), (1, 30, 3), (1, 30, 4), (1, 30, 2),
        (1, 31, 5), (1, 31, 1), (1, 31, 3), (1, 31, 4), (1, 31, 2),
        (1, 23, 5), (1, 23, 1), (1, 23, 3), (1, 23, 4), (1, 23, 2),
        (1, 14, 5), (1, 14, 1), (1, 14, 3), (1, 14, 4), (1, 14, 2),
        (1, 15, 5), (1, 15, 1), (1, 15, 3), (1, 15, 4), (1, 15, 2),
        (1, 16, 5), (1, 16, 1), (1, 16, 3), (1, 16, 4), (1, 16, 2),
        (1, 17, 5), (1, 17, 1), (1, 17, 3), (1, 17, 4), (1, 17, 2),
        (1, 18, 5), (1, 18, 1), (1, 18, 3), (1, 18, 4), (1, 18, 2),
        (1, 19, 5), (1, 19, 1), (1, 19, 3), (1, 19, 4), (1, 19, 2),
        (1, 20, 5), (1, 20, 1), (1, 20, 3), (1, 20, 4), (1, 20, 2),
        (1, 21, 5), (1, 21, 1), (1, 21, 3), (1, 21, 4), (1, 21, 2),
        (1, 22, 5), (1, 22, 1), (1, 22, 3), (1, 22, 4), (1, 22, 2)
        ON CONFLICT DO NOTHING;
      `;
    }

    isPgConnected = true;
    console.log(`\x1b[32m🟢 [CONECTADO]\x1b[0m Base de Datos: PostgreSQL | Host: ${PGHOST}:${PGPORT} | Base: ${PGDATABASE}`);

    // Sincronizar In-Memory Fallback con la data viva de PostgreSQL al inicio
    await syncInMemoryFromPg();

    // Sincronización periódica cada 5 minutos en segundo plano
    setInterval(syncInMemoryFromPg, 5 * 60 * 1000).unref();
  } catch (err) {
    isPgConnected = false;
    console.log(`\x1b[31m🔴 [DESCONECTADO]\x1b[0m Base de Datos: PostgreSQL | Host: ${PGHOST}:${PGPORT} | Modo: In-Memory`);
  }
}

// Sincroniza todas las tablas vivas de PostgreSQL en el almacén en memoria para que nunca quede desactualizado
export async function syncInMemoryFromPg() {
  if (!isPgConnected || !sql) return;
  try {
    const [
      usuarios,
      grupoSalas,
      salas,
      userSalas,
      paginas,
      modulos,
      permissions,
      userModulePermissions,
      dispositivos,
      departamentos,
      areas,
      cargos,
      empleados,
      configuracion,
      wisiItems,
      feriados,
      cortes
    ] = await Promise.all([
      sql`SELECT * FROM usuarios ORDER BY id ASC`.catch(() => inMemoryData.usuarios),
      sql`SELECT * FROM grupo_salas ORDER BY id ASC`.catch(() => inMemoryData.grupo_salas),
      sql`SELECT * FROM salas ORDER BY id ASC`.catch(() => inMemoryData.salas),
      sql`SELECT * FROM user_salas ORDER BY id ASC`.catch(() => inMemoryData.user_salas),
      sql`SELECT * FROM paginas ORDER BY id ASC`.catch(() => inMemoryData.paginas),
      sql`SELECT * FROM modulos ORDER BY orden ASC, id ASC`.catch(() => inMemoryData.modulos),
      sql`SELECT * FROM permissions ORDER BY id ASC`.catch(() => inMemoryData.permissions),
      sql`SELECT * FROM user_module_permissions ORDER BY id ASC`.catch(() => inMemoryData.user_module_permissions),
      sql`SELECT *, COALESCE(ip_panel, '') AS ip_panel, COALESCE(ip_panel, '') AS ip_panel_remoto FROM dispositivos ORDER BY id ASC`.catch(() => inMemoryData.dispositivos),
      sql`SELECT * FROM departamentos ORDER BY id ASC`.catch(() => inMemoryData.departamentos),
      sql`SELECT * FROM areas ORDER BY id ASC`.catch(() => inMemoryData.areas),
      sql`SELECT * FROM cargos ORDER BY id ASC`.catch(() => inMemoryData.cargos),
      sql`SELECT * FROM empleados ORDER BY id ASC`.catch(() => inMemoryData.empleados),
      sql`SELECT * FROM configuracion`.catch(() => inMemoryData.configuracion),
      sql`SELECT * FROM wisi_items ORDER BY id ASC`.catch(() => inMemoryData.wisi_items),
      sql`SELECT * FROM feriados ORDER BY mes ASC, dia ASC, id ASC`.catch(() => inMemoryData.feriados || []),
      sql`SELECT id, titulo, sala_id, sala_nombre, fecha_desde, fecha_hasta, total_empleados, created_at, updated_at FROM cortes ORDER BY id DESC`.catch(() => inMemoryData.cortes || [])
    ]);

    if (usuarios && usuarios.length > 0) inMemoryData.usuarios = usuarios;
    if (grupoSalas && grupoSalas.length > 0) inMemoryData.grupo_salas = grupoSalas;
    if (salas && salas.length > 0) inMemoryData.salas = salas;
    if (userSalas && userSalas.length > 0) inMemoryData.user_salas = userSalas;
    if (paginas && paginas.length > 0) inMemoryData.paginas = paginas;
    if (modulos && modulos.length > 0) inMemoryData.modulos = modulos;
    if (permissions && permissions.length > 0) inMemoryData.permissions = permissions;
    if (userModulePermissions && userModulePermissions.length > 0) inMemoryData.user_module_permissions = userModulePermissions;
    if (dispositivos && dispositivos.length > 0) inMemoryData.dispositivos = dispositivos;
    if (departamentos && departamentos.length > 0) inMemoryData.departamentos = departamentos;
    if (areas && areas.length > 0) inMemoryData.areas = areas;
    if (cargos && cargos.length > 0) inMemoryData.cargos = cargos;
    if (empleados && empleados.length > 0) inMemoryData.empleados = empleados;
    if (configuracion && configuracion.length > 0) inMemoryData.configuracion = configuracion;
    if (wisiItems && wisiItems.length > 0) inMemoryData.wisi_items = wisiItems;
    if (feriados && feriados.length > 0) inMemoryData.feriados = feriados;
    if (cortes && cortes.length > 0) inMemoryData.cortes = cortes;
  } catch (err) {
    console.warn('Aviso sincronizando In-Memory Fallback desde PostgreSQL:', err.message);
  }
}

export function getDbStatus() {
  return {
    connected: isPgConnected,
    mode: isPgConnected ? 'PostgreSQL' : 'In-Memory Fallback',
    host: `${PGHOST}:${PGPORT}`,
    database: PGDATABASE
  };
}
