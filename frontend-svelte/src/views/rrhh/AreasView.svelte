<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentAreasFilters = writable({
    selectedSalas: [],
    selectedDepartamentos: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { masterAreasActions, masterAreasStore, masterDepartamentosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
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
  const unsubInit = persistentAreasFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let selectedDepartamentos = initial.selectedDepartamentos || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentAreasFilters.set({
      selectedSalas,
      selectedDepartamentos,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: [],
    departamentos: []
  };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0 ||
    selectedDepartamentos.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) +
    selectedSalas.length +
    selectedDepartamentos.length;

  let items = [];
  $: allAreas = $masterAreasStore || [];
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
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDepartamentos.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedDepartamentos.length > 0) q.set("departamento_ids", selectedDepartamentos.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/areas/filter-options?${q.toString()}`);
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
      if (selectedDepartamentos.length > 0) {
        q.set('departamento_ids', selectedDepartamentos.join(','));
      }

      const res = await fetch(`/api/master/areas?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar áreas del servidor', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    selectedDepartamentos = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredDepartamentosStore = ($masterDepartamentosStore || []).filter(d => {
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return !d.sala_id || assignedSalaIds.map(Number).includes(Number(d.sala_id));
  });

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Área', bold: true, sortable: true, editable: true },
    { key: 'departamento_nombre', keyId: 'departamento_id', label: 'Departamento Asignado', sortable: true, editable: true, options: filteredDepartamentosStore },
    { key: 'sala_nombre', label: 'Sala Asignada', sortable: true, editable: false }
  ];

  $: createFields = [
    { key: 'nombre', label: 'Nombre del Área', type: 'text', placeholder: 'Ej. Selección y Reclutamiento', required: true },
    { key: 'departamento_id', label: 'Departamento Asignado', type: 'select', options: filteredDepartamentosStore, required: true }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      await masterAreasActions.add(draft);
      triggerToast('Área creada exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al crear área: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterAreasActions.update(id, draft);
      triggerToast('Área actualizada exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar área: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, item, onResult } = event.detail;
    try {
      const res = await masterAreasActions.delete(id);
      if (res && res.blocked) {
        onResult(res);
      } else {
        triggerToast('Área eliminada exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar área: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    for (const id of ids) {
      try {
        const res = await masterAreasActions.delete(id);
        if (res && res.blocked) {
          onResult(res);
          return;
        }
      } catch (err) {
        triggerToast(`Error al eliminar área ID ${id}: ${err.message}`, 'error');
      }
    }
    triggerToast(`${ids.length} áreas eliminadas en masivo`, 'success');
    onResult({ success: true });
    await loadServerData();
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allAreas}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar áreas por nombre, departamento o ID..."
  entityType="área"
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-areas-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
      on:change={(e) => {
        selectedSalas = e.detail;
        loadServerData({ page: 1 });
      }}
    />

    <SmartMultiSelect
      id="filter-areas-departamentos"
      label="Departamento"
      options={filterOptions.departamentos}
      groupBy="sala_nombre"
      bind:selectedValues={selectedDepartamentos}
      on:change={(e) => {
        selectedDepartamentos = e.detail;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    align-items: center;
  }

  @media (max-width: 768px) {
    .smart-filters-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
