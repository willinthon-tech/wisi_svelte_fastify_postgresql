<script context="module">
  import { writable } from "svelte/store";

  export const persistentRangosFilters = writable({
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import { masterRangosActions, masterRangosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { getLocalItems, saveLocalItems } from '../../services/localDb.service.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let initial = {};
  const unsubInit = persistentRangosFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let searchQuery = initial.searchQuery || "";

  $: {
    persistentRangosFilters.set({
      searchQuery
    });
  }

  $: hasActiveFilters = Boolean((searchQuery || "").trim());

  let items = [];
  $: allRangos = $masterRangosStore || [];
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
    // 1. Carga instantánea (0ms) desde IndexedDB local
    try {
      const local = await getLocalItems('rangos');
      if (Array.isArray(local) && local.length > 0) {
        items = local;
        totalCount = local.length;
      } else if (Array.isArray(allRangos) && allRangos.length > 0) {
        items = allRangos;
        totalCount = allRangos.length;
      }
    } catch (e) {}

    // 2. Carga en segundo plano desde backend
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

      const res = await fetch(`/api/master/rangos?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
        saveLocalItems('rangos', items).catch(() => {});
      }
    } catch (err) {
      console.warn('Fallback local IndexedDB para rangos:', err);
      const local = await getLocalItems('rangos');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterRangosStore || []);
      const q = (currentParams.search || '').trim().toLowerCase();
      const filtered = q ? source.filter(x => (x.nombre || '').toLowerCase().includes(q)) : source;
      totalCount = filtered.length;
      const start = ((currentParams.page || 1) - 1) * (currentParams.limit || 10);
      items = filtered.slice(start, start + (currentParams.limit || 10));
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'uuid', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Rango', bold: true, sortable: true, editable: true }
  ];

  $: createFields = [
    { key: 'nombre', label: 'Nombre del Rango', type: 'text', placeholder: 'Ej. Rango 1, Rango 2, Rango 3...', required: true }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      const created = await masterRangosActions.add(draft);
      triggerToast('Rango creado exitosamente', 'success');
      if (created) {
        items = [created, ...items.filter(x => String(x.uuid || x.id) !== String(created.uuid || created.id))];
        totalCount++;
      }
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(`Error al crear rango: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    const targetUuid = id;
    try {
      await masterRangosActions.update(targetUuid, draft);
      triggerToast('Rango actualizado exitosamente', 'success');
      items = items.map(x => (String(x.uuid || x.id) === String(targetUuid)) ? { ...x, ...draft } : x);
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(`Error al actualizar rango: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, item, onResult } = event.detail;
    const targetUuid = item?.uuid || id || item?.id;
    try {
      const res = await masterRangosActions.delete(targetUuid);
      if (res && res.blocked) {
        if (onResult) {
          onResult(res);
        } else {
          triggerToast(res.message || 'No se puede eliminar porque está vinculado a registros de aportes.', 'warning');
        }
      } else {
        triggerToast(`Rango eliminado exitosamente`, 'success');
        items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
        totalCount = Math.max(0, totalCount - 1);
        if (onResult) onResult({ success: true });
        loadServerData().catch(() => {});
      }
    } catch (err) {
      triggerToast(`Error al eliminar rango: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterRangosActions.delete(id);
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
        entityType: 'rango'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allRangos}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar rangos por nombre o ID..."
  entityType="rango"
  actions={{ edit: true, delete: true }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="search-actions">
    {#if hasActiveFilters}
      <button 
        type="button" 
        class="clear-filters-btn" 
        on:click={clearAllFilters}
        title="Restablecer búsqueda"
      >
        <span>✕</span> Limpiar Búsqueda
      </button>
    {/if}
  </div>
</PaginatedDataTable>

<style>
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
