<script context="module">
  import { writable } from "svelte/store";

  export const persistentExcepcionesFilters = writable({
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import { masterExcepcionesActions, masterExcepcionesStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  import { getLocalItems, saveLocalItems } from '../../services/localDb.service.js';

  let initial = {};
  const unsubInit = persistentExcepcionesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let searchQuery = initial.searchQuery || "";

  $: {
    persistentExcepcionesFilters.set({
      searchQuery
    });
  }

  $: hasActiveFilters = Boolean((searchQuery || "").trim());

  let items = [];
  $: allExcepciones = $masterExcepcionesStore || [];
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
      const local = await getLocalItems('excepciones');
      if (Array.isArray(local) && local.length > 0) {
        items = local;
        totalCount = local.length;
      } else if (Array.isArray(allExcepciones) && allExcepciones.length > 0) {
        items = allExcepciones;
        totalCount = allExcepciones.length;
      }
    } catch (e) {}

    // 2. Carga en segundo plano
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

      const res = await fetch(`/api/master/excepciones?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
        saveLocalItems('excepciones', items).catch(() => {});
      }
    } catch (err) {
      console.warn('Fallback local IndexedDB para excepciones:', err);
      const local = await getLocalItems('excepciones');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterExcepcionesStore || []);
      const q = (currentParams.search || '').trim().toLowerCase();
      const filtered = q ? source.filter(x => (x.codigo || '').toLowerCase().includes(q) || (x.descripcion || '').toLowerCase().includes(q)) : source;
      totalCount = filtered.length;
      const start = ((currentParams.page || 1) - 1) * (currentParams.limit || 10);
      items = filtered.slice(start, start + (currentParams.limit || 10));
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    loadServerData({ page: 1, search: "" });
  }

  const tipoOptions = [
    { id: 'Asignable', nombre: 'Asignable' },
    { id: 'No Asignable', nombre: 'No Asignable' }
  ];

  $: columns = [
    { key: 'uuid', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'codigo', label: 'Código', bold: true, sortable: true, editable: true },
    { key: 'descripcion', label: 'Descripción', sortable: true, editable: true },
    { key: 'color', label: 'COLOR DE IDENTIFICACIÓN', type: 'color', sortable: true, editable: true },
    { key: 'tipo', label: 'Tipo', sortable: true, editable: true, type: 'select', options: tipoOptions }
  ];

  $: createFields = [
    { key: 'codigo', label: 'Código de Excepción', type: 'text', placeholder: 'Ej. EXC-01, MEDICO, PERMISO...', required: true },
    { key: 'descripcion', label: 'Descripción de Excepción', type: 'text', placeholder: 'Ej. Permiso Médico con reposo...', required: true },
    { key: 'color', label: 'COLOR DE IDENTIFICACIÓN', type: 'color', placeholder: '#000000', defaultValue: '#000000', required: true },
    { 
      key: 'tipo', 
      label: 'Tipo de Excepción', 
      type: 'select', 
      options: tipoOptions,
      defaultValue: 'Asignable',
      required: true 
    }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      const created = await masterExcepcionesActions.add(draft);
      triggerToast('Excepción creada exitosamente', 'success');
      if (created) {
        items = [created, ...items.filter(x => String(x.uuid || x.id) !== String(created.uuid || created.id))];
        totalCount++;
      }
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(err.message?.startsWith('El código') ? err.message : `Error al crear excepción: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    const targetUuid = id;
    try {
      await masterExcepcionesActions.update(targetUuid, draft);
      triggerToast('Excepción actualizada exitosamente', 'success');
      items = items.map(x => (String(x.uuid || x.id) === String(targetUuid)) ? { ...x, ...draft } : x);
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(err.message?.startsWith('El código') ? err.message : `Error al actualizar excepción: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    const targetUuid = id;
    try {
      const res = await masterExcepcionesActions.delete(targetUuid);
      if (res && res.blocked) {
        onResult(res);
      } else {
        triggerToast('Excepción eliminada exitosamente', 'success');
        items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
        totalCount = Math.max(0, totalCount - 1);
        if (onResult) onResult({ success: true });
        loadServerData().catch(() => {});
      }
    } catch (err) {
      triggerToast(`Error al eliminar excepción: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterExcepcionesActions.delete(id);
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
        entityType: 'excepcion'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allExcepciones}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar excepciones por código, descripción o tipo..."
  entityType="excepción"
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
