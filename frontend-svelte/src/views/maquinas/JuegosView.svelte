<script context="module">
  import { writable } from "svelte/store";

  export const persistentJuegosMaquinasFilters = writable({
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import { masterJuegosMaquinasActions, masterJuegosMaquinasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let initial = {};
  const unsubInit = persistentJuegosMaquinasFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let searchQuery = initial.searchQuery || "";

  $: {
    persistentJuegosMaquinasFilters.set({
      searchQuery
    });
  }

  $: hasActiveFilters = Boolean((searchQuery || "").trim());

  let items = [];
  $: allJuegos = $masterJuegosMaquinasStore || [];
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

      const res = await fetch(`/api/master/juegos-maquinas?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar juegos de máquinas del servidor', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    loadServerData({ page: 1, search: "" });
  }

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Juego', bold: true, sortable: true, editable: true }
  ];

  $: createFields = [
    { key: 'nombre', label: 'Nombre del Juego', type: 'text', placeholder: 'Ej. 5 Dragons, Buffalo, 88 Fortunes...', required: true }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      await masterJuegosMaquinasActions.add(draft);
      triggerToast('Juego de máquinas creado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al crear juego de máquinas: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterJuegosMaquinasActions.update(id, draft);
      triggerToast('Juego de máquinas actualizado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar juego de máquinas: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    try {
      const res = await masterJuegosMaquinasActions.delete(id);
      if (res && res.blocked) {
        onResult(res);
      } else {
        triggerToast('Juego de máquinas eliminado exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar juego de máquinas: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterJuegosMaquinasActions.delete(id);
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
        entityType: 'juego'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allJuegos}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar juegos de máquinas por nombre o ID..."
  entityType="juego"
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
        on:click={clearAllFilters}
        style="padding: 7px 14px; font-size: 12px; font-weight: 700; color: #ef4444; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.04); white-space: nowrap;"
        title="Restablecer búsqueda"
      >
        <span>✕</span> Limpiar Búsqueda
      </button>
    {/if}
  </div>
</PaginatedDataTable>
