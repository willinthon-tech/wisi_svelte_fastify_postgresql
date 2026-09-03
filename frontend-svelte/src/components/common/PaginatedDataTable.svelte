<script>
  function toTitleCase(str) {
    if (!str || typeof str !== 'string') return str;
    return str
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '')
      .join(' ');
  }

  function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    const str = String(dateStr).trim();
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDateDDMMYYYY(dateStr) {
    if (!dateStr) return '—';
    const d = parseLocalDate(dateStr);
    if (!d || isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function calculateEdad(dateStr) {
    if (!dateStr) return '';
    const birth = parseLocalDate(dateStr);
    if (!birth || isNaN(birth.getTime())) return '';
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
      years--;
    }
    return `${years} ${years === 1 ? 'año' : 'años'}`;
  }

  function calculateAntiguedad(dateStr) {
    if (!dateStr) return '';
    const start = parseLocalDate(dateStr);
    if (!start || isNaN(start.getTime())) return '';
    const now = new Date();
    if (start > now) return '0 días';

    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();
    let days = now.getDate() - start.getDate();

    if (days < 0) {
      months--;
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years--;
      months += 12;
    }

    if (years >= 1) {
      return `${years} ${years === 1 ? 'año' : 'años'}${months > 0 ? `, ${months}m` : ''}`;
    }
    if (months >= 1) {
      return `${months} ${months === 1 ? 'mes' : 'meses'}${days > 0 ? `, ${days}d` : ''}`;
    }
    return `${days} ${days === 1 ? 'día' : 'días'}`;
  }


  import { createEventDispatcher } from 'svelte';
  import html2canvas from 'html2canvas';
  import { triggerToast, globalCreateModalTriggerStore } from '../../controllers/ui.store.js';
  import { masterCargosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { 
    photoModalStore, 
    openPhotoModal as triggerGlobalPhotoModal, 
    updatePhotoModalItems 
  } from "../../controllers/globalModal.store.js";
  import DeleteModal from '../modals/DeleteModal.svelte';
  import BlockedDeleteModal from '../modals/BlockedDeleteModal.svelte';
  import BatchDeleteConfirmModal from '../modals/BatchDeleteConfirmModal.svelte';
  import BatchDeleteReportModal from '../modals/BatchDeleteReportModal.svelte';

  export let items = [];
  export let totalCount = 0;
  export let currentPage = 1;
  export let pageSize = 10;
  export let columns = [];
  export let searchPlaceholder = 'Buscar registros...';
  export let entityType = 'registro';
  export let actions = { edit: true, delete: true, reincorporate: false, desincorporate: false };
  export let showCheckbox = true;
  export let isServerSide = false;
  export let createFields = [];
  export let existingItems = [];
  export let cargosOptions = [];
  export let reservedCodes = []; // Array of codes that cannot be used (e.g., ['L', 'U'])
  export let createModalTitle = ''; // Optional custom modal title override
  export let customCreateModal = false; // When true, parent handles create modal via on:openModal
    let allMasterCargos = [];
  $: allMasterCargos = $masterCargosStore || [];
  $: activeCargosList = (cargosOptions && cargosOptions.length > 0) ? cargosOptions : allMasterCargos;
  $: hasRowActions = actions && (actions.edit !== false || actions.delete !== false || actions.reincorporate || actions.desincorporate);

  // Reincorporar Modal State
  let isReincorporarModalOpen = false;
  let itemToReincorporar = null;
  let reincorporarFecha = new Date().toISOString().split('T')[0];
  let reincorporarCargoId = '';

  async function promptReincorporar(item) {
    itemToReincorporar = item;
    reincorporarFecha = new Date().toISOString().split('T')[0];
    reincorporarCargoId = item.cargo_id || '';
    isReincorporarModalOpen = true;
    try {
      await loadMasterStoresFromBackend();
    } catch (e) {
      console.warn('Error refreshing PostgreSQL master stores:', e);
    }
  }

  function closeReincorporarModal() {
    isReincorporarModalOpen = false;
    itemToReincorporar = null;
    reincorporarCargoId = '';
  }

  function submitReincorporarModal() {
    if (!reincorporarCargoId) {
      triggerToast('Debe seleccionar el nuevo cargo para la reincorporación', 'warning');
      return;
    }
    if (!reincorporarFecha) {
      triggerToast('Debe seleccionar la fecha de ingreso para la reincorporación', 'warning');
      return;
    }
    dispatch('reincorporate', {
      id: itemToReincorporar.id,
      cargo_id: Number(reincorporarCargoId),
      fecha_ingreso: reincorporarFecha,
      item: itemToReincorporar
    });
    isReincorporarModalOpen = false;
    itemToReincorporar = null;
    reincorporarCargoId = '';
  }

  // Create Modal State
  let isCreateModalOpen = false;
  let createDraft = {};

  function getInlineSelectOptions(col, item) {
    const rawOptions = col.options || [];
    if (!item) return rawOptions;

    // Priority 1: Filter by departamento_id / departamento_nombre if row has departamento context (e.g. Cargos editing Area)
    const targetDeptId = item.departamento_id ? Number(item.departamento_id) : null;
    const targetDeptNombre = item.departamento_nombre ? String(item.departamento_nombre).trim().toLowerCase() : null;

    if (targetDeptId || targetDeptNombre) {
      const filteredDept = rawOptions.filter(opt => {
        if (!opt) return false;
        if (targetDeptId && opt.departamento_id) {
          return Number(opt.departamento_id) === targetDeptId;
        }
        if (targetDeptNombre && opt.departamento_nombre) {
          return String(opt.departamento_nombre).trim().toLowerCase() === targetDeptNombre;
        }
        return false;
      });
      if (filteredDept.length > 0) return filteredDept;
    }

    // Priority 2: Filter by sala_id / sala_nombre if row has sala context (e.g. Areas editing Departamento)
    const targetSalaId = item.sala_id ? Number(item.sala_id) : null;
    const targetSalaNombre = item.sala_nombre ? String(item.sala_nombre).trim().toLowerCase() : null;

    if (targetSalaId || targetSalaNombre) {
      const filteredSala = rawOptions.filter(opt => {
        if (!opt) return false;
        if (targetSalaId && opt.sala_id) {
          return Number(opt.sala_id) === targetSalaId;
        }
        if (targetSalaNombre && opt.sala_nombre) {
          return String(opt.sala_nombre).trim().toLowerCase() === targetSalaNombre;
        }
        return false;
      });
      if (filteredSala.length > 0) return filteredSala;
    }

    return rawOptions;
  }


  function getGroupedOptions(optionsList) {
    if (!optionsList || !Array.isArray(optionsList) || optionsList.length === 0) return [];
    
    // Sort items hierarchically & alphabetically (1. Sala A-Z, 2. Departamento A-Z, 3. Área A-Z, 4. Cargo/Nombre A-Z)
    const sortedOptions = [...optionsList].sort((a, b) => {
      if (!a || !b) return 0;

      // 1. Sala (A-Z)
      const sA = (a.sala_nombre || '').toString().trim().toLowerCase();
      const sB = (b.sala_nombre || '').toString().trim().toLowerCase();
      if (sA !== sB) return sA.localeCompare(sB, 'es', { sensitivity: 'base' });

      // 2. Departamento (A-Z)
      const dA = (a.departamento_nombre || '').toString().trim().toLowerCase();
      const dB = (b.departamento_nombre || '').toString().trim().toLowerCase();
      if (dA !== dB) return dA.localeCompare(dB, 'es', { sensitivity: 'base' });

      // 3. Área (A-Z)
      const aA = (a.area_nombre || '').toString().trim().toLowerCase();
      const aB = (b.area_nombre || '').toString().trim().toLowerCase();
      if (aA !== aB) return aA.localeCompare(aB, 'es', { sensitivity: 'base' });

      // 4. Cargo / Nombre (A-Z)
      const nA = (a.nombre || a.nombre_comercial || a.name || '').toString().trim().toLowerCase();
      const nB = (b.nombre || b.nombre_comercial || b.name || '').toString().trim().toLowerCase();
      return nA.localeCompare(nB, 'es', { sensitivity: 'base' });
    });

    const hasTriple = sortedOptions.some(o => o && o.sala_nombre && o.departamento_nombre && o.area_nombre);
    const hasBoth = sortedOptions.some(o => o && o.sala_nombre && o.departamento_nombre);
    const hasSalaGroup = sortedOptions.some(o => o && o.sala_nombre);
    const hasCustomGroup = sortedOptions.some(o => o && o.group);

    if (!hasTriple && !hasBoth && !hasSalaGroup && !hasCustomGroup) {
      return [{ label: null, items: sortedOptions }];
    }

    const groupsMap = new Map();

    for (const item of sortedOptions) {
      if (!item) continue;
      let gName = '';

      if (hasTriple) {
        const sName = item.sala_nombre ? String(item.sala_nombre).trim() : 'Sin Sala';
        const dName = item.departamento_nombre ? String(item.departamento_nombre).trim() : 'Sin Depto';
        const aName = item.area_nombre ? String(item.area_nombre).trim() : 'Sin Área';
        gName = `📍 ${sName} — 🏢 ${dName} — 📐 ${aName}`;
      } else if (hasBoth) {
        const sName = item.sala_nombre ? String(item.sala_nombre).trim() : 'Sin Sala';
        const dName = item.departamento_nombre ? String(item.departamento_nombre).trim() : 'Sin Depto';
        gName = `📍 ${sName} — 🏢 ${dName}`;
      } else if (hasSalaGroup) {
        gName = item.sala_nombre ? `📍 ${String(item.sala_nombre).trim()}` : 'Sin Sala Asignada';
      } else {
        gName = item.group ? String(item.group).trim() : 'General';
      }

      if (!groupsMap.has(gName)) {
        groupsMap.set(gName, []);
      }
      groupsMap.get(gName).push(item);
    }

    const result = [];
    for (const [label, items] of groupsMap.entries()) {
      result.push({ label, items });
    }
    return result;
  }


  // Reactive validation for creation modal duplicate name check
  $: duplicateNameError = (function() {
    if (!createDraft || !createDraft.nombre) return '';
    const clean = createDraft.nombre.trim().toLowerCase();
    if (!clean) return '';
    const nameList = (existingItems && existingItems.length > 0 ? existingItems : items) || [];
    const isDup = nameList.some(item => (item.nombre || '').trim().toLowerCase() === clean);
    return isDup ? 'Este nombre ya se encuentra registrado y en uso.' : '';
  })();

  // Reactive validation for reserved codes in create modal
  $: reservedCodeCreateError = (function() {
    if (!createDraft || !createDraft.codigo || !reservedCodes || reservedCodes.length === 0) return '';
    const code = String(createDraft.codigo).trim().toUpperCase();
    if (!code) return '';
    const isReserved = reservedCodes.some(r => String(r).toUpperCase() === code);
    return isReserved ? `El código "${code}" está reservado como plantilla base del sistema y no puede usarse.` : '';
  })();

  // Reactive validation for inline editing duplicate name check
  $: inlineDuplicateError = (function() {
    if (!inlineDraft || !editingInlineId) return '';
    // Check reserved code
    if (reservedCodes && reservedCodes.length > 0 && inlineDraft.codigo) {
      const code = String(inlineDraft.codigo).trim().toUpperCase();
      const isReserved = reservedCodes.some(r => String(r).toUpperCase() === code);
      if (isReserved) return `El código "${code}" está reservado como plantilla base y no puede usarse.`;
    }
    // Check duplicate name
    if (!inlineDraft.nombre) return '';
    const clean = inlineDraft.nombre.trim().toLowerCase();
    if (!clean) return '';
    const nameList = (existingItems && existingItems.length > 0 ? existingItems : items) || [];
    const isDup = nameList.some(item => Number(item.id) !== Number(editingInlineId) && (item.nombre || '').trim().toLowerCase() === clean);
    return isDup ? 'Este nombre ya se encuentra registrado y en uso.' : '';
  })();

  // Subscribe to top-right "Nuevo Registro" button trigger (only opens on explicit click, NOT on view mount)
  let unsubscribeCreateTrigger;
  let lastTriggerVal = null;
  import { onDestroy } from 'svelte';
  unsubscribeCreateTrigger = globalCreateModalTriggerStore.subscribe((val) => {
    if (lastTriggerVal === null) {
      lastTriggerVal = val;
      return;
    }
    if (val > lastTriggerVal) {
      lastTriggerVal = val;
      dispatch('openModal');
      if (!customCreateModal && createFields && createFields.length > 0) {
        openCreateModal();
      }
    }
  });
  onDestroy(() => {
    if (unsubscribeCreateTrigger) unsubscribeCreateTrigger();
  });


  function openCreateModal() {
    createDraft = {};
    isCreateModalOpen = true;
  }

  function closeCreateModal() {
    isCreateModalOpen = false;
    createDraft = {};
  }

  function submitCreateModal() {
    if (duplicateNameError) {
      triggerToast(duplicateNameError, 'error');
      return;
    }
    if (reservedCodeCreateError) {
      triggerToast(reservedCodeCreateError, 'error');
      return;
    }
    dispatch('create', createDraft);
    isCreateModalOpen = false;
    createDraft = {};
  }

  const dispatch = createEventDispatcher();

  // Search & Sorting State
  export let searchQuery = '';
  export let sortBy = 'id';
  export let sortDir = 'desc';

  // Batch Selection State
  let selectedIds = new Set();

  // Inline Editing State
  let editingInlineId = null;
  let inlineDraft = {};

  // Desincorporar Modal State
  let isDesincorporarModalOpen = false;
  let itemToDesincorporar = null;
  let motivoDesincorporacion = '';

  // Delete Modal States
  let isDeleteModalOpen = false;
  let isBlockedModalOpen = false;
  let itemToDelete = null;
  let blockedData = null;

  // Batch Delete Modals State
  let isBatchConfirmOpen = false;
  let isBatchDeleting = false;
  let isBatchReportOpen = false;
  let batchReportData = null;

  // Universal Client-Side Search Filtering
  $: filteredItems = (function() {
    if (isServerSide || !items || !Array.isArray(items)) return items || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;

    return items.filter(item => {
      if (!item) return false;
      return Object.entries(item).some(([key, val]) => {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object') return false;
        return String(val).toLowerCase().includes(q);
      });
    });
  })();

  // Universal Client-Side Sorting
  $: sortedItems = (function() {
    if (isServerSide || !filteredItems || !Array.isArray(filteredItems)) return filteredItems || [];
    if (!sortBy) return filteredItems;

    const list = [...filteredItems];
    list.sort((a, b) => {
      // Especial para calendario: orden cronológico por mes y día
      if (sortBy === 'mes' || sortBy === 'mes_nombre') {
        const mA = Number(a.mes || 0);
        const mB = Number(b.mes || 0);
        if (mA !== mB) {
          return sortDir === 'asc' ? mA - mB : mB - mA;
        }
        const dA = Number(a.dia || 0);
        const dB = Number(b.dia || 0);
        return sortDir === 'asc' ? dA - dB : dB - dA;
      }

      if (sortBy === 'dia') {
        const dA = Number(a.dia || 0);
        const dB = Number(b.dia || 0);
        if (dA !== dB) {
          return sortDir === 'asc' ? dA - dB : dB - dA;
        }
        const mA = Number(a.mes || 0);
        const mB = Number(b.mes || 0);
        return sortDir === 'asc' ? mA - mB : mB - mA;
      }

      let valA = a[sortBy];
      let valB = b[sortBy];
      if (valA === null || valA === undefined) valA = '';
      if (valB === null || valB === undefined) valB = '';

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortDir === 'asc' ? valA - valB : valB - valA;
      }

      const strA = String(valA).trim();
      const strB = String(valB).trim();
      const cmp = strA.localeCompare(strB, 'es', { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  })();

  // Server-Side vs Client-Side Data Count & Slicing
  $: numCurrentPage = Number(currentPage) || 1;
  $: numPageSize = Number(pageSize) || 10;
  $: displayTotalCount = isServerSide ? Number(totalCount || 0) : sortedItems.length;
  $: totalPages = Math.max(1, Math.ceil(displayTotalCount / numPageSize) || 1);

  $: paginatedItems = isServerSide 
    ? items 
    : sortedItems.slice((numCurrentPage - 1) * numPageSize, numCurrentPage * numPageSize);

  $: startRecord = displayTotalCount === 0 ? 0 : (numCurrentPage - 1) * numPageSize + 1;
  $: endRecord = Math.min(numCurrentPage * numPageSize, displayTotalCount);

  $: totalFilters = searchQuery.trim() ? 1 : 0;
  $: activeFilterName = searchQuery.trim() ? `"${searchQuery.trim()}"` : 'Ninguno';

  function notifyServerFetch(actionType = 'page') {
    const pageNum = Number(currentPage) || 1;
    const sizeNum = Number(pageSize) || 10;
    if (isServerSide) {
      dispatch('fetchServerData', {
        page: pageNum,
        limit: sizeNum,
        search: searchQuery,
        sortBy,
        sortDir
      });
    }

    if (actionType === 'page') {
      dispatch('pageChange', { page: pageNum, pageSize: sizeNum });
    } else if (actionType === 'size') {
      dispatch('pageSizeChange', { page: pageNum, pageSize: sizeNum });
    } else if (actionType === 'sort') {
      dispatch('sort', { sortBy, sortOrder: sortDir });
    } else if (actionType === 'search') {
      dispatch('search', { query: searchQuery });
    }
  }

  let searchTimeout = null;
  function handleSearchInput() {
    currentPage = 1;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      notifyServerFetch('search');
    }, 250);
  }

  function handlePageSizeChange(e) {
    if (e && e.target) {
      pageSize = Number(e.target.value) || 10;
    }
    currentPage = 1;
    selectedIds = new Set();
    notifyServerFetch('size');
  }

  function changePage(newPage) {
    const targetPage = Number(newPage);
    if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
      currentPage = targetPage;
      selectedIds = new Set();
      notifyServerFetch('page');
    }
  }

  function toggleSort(colKey) {
    if (sortBy === colKey) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = colKey;
      sortDir = 'asc';
    }
    currentPage = 1;
    notifyServerFetch('sort');
  }

  function getPhotoUrl(item) {
    if (!item) return '';
    if (item.foto && typeof item.foto === 'string' && item.foto.trim().length > 0) {
      const clean = item.foto.trim();
      if (clean.startsWith('http')) return clean;
      return clean.startsWith('/') ? clean : `/${clean}`;
    }
    const empId = item.empleado_id || item.id;
    if (empId) {
      return `/empleados/${empId}.jpg`;
    }
    return '';
  }

  // Precarga en segundo plano de las fotos visibles en la página actual para respuesta instantánea (0ms)
  $: if (paginatedItems && paginatedItems.length > 0 && typeof window !== 'undefined') {
    paginatedItems.forEach(item => {
      const url = getPhotoUrl(item);
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }

  function getInitials(name, cedula) {
    if (name && typeof name === 'string' && name.trim().length > 0) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].substring(0, 2).toUpperCase();
    }
    if (cedula) return String(cedula).substring(0, 2).toUpperCase();
    return 'EM';
  }

  function formatDate(val) {
    if (!val || val === '—') return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val).split('T')[0];
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return String(val).split('T')[0];
    }
  }

  async function downloadPhoto(item) {
    if (!item) return;
    try {
      const url = getPhotoUrl(item);
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const cedula = (item.cedula || item.employee_no || item.id || 'empleado').toString().replace(/^#/, '').trim();
      const name = (toTitleCase(item.nombre) || 'foto').toString().replace(/[\s:]+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
      const fileName = `${cedula}_${name}.jpg`;

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('Error downloading photo:', e);
    }
  }

  // Batch Selection Methods
  $: allSelected = paginatedItems.length > 0 && paginatedItems.filter(i => !(i.disabled || i.disableDelete || i.is_system)).length > 0 && paginatedItems.filter(i => !(i.disabled || i.disableDelete || i.is_system)).every(i => selectedIds.has(i.id));

  function toggleSelectAll() {
    const selectable = paginatedItems.filter(i => !(i.disabled || i.disableDelete || i.is_system));
    if (selectable.length === 0) return;
    const isAll = selectable.every(i => selectedIds.has(i.id));
    if (isAll) {
      selectable.forEach(i => selectedIds.delete(i.id));
    } else {
      selectable.forEach(i => selectedIds.add(i.id));
    }
    selectedIds = new Set(selectedIds);
  }

  function toggleSelectOne(id) {
    const item = paginatedItems.find(i => i.id === id);
    if (item && (item.disabled || item.disableDelete || item.is_system)) return;
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    selectedIds = new Set(selectedIds);
  }

  function handleBatchDesincorporate() {
    const ids = Array.from(selectedIds);
    dispatch('batchDesincorporate', ids);
    selectedIds = new Set();
  }

  function handleBatchReincorporate() {
    const ids = Array.from(selectedIds);
    dispatch('batchReincorporate', ids);
    selectedIds = new Set();
  }

  function handleBatchDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      const item = items.find(i => i.id === ids[0]);
      promptDelete(item || { id: ids[0] });
    } else {
      isBatchConfirmOpen = true;
    }
  }

  function confirmBatchDelete() {
    const ids = Array.from(selectedIds);
    isBatchDeleting = true;

    dispatch('batchDelete', {
      ids,
      items: ids.map(id => items.find(i => i.id === id) || { id }),
      onResult: (res) => {
        isBatchDeleting = false;
        isBatchConfirmOpen = false;
        selectedIds = new Set();
        handleBatchReport(res);
      }
    });
  }

  function handleBatchReport(res) {
    if (!res) return;
    if (res.blocked && !Array.isArray(res.blocked)) {
      blockedData = res;
      isBlockedModalOpen = true;
      return;
    }

    const blockedList = res.blocked || [];
    const errorList = res.errors || [];
    const deletedList = res.deleted || [];

    if (blockedList.length > 0 || errorList.length > 0) {
      batchReportData = {
        deleted: deletedList,
        blocked: blockedList,
        errors: errorList,
        total: res.total || (deletedList.length + blockedList.length + errorList.length),
        entityType
      };
      isBatchReportOpen = true;
    } else if (deletedList.length > 0) {
      triggerToast(`✅ ${deletedList.length} registros eliminados exitosamente de la base de datos`, 'success');
    }
  }

  // Inline Editing Methods
  function startInlineEdit(item) {
    editingInlineId = item.id;
    inlineDraft = {
      ...item,
      hora_entrada: item.hora_entrada || '',
      hora_salida: item.hora_salida || '',
      color: item.color || '#FFFF99',
      tipo: item.tipo || 'horario'
    };
  }

  function cancelInlineEdit() {
    editingInlineId = null;
    inlineDraft = {};
  }

  function saveInlineEdit(id) {
    if (inlineDuplicateError) {
      triggerToast(inlineDuplicateError, 'error');
      return;
    }
    dispatch('saveInline', { id, draft: inlineDraft });
    editingInlineId = null;
    inlineDraft = {};
  }

  // Delete Methods
  function promptDesincorporar(item) {
    itemToDesincorporar = item;
    motivoDesincorporacion = '';
    isDesincorporarModalOpen = true;
  }

  function confirmDesincorporar() {
    if (!motivoDesincorporacion.trim()) {
      triggerToast('Debe ingresar el motivo de la desincorporación', 'warning');
      return;
    }
    dispatch('desincorporate', {
      ...itemToDesincorporar,
      motivo_desincorporacion: motivoDesincorporacion.trim()
    });
    isDesincorporarModalOpen = false;
    itemToDesincorporar = null;
    motivoDesincorporacion = '';
  }

  function promptDelete(item) {
    itemToDelete = item;
    isDeleteModalOpen = true;
  }

  async function handleConfirmDelete(event) {
    const id = event.detail;
    dispatch('delete', {
      id,
      item: itemToDelete,
      onResult: (res) => {
        if (res && res.blocked) {
          isDeleteModalOpen = false;
          blockedData = res;
          isBlockedModalOpen = true;
        } else {
          isDeleteModalOpen = false;
          itemToDelete = null;
        }
      }
    });
  }
  
  function calculateJornada(entrada, salida) {
    if (!entrada || !salida) return '—';
    try {
      const [h1, m1] = entrada.split(':').map(Number);
      const [h2, m2] = salida.split(':').map(Number);
      let t1 = h1 * 60 + m1;
      let t2 = h2 * 60 + m2;
      if (t2 < t1) t2 += 24 * 60; // Next day
      let diff = t2 - t1;
      if (diff <= 0) return '—';
      const hours = Math.floor(diff / 60);
      const mins = diff % 60;
      return String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
    } catch {
      return '—';
    }
  }

  let lastKnownItems = items;
  let pendingModalPageDirection = null;

  $: if (items !== lastKnownItems) {
    lastKnownItems = items;
    if ($photoModalStore.isOpen && ($photoModalStore.mode === 'empleado' || $photoModalStore.mode === 'desincorporado')) {
      if (pendingModalPageDirection && paginatedItems.length > 0) {
        const dir = pendingModalPageDirection;
        pendingModalPageDirection = null;
        updatePhotoModalItems({
          items: paginatedItems,
          currentPage: currentPage - 1,
          totalPages: totalPages || 1,
          totalCount: displayTotalCount,
          position: dir === 'next' ? 'first' : 'last'
        });
      }
    }
  }

  function openPhotoModal(item) {
    const idx = paginatedItems.findIndex(i => String(i.id) === String(item.id));
    const effectiveIdx = idx !== -1 ? idx : 0;
    const isDesinc = entityType === 'desincorporado' || Boolean(actions?.reincorporate);
    triggerGlobalPhotoModal({
      item,
      items: paginatedItems,
      currentIndex: effectiveIdx,
      currentPage: currentPage - 1,
      totalPages: totalPages || 1,
      totalCount: displayTotalCount,
      mode: isDesinc ? 'desincorporado' : 'empleado',
      onPageNext: () => {
        if (currentPage < totalPages) {
          if (isServerSide) {
            pendingModalPageDirection = 'next';
            changePage(currentPage + 1);
          } else {
            changePage(currentPage + 1);
            updatePhotoModalItems({
              items: paginatedItems,
              currentPage: currentPage - 1,
              totalPages: totalPages || 1,
              totalCount: displayTotalCount,
              position: 'first'
            });
          }
        }
      },
      onPagePrev: () => {
        if (currentPage > 1) {
          if (isServerSide) {
            pendingModalPageDirection = 'prev';
            changePage(currentPage - 1);
          } else {
            changePage(currentPage - 1);
            updatePhotoModalItems({
              items: paginatedItems,
              currentPage: currentPage - 1,
              totalPages: totalPages || 1,
              totalCount: displayTotalCount,
              position: 'last'
            });
          }
        }
      }
    });
  }

