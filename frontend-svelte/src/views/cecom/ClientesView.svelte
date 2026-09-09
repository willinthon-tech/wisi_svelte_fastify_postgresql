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
  import ClienteFormModal from '../../components/modals/ClienteFormModal.svelte';
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
  let isFormModalOpen = false;
  let formModalItem = null;

  function openCreateFormModal() {
    formModalItem = null;
    isFormModalOpen = true;
  }

  function openEditFormModal(e) {
    formModalItem = e.detail || null;
    isFormModalOpen = true;
  }

  $: tipoClientesOptions = ($masterTipoClientesStore || []).map(t => ({
    id: t.id,
    nombre: t.nombre
  }));

  $: columns = [
    { key: 'foto', label: 'Foto', type: 'photo', sortable: false, editable: false },
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Cliente', bold: true, sortable: true, editable: false },
    { 
      key: 'tipo_cliente_nombre', 
      keyId: 'tipo_cliente_id', 
      label: 'Tipo de Cliente', 
      sortable: true, 
      editable: false, 
      options: tipoClientesOptions 
    },
    { 
      key: 'sala_nombre', 
      keyId: 'sala_id', 
      label: 'Sala', 
      sortable: true, 
      editable: false, 
      options: filteredSalasStore 
    },
    { 
      key: 'descripcion', 
      label: 'Descripción', 
      sortable: false, 
      editable: false 
    }
  ];

  async function handleCreate(event) {
    const detail = event.detail || {};
    const onDone = detail.onDone;
    const { onDone: _, ...draft } = detail;
    try {
      const res = await fetch('/api/master/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Cliente creado exitosamente', 'success');
        isFormModalOpen = false;
        formModalItem = null;
        if (onDone) onDone(null);
        await loadMasterStoresFromBackend();
        await loadServerData();
      } else {
        throw new Error(json?.error || 'Error al crear cliente');
      }
    } catch (err) {
      triggerToast(`Error al crear cliente: ${err.message}`, 'error');
      if (onDone) onDone(err);
    }
  }

  async function handleSaveInline(event) {
    const detail = event.detail || {};
    const { id, draft } = detail;
    const onDone = draft?.onDone || detail.onDone;
    const cleanDraft = { ...draft };
    delete cleanDraft.onDone;
    try {
      const res = await fetch(`/api/master/clientes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanDraft)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Cliente actualizado exitosamente', 'success');
        isFormModalOpen = false;
        formModalItem = null;
        if (onDone) onDone(null);
        await loadMasterStoresFromBackend();
        await loadServerData();
      } else {
        throw new Error(json?.error || 'Error al actualizar cliente');
      }
    } catch (err) {
      triggerToast(`Error al actualizar cliente: ${err.message}`, 'error');
      if (onDone) onDone(err);
    }
  }

  async function handleDelete(event) {
    const { id, item, onResult } = event.detail;
    try {
      const res = await masterClientesActions.delete(id || item?.id);
      if (res && res.blocked) {
        if (onResult) {
          onResult(res);
        } else {
          triggerToast(res.message || 'No se puede eliminar el cliente porque tiene registros vinculados en el libro.', 'warning');
        }
      } else {
        triggerToast(`Cliente eliminado exitosamente`, 'success');
        if (onResult) onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar cliente: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterClientesActions.delete(id);
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
        entityType: 'cliente'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={$masterClientesStore || []}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  createFields={[]}
  customCreateModal={true}
  bind:searchQuery
  searchPlaceholder="Buscar por cliente, tipo, sala o ID..."
  entityType="cliente"
  actions={{ edit: true, editModal: true, delete: true }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:openModal={openCreateFormModal}
  on:openEdit={openEditFormModal}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-clientes-salas"
      label="Salas"
      options={(filterOptions.salas || []).filter(s => !assignedSalaIds || assignedSalaIds.length === 0 || assignedSalaIds.map(Number).includes(Number(s.id)))}
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

  <div slot="search-actions">
    {#if hasActiveFilters}
      <button 
        type="button" 
        class="clear-filters-btn" 
        on:click={clearAllFilters}
        title="Restablecer búsqueda y filtros"
      >
        <span>✕</span> Limpiar Búsqueda
      </button>
    {/if}
  </div>
</PaginatedDataTable>

<ClienteFormModal 
  bind:isOpen={isFormModalOpen}
  item={formModalItem}
  {assignedSalaIds}
  on:create={handleCreate}
  on:update={handleSaveInline}
  on:close={() => { isFormModalOpen = false; formModalItem = null; }}
/>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    width: 100%;
  }

  .clear-filters-btn {
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
  .clear-filters-btn:hover {
    background: #fee2e2;
    border-color: #f87171;
  }
</style>
