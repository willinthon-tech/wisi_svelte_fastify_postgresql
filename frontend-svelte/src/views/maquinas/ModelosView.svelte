<script context="module">
  import { writable } from "svelte/store";

  export const persistentModelosFilters = writable({
    selectedMarcas: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { 
    masterModelosActions, 
    masterModelosStore, 
    masterMarcasStore, 
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let initial = {};
  const unsubInit = persistentModelosFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let selectedMarcas = initial.selectedMarcas || [];
  let searchQuery = initial.searchQuery || "";

  $: {
    persistentModelosFilters.set({
      selectedMarcas,
      searchQuery
    });
  }

  let filterOptions = {
    marcas: []
  };

  $: hasActiveFilters = Boolean((searchQuery || "").trim() || selectedMarcas.length > 0);
  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) + selectedMarcas.length;

  let items = [];
  $: allModelos = $masterModelosStore || [];
  $: allMarcas = $masterMarcasStore || [];
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
      fetchFilterOptions(),
      loadServerData(currentParams)
    ]);
  });

  // Dynamic cascading facet fetch
  let lastFilterKey = "";
  $: filterKey = `${selectedMarcas.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (selectedMarcas.length > 0) q.set("marca_ids", selectedMarcas.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/modelos/filter-options?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          filterOptions = json.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching filter options in ModelosView:", e);
    }
  }

  async function loadServerData(params = {}) {
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        page: currentParams.page,
        limit: currentParams.limit,
        search: currentParams.search !== undefined ? currentParams.search : searchQuery,
        sortBy: currentParams.sortBy || 'id',
        sortDir: currentParams.sortDir || 'desc'
      });
      if (selectedMarcas.length > 0) {
        q.set('marca_ids', selectedMarcas.join(','));
      }

      const res = await fetch(`/api/master/modelos?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar modelos del servidor', 'error');
    }
  }

  function handleFilterChange() {
    loadServerData({ page: 1 });
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedMarcas = [];
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Modelo', bold: true, sortable: true, editable: true },
    { 
      key: 'marca_nombre', 
      label: 'Marca', 
      sortable: true, 
      editable: true, 
      options: allMarcas, 
      keyId: 'marca_id' 
    }
  ];

  $: createFields = [
    { 
      key: 'nombre', 
      label: 'Nombre del Modelo', 
      type: 'text', 
      placeholder: 'Ej. Helix XT, Wave XL, MarsX, DualScreen...', 
      required: true 
    },
    { 
      key: 'marca_id', 
      label: 'Marca', 
      type: 'select', 
      options: allMarcas, 
      required: true 
    }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      await masterModelosActions.add(draft);
      triggerToast('Modelo creado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al crear modelo: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterModelosActions.update(id, draft);
      triggerToast('Modelo actualizado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar modelo: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    try {
      const res = await masterModelosActions.delete(id);
      if (res && res.blocked) {
        onResult(res);
      } else {
        triggerToast('Modelo eliminado exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar modelo: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterModelosActions.delete(id);
        if (res && res.blocked) {
          blocked.push({
            id,
            name: res.entityName || `ID: ${id}`,
            reason: res.message || 'Tiene elementos asociados en la base de datos',
            dependencies: res.dependencies || []
          });
        } else if (res && (res.success || res.id)) {
          deleted.push({ id });
        } else {
          blocked.push({
            id,
            name: `ID: ${id}`,
            reason: res?.error || 'No se pudo eliminar por restricciones de datos',
            dependencies: []
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
        entityType: 'modelo'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allModelos}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar modelos por nombre, marca o ID..."
  entityType="modelo"
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" style="display: flex; gap: 10px; width: 100%;">
    <div style="flex: 1; width: 100%;">
      <SmartMultiSelect
        id="filter-modelos-marcas"
        label="Marca"
        options={filterOptions.marcas}
        bind:selectedValues={selectedMarcas}
        on:change={handleFilterChange}
      />
    </div>
  </div>

  <div slot="search-actions">
    {#if hasActiveFilters}
      <button
        type="button"
        on:click={clearAllFilters}
        style="padding: 7px 14px; font-size: 12px; font-weight: 700; color: #ef4444; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.04); white-space: nowrap;"
        title="Restablecer filtros"
      >
        <span>✕</span> Limpiar Filtros ({totalFilters})
      </button>
    {/if}
  </div>
</PaginatedDataTable>
