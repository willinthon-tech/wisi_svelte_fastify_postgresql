<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentCortesFilters = writable({
    selectedSalas: [],
    searchQuery: ""
  });

  // Store del corte activo para la subvista de cálculos
  export const selectedCorteStore = writable(null);
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import CorteEmpleadosModal from '../../components/modals/CorteEmpleadosModal.svelte';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let showEmpleadosModal = false;
  let selectedCorteParaEmpleados = null;

  function handleVerEmpleadosCorte(event) {
    selectedCorteParaEmpleados = event.detail;
    showEmpleadosModal = true;
  }

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Initialize from persistent store
  let initial = {};
  const unsubInit = persistentCortesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let selectedSalas = initial.selectedSalas || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store
  $: {
    persistentCortesFilters.set({
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

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) + selectedSalas.length;

  let items = [];
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
      fetchFilterOptions(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options when active filters change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/cortes/filter-options?${q.toString()}`);
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

      const res = await fetch(`/api/master/cortes?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = (json.data || []).map(item => ({
          ...item,
          sala_nombre: item.sala_nombre || 'General / Consolidado',
          fecha_rango: `${formatDate(item.fecha_desde)} al ${formatDate(item.fecha_hasta)}`
        }));
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar cortes históricos del servidor', 'error');
    }
  }

  function formatDate(dStr) {
    if (!dStr) return '';
    const parts = String(dStr).split('T')[0].split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dStr;
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'fecha_rango', label: 'Período Evaluado', sortable: true, editable: false },
    { key: 'sala_nombre', label: 'Sala Asignada', sortable: true, editable: false },
    { key: 'total_empleados', label: 'Empleados', type: 'corte_empleados_badge', sortable: true, editable: false },
    { key: 'calculos_btn', label: 'Reporte', type: 'corte_actions', editable: false }
  ];

  function handleVerCalculos(event) {
    const corte = event.detail;
    selectedCorteStore.set(corte);
    // Navegar a la subruta de cálculos
    navigateToRoute(`rrhh/cortes/calculos?id=${corte.id}`);
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    try {
      const res = await fetch(`/api/master/cortes/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Corte histórico eliminado exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      } else {
        triggerToast(json?.error || 'Error al eliminar el corte', 'error');
      }
    } catch (err) {
      triggerToast(`Error al eliminar corte: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await fetch(`/api/master/cortes/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json && json.success) {
          deleted.push({ id });
        } else {
          blocked.push({
            id,
            name: `Corte #${id}`,
            reason: json?.error || 'Error al eliminar registro'
          });
        }
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    await loadServerData();

    if (onResult) {
      onResult({
        deleted,
        blocked,
        errors,
        total: ids.length,
        entityType: 'corte'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={items}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  createFields={[]}
  bind:searchQuery
  searchPlaceholder="Buscar cortes por sala o ID..."
  entityType="corte"
  actions={{ edit: false, delete: true }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
  on:verCalculos={handleVerCalculos}
  on:verEmpleadosCorte={handleVerEmpleadosCorte}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-cortes-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
      on:change={(e) => {
        selectedSalas = e.detail;
        loadServerData({ page: 1 });
      }}
    />
  </div>

  {#if hasActiveFilters}
    <div slot="search-actions" class="search-actions-row">
      <button
        type="button"
        on:click={clearAllFilters}
        class="btn-clear-filters"
        title="Restablecer búsqueda y todos los filtros"
      >
        <span>✕</span> Limpiar Filtros ({totalFilters})
      </button>
    </div>
  {/if}
</PaginatedDataTable>

<CorteEmpleadosModal
  isOpen={showEmpleadosModal}
  corte={selectedCorteParaEmpleados}
  on:close={() => {
    showEmpleadosModal = false;
    selectedCorteParaEmpleados = null;
  }}
/>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    align-items: center;
  }

  .search-actions-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .btn-clear-filters {
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 700;
    color: #ef4444;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    background: #fef2f2;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    white-space: nowrap;
  }
</style>
