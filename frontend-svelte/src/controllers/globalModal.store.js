import { writable } from 'svelte/store';
import { getCloudBaseUrl } from '../config/api.config.js';

let transitionSafetyTimer = null;

function startTransitionSafetyTimer() {
  if (transitionSafetyTimer) clearTimeout(transitionSafetyTimer);
  transitionSafetyTimer = setTimeout(() => {
    photoModalStore.update(s => ({
      ...s,
      isPageTransitioning: false,
      pageTransitionDirection: null
    }));
  }, 3000);
}

function clearTransitionSafetyTimer() {
  if (transitionSafetyTimer) {
    clearTimeout(transitionSafetyTimer);
    transitionSafetyTimer = null;
  }
}

/**
 * Estado del Modal Global de Fotografías y Fichas
 */
const initialModalState = {
  isOpen: false,
  activeItem: null,
  items: [],
  currentIndex: 0,
  currentPage: 0,
  totalPages: 1,
  totalCount: 0,
  isPageTransitioning: false,
  pageTransitionDirection: null, // 'next' | 'prev'
  /**
   * modo:
   * - 'checkin_checkout': Marcajes de entrada / salida
   * - 'undefined': Marcajes con estado indefinido / otros
   * - 'marcajes_table': Marcajes provenientes de la vista MarcajesView
   * - 'empleado': Empleados activos
   * - 'desincorporado': Empleados desincorporados (muestra banner de motivo)
   */
  mode: 'checkin_checkout',
  // Callback opcional si la vista de origen soporta paginación remota al avanzar
  onPageNext: null,
  onPagePrev: null
};

export const photoModalStore = writable({ ...initialModalState });

/**
 * Abre el modal global con la configuración y lista provista
 */
export function openPhotoModal(config = {}) {
  clearTransitionSafetyTimer();
  const items = Array.isArray(config.items) ? [...config.items] : (config.item ? [config.item] : []);
  let activeItem = config.item || items[0] || null;
  let currentIndex = typeof config.currentIndex === 'number' ? config.currentIndex : 0;

  if (activeItem && items.length > 0) {
    const foundIdx = items.findIndex(x => String(x.id) === String(activeItem.id));
    if (foundIdx !== -1) {
      currentIndex = foundIdx;
      activeItem = items[foundIdx];
    }
  }

  photoModalStore.set({
    isOpen: true,
    activeItem,
    items,
    currentIndex: Math.max(0, currentIndex),
    currentPage: typeof config.currentPage === 'number' ? config.currentPage : 0,
    totalPages: typeof config.totalPages === 'number' ? Math.max(1, config.totalPages) : 1,
    totalCount: typeof config.totalCount === 'number' ? config.totalCount : items.length,
    isPageTransitioning: false,
    pageTransitionDirection: null,
    mode: config.mode || inferItemMode(activeItem),
    onPageNext: typeof config.onPageNext === 'function' ? config.onPageNext : null,
    onPagePrev: typeof config.onPagePrev === 'function' ? config.onPagePrev : null
  });
}

/**
 * Cierra el modal global sin alterar la ruta ni la vista actual
 */
export function closePhotoModal() {
  clearTransitionSafetyTimer();
  photoModalStore.update(state => ({
    ...state,
    isOpen: false,
    activeItem: null,
    isPageTransitioning: false,
    pageTransitionDirection: null
  }));
}

/**
 * Avanza al siguiente elemento del modal
 */
export function photoModalNext() {
  let callback = null;

  photoModalStore.update(state => {
    if (!state.isOpen || state.items.length === 0 || state.isPageTransitioning) return state;
    if (state.currentIndex < state.items.length - 1) {
      const nextIdx = state.currentIndex + 1;
      return {
        ...state,
        currentIndex: nextIdx,
        activeItem: state.items[nextIdx]
      };
    } else if (state.onPageNext && state.currentPage < state.totalPages - 1) {
      callback = state.onPageNext;
      startTransitionSafetyTimer();
      return {
        ...state,
        isPageTransitioning: true,
        pageTransitionDirection: 'next'
      };
    }
    return state;
  });

  if (callback) {
    try {
      callback();
    } catch (e) {
      console.warn('Error onPageNext modal:', e);
      clearTransitionSafetyTimer();
      photoModalStore.update(s => ({
        ...s,
        isPageTransitioning: false,
        pageTransitionDirection: null
      }));
    }
  }
}

/**
 * Retrocede al elemento anterior del modal
 */
