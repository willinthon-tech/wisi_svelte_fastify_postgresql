import { writable } from 'svelte/store';
import { toBackendUrl } from '../config/api.config.js';

export const pendingSyncCountStore = writable(0);
export const isLocalDbReadyStore = writable(false);

const DB_NAME = 'wisi_local_db_v1';
const DB_VERSION = 2;

export const LOCAL_STORES = [
  'clientes',
  'empleados',
  'salas',
  'departamentos',
  'areas',
  'cargos',
  'horarios',
  'maquinas',
  'mesas',
  'llaves',
  'estados',
  'sociedades',
  'valores',
  'juegos',
  'juegos_maquinas',
  'marcas',
  'modelos',
  'tipos',
  'modos',
  'legal',
  'rangos',
  'metodos_pago',
  'tipo_clientes',
  'tipo_incidencias',
  'dispositivos',
  'usuarios',
  'libros',
  'libro_control_clientes',
  'libro_aportes',
  'libro_control_llaves',
  'libro_incidencias_generales',
  'libro_novedades_mesas',
  'libro_datos',
  'libro_drop_mesas',
  'libro_reporte',
  'attlogs',
  'outbox_sync_queue'
];

let dbInstance = null;
let isInitializing = false;

/**
 * Inicializa la Base de Datos Local IndexedDB (Local-First)
 * Compatible con navegadores modernos, PWAs, Tauri (Windows) y Capacitor (Android).
 */
export async function initLocalDb() {
  if (dbInstance) return dbInstance;
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    console.warn('[LocalDb] IndexedDB no soportado en este entorno.');
    return null;
  }

  if (isInitializing) {
    // Esperar a que la instancia previa termine
    while (isInitializing) {
      await new Promise(r => setTimeout(r, 50));
    }
    return dbInstance;
  }

  isInitializing = true;

  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        for (const storeName of LOCAL_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: '_local_key' });
            store.createIndex('id', 'id', { unique: false });
            store.createIndex('uuid', 'uuid', { unique: false });
            store.createIndex('updated_at', 'updated_at', { unique: false });
            if (storeName === 'outbox_sync_queue') {
              store.createIndex('status', 'status', { unique: false });
              store.createIndex('created_at', 'created_at', { unique: false });
            }
          }
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        isInitializing = false;
        isLocalDbReadyStore.set(true);
        refreshPendingSyncCount().catch(() => {});
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        isInitializing = false;
        console.error('[LocalDb] Error abriendo IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    } catch (err) {
      isInitializing = false;
      console.error('[LocalDb] Excepción inicializando IndexedDB:', err);
      reject(err);
    }
  });
}

function getItemKey(item) {
  if (!item) return crypto.randomUUID();
  if (item._local_key) return String(item._local_key);
  if (item.uuid) return String(item.uuid);
  if (item.id !== undefined && item.id !== null) return `id_${item.id}`;
  return crypto.randomUUID();
}

/**
 * Guarda o actualiza masivamente un conjunto de registros en una tabla local.
 */
