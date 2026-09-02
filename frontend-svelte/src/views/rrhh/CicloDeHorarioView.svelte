<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentAsignacionesFilters = writable({
    selectedSalas: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import AsignarEmpleadosCicloModal from '../../components/modals/AsignarEmpleadosCicloModal.svelte';
  import { loadMasterStoresFromBackend, masterSalasStore, userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentAsignacionesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentAsignacionesFilters.set({ selectedSalas, searchQuery });
  }

  // Cascading Facet Options from Backend
  let filterOptions = { salas: [] };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) + selectedSalas.length;

  let items = [];
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sort_by: 'id',
    sort_order: 'asc'
  };

  let isMounted = false;
  let lastFetchedSalaIds = '';

  $: if (isMounted && assignedSalaIds) {
    const currentSalaStr = assignedSalaIds.join(',');
    if (currentSalaStr !== lastFetchedSalaIds) {
      lastFetchedSalaIds = currentSalaStr;
      fetchFilterOptions();
      loadServerData(currentParams);
    }
  }

  onMount(async () => {
    isMounted = true;
    lastFetchedSalaIds = assignedSalaIds.join(',');
    await Promise.all([
      loadMasterStoresFromBackend(),
      fetchFilterOptions(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    if (isMounted) fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/departamentos-ciclos/filter-options?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          filterOptions = json.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching filter options:", e);
    }
  }

  async function loadServerData(params = {}) {
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        page: currentParams.page || 1,
        limit: currentParams.limit || 10,
        search: (currentParams.search !== undefined ? currentParams.search : '').trim(),
        sort_by: currentParams.sort_by || 'id',
        sort_order: currentParams.sort_order || 'asc'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (selectedSalas.length > 0) {
        q.set('sala_ids', selectedSalas.join(','));
      }
      const res = await fetch(`/api/master/departamentos-ciclos?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar departamentos', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    loadServerData({ page: 1, search: "" });
  }

  // Table Columns
  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'departamento_nombre', label: 'DEPARTAMENTO', bold: true, sortable: true, editable: false },
    { key: 'sala_nombre', label: 'SALA', sortable: true, editable: false },
    { key: 'horarios_asignados', label: 'HORARIOS CONFIGURADOS', type: 'departamento_horarios_asignados', sortable: false, editable: false },
    { key: 'total_empleados', label: 'EMPLEADOS', type: 'total_empleados_badge', sortable: false, editable: false },
    { key: 'acciones_ciclos', label: 'ACCIONES', type: 'departamento_ciclos_actions', sortable: false, editable: false }
  ];

  // Employee Assignment Modal State
  let isAsignarModalOpen = false;
  let departmentToAssign = null;

  function openAsignarEmpleadosModal(deptItem) {
    departmentToAssign = deptItem;
    isAsignarModalOpen = true;
  }
</script>

<div class="ciclos-view-container">
  <PaginatedDataTable
    {items}
    {columns}
    {totalCount}
    {currentPage}
    {pageSize}
    isServerSide={true}
    bind:searchQuery
    entityType="Departamento"
    searchPlaceholder="Buscar por departamento, sala..."
    actions={{ edit: false, delete: false }}
    showCheckbox={false}
    on:pageChange={(e) => loadServerData({ page: e.detail.page, limit: e.detail.pageSize })}
    on:pageSizeChange={(e) => loadServerData({ page: 1, limit: e.detail.pageSize })}
    on:search={(e) => loadServerData({ page: 1, search: e.detail.query })}
    on:fetchServerData={(e) => loadServerData({ page: e.detail.page, limit: e.detail.limit, search: e.detail.search, sort_by: e.detail.sortBy, sort_order: e.detail.sortDir })}
    on:sort={(e) => loadServerData({ page: 1, sort_by: e.detail.sortBy, sort_order: e.detail.sortOrder })}
    on:openAsignarEmpleados={(e) => openAsignarEmpleadosModal(e.detail)}
  >
    <div slot="filters" class="smart-filters-grid">
      <SmartMultiSelect
        id="filter-asignaciones-salas"
        label="Salas"
        options={filterOptions.salas}
        bind:selectedValues={selectedSalas}
        on:change={(e) => {
          selectedSalas = e.detail;
          loadServerData({ page: 1 });
        }}
      />
    </div>

    <div slot="search-actions">
      {#if hasActiveFilters}
        <button
          type="button"
          on:click={clearAllFilters}
          style="padding: 7px 14px; font-size: 12px; font-weight: 700; color: #ef4444; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.04); white-space: nowrap;"
          title="Restablecer búsqueda y todos los filtros"
        >
          <span>✕</span> Limpiar Filtros ({totalFilters})
        </button>
      {/if}
    </div>
  </PaginatedDataTable>
</div>

<!-- Modal para Asignación Directa y Masiva de Horarios del Departamento -->
<AsignarEmpleadosCicloModal 
  show={isAsignarModalOpen}
  department={departmentToAssign}
  on:close={() => isAsignarModalOpen = false}
  on:saved={() => loadServerData()}
/>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    align-items: center;
  }
</style>
