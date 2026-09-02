// Configuración Centralizada y Global de API y Endpoints WISI Space

export function getCloudBaseUrl() {
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    // Si estamos en desarrollo local (localhost o 127.0.0.1)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3030';
    }
    // En producción en dominio real (ej. https://wisi.space)
    return origin;
  }
  return 'http://localhost:3030';
}

export function getWsUrl() {
  if (typeof window !== 'undefined') {
    const { hostname, protocol, host } = window.location;
    const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'ws://localhost:3030/ws/attlogs';
    }
    return `${wsProto}//${host}/ws/attlogs`;
  }
  return 'ws://localhost:3030/ws/attlogs';
}

export const CLOUD_BASE_URL = getCloudBaseUrl();

/**
 * Directorio Global de Endpoints de la Aplicación.
 * Agregar aquí cualquier nuevo endpoint que se vaya creando en el sistema.
 */
export const ENDPOINTS = {
  // Autenticación
  AUTH_LOGIN: `${CLOUD_BASE_URL}/api/auth/login`,
  AUTH_VERIFY: `${CLOUD_BASE_URL}/api/auth/verify`,

  // Panel Máster / Administración
  USUARIOS: `${CLOUD_BASE_URL}/api/master/usuarios`,
  SALAS: `${CLOUD_BASE_URL}/api/master/salas`,
  PAGINAS: `${CLOUD_BASE_URL}/api/master/paginas`,
  MODULOS: `${CLOUD_BASE_URL}/api/master/modulos`,
  DISPOSITIVOS: `${CLOUD_BASE_URL}/api/master/dispositivos`,

  // Agente y Marcajes (attlogs)
  ATTLOGS: `${CLOUD_BASE_URL}/api/attlogs`,
  ATTLOGS_SYNC: `${CLOUD_BASE_URL}/api/attlogs/sync`,
  ATTLOG_IMAGE: (id) => `${CLOUD_BASE_URL}/attlogs/${id}/image`,

  // Recursos Operativos (CECOM, RRHH, Máquinas, Mesas, Llaves)
  LIBROS: `${CLOUD_BASE_URL}/api/libros`,
  EMPLEADOS: `${CLOUD_BASE_URL}/api/empleados`,
  CARGOS: `${CLOUD_BASE_URL}/api/cargos`,
  AREAS: `${CLOUD_BASE_URL}/api/areas`,
  DEPARTAMENTOS: `${CLOUD_BASE_URL}/api/departamentos`,
  HORARIOS: `${CLOUD_BASE_URL}/api/horarios`,
  MAQUINAS: `${CLOUD_BASE_URL}/api/maquinas`,
  MESAS: `${CLOUD_BASE_URL}/api/mesas`,
  LLAVES: `${CLOUD_BASE_URL}/api/llaves`
};

// Aliases de conveniencia
export const AGENT_SYNC_ENDPOINT_URL = ENDPOINTS.ATTLOGS_SYNC;