export async function saveLocalItems(storeName, items = []) {
  const db = await initLocalDb();
  if (!db || !Array.isArray(items) || items.length === 0) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);

      for (const item of items) {
        if (!item) continue;
        const key = getItemKey(item);
        const record = {
          ...item,
          _local_key: key,
          _last_local_update: new Date().toISOString()
        };
        store.put(record);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obtiene todos los registros locales de una tabla.
 */
export async function getLocalItems(storeName, filterFn = null) {
  const db = await initLocalDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        let results = request.result || [];
        if (typeof filterFn === 'function') {
          results = results.filter(filterFn);
        }
        resolve(results);
      };

      request.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Guarda o actualiza un registro individual localmente.
 */
export async function upsertLocalItem(storeName, item) {
  const db = await initLocalDb();
  if (!db || !item) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const key = getItemKey(item);
      const record = {
        ...item,
        _local_key: key,
        _last_local_update: new Date().toISOString()
      };
      store.put(record);

      tx.oncomplete = () => resolve(record);
      tx.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Elimina un registro localmente.
 */
export async function deleteLocalItem(storeName, idOrUuid) {
  const db = await initLocalDb();
  if (!db || idOrUuid === undefined || idOrUuid === null) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      
      // Intentar clave directa, o buscar por id / uuid
      const directKey = String(idOrUuid).startsWith('id_') ? String(idOrUuid) : (typeof idOrUuid === 'number' ? `id_${idOrUuid}` : String(idOrUuid));
      store.delete(directKey);

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Encola una operación en la Cola de Sincronización de Salida (Outbox Queue).
 * Se ejecuta de inmediato en local y queda pendiente de subida a la nube.
 */
export async function queueOutboxAction({
  entity,
  action, // 'create' | 'update' | 'delete'
  endpoint,
  method = 'POST',
  payload = null,
  targetId = null,
  uuid = null
}) {
  const db = await initLocalDb();
  if (!db) return;

  const itemUuid = uuid || payload?.uuid || crypto.randomUUID();
  const queueItem = {
    _local_key: itemUuid,
    uuid: itemUuid,
    entity,
    action,
    endpoint,
    method,
    payload: payload ? { ...payload, uuid: itemUuid } : null,
    target_id: targetId,
    status: 'pending',
    retries: 0,
    created_at: new Date().toISOString()
  };

  await upsertLocalItem('outbox_sync_queue', queueItem);
  await refreshPendingSyncCount();

  // Si hay conexión, intentar procesar de inmediato en segundo plano
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    processOutboxQueue().catch(() => {});
  }

  return queueItem;
}

/**
 * Refresca el conteo de elementos pendientes en la cola.
 */
export async function refreshPendingSyncCount() {
  try {
    const pending = await getLocalItems('outbox_sync_queue', item => item.status === 'pending');
    pendingSyncCountStore.set(pending.length);
    return pending.length;
  } catch (e) {
    return 0;
  }
}

let isProcessingQueue = false;

/**
 * Procesa la cola de sincronización de salida cuando hay conexión a internet.
 * Envía las operaciones pendientes al backend y las marca como sincronizadas.
 */
export async function processOutboxQueue() {
  if (isProcessingQueue) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  isProcessingQueue = true;

  try {
    const pendingItems = await getLocalItems('outbox_sync_queue', item => item.status === 'pending');
    if (pendingItems.length === 0) {
      pendingSyncCountStore.set(0);
      return;
    }

    // Ordenar cronológicamente (FIFO)
    pendingItems.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const item of pendingItems) {
      try {
        const url = toBackendUrl(item.endpoint);
        const options = {
          method: item.method || 'POST',
          headers: { 'Content-Type': 'application/json' }
        };

        if (item.payload && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
          options.body = JSON.stringify(item.payload);
        }

        const res = await fetch(url, options);
        if (res.ok) {
          // Marcar como sincronizado y eliminar de la cola
          await deleteLocalItem('outbox_sync_queue', item._local_key);
        } else {
          // Incrementar reintentos si falló en el servidor
          item.retries = (item.retries || 0) + 1;
          if (item.retries > 5) {
            item.status = 'failed';
          }
          await upsertLocalItem('outbox_sync_queue', item);
        }
      } catch (err) {
        // Error de red momentáneo, detener procesamiento hasta nueva reconexión
        console.warn(`[OutboxSync] Pausando sincronización por fallo de red:`, err);
        break;
      }
    }

    await refreshPendingSyncCount();
  } catch (err) {
    console.error('[OutboxSync] Error procesando cola de salida:', err);
  } finally {
    isProcessingQueue = false;
  }
}

// Escuchar eventos de reconexión para vaciar la cola automáticamente
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[LocalDb] Conexión reestablecida. Procesando cola de salida a la nube...');
    processOutboxQueue().catch(() => {});
  });
}