</script>

<div class="datatable-card">
  <!-- Top Bar Search Input (Clean 100% Width matching Fotos Globales) -->
  <div class="table-toolbar">
    <div class="toolbar-content" style="display: flex; flex-direction: column; align-items: flex-start; gap: 10px; width: 100%;">
      <slot name="filters" />

      <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
        <div class="search-box" style="flex: 1; width: 100%;">
          <input 
            type="text" 
            bind:value={searchQuery}
            on:input={handleSearchInput}
            placeholder={searchPlaceholder}
          />
          <span class="search-icon">🔍</span>
        </div>

        <slot name="search-actions" />
      </div>

      <slot name="info-banner" />

      {#if showCheckbox && selectedIds.size > 0}
        <div class="batch-toolbar" style="display: flex; align-items: center; justify-content: flex-start; gap: 8px; width: 100%; text-align: left;">
          <span class="batch-badge">{selectedIds.size} seleccionados</span>
          
          {#if actions.desincorporate}
            <button type="button" on:click={handleBatchDesincorporate} class="btn-batch btn-batch-desincorporate">
              Desincorporar
            </button>
          {/if}

          {#if actions.reincorporate}
            <button type="button" on:click={handleBatchReincorporate} class="btn-batch btn-batch-reincorporate">
              Reincorporar
            </button>
          {/if}

          {#if actions.delete !== false}
            <button type="button" on:click={handleBatchDelete} class="btn-batch btn-batch-delete">
              Eliminar
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Scrollable Table Wrapper -->
  <div class="table-scroll-wrapper">
    <table class="data-table">
      <thead>
        <tr>
          <!-- Batch Selection Checkbox Column Header -->
          {#if showCheckbox}
            <th style="width: 40px; padding: 6px 10px; text-align: center;">
              <input 
                type="checkbox" 
                checked={allSelected} 
                on:change={toggleSelectAll} 
                style="cursor: pointer; width: 14px; height: 14px; accent-color: #2563eb;"
                title="Seleccionar todos los registros de la página"
              />
            </th>
          {/if}

          {#each columns as col}
            <th 
              style="text-align: {col.align || 'left'}; cursor: {col.sortable !== false ? 'pointer' : 'default'}; padding: 6px 14px;"
              on:click={() => col.sortable !== false && toggleSort(col.key)}
            >
              {col.label} 
              {#if col.sortable !== false}
                <span class="sort-arrow">
                  {sortBy === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </span>
              {/if}
            </th>
          {/each}
          {#if hasRowActions}
            <th style="text-align: right; padding: 6px 14px;">Acciones</th>
          {/if}
        </tr>
      </thead>

      <tbody>
        {#if paginatedItems.length === 0}
          <tr>
            <td colspan={columns.length + (showCheckbox ? 1 : 0) + (hasRowActions ? 1 : 0)} class="empty-state">
              No se encontraron registros
            </td>
          </tr>
        {:else}
          {#each paginatedItems as item (item.id)}
            {@const isEditingThisRow = editingInlineId === item.id}
            <tr class="{isEditingThisRow ? 'editing-row' : ''} {selectedIds.has(item.id) ? 'selected-row' : ''} {item.is_system ? 'system-base-row' : ''}">
              <!-- Batch Checkbox Column -->
              {#if showCheckbox}
              <td style="text-align: center; width: 40px; padding: 4px 10px;">
                {#if item.disabled || item.disableDelete || item.is_system}
                  <input 
                    type="checkbox"
                    disabled
                    style="cursor: not-allowed; width: 14px; height: 14px; opacity: 0.3;"
                    title="Plantilla base del sistema (no eliminable)"
                  />
                {:else}
                  <input 
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    on:change={() => toggleSelectOne(item.id)}
                    style="cursor: pointer; width: 14px; height: 14px; accent-color: #2563eb;"
                  />
                {/if}
              </td>
              {/if}

              {#each columns as col}
                {#if item.skipColumns && item.skipColumns.includes(col.key)}
                  <!-- Columna omitida por colspan anterior -->
                {:else if item.colspans && item.colspans[col.key]}
                  <td 
                    colspan={item.colspans[col.key].colspan} 
                    style="text-align: {item.colspans[col.key].align || 'center'}; padding: 4px 14px;"
                  >
                    <span style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 700; color: #334155; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 4px 14px; border-radius: 8px; width: 100%; box-sizing: border-box; text-align: center; letter-spacing: 0.3px;">
                      {item.colspans[col.key].text || item[col.key]}
                    </span>
                  </td>
                {:else}
                <td style="text-align: {col.align || 'left'}; padding: 4px 14px;">
                  {#if col.type === 'photo'}
                    <!-- Photo Thumbnail (Compact 26x26px matching Fotos Globales) -->
                    <button 
                      type="button" 
                      class="photo-btn"
                      on:click={() => openPhotoModal(item)}
                      title="Ampliar fotografía">
                      <img 
                        src={getPhotoUrl(item)} 
                        alt="Foto de {toTitleCase(item.nombre) || 'Empleado'}"
                        class="employee-thumb"
                        on:error={(e) => { 
                          const img = e.target;
                          const empId = item.empleado_id || item.id;
                          if (!img.dataset.triedEmp && empId && !img.src.endsWith(`/empleados/${empId}.jpg`)) {
                            img.dataset.triedEmp = 'true';
                            img.src = `/empleados/${empId}.jpg`;
                          } else {
                            img.style.display = 'none';
                            if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
                          }
                        }}
                      />
                      <div class="fallback-avatar-icon" style="display: none;">
                        {getInitials(toTitleCase(item.nombre), item.cedula)}
                      </div>
                    </button>

                  {:else if col.type === 'id'}
                    <!-- ID with # prefix or BASE tag for system templates -->
                    {#if item.is_system}
                      <span class="id-badge" style="background: #e2e8f0; color: #334155; border-color: #cbd5e1; font-weight: 900; letter-spacing: 0.5px;">BASE</span>
                    {:else}
                      <span class="id-badge">#{item.id}</span>
                    {/if}

                  {:else if isEditingThisRow && col.editable !== false}
                    <!-- INLINE EDITING INPUT CELL -->
                    {#if col.type === 'color'}
                      <!-- Color Picker Input for Color Column -->
                      <div style="display: inline-flex; align-items: center; gap: 6px;">
                        <input 
                          type="color" 
                          bind:value={inlineDraft['color']} 
                          style="width: 32px; height: 32px; padding: 0; border: 1.5px solid #cbd5e1; border-radius: 6px; cursor: pointer; background: transparent;"
                        />
                        <input 
                          type="text" 
                          bind:value={inlineDraft['color']} 
                          style="width: 75px; padding: 3px 6px; font-family: monospace; font-size: 11.5px; font-weight: 700; border-radius: 6px; border: 1px solid #2563eb; outline: none; background: #ffffff;"
                        />
                      </div>

                    {:else if col.type === 'horario_badge'}
                      <!-- Work Hours Inputs: 2 Time Pickers (Entry & Exit) -->
                      {#if String(inlineDraft['tipo']).toLowerCase() === 'plantilla'}
                        <span style="display: inline-block; background: #f1f5f9; color: #64748b; padding: 4px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 600; font-style: italic;">
                          Sin horario (Plantilla)
                        </span>
                      {:else}
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                          <input 
                            type="time" 
                            step="1"
                            bind:value={inlineDraft['hora_entrada']} 
                            class="inline-input-time"
                            style="width: 95px; padding: 3px 6px; font-size: 11.5px; font-weight: 700; font-family: monospace; border-radius: 6px; border: 1px solid #2563eb; outline: none; background: #ffffff;"
                          />
                          <span style="font-weight: 800; color: #64748b;">-</span>
                          <input 
                            type="time" 
                            step="1"
                            bind:value={inlineDraft['hora_salida']} 
                            class="inline-input-time"
                            style="width: 95px; padding: 3px 6px; font-size: 11.5px; font-weight: 700; font-family: monospace; border-radius: 6px; border: 1px solid #2563eb; outline: none; background: #ffffff;"
                          />
                        </div>
                      {/if}

                    {:else if col.key === 'tipo' || (col.options && Array.isArray(col.options) && typeof col.options[0] === 'string')}
                      <!-- Tipo Select Dropdown -->
                      <select 
                        bind:value={inlineDraft[col.key]}
                        on:change={(e) => {
                          if (e.target.value === 'plantilla') {
                            inlineDraft['hora_entrada'] = null;
                            inlineDraft['hora_salida'] = null;
                          }
                        }}
                        class="inline-select"
                        style="padding: 4px 8px; border-radius: 6px; border: 1px solid #2563eb; font-size: 12px; font-weight: 800; background: #ffffff; cursor: pointer;">
                        {#each (col.options || ['horario', 'plantilla']) as opt}
                          <option value={opt}>
                            {String(opt).toLowerCase() === 'plantilla' || String(opt).toLowerCase() === 'excepcion' ? 'EXCEPCIÓN' : String(opt).toUpperCase()}
                          </option>
                        {/each}
                      </select>

                    {:else if col.options && Array.isArray(col.options)}
                      <!-- Standard Entity Select Dropdown -->
                      <select 
                        bind:value={inlineDraft[col.keyId || col.key]}
                        class="inline-select">
                        {#each getInlineSelectOptions(col, item) as opt}
                          <option value={typeof opt === 'object' ? opt.id : opt}>
                            {typeof opt === 'object' ? (opt.nombre || opt.nombre_comercial || opt.name) : opt}
                          </option>
                        {/each}
                      </select>

                    {:else if col.type === 'fecha_nacimiento' || col.type === 'fecha_ingreso' || col.type === 'date'}
                      <!-- Date Input for Birthday / Join Date -->
                      <input 
                        type="date" 
                        bind:value={inlineDraft[col.key]}
                        class="inline-input"
                        style="padding: 3px 6px; font-size: 11.5px; font-weight: 700; border-radius: 6px; border: 1px solid #2563eb; background: #ffffff;"
                      />

                    {:else}
                      <!-- Standard Text Input -->
                      <input 
                        type="text" 
                        bind:value={inlineDraft[col.key]}
                        class="inline-input"
                        placeholder={col.label}
                      />
                    {/if}

                  {:else if col.type === 'color'}
                    <!-- READ-ONLY Color Circle Badge -->
                    <div style="display: inline-flex; align-items: center; gap: 8px;">
                      <span style="width: 18px; height: 18px; border-radius: 50%; background-color: {item[col.key] || '#e2e8f0'}; border: 1.5px solid rgba(0,0,0,0.15); box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex-shrink: 0;"></span>
                      <span style="font-family: monospace; font-size: 11px; font-weight: 700; color: #475569;">{item[col.key] || '—'}</span>
                    </div>

                  {:else if col.type === 'badge'}
                    <!-- READ-ONLY Pill Badge -->
                    <span style="display: inline-block; padding: 2px 9px; border-radius: 12px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; background: {String(item[col.key]).toLowerCase() === 'plantilla' ? '#e0e7ff' : '#dcfce7'}; color: {String(item[col.key]).toLowerCase() === 'plantilla' ? '#3730a3' : '#166534'};">
                      {String(item[col.key]).toLowerCase() === 'plantilla' ? 'Excepción' : (item[col.key] || 'horario')}
                    </span>

                  {:else if col.type === 'horario_badge'}
                    <!-- READ-ONLY Work Hours 2-Pill Component (Entry, Exit) -->
                    {#if item.hora_entrada || item.hora_salida}
                      <div style="display: inline-flex; align-items: center; gap: 6px; background: #f0f9ff; border: 1px solid #bae6fd; padding: 4px 8px; border-radius: 8px; font-size: 12px; font-weight: 700; font-family: monospace;">
                        <span style="background: #0284c7; color: #ffffff; padding: 2px 6px; border-radius: 5px; font-size: 11.5px;">{item.hora_entrada || '--:--'}</span>
                        <span style="background: #0284c7; color: #ffffff; padding: 2px 6px; border-radius: 5px; font-size: 11.5px;">{item.hora_salida || '--:--'}</span>
                      </div>
                    {:else}
                      <span style="display: inline-block; background: #f1f5f9; color: #64748b; padding: 4px 10px; border-radius: 8px; font-size: 11.5px; font-weight: 600; font-style: italic;">
                        Sin horario
                      </span>
                    {/if}

                  {:else if col.type === 'jornada'}
                    <!-- READ-ONLY Calculated Work Duration -->
                    <span style="font-family: monospace; font-size: 12px; font-weight: 800; color: #0f172a;">
                      {calculateJornada(isEditingThisRow ? inlineDraft.hora_entrada : item.hora_entrada, isEditingThisRow ? inlineDraft.hora_salida : item.hora_salida)}
                    </span>

                  {:else if col.type === 'ciclo_badge'}
                    <!-- Ciclo Type Badge (CORRELATIVO vs MIXTO) -->
                    <span style="display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; background: {String(item[col.key]).toLowerCase() === 'correlativo' ? '#f5f3ff' : '#eff6ff'}; color: {String(item[col.key]).toLowerCase() === 'correlativo' ? '#6b21a8' : '#1d4ed8'}; border: 1px solid {String(item[col.key]).toLowerCase() === 'correlativo' ? '#ddd6fe' : '#bfdbfe'};">
                      {item[col.key] || 'correlativo'}
                    </span>

                  {:else if col.type === 'ciclo_sequence'}
                    <!-- Ciclo Sequence Pills -->
                    {#if item.detalles && item.detalles.length > 0}
                      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        {#each item.detalles as d, idx}
                          <div style="display: inline-flex; align-items: center; gap: 4px; background: #ffffff; border: 1px solid #cbd5e1; padding: 3px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                            {#if String(item.tipo_ciclo).toLowerCase() === 'correlativo'}
                              <span style="color: #6366f1; font-weight: 800;">{d.dias_duracion}</span>
                            {/if}
                            <span style="color: #0f172a; font-family: monospace;">[{d.plantilla_codigo || '—'}]</span>
                            <span style="color: #475569; font-size: 11px;">{d.plantilla_nombre}</span>
                          </div>
                          {#if idx < item.detalles.length - 1}
                            <span style="color: #94a3b8; font-weight: 800; font-size: 11px;">➔</span>
                          {/if}
                        {/each}
                      </div>
                    {:else}
                      <span style="color: #94a3b8; font-style: italic; font-size: 11.5px;">Sin horarios configurados</span>
                    {/if}

                  {:else if col.type === 'ciclo_correlativo_column'}
                    <!-- Correlativo Column Preview -->
                    {#if item.correlativo && item.correlativo.detalles && item.correlativo.detalles.length > 0}
                      <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                        {#each item.correlativo.detalles as d, idx}
                          <span style="display: inline-flex; align-items: center; gap: 3px; background: #f5f3ff; color: #5b21b6; border: 1px solid #ddd6fe; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 800;">
                            <strong style="color: #7c3aed;">{d.dias_duracion}</strong> [{d.plantilla_codigo || '—'}]
                          </span>
                          {#if idx < item.correlativo.detalles.length - 1}
                            <span style="color: #a78bfa; font-size: 10px; font-weight: 800;">➔</span>
                          {/if}
                        {/each}
                      </div>
                    {:else}
                      <span style="display: inline-block; background: #f1f5f9; color: #94a3b8; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; font-style: italic;">
                        -- Sin definir --
                      </span>
                    {/if}

                  {:else if col.type === 'ciclo_mixto_column'}
                    <!-- Mixto Column Preview -->
                    {#if item.mixto && item.mixto.detalles && item.mixto.detalles.length > 0}
                      <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                        {#each item.mixto.detalles as d}
                          <span style="display: inline-flex; align-items: center; gap: 4px; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 800;">
                            [{d.plantilla_codigo || '—'}] {d.hora_entrada ? `${d.hora_entrada.substring(0,5)}` : 'Sin horario'}
                          </span>
                        {/each}
                      </div>
                    {:else}
                      <span style="display: inline-block; background: #f1f5f9; color: #94a3b8; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; font-style: italic;">
                        -- Sin definir --
                      </span>
                    {/if}

                  {:else if col.type === 'departamento_horarios_asignados' || col.type === 'departamento_ciclos_list'}
                    <!-- Configured Department Shift Badges (Peloticas) -->
                    <div style="display: flex; flex-wrap: wrap; gap: 5px; align-items: center;">
                      {#if item.horarios_asignados && item.horarios_asignados.length > 0}
                        {#each item.horarios_asignados as h}
                          <div 
                            style="display: inline-flex; align-items: center; gap: 4px; background: {h.color || '#3b82f6'}; color: #ffffff; padding: 3px 9px; border-radius: 12px; font-weight: 800; font-size: 11px; box-shadow: 0 1px 2px rgba(0,0,0,0.12);"
                            title="{h.nombre} ({h.hora_entrada || ''} - {h.hora_salida || ''})">
                            <span>{h.codigo || 'H'}</span>
                          </div>
                        {/each}
                      {:else if item.ciclos && item.ciclos.length > 0}
                        <button 
                          type="button" 
                          on:click={() => dispatch('openPreviewHorarios', item)}
                          style="padding: 4px 12px; border-radius: 20px; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; font-size: 11.5px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);"
                          title="Ver detalle de los horarios configurados">
                          <span>{item.ciclos.length} {item.ciclos.length === 1 ? 'Horario' : 'Horarios'}</span>
                        </button>
                      {:else}
                        <span style="display: inline-block; background: #f1f5f9; color: #94a3b8; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; font-style: italic;">
                          0 Horarios
                        </span>
                      {/if}
                    </div>

                  {:else if col.type === 'total_empleados_badge'}
                    <!-- Department Total Active Employees Pill -->
                    <span style="display: inline-flex; align-items: center; gap: 5px; background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; padding: 4px 10px; border-radius: 12px; font-size: 11.5px; font-weight: 800;">
                      {item.total_empleados || 0} emp.
                    </span>

                  {:else if col.type === 'corte_empleados_badge'}
                    <!-- Empleados badge en Corte Histórico -->
                    <span style="display: inline-flex; align-items: center; gap: 5px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 4px 10px; border-radius: 12px; font-size: 11.5px; font-weight: 800;">
                      👥 {item.total_empleados || 0} empleados
                    </span>

                  {:else if col.type === 'corte_actions'}
                    <!-- Botón Ver Cálculos de Corte Histórico -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <button 
                        type="button" 
                        on:click={() => dispatch('verCalculos', item)}
                        style="padding: 6px 14px; border-radius: 8px; border: 1px solid #7c3aed; background: #7c3aed; color: #ffffff; font-size: 12px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(124, 58, 237, 0.25); transition: all 0.15s ease;"
                        on:mouseenter={(e) => e.currentTarget.style.background = '#6d28d9'}
                        on:mouseleave={(e) => e.currentTarget.style.background = '#7c3aed'}
                        title="Ver desglose completo de cálculos de asistencia">
                        <span>📊</span> Ver Cálculos
                      </button>
                    </div>

                  {:else if col.type === 'departamento_ciclos_actions'}
                    <!-- Dedicated Action Button: Ver Departamento -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <button 
                        type="button" 
                        on:click={() => dispatch('openAsignarEmpleados', item)}
                        style="padding: 6px 14px; border-radius: 8px; border: 1px solid #2563eb; background: #2563eb; color: #ffffff; font-size: 12px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25); transition: all 0.15s ease;"
                        on:mouseenter={(e) => e.currentTarget.style.background = '#1d4ed8'}
                        on:mouseleave={(e) => e.currentTarget.style.background = '#2563eb'}
                        title="Asignar horarios a los empleados del departamento">
                        Asignar Horarios
                      </button>
                    </div>

                  {:else if col.type === 'ciclos_actions_buttons'}
                    <!-- 2 Dedicated Action Buttons: Correlativo & Mixto (legacy compatibility) -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <button 
                        type="button" 
                        on:click={() => dispatch('openConfigCorrelativo', item)}
                        style="padding: 5px 14px; border-radius: 6px; border: 1px solid {item.correlativo ? '#ddd6fe' : '#cbd5e1'}; background: {item.correlativo ? '#f5f3ff' : '#ffffff'}; color: {item.correlativo ? '#6b21a8' : '#475569'}; font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.15s ease;"
                        title="Configurar / Editar ciclo correlativo rotativo">
                        Correlativo
                      </button>

                      <button 
                        type="button" 
                        on:click={() => dispatch('openConfigMixto', item)}
                        style="padding: 5px 14px; border-radius: 6px; border: 1px solid {item.mixto ? '#bfdbfe' : '#cbd5e1'}; background: {item.mixto ? '#eff6ff' : '#ffffff'}; color: {item.mixto ? '#1d4ed8' : '#475569'}; font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.15s ease;"
                        title="Configurar / Editar ciclo mixto flexible">
                        Mixto
                      </button>
                    </div>

                  {:else if col.type === 'fecha_nacimiento'}
                    <!-- READ-ONLY Fecha de Nacimiento con Edad -->
                    {#if item[col.key]}
                      <div style="display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap;">
                        <span style="font-size: 12.5px; font-weight: 800; color: #0f172a;">
                          {formatDateDDMMYYYY(item[col.key])}
                        </span>
                        <span style="font-size: 11.5px; font-weight: 800; color: #7c3aed;">
                          ({calculateEdad(item[col.key])})
                        </span>
                      </div>
                    {:else}
                      <span style="color: #94a3b8; font-style: italic; font-size: 12px;">—</span>
                    {/if}

                  {:else if col.type === 'fecha_ingreso'}
                    <!-- READ-ONLY Fecha de Ingreso con Antigüedad -->
                    {#if item[col.key]}
                      <div style="display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap;">
                        <span style="font-size: 12.5px; font-weight: 800; color: #0f172a;">
                          {formatDateDDMMYYYY(item[col.key])}
                        </span>
                        <span style="font-size: 11.5px; font-weight: 800; color: #2563eb;">
                          ({calculateAntiguedad(item[col.key])})
                        </span>
                      </div>
                    {:else}
                      <span style="color: #94a3b8; font-style: italic; font-size: 12px;">—</span>
                    {/if}

                  {:else}
                    <!-- READ-ONLY CELL -->
                    <span class={col.bold ? 'font-bold' : ''}>
                      {item[col.key] !== null && item[col.key] !== undefined ? item[col.key] : '—'}
                    </span>
                  {/if}
                </td>
                {/if}
              {/each}

              <!-- Action Buttons -->
              {#if hasRowActions}
              <td style="text-align: right; padding: 4px 14px;">
                <div class="actions-group">
                  {#if isEditingThisRow}
                    <!-- Save & Cancel Inline Buttons -->
                    <button 
                      type="button"
                      class="btn-action btn-save-inline"
                      title="Guardar Cambios"
                      disabled={!!inlineDuplicateError}
                      style="{inlineDuplicateError ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
                      on:click={() => saveInlineEdit(item.id)}>
                      Guardar
                    </button>
                    <button 
                      type="button"
                      class="btn-action btn-cancel-inline"
                      title="Cancelar Edición"
                      on:click={cancelInlineEdit}>
                      Cancelar
                    </button>
                  {:else}
                    {#if actions.desincorporate}
                      <button 
                        type="button"
                        class="btn-action btn-desincorporate"
                        title="Desincorporar Empleado"
                        on:click={() => promptDesincorporar(item)}>
                        Desincorporar
                      </button>
                    {/if}

                    {#if actions.reincorporate}
                      <button 
                        type="button"
                        class="btn-action btn-reincorporate"
                        title="Reincorporar Empleado"
                        on:click={() => promptReincorporar(item)}>
                        Reincorporar
                      </button>
                    {/if}

                    {#if actions.edit !== false}
                      {#if item.disabled || item.disableEdit || item.is_system}
                        <button 
                          type="button" 
                          class="btn-action btn-edit disabled"
                          disabled
                          style="opacity: 0.35; cursor: not-allowed;"
                          title="Plantilla base predeterminada">
                          Editar
                        </button>
                      {:else}
                        {#if actions.editModal}
                          <button 
                            type="button"
                            class="btn-action btn-edit"
                            title="Editar registro"
                            on:click={() => dispatch('openEdit', item)}>
                            Editar
                          </button>
                        {:else}
                          <button 
                            type="button"
                            class="btn-action btn-edit"
                            title="Editar en la misma línea"
                            on:click={() => startInlineEdit(item)}>
                            Editar
                          </button>
                        {/if}
                      {/if}
                    {/if}

                    {#if actions.delete !== false}
                      {#if item.disabled || item.disableDelete || item.is_system}
                        <button 
                          type="button" 
                          class="btn-action btn-delete disabled"
                          disabled
                          style="opacity: 0.35; cursor: not-allowed;"
                          title="Plantilla base del sistema (no se puede eliminar)">
                          Eliminar
                        </button>
                      {:else}
                        <button 
                          type="button"
                          class="btn-action btn-delete"
                          title="Eliminar"
                          on:click={() => promptDelete(item)}>
                          Eliminar
                        </button>
                      {/if}
                    {/if}
                  {/if}
                </div>
              </td>
              {/if}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Bottom Toolbar Footer (Exact Fotos Globales layout) -->
  <div class="table-footer-toolbar">
    <!-- Left: Filters Info -->
    <div class="footer-info">
      Total: (<strong>{displayTotalCount}</strong>) &nbsp;|&nbsp; Filtros Totales: (<strong>{totalFilters}</strong>) &nbsp;Filtros: <span class={totalFilters > 0 ? 'filter-active' : 'filter-none'}>{activeFilterName}</span>
    </div>

    <!-- Right Controls: [10 filas v] [1 - 10 de 2166] [< 1 / 217 >] -->
    <div class="footer-controls">
      <!-- Dropdown Filas -->
      <select 
        bind:value={pageSize}
        on:change={handlePageSizeChange}
        class="page-size-select">
        <option value={10}>10 filas</option>
        <option value={25}>25 filas</option>
        <option value={50}>50 filas</option>
        <option value={100}>100 filas</option>
        <option value={500}>500 filas</option>
        <option value={1000}>1000 filas</option>
      </select>

      <!-- Range indicator -->
      <span class="range-text">
        {startRecord} - {endRecord} de {displayTotalCount}
      </span>

      <!-- Compact Pagination Group [< 1 / 217 >] -->
      <div class="pagination-pill">
        <button 
          on:click={() => changePage(numCurrentPage - 1)}
          disabled={numCurrentPage <= 1}
          type="button"
          class="page-btn">
          &lt;
        </button>

        <span class="page-indicator">
          {numCurrentPage} / {totalPages}
        </span>

        <button 
          on:click={() => changePage(numCurrentPage + 1)}
          disabled={numCurrentPage >= totalPages}
          type="button"
          class="page-btn">
          &gt;
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Confirmation Delete Modal -->
<DeleteModal 
  isOpen={isDeleteModalOpen}
  item={itemToDelete}
  {entityType}
  on:confirm={handleConfirmDelete}
  on:close={() => (isDeleteModalOpen = false)}
/>

<!-- Blocked Delete Modal -->
<BlockedDeleteModal 
  isOpen={isBlockedModalOpen}
  blockedData={blockedData}
  on:close={() => (isBlockedModalOpen = false)}
/>

<!-- Batch Delete Confirm Modal -->
<BatchDeleteConfirmModal 
  isOpen={isBatchConfirmOpen}
  count={selectedIds.size}
  {entityType}
  isDeleting={isBatchDeleting}
  on:confirm={confirmBatchDelete}
  on:close={() => (isBatchConfirmOpen = false)}
/>

<!-- Batch Delete Report Modal -->
<BatchDeleteReportModal 
  isOpen={isBatchReportOpen}
  report={batchReportData}
  on:close={() => (isBatchReportOpen = false)}
/>

{#if isDesincorporarModalOpen && itemToDesincorporar}
  <div class="modal-overlay" style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;">
    <div style="background: #ffffff; border-radius: 16px; width: 100%; max-width: 480px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); border: 1px solid #e2e8f0;">
      
      <!-- Modal Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #fff1f2; border-bottom: 1px solid #fecdd3;">
        <div style="font-size: 16px; font-weight: 800; color: #9f1239; display: flex; align-items: center; gap: 8px;">
          Desincorporar Empleado
        </div>
        <button 
          on:click={() => isDesincorporarModalOpen = false} 
          type="button"
          style="width: 30px; height: 30px; border-radius: 50%; border: none; background: #ffe4e6; color: #9f1239; font-weight: 800; cursor: pointer;">
          ✕
        </button>
      </div>

      <!-- Modal Body -->
      <div style="padding: 20px;">
        <p style="font-size: 13.5px; color: #334155; margin-top: 0; margin-bottom: 14px; line-height: 1.5;">
          Indique el motivo por el cual está desincorporando al empleado 
          <strong style="color: #0f172a;">{toTitleCase(itemToDesincorporar.nombre)}</strong> 
          <span style="font-family: monospace; color: #2563eb; font-weight: 700;">(#{itemToDesincorporar.id})</span>:
        </p>

        <label for="motivo_desincorporacion_txt" style="display: block; font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 6px;">
          Motivo de Desincorporación <span style="color: #e11d48;">*</span>
        </label>

        <textarea 
          id="motivo_desincorporacion_txt"
          bind:value={motivoDesincorporacion}
          rows="4"
          placeholder="Escriba aquí la razón detallada (ej: Renuncia voluntaria, Fin de contrato, Inasistencia injustificada...)"
          style="width: 100%; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; font-size: 13px; outline: none; font-family: inherit; resize: vertical; color: #0f172a; box-sizing: border-box;"
        ></textarea>
      </div>

      <!-- Modal Footer -->
      <div style="padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
        <button 
          type="button" 
          on:click={() => isDesincorporarModalOpen = false}
          style="padding: 8px 16px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: 700; font-size: 12.5px; color: #64748b; cursor: pointer;">
          Cancelar
        </button>

        <button 
          type="button" 
          on:click={confirmDesincorporar}
          style="padding: 8px 18px; background: #e11d48; color: #ffffff; border: none; border-radius: 8px; font-weight: 700; font-size: 12.5px; cursor: pointer; box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);">
          Confirmar Desincorporación
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .datatable-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    overflow: visible;
    position: relative;
    margin-bottom: 24px;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .table-toolbar {
    padding: 10px 14px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    border-top-left-radius: 12px;
    border-top-right-radius: 12px;
    position: relative;
    z-index: 40;
  }

  .toolbar-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .search-box {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .search-box input {
    width: 100%;
    padding: 8px 12px 8px 34px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 13.5px;
    outline: none;
    transition: all 0.15s ease;
  }

  .search-box input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }

  .search-icon {
    position: absolute;
    left: 12px;
    font-size: 14px;
    color: #94a3b8;
    pointer-events: none;
  }

  .batch-toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    white-space: nowrap;
    width: 100%;
    text-align: left;
    margin-left: 0;
  }

  .batch-badge {
    font-size: 12px;
    color: #2563eb;
    font-weight: 800;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    padding: 4px 10px;
    border-radius: 6px;
  }

  .btn-batch {
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
  }

  .btn-batch-desincorporate {
    background: #fffbeb;
    color: #b45309;
    border-color: #fde68a;
  }

  .btn-batch-desincorporate:hover {
    background: #fef3c7;
  }

  .btn-batch-reincorporate {
    background: #f0fdf4;
    color: #15803d;
    border-color: #bbf7d0;
  }

  .btn-batch-reincorporate:hover {
    background: #dcfce7;
  }

  .btn-batch-delete {
    background: #fef2f2;
    color: #dc2626;
    border-color: #fecaca;
  }

  .btn-batch-delete:hover {
    background: #fee2e2;
  }

  .table-scroll-wrapper {
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 13px;
  }

  .data-table th {
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    color: #475569;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    user-select: none;
  }

  .sort-arrow {
    font-size: 10px;
    color: #2563eb;
    margin-left: 2px;
  }

  .data-table td {
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
    vertical-align: middle;
  }

  .selected-row td {
    background: #eff6ff !important;
  }

  .editing-row td {
    background: #f0f9ff !important;
  }

  .data-table tr:hover td {
    background: #f8fafc;
  }

  .id-badge {
    font-family: monospace;
    font-weight: 700;
    color: #334155;
  }

  .font-bold {
    font-weight: 600;
    color: #0f172a;
  }

  .photo-btn {
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 6px;
    outline: none;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .employee-thumb {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    object-fit: cover;
    border: 1px solid #3b82f6;
    background: #f1f5f9;
  }

  .fallback-avatar-icon {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: #2563eb;
    color: #ffffff;
    font-size: 10px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .inline-input {
    width: 100%;
    min-width: 120px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid #2563eb;
    font-size: 12.5px;
    outline: none;
    background: #ffffff;
  }

  .inline-select {
    width: 100%;
    min-width: 120px;
    padding: 3px 6px;
    border-radius: 6px;
    border: 1px solid #2563eb;
    font-size: 12.5px;
    outline: none;
    background: #ffffff;
  }

  .actions-group {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .btn-action {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 3px 7px;
    font-size: 11.5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-action:hover {
    background: #f1f5f9;
  }

  .btn-save-inline {
    background: #16a34a;
    color: #ffffff;
    border-color: #15803d;
    font-weight: 700;
  }

  .btn-save-inline:hover {
    background: #15803d;
  }

  .btn-cancel-inline {
    background: #64748b;
    color: #ffffff;
    border-color: #475569;
    font-weight: 700;
  }

  .btn-cancel-inline:hover {
    background: #475569;
  }

  .btn-delete {
    color: #ef4444;
    border-color: #fca5a5;
    font-weight: 700;
  }

  .btn-delete:hover {
    background: #fef2f2;
  }

  .btn-desincorporate {
    color: #b45309;
    border-color: #fde68a;
    font-weight: 700;
  }

  .btn-edit {
    color: #2563eb;
    border-color: #bfdbfe;
    font-weight: 700;
  }

  .btn-edit:hover {
    background: #eff6ff;
  }

  .btn-desincorporate:hover {
    background: #fffbeb;
  }

  .btn-reincorporate {
    color: #16a34a;
    border-color: #86efac;
    font-weight: 700;
  }

  .btn-reincorporate:hover {
    background: #f0fdf4;
  }

  .empty-state {
    text-align: center;
    padding: 24px;
    color: #64748b;
    font-size: 13px;
    font-weight: 600;
  }

  .table-footer-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    flex-wrap: wrap;
  }

  .footer-info {
    font-size: 13px;
    color: #475569;
    font-weight: 500;
  }

  .filter-active {
    color: #2563eb;
    font-weight: 700;
  }

  .filter-none {
    color: #64748b;
    font-weight: 600;
  }

  .footer-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .page-size-select {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    outline: none;
    cursor: pointer;
  }

  .range-text {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
  }

  .pagination-pill {
    display: flex;
    align-items: center;
    border: 1px solid #94a3b8;
    border-radius: 6px;
    overflow: hidden;
    background: #94a3b8;
  }

  .page-btn {
    padding: 3px 8px;
    border: none;
    background: #ffffff;
    color: #334155;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
  }

  .page-btn:disabled {
    background: #e2e8f0;
    cursor: not-allowed;
    color: #94a3b8;
  }

  .page-indicator {
    padding: 3px 10px;
    background: #94a3b8;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
  }

  /* Photo Lightbox Backdrop & Modal Card */
  .photo-lightbox-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(8px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .lightbox-carousel-wrapper {
    position: relative;
    max-width: 580px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .carousel-nav-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.2);
    background: rgba(15, 23, 42, 0.9);
    color: #ffffff;
    font-size: 22px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    transition: all 0.15s ease;
  }

  .carousel-nav-btn:hover {
    background: #2563eb;
    border-color: #60a5fa;
    transform: translateY(-50%) scale(1.1);
  }

  .prev-btn {
    left: -22px;
  }

  .next-btn {
    right: -22px;
  }

  .photo-lightbox-card {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.2);
    position: relative;
    color: #0f172a;
  }

  .photo-lightbox-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .photo-lightbox-header-left {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .photo-lightbox-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    width: 100%;
  }

  .employee-name-text {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    max-width: 220px;
  }

  .carousel-counter-badge {
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    background: #e2e8f0;
    padding: 2px 6px;
    border-radius: 8px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .photo-lightbox-subtitle {
    font-size: 12px;
    color: #2563eb;
    font-weight: 700;
    font-family: monospace;
    margin-top: 2px;
  }

  .photo-lightbox-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .page-summary-badge {
    font-size: 12.5px;
    font-weight: 700;
    color: #1e3a8a;
    background: #dbeafe;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid #bfdbfe;
    white-space: nowrap;
  }

  .photo-lightbox-close {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    font-size: 18px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .photo-lightbox-close:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .photo-lightbox-body {
    padding: 20px;
    background: #0f172a;
    text-align: center;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 300px;
  }

  .photo-lightbox-img {
    max-width: 100%;
    max-height: 400px;
    border-radius: 12px;
    object-fit: contain;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    border: 3px solid #334155;
  }

  .photo-lightbox-avatar-fallback {
    width: 130px;
    height: 130px;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff;
    font-weight: 800;
    font-size: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  }

  .photo-lightbox-footer {
    padding: 16px 20px;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    font-size: 13px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }

  .meta-item {
    display: flex;
    flex-direction: column;
  }

  .photo-lightbox-footer-download-row {
    grid-column: span 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px dashed #e2e8f0;
    width: 100%;
  }

  .footer-meta-info-text {
    font-size: 11.5px;
    color: #475569;
    font-weight: 700;
  }

  .text-blue {
    color: #2563eb;
  }

  .text-green {
    color: #10b981;
  }

  .btn-download-photo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 14px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 20px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.35);
    transition: all 0.15s ease;
    width: auto !important;
    max-width: max-content !important;
    flex-shrink: 0;
  }

  .btn-download-photo:hover {
    background: #1d4ed8;
    transform: translateY(-1px);
    box-shadow: 0 6px 10px -1px rgba(37, 99, 235, 0.4);
  }

  .footer-meta-label {
    font-size: 10.5px;
    font-weight: 800;
    color: #64748b;
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .footer-meta-val {
    font-weight: 700;
    color: #0f172a;
    font-size: 13px;
  }
</style>
<!-- Modal para Crear Registro (Departamentos, Áreas, Cargos, etc.) -->
{#if isCreateModalOpen}
  <div 
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease;">
    
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div 
      style="background: #ffffff; border-radius: 14px; max-width: 480px; width: 100%; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); border: 1px solid #e2e8f0; color: #0f172a;"
      on:click|stopPropagation>
      
      <!-- Modal Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
          <span>➕</span> {createModalTitle || `Agregar Nuevo ${toTitleCase(entityType)}`}
        </h3>
        <button 
          type="button" 
          on:click={closeCreateModal}
          style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid #cbd5e1; background: #ffffff; color: #64748b; font-size: 16px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <!-- Modal Body Form -->
      <form on:submit|preventDefault={submitCreateModal} style="padding: 20px;">
        {#each createFields as field}
          {#if field.type === 'row'}
            <!-- 2-Column Side-by-Side Row (e.g. Hora Entrada & Hora Salida) -->
            {#if String(createDraft['tipo']).toLowerCase() !== 'plantilla'}
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                {#each field.fields as subField}
                  <div>
                    <label for={`create_subfield_${subField.key}`} style="display: block; font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                      {subField.label} {subField.required ? '*' : ''}
                    </label>
                    {#if subField.type === 'select'}
                      <select 
                        id={`create_subfield_${subField.key}`}
                        bind:value={createDraft[subField.key]}
                        required={subField.required}
                        style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #cbd5e1; font-size: 13.5px; color: #0f172a; font-weight: 600; outline: none; background: #ffffff; box-sizing: border-box;"
                      >
                        {#each (subField.options || []) as opt}
                          <option value={typeof opt === 'object' ? opt.id : opt}>
                            {typeof opt === 'object' ? (opt.nombre || opt.label) : opt}
                          </option>
                        {/each}
                      </select>
                    {:else}
                      <input 
                        id={`create_subfield_${subField.key}`}
                        type={subField.type || 'text'} 
                        step={subField.type === 'time' ? '1' : undefined}
                        min={subField.min}
                        max={subField.max}
                        bind:value={createDraft[subField.key]}
                        placeholder={subField.placeholder || ''}
                        required={subField.required}
                        style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #cbd5e1; font-size: 13.5px; color: #0f172a; font-weight: 600; outline: none; background: #ffffff; box-sizing: border-box;"
                      />
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

          {:else if field.type === 'color'}
            <!-- Rich Color Picker Input with Hex Field -->
            <div style="margin-bottom: 16px;">
              <label for={`create_color_${field.key}`} style="display: block; font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                {field.label} {field.required ? '*' : ''}
              </label>
              <div style="display: flex; align-items: center; gap: 10px;">
                <input 
                  id={`create_color_${field.key}`}
                  type="color" 
                  bind:value={createDraft[field.key]}
                  style="width: 44px; height: 42px; padding: 2px; border: 1.5px solid #cbd5e1; border-radius: 8px; cursor: pointer; background: #ffffff;"
                />
                <input 
                  type="text" 
                  bind:value={createDraft[field.key]}
                  placeholder="#FFFF99"
                  style="flex: 1; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #cbd5e1; font-size: 13.5px; color: #0f172a; font-weight: 700; font-family: monospace; outline: none; background: #ffffff;"
                />
              </div>
            </div>

          {:else}
            <!-- Standard Select / Input -->
            <div style="margin-bottom: 16px;">
              <label for={`create_field_${field.key}`} style="display: block; font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
                {field.label} {field.required ? '*' : ''}
              </label>

              {#if field.type === 'select'}
                <select 
                  id={`create_field_${field.key}`}
                  bind:value={createDraft[field.key]}
                  on:change={(e) => {
                    if (field.key === 'tipo' && e.target.value === 'plantilla') {
                      createDraft['hora_entrada'] = null;
                      createDraft['hora_salida'] = null;
                    }
                  }}
                  required={field.required}
                  style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #cbd5e1; font-size: 13.5px; color: #0f172a; font-weight: 600; outline: none; background: #ffffff;">
                  {#if !createDraft[field.key]}
                    <option value="">-- Seleccionar {field.label} --</option>
                  {/if}
                  {#if Array.isArray(field.options) && typeof field.options[0] === 'string'}
                    {#each field.options as opt}
                      <option value={opt}>{String(opt).toUpperCase()}</option>
                    {/each}
                  {:else}
                    {#each getGroupedOptions(field.options) as grp}
                      {#if grp.label}
                        <optgroup label="{grp.label}">
                          {#each grp.items as opt}
                            <option value={opt.id}>{opt.nombre || opt.nombre_comercial}</option>
                          {/each}
                        </optgroup>
                      {:else}
                        {#each grp.items as opt}
                          <option value={opt.id}>{opt.nombre || opt.nombre_comercial}</option>
                        {/each}
                      {/if}
                    {/each}
                  {/if}
                </select>
              {:else}
                <div>
                  <input 
                    type={field.type || 'text'} 
                    step={field.type === 'time' ? '1' : undefined}
                    bind:value={createDraft[field.key]}
                    placeholder={field.placeholder || ''}
                    required={field.required}
                    style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid {(field.key === 'nombre' && duplicateNameError) || (field.key === 'codigo' && reservedCodeCreateError) ? '#ef4444' : '#cbd5e1'}; font-size: 13.5px; color: #0f172a; font-weight: 600; outline: none; background: {(field.key === 'nombre' && duplicateNameError) || (field.key === 'codigo' && reservedCodeCreateError) ? '#fef2f2' : '#ffffff'}; transition: all 0.15s ease;"
                  />
                  {#if field.key === 'nombre' && duplicateNameError}
                    <div style="font-size: 11.5px; font-weight: 700; color: #ef4444; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                      <span>⚠️</span> {duplicateNameError}
                    </div>
                  {/if}
                  {#if field.key === 'codigo' && reservedCodeCreateError}
                    <div style="font-size: 11.5px; font-weight: 700; color: #ef4444; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                      <span>🚫</span> {reservedCodeCreateError}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/each}

        <!-- Actions -->
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">
          <button 
            type="button" 
            on:click={closeCreateModal}
            style="padding: 9px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; font-size: 13px; font-weight: 700; cursor: pointer;">
            Cancelar
          </button>

          <button 
            type="submit" 
            disabled={!!duplicateNameError || !!reservedCodeCreateError}
            style="padding: 9px 18px; border-radius: 8px; border: none; background: {(duplicateNameError || reservedCodeCreateError) ? '#94a3b8' : '#2563eb'}; color: #ffffff; font-size: 13px; font-weight: 800; cursor: {(duplicateNameError || reservedCodeCreateError) ? 'not-allowed' : 'pointer'}; opacity: {(duplicateNameError || reservedCodeCreateError) ? '0.6' : '1'}; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2); transition: all 0.15s ease;">
            {createModalTitle ? 'Guardar' : `Guardar ${toTitleCase(entityType)}`}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Modal para Reincorporar Empleado con Fecha de Ingreso y Nuevo Cargo -->
{#if isReincorporarModalOpen && itemToReincorporar}
  <div 
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease;">
    
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div 
      style="background: #ffffff; border-radius: 14px; max-width: 520px; width: 100%; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); border: 1px solid #e2e8f0; color: #0f172a;"
      on:click|stopPropagation>
      
      <!-- Modal Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #f0fdf4; border-bottom: 1px solid #bbf7d0;">
        <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #166534; display: flex; align-items: center; gap: 8px;">
          <span>🔄</span> Reincorporar Empleado
        </h3>
        <button 
          type="button" 
          on:click={closeReincorporarModal}
          style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid #cbd5e1; background: #ffffff; color: #64748b; font-size: 16px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          ✕
        </button>
      </div>

      <!-- Modal Body Form -->
      <form on:submit|preventDefault={submitReincorporarModal} style="padding: 20px;">
        <!-- Employee Info Summary Card -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
          <div style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden; border: 2px solid #3b82f6; display: flex; align-items: center; justify-content: center; background: #eff6ff; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <img 
              src={getPhotoUrl(itemToReincorporar)} 
              alt="Foto de {toTitleCase(itemToReincorporar.nombre)}"
              style="width: 100%; height: 100%; object-fit: cover;"
              on:error={(e) => { 
                const img = e.target;
                const empId = itemToReincorporar?.empleado_id || itemToReincorporar?.id;
                if (!img.dataset.triedEmp && empId && !img.src.endsWith(`/empleados/${empId}.jpg`)) {
                  img.dataset.triedEmp = 'true';
                  img.src = `/empleados/${empId}.jpg`;
                } else {
                  img.style.display = 'none';
                  if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
                }
              }}
            />
            <div class="fallback-avatar-icon" style="display: none; width: 100%; height: 100%; background: #2563eb; color: #ffffff; font-weight: 800; align-items: center; justify-content: center; font-size: 15px;">
              {getInitials(toTitleCase(itemToReincorporar.nombre), itemToReincorporar.cedula)}
            </div>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 800; color: #0f172a;">{toTitleCase(itemToReincorporar.nombre)}</div>
            <div style="font-size: 12px; color: #64748b; font-weight: 600;">
              Cédula: <strong>{itemToReincorporar.cedula || '—'}</strong> | Sala Anterior: <strong>{itemToReincorporar.sala_nombre || '—'}</strong>
            </div>
          </div>
        </div>

        <!-- Fecha de Ingreso -->
        <div style="margin-bottom: 16px;">
          <label for="reincorporar_fecha_inp" style="display: block; font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
            Fecha de Ingreso *
          </label>
          <input 
            id="reincorporar_fecha_inp"
            type="date" 
            bind:value={reincorporarFecha}
            required
            style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #cbd5e1; font-size: 13.5px; color: #0f172a; font-weight: 600; outline: none; background: #ffffff;"
          />
        </div>

        <!-- Nuevo Cargo Asignado -->
        <div style="margin-bottom: 16px;">
          <label for="reincorporar_cargo_sel" style="display: block; font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
            Nuevo Cargo Asignado *
          </label>
          <select 
            id="reincorporar_cargo_sel"
            bind:value={reincorporarCargoId}
            required
            style="width: 100%; padding: 10px 12px; border-radius: 8px; border: 1.5px solid #cbd5e1; font-size: 13.5px; color: #0f172a; font-weight: 600; outline: none; background: #ffffff;">
            <option value="">-- Seleccionar Nuevo Cargo --</option>
            {#each getGroupedOptions(activeCargosList) as grp}
              {#if grp.label}
                <optgroup label="{grp.label}">
                  {#each grp.items as opt}
                    <option value={opt.id}>{opt.nombre || opt.nombre_comercial}</option>
                  {/each}
                </optgroup>
              {:else}
                {#each grp.items as opt}
                  <option value={opt.id}>{opt.nombre || opt.nombre_comercial}</option>
                {/each}
              {/if}
            {/each}
          </select>
        </div>

        <!-- Form Actions -->
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9;">
          <button 
            type="button" 
            on:click={closeReincorporarModal}
            style="padding: 9px 16px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; font-size: 13px; font-weight: 700; cursor: pointer;">
            Cancelar
          </button>

          <button 
            type="submit" 
            style="padding: 9px 18px; border-radius: 8px; border: none; background: #16a34a; color: #ffffff; font-size: 13px; font-weight: 800; cursor: pointer; box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);">
            Confirmar Reincorporación
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
