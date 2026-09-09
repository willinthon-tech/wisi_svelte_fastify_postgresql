<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentClientesFilters = writable({
    selectedSalas: [],
    selectedTipoClientes: [],
    searchQuery: ""
  });
</script>

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

  import { onMount, onDestroy } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { 
    masterSalasStore,
    masterTipoClientesStore,
    masterClientesStore,
    masterClientesActions,
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  // Extract assigned sala IDs strictly for the logged-in user
  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const userId = user?.id || 1;

    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    const masterMap = $masterUserSalasStore;
    if (
      masterMap &&
      typeof masterMap === "object" &&
      !Array.isArray(masterMap)
    ) {
      const userList = masterMap[userId] || masterMap[String(userId)];
      if (Array.isArray(userList)) {
        return userList
          .map((s) => (typeof s === "object" ? s.id : Number(s)))
          .filter(Boolean);
      }
    }

    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    return [];
  })();

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentClientesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State (Only 2: Salas and Tipo Cliente)
  let selectedSalas = initial.selectedSalas || [];
  let selectedTipoClientes = initial.selectedTipoClientes || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentClientesFilters.set({
      selectedSalas,
      selectedTipoClientes,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: [],
    tipo_clientes: []
  };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0 ||
    selectedTipoClientes.length > 0
  );

  let items = [];
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;
  let loading = false;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'id',
    sortDir: 'desc'
  };

  let unsubscribeClientesStore;
  let isMounted = false;

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadServerData(currentParams)
    ]);
    isMounted = true;

    // Reactividad en tiempo real: si cambia masterClientesStore al crear/eliminar, recargar automáticamente
    let lastLen = ($masterClientesStore || []).length;
    unsubscribeClientesStore = masterClientesStore.subscribe((list) => {
      if (!isMounted) return;
      const currentLen = (list || []).length;
      if (currentLen !== lastLen) {
        lastLen = currentLen;
        loadServerData();
        fetchFilterOptions();
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeClientesStore) unsubscribeClientesStore();
  });

  // Fetch filter options ONLY when active filters, user assigned salas or search change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedTipoClientes.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedTipoClientes.length > 0) q.set("tipo_cliente_ids", selectedTipoClientes.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/clientes/filter-options?${q.toString()}`);
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
    loading = true;
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
      if (selectedTipoClientes.length > 0) {
        q.set('tipo_cliente_ids', selectedTipoClientes.join(','));
      }

      const res = await fetch(`/api/master/clientes?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar clientes del servidor', 'error');
    } finally {
      loading = false;
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    selectedTipoClientes = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredSalasStore = ($masterSalasStore || []).filter(s => {
    if (s.grupo_id && Number(s.grupo_id) === 2) return false;
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return assignedSalaIds.includes(s.id);
  });

  $: tipoClientesOptions = ($masterTipoClientesStore || []).map(t => ({
    id: t.id,
    nombre: t.nombre
  }));

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Cliente', bold: true, sortable: true, editable: true },
    { 
      key: 'tipo_cliente_nombre', 
      keyId: 'tipo_cliente_id', 
      label: 'Tipo de Cliente', 
      sortable: true, 
      editable: true, 
      options: tipoClientesOptions 
    },
    { 
      key: 'sala_nombre', 
      keyId: 'sala_id', 
      label: 'Sala', 
      sortable: true, 
      editable: true, 
      options: filteredSalasStore 
    }
  ];

  $: createFields = [
    { key: 'nombre', label: 'Nombre del Cliente', type: 'text', required: true, placeholder: 'Ej: Juan Pérez' },
    { key: 'tipo_cliente_id', label: 'Tipo de Cliente', type: 'select', options: tipoClientesOptions, required: true },
    { key: 'sala_id', label: 'Sala', type: 'select', options: filteredSalasStore, required: true }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      await masterClientesActions.add(draft);
      triggerToast('Cliente creado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al crear cliente: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterClientesActions.update(id, draft);
      triggerToast('Cliente actualizado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar cliente: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const item = event.detail;
    try {
      const res = await masterClientesActions.delete(item.id);
      if (res && res.blocked) {
        triggerToast(res.message || 'No se puede eliminar el cliente porque tiene registros vinculados en el libro.', 'warning');
        return;
      }
      triggerToast(`Cliente ${toTitleCase(item.nombre)} eliminado exitosamente`, 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al eliminar cliente: ${err.message}`, 'error');
    }
  }
</script>

<PaginatedDataTable 
  bind:items
  existingItems={$masterClientesStore || []}
  {createFields}
  bind:totalCount
  bind:currentPage
  bind:pageSize
  isServerSide={true}
  {columns}
  bind:searchQuery
  searchPlaceholder="Buscar por cliente, tipo, sala o ID..."
  entityType="cliente"
  actions={{ edit: true, delete: true }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-clientes-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
      on:change={(e) => {
        selectedSalas = e.detail;
        loadServerData({ page: 1 });
      }}
    />

    <SmartMultiSelect
      id="filter-clientes-tipo"
      label="Tipo de Cliente"
      options={filterOptions.tipo_clientes}
      bind:selectedValues={selectedTipoClientes}
      on:change={(e) => {
        selectedTipoClientes = e.detail;
        loadServerData({ page: 1 });
      }}
    />
  </div>

  <div slot="clear-filters">
    {#if hasActiveFilters}
      <button 
        type="button" 
        class="clear-filters-btn" 
        on:click={clearAllFilters}
        title="Restablecer filtros"
      >
        <span class="clear-icon">✕</span>
        <span>Limpiar filtros</span>
      </button>
    {/if}
  </div>
</PaginatedDataTable>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    width: 100%;
  }

  .clear-filters-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    color: #ef4444;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .clear-filters-btn:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
  }
  .clear-icon {
    font-size: 11px;
    font-weight: 700;
  }
</style>
