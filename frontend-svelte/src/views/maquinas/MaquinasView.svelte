<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentMaquinasFilters = writable({
    selectedGrupos: [],
    selectedSalas: [],
    selectedEstados: [],
    selectedModelos: [],
    selectedJuegos: [],
    selectedSociedades: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { masterSalasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Initialize from persistent store
  let initial = {};
  const unsubInit = persistentMaquinasFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedGrupos = initial.selectedGrupos || [];
  let selectedSalas = initial.selectedSalas || [];
  let selectedEstados = initial.selectedEstados || [];
  let selectedModelos = initial.selectedModelos || [];
  let selectedJuegos = initial.selectedJuegos || [];
  let selectedSociedades = initial.selectedSociedades || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentMaquinasFilters.set({
      selectedGrupos,
      selectedSalas,
      selectedEstados,
      selectedModelos,
      selectedJuegos,
      selectedSociedades,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    grupos: [],
    salas: [],
    juegos: [],
    estados: [],
    sociedades: [],
    valores: [],
    modelos: [],
    tipos: [],
    modos: [],
    legales: []
  };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedGrupos.length > 0 ||
    selectedSalas.length > 0 ||
    selectedEstados.length > 0 ||
    selectedModelos.length > 0 ||
    selectedJuegos.length > 0 ||
    selectedSociedades.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) +
    selectedGrupos.length +
    selectedSalas.length +
    selectedEstados.length +
    selectedModelos.length +
    selectedJuegos.length +
    selectedSociedades.length;

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
      loadMasterStoresFromBackend(),
      fetchFilterOptions(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options ONLY when user assigned salas change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));

      const res = await fetch(`/api/master/maquinas/filter-options?${q.toString()}`);
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
        page: currentParams.page || 1,
        limit: currentParams.limit || 10,
        search: currentParams.search !== undefined ? currentParams.search : searchQuery,
        sort_by: currentParams.sortBy || currentParams.sort_by || 'id',
        sort_order: currentParams.sortDir || currentParams.sort_order || 'desc'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (selectedGrupos.length > 0) {
        q.set('grupo_ids', selectedGrupos.join(','));
      }
      if (selectedSalas.length > 0) {
        q.set('sala_ids', selectedSalas.join(','));
      }
      if (selectedEstados.length > 0) {
        q.set('estado_ids', selectedEstados.join(','));
      }
      if (selectedModelos.length > 0) {
        q.set('modelo_ids', selectedModelos.join(','));
      }
      if (selectedJuegos.length > 0) {
        q.set('juego_ids', selectedJuegos.join(','));
      }
      if (selectedSociedades.length > 0) {
        q.set('sociedad_ids', selectedSociedades.join(','));
      }

      const res = await fetch(`/api/master/maquinas?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar máquinas del servidor', 'error');
    }
  }

  function handleFilterChange() {
    loadServerData({ page: 1 });
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedGrupos = [];
    selectedSalas = [];
    selectedEstados = [];
    selectedModelos = [];
    selectedJuegos = [];
    selectedSociedades = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredSalasStore = ($masterSalasStore || []).filter(s => {
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return assignedSalaIds.includes(s.id);
  });

  $: defaultSalaId = (assignedSalaIds && assignedSalaIds.length > 0) ? assignedSalaIds[0] : (filteredSalasStore[0]?.id || 1);

  // Column definitions for PaginatedDataTable
  $: columns = [
    { key: 'id', label: 'N°', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre de Máquina', bold: true, sortable: true, editable: true },
    { key: 'serial', label: 'Serial', bold: true, sortable: true, editable: true },
    { key: 'puestos', label: 'Puestos', type: 'number', sortable: true, editable: true },
    { key: 'grupo_sala_nombre', label: 'Grupo de Sala', sortable: true, editable: false },
    { key: 'sala_nombre', keyId: 'sala_id', label: 'Sala', sortable: true, editable: true, type: 'select', options: filterOptions.salas || [] },
    { key: 'juego_nombre', keyId: 'juego_id', label: 'Juego', sortable: true, editable: true, type: 'select', options: filterOptions.juegos || [] },
    { key: 'estado_nombre', keyId: 'estado_id', label: 'Estado', sortable: true, editable: true, type: 'select', options: filterOptions.estados || [] },
    { key: 'sociedad_nombre', keyId: 'sociedad_id', label: 'Sociedad', sortable: true, editable: true, type: 'select', options: filterOptions.sociedades || [] },
    { key: 'valor_nombre', keyId: 'valor_id', label: 'Valor', sortable: true, editable: true, type: 'select', options: filterOptions.valores || [] },
    { key: 'modelo_nombre', keyId: 'modelo_id', label: 'Modelo', sortable: true, editable: true, type: 'select', options: filterOptions.modelos || [] },
    { key: 'tipo_nombre', keyId: 'tipo_id', label: 'Tipo', sortable: true, editable: true, type: 'select', options: filterOptions.tipos || [] },
    { key: 'modo_nombre', keyId: 'modo_id', label: 'Modo', sortable: true, editable: true, type: 'select', options: filterOptions.modos || [] },
    { key: 'legal_nombre', keyId: 'legal_id', label: 'Legal', sortable: true, editable: true, type: 'select', options: filterOptions.legales || [] }
  ];

  // Create modal form fields with col-6 row for nombre and serial
  $: createFields = [
    {
      type: 'row',
      fields: [
        { key: 'nombre', label: 'Nombre de Máquina', type: 'text', placeholder: 'Ej. MAQ-001 / Buffalo Gold', required: true },
        { key: 'serial', label: 'Serial de Máquina', type: 'text', placeholder: 'Ej. SN-89234812', required: true }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'puestos', label: 'Puestos', type: 'number', placeholder: '1', defaultValue: 1, min: 1, required: true },
        { key: 'sala_id', label: 'Sala Asignada', type: 'select', options: filterOptions.salas || filteredSalasStore, required: true, defaultValue: defaultSalaId }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'juego_id', label: 'Juego', type: 'select', options: filterOptions.juegos || [], required: false },
        { key: 'estado_id', label: 'Estado', type: 'select', options: filterOptions.estados || [], required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'sociedad_id', label: 'Sociedad', type: 'select', options: filterOptions.sociedades || [], required: false },
        { key: 'valor_id', label: 'Valor', type: 'select', options: filterOptions.valores || [], required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'modelo_id', label: 'Modelo', type: 'select', options: filterOptions.modelos || [], required: false },
        { key: 'tipo_id', label: 'Tipo', type: 'select', options: filterOptions.tipos || [], required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'modo_id', label: 'Modo', type: 'select', options: filterOptions.modos || [], required: false },
        { key: 'legal_id', label: 'Legal', type: 'select', options: filterOptions.legales || [], required: false }
      ]
    }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      const res = await fetch('/api/master/maquinas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Máquina registrada exitosamente', 'success');
        await loadServerData({ page: 1 });
      } else {
        throw new Error(json.error || 'Error al guardar máquina');
      }
    } catch (err) {
      triggerToast(`Error al crear: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      const res = await fetch(`/api/master/maquinas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Máquina actualizada exitosamente', 'success');
        await loadServerData();
      } else {
        throw new Error(json.error || 'Error al actualizar máquina');
      }
    } catch (err) {
      triggerToast(`Error al actualizar: ${err.message}`, 'error');
      await loadServerData();
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    try {
      const res = await fetch(`/api/master/maquinas/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        triggerToast('Máquina eliminada exitosamente', 'success');
        if (onResult) onResult({ success: true });
        await loadServerData();
      } else if (json && json.blocked) {
        if (onResult) onResult(json);
      } else {
        triggerToast(json.message || json.error || 'No se pudo eliminar la máquina', 'error');
        if (onResult) onResult({ error: true, message: json.message || json.error });
      }
    } catch (err) {
      triggerToast(`Error al eliminar: ${err.message}`, 'error');
      if (onResult) onResult({ error: true });
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await fetch(`/api/master/maquinas/${id}`, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) {
          deleted.push({ id });
        } else if (json && json.blocked) {
          blocked.push({
            id,
            name: json.entityName || `ID: ${id}`,
            reason: json.message || 'Tiene registros dependientes vinculados',
            dependencies: json.dependencies || []
          });
        } else {
          errors.push({ id, reason: json.message || json.error || 'Error al eliminar registro' });
        }
      } catch (err) {
        errors.push({ id, reason: err.message });
      }
    }

    await loadServerData();

    if (onResult) {
      onResult({
        deleted,
        blocked,
        errors,
        total: ids.length,
        entityType: 'máquina'
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
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar por nombre, serial, sala, juego, modelo..."
  entityType="máquina"
  createModalTitle="Agregar Máquina"
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-maquinas-grupos"
      label="Grupo de Sala"
      options={filterOptions.grupos}
      bind:selectedValues={selectedGrupos}
      on:change={handleFilterChange}
    />

    <SmartMultiSelect
      id="filter-maquinas-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
      on:change={handleFilterChange}
    />

    <SmartMultiSelect
      id="filter-maquinas-estados"
      label="Estados"
      options={filterOptions.estados}
      bind:selectedValues={selectedEstados}
      on:change={handleFilterChange}
    />

    <SmartMultiSelect
      id="filter-maquinas-modelos"
      label="Modelos"
      options={filterOptions.modelos}
      bind:selectedValues={selectedModelos}
      on:change={handleFilterChange}
    />

    <SmartMultiSelect
      id="filter-maquinas-juegos"
      label="Juegos"
      options={filterOptions.juegos}
      bind:selectedValues={selectedJuegos}
      on:change={handleFilterChange}
    />

    <SmartMultiSelect
      id="filter-maquinas-sociedades"
      label="Sociedades"
      options={filterOptions.sociedades}
      bind:selectedValues={selectedSociedades}
      on:change={handleFilterChange}
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
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
    width: 100%;
    align-items: center;
  }
</style>
