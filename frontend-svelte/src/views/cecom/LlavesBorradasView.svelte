<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentLlavesBorradasFilters = writable({
    selectedSalas: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { 
    masterLlavesActions, 
    masterLlavesStore, 
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentLlavesBorradasFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentLlavesBorradasFilters.set({
      selectedSalas,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: []
  };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) +
    selectedSalas.length;

  let items = [];
  $: allLlavesBorradas = ($masterLlavesStore || []).filter(m => (m.active ?? 1) === 0);
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'id',
    sortDir: 'desc'
  };

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options ONLY when active filters, user assigned salas or search change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams({ active: '0' });
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/llaves/filter-options?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          filterOptions = json.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching filter options from backend:", e);
    }
  }

  async function loadServerData(params = {}) {
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        active: '0',
        page: currentParams.page,
        limit: currentParams.limit,
        search: currentParams.search || '',
        sortBy: currentParams.sortBy || 'id',
        sortDir: currentParams.sortDir || 'desc'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (selectedSalas.length > 0) {
        q.set('sala_ids', selectedSalas.join(','));
      }

      const res = await fetch(`/api/master/llaves?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar llaves borradas del servidor', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre de la Llave', bold: true, sortable: true, editable: false },
    { key: 'sala_nombre', label: 'Sala Asignada', sortable: true, editable: false }
  ];

  async function handleRestore(event) {
    const item = event.detail;
    try {
      await masterLlavesActions.restore(item.id);
      triggerToast(`Llave "${item.nombre}" restaurada exitosamente`, 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al restaurar llave: ${err.message}`, 'error');
    }
  }

  async function handleBatchRestore(event) {
    const ids = event.detail || [];
    let count = 0;
    for (const id of ids) {
      try {
        await masterLlavesActions.restore(id);
        count++;
      } catch (err) {
        console.error(err);
      }
    }
    triggerToast(`${count} llaves restauradas exitosamente`, 'success');
    await loadServerData();
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allLlavesBorradas}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  actions={{ 
    edit: false, 
    delete: false, 
    restore: true, 
    restoreLabel: 'Restaurar'
  }}
  createFields={[]}
  bind:searchQuery
  searchPlaceholder="Buscar llaves borradas por nombre, sala o ID..."
  entityType="llave borrada"
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:restore={handleRestore}
  on:batchRestore={handleBatchRestore}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-llaves-borradas-salas"
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

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    align-items: center;
  }
</style>
