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
  }, 9000);
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
  photoModalStore.update(state => {
    if (!state.isOpen || state.items.length === 0 || state.isPageTransitioning) return state;
    if (state.currentIndex < state.items.length - 1) {
      const nextIdx = state.currentIndex + 1;
      return {
        ...state,
        currentIndex: nextIdx,
        activeItem: state.items[nextIdx]
      };
    } else if (state.onPageNext) {
      startTransitionSafetyTimer();
      try {
        state.onPageNext();
      } catch (e) {
        console.warn('Error onPageNext modal:', e);
      }
      return {
        ...state,
        isPageTransitioning: true,
        pageTransitionDirection: 'next'
      };
    }
    return state;
  });
}

/**
 * Retrocede al elemento anterior del modal
 */
export function photoModalPrev() {
  photoModalStore.update(state => {
    if (!state.isOpen || state.items.length === 0 || state.isPageTransitioning) return state;
    if (state.currentIndex > 0) {
      const prevIdx = state.currentIndex - 1;
      return {
        ...state,
        currentIndex: prevIdx,
        activeItem: state.items[prevIdx]
      };
    } else if (state.onPagePrev) {
      startTransitionSafetyTimer();
      try {
        state.onPagePrev();
      } catch (e) {
        console.warn('Error onPagePrev modal:', e);
      }
      return {
        ...state,
        isPageTransitioning: true,
        pageTransitionDirection: 'prev'
      };
    }
    return state;
  });
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
  const st = String(newRecord.attendancestatus || "").toLowerCase().trim();
  const isCheckInOut = st === "checkin" || st === "checkout";
  const isUndefined = st === "undefined" || st === "otros";

  photoModalStore.update((s) => {
    if (!s.isOpen) return s;

    // 1. Si el modal está en flujo checkin_checkout y llega un undefined/otro -> NO HACER NADA
    if (s.mode === "checkin_checkout" && !isCheckInOut) {
      return s;
    }

    // 2. Si el modal está en flujo undefined y llega un checkin/checkout -> NO HACER NADA
    if (s.mode === "undefined" && !isUndefined) {
      return s;
    }

    // 3. Si el modal es de empleados o desincorporados -> NO HACER NADA
    if (s.mode !== "checkin_checkout" && s.mode !== "undefined" && s.mode !== "marcajes_table") {
      return s;
    }

    const pageSize = 10;
    const newTotalCount = (s.totalCount || 0) + 1;
    const newTotalPages = Math.ceil(newTotalCount / pageSize) || 1;

    // Caso 1: El usuario está en la posición 1 (Página 1, índice 0)
    // -> Pasa a ver de inmediato el nuevo registro que acaba de llegar
    if (s.currentPage === 0 && s.currentIndex === 0) {
      const updatedItems = [
        newRecord,
        ...s.items.filter((a) => String(a.id) !== String(newRecord.id)),
      ].slice(0, pageSize);

      return {
        ...s,
        items: updatedItems,
        activeItem: newRecord,
        currentIndex: 0,
        totalCount: newTotalCount,
        totalPages: newTotalPages,
      };
    }

    // Caso 2: El usuario está en otra posición (ej. índice 3) o en otra página
    // -> Mantiene en pantalla EXACTAMENTE al mismo empleado/registro activo
    const currentViewingId = s.activeItem?.id;

    if (s.currentPage === 0) {
      const extendedList = [
        newRecord,
        ...s.items.filter((a) => String(a.id) !== String(newRecord.id)),
      ];
      const newIdx = extendedList.findIndex(
        (a) => String(a.id) === String(currentViewingId)
      );

      if (newIdx !== -1 && newIdx < pageSize) {
        return {
          ...s,
          items: extendedList.slice(0, pageSize),
          currentIndex: newIdx,
          totalCount: newTotalCount,
          totalPages: newTotalPages,
        };
      } else if (newIdx >= pageSize) {
        // Empujado a la página 2
        return {
          ...s,
          currentPage: 1,
          items: extendedList.slice(pageSize, pageSize * 2),
          currentIndex: 0,
          totalCount: newTotalCount,
          totalPages: newTotalPages,
        };
      }
    }

    // Si está en páginas >= 1, solo incrementa el totalCount
    return {
      ...s,
      totalCount: newTotalCount,
      totalPages: newTotalPages,
    };
  });
}

/**
 * Abre el modal global apuntando a un marcaje específico mediante su ID (ej. al hacer click en notificación).
 * Sincroniza los datos completos del empleado y la posición real en el paginador.
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
      totalCount: 1,
      mode: 'checkin_checkout'
    });
  }

  // 2. Consultar al backend los datos enriquecidos y la posición para sincronización exacta
  try {
    const cloudBase = getCloudBaseUrl();
    const res = await fetch(`${cloudBase}/api/attlogs/${validId}/detail`);
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        const rec = json.data;
        const pos = json.position;
        const globalIndex = pos ? pos.globalIndex : 0;
        const pageSize = 10;
        const page = Math.floor(globalIndex / pageSize);

        openPhotoModal({
          item: rec,
          items: [rec],
          currentIndex: 0,
          currentPage: page,
          totalPages: pos ? Math.ceil(pos.position / pageSize) : 1,
          totalCount: pos ? pos.position : 1,
          mode: 'checkin_checkout'
        });
      }
    }
  } catch (err) {
    console.warn('[GlobalModal] Error abriendo ficha desde attlog_id:', err);
  }
}