export function photoModalPrev() {
  let callback = null;

  photoModalStore.update(state => {
    if (!state.isOpen || state.items.length === 0 || state.isPageTransitioning) return state;
    if (state.currentIndex > 0) {
      const prevIdx = state.currentIndex - 1;
      return {
        ...state,
        currentIndex: prevIdx,
        activeItem: state.items[prevIdx]
      };
    } else if (state.onPagePrev && state.currentPage > 0) {
      callback = state.onPagePrev;
      startTransitionSafetyTimer();
      return {
        ...state,
        isPageTransitioning: true,
        pageTransitionDirection: 'prev'
      };
    }
    return state;
  });

  if (callback) {
    try {
      callback();
    } catch (e) {
      console.warn('Error onPagePrev modal:', e);
      clearTransitionSafetyTimer();
      photoModalStore.update(s => ({
        ...s,
        isPageTransitioning: false,
        pageTransitionDirection: null
      }));
    }
  }
}

/**
 * Actualiza la lista de elementos y paginación en el modal global
 */
export function updatePhotoModalItems({ items, currentPage, totalPages, totalCount, position = 'keep' } = {}) {
  clearTransitionSafetyTimer();
  photoModalStore.update(state => {
    if (!state.isOpen) return state;
    const newItems = Array.isArray(items) ? [...items] : state.items;
    if (newItems.length === 0) {
      return {
        ...state,
        isPageTransitioning: false,
        pageTransitionDirection: null
      };
    }

    let newIndex = state.currentIndex;
    if (position === 'first') {
      newIndex = 0;
    } else if (position === 'last') {
      newIndex = Math.max(0, newItems.length - 1);
    } else {
      if (newIndex >= newItems.length) {
        newIndex = Math.max(0, newItems.length - 1);
      }
    }

    return {
      ...state,
      isPageTransitioning: false,
      pageTransitionDirection: null,
      items: newItems,
      currentIndex: newIndex,
      activeItem: newItems[newIndex] || state.activeItem,
      currentPage: typeof currentPage === 'number' ? currentPage : state.currentPage,
      totalPages: typeof totalPages === 'number' ? totalPages : state.totalPages,
      totalCount: typeof totalCount === 'number' ? totalCount : state.totalCount
    };
  });
}

/**
 * Infiere el tipo de ficha si no se especificó
 */
function inferItemMode(item) {
  if (!item) return 'checkin_checkout';
  if (item.activo === false || item.motivo_desincorporacion) return 'desincorporado';
  if (item.event_time !== undefined || item.attendancestatus !== undefined) {
    const st = String(item.attendancestatus || '').toLowerCase().trim();
    if (st === 'undefined' || st === 'otros') return 'undefined';
    return 'checkin_checkout';
  }
  return 'empleado';
}

/**
 * Procesa la inserción en tiempo real de un nuevo marcaje sobre el modal si está abierto
 */
export function handleRealtimeAttlogInPhotoModal(newRecord) {
  if (!newRecord) return;

  photoModalStore.update((s) => {
    if (!s.isOpen) return s;

    // 1. Si el modal está en modo 'ultimo_registro', se actualiza en vivo al nuevo marcaje (plácata, plácata)
    if (s.mode === "ultimo_registro") {
      return {
        ...s,
        items: [newRecord],
        activeItem: newRecord,
        currentIndex: 0,
        currentPage: 0,
        totalPages: 1,
        totalCount: 1,
      };
    }

    // 2. En cualquier otro modo ('alerta', 'marcajes_table', 'empleado', 'desincorporado'),
    // no se altera la visualización actual del usuario para que su navegación en el modal
    // o su ficha de alerta se mantenga 100% estable y sin saltos accidentales.
    if (s.mode === "marcajes_table") {
      const pageSize = 10;
      const newTotalCount = (s.totalCount || 0) + 1;
      const newTotalPages = Math.ceil(newTotalCount / pageSize) || 1;
      return {
        ...s,
        totalCount: newTotalCount,
        totalPages: newTotalPages,
      };
    }

    return s;
  });
}

/**
 * Abre el modal global apuntando a un marcaje específico mediante su ID (ej. al hacer click en notificación).
 * Sincroniza los datos completos del empleado en modo 'alerta' (1 de 1 fijo).
 */
export async function openPhotoModalForAttlog(attlogId, initialRecord = null) {
  if (!attlogId && !initialRecord) return;

  const validId = attlogId || initialRecord?.id;

  // 1. Apertura instantánea con datos locales o provisionales si existen (0ms lag)
  if (initialRecord) {
    openPhotoModal({
      item: initialRecord,
      items: [initialRecord],
      currentIndex: 0,
      currentPage: 0,
      totalPages: 1,
      totalCount: 1,
      mode: 'alerta'
    });
  }

  // 2. Consultar al backend los datos enriquecidos para sincronización exacta
  try {
    const cloudBase = getCloudBaseUrl();
    const res = await fetch(`${cloudBase}/api/attlogs/${validId}/detail`);
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        const rec = json.data;
        openPhotoModal({
          item: rec,
          items: [rec],
          currentIndex: 0,
          currentPage: 0,
          totalPages: 1,
          totalCount: 1,
          mode: 'alerta'
        });
      }
    }
  } catch (err) {
    console.warn('[GlobalModal] Error abriendo ficha desde attlog_id:', err);
  }
}

