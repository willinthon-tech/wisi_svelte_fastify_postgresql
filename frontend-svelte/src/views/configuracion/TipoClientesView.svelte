<script context="module">
  import { writable } from "svelte/store";

  export const persistentTipoClientesFilters = writable({
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import { masterTipoClientesActions, masterTipoClientesStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let initial = {};
  const unsubInit = persistentTipoClientesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let searchQuery = initial.searchQuery || "";

  $: {
    persistentTipoClientesFilters.set({
      searchQuery
    });
  }

  $: hasActiveFilters = Boolean((searchQuery || "").trim());

  let items = [];
  $: allTipoClientes = $masterTipoClientesStore || [];
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

      const res = await fetch(`/api/master/tipo-clientes?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar tipos de clientes del servidor', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Tipo de Cliente', bold: true, sortable: true, editable: true }
  ];

  $: createFields = [
    { key: 'nombre', label: 'Tipo de Cliente', type: 'text', placeholder: 'Ej. VIP, Regular, Ocasional, Nuevo...', required: true }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      await masterTipoClientesActions.add(draft);
      triggerToast('Tipo de cliente creado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al crear tipo de cliente: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterTipoClientesActions.update(id, draft);
      triggerToast('Tipo de cliente actualizado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar tipo de cliente: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const item = event.detail;
    try {
      const res = await masterTipoClientesActions.delete(item.id);
      if (res && res.blocked) {
        triggerToast(res.message || 'No se puede eliminar porque tiene clientes vinculados.', 'warning');
        return;
      }
      triggerToast(`Tipo de cliente ${item.nombre} eliminado exitosamente`, 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al eliminar tipo de cliente: ${err.message}`, 'error');
    }
  }
</script>

<PaginatedDataTable 
  bind:items
  existingItems={allTipoClientes}
  {createFields}
  bind:totalCount
  bind:currentPage
  bind:pageSize
  isServerSide={true}
  {columns}
  bind:searchQuery
  searchPlaceholder="Buscar por nombre o ID..."
  entityType="tipo de cliente"
  actions={{ edit: true, delete: true }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
>
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
