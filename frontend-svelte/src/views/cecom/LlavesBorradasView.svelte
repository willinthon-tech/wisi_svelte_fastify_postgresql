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

  import { getLocalItems, saveLocalItems } from '../../services/localDb.service.js';

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUid = $currentUserStore?.uuid || $currentUserStore?.id;
  $: currentUserSalas = currentUid ? (userSalasMap[currentUid] || userSalasMap[String(currentUid)] || ($currentUserStore?.id ? userSalasMap[$currentUserStore.id] : null) || []) : [];
  $: assignedSalaIds = ((currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => typeof s === 'object' ? (s.uuid || s.id) : s) : [])).map(String);

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
  let isLoading = true;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'id',
    sortDir: 'desc'
  };

  onMount(async () => {
    isLoading = true;
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
    isLoading = true;
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !json.success) throw new Error(json?.message || 'Error en respuesta');

      items = json.data || [];
      totalCount = json.total || 0;
      currentPage = json.page || 1;
      pageSize = json.limit || 10;
    } catch (err) {
      console.warn('Fallback local IndexedDB para llaves borradas:', err);
      const local = await getLocalItems('llaves_borradas', null, 'created_at', 'desc');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterLlavesStore || []).filter(m => (m.active ?? 1) === 0);
      const q = (currentParams.search || '').trim().toLowerCase();
      const filtered = q ? source.filter(x => (x.nombre || '').toLowerCase().includes(q)) : source;
      totalCount = filtered.length;
      const start = ((currentParams.page || 1) - 1) * (currentParams.limit || 10);
      items = filtered.slice(start, start + (currentParams.limit || 10));
    } finally {
      isLoading = false;
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'uuid', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre de la Llave', bold: true, sortable: true, editable: false },
    { key: 'sala_nombre', label: 'Sala Asignada', sortable: true, editable: false }
  ];

  async function handleRestore(event) {
    const item = event.detail;
    const targetUuid = item?.uuid || item?.id;
    try {
      await masterLlavesActions.restore(targetUuid);
      triggerToast(`Llave "${item.nombre}" restaurada exitosamente`, 'success');
      items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
      totalCount = Math.max(0, totalCount - 1);
      loadServerData().catch(() => {});
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
    items = items.filter(x => !ids.some(id => String(id) === String(x.id) || String(id) === String(x.uuid)));
    totalCount = Math.max(0, totalCount - count);
    loadServerData().catch(() => {});
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allLlavesBorradas}
  {totalCount}
  {currentPage}
  {pageSize}
  {isLoading}
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
