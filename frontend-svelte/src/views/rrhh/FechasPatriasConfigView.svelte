<script context="module">
  import { writable } from "svelte/store";

  export const persistentFechasPatriasFilters = writable({
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import { masterFechasPatriasActions, masterFechasPatriasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let initial = {};
  const unsubInit = persistentFechasPatriasFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let searchQuery = initial.searchQuery || "";

  $: {
    persistentFechasPatriasFilters.set({
      searchQuery
    });
  }

  $: hasActiveFilters = Boolean((searchQuery || "").trim());

  let rawItems = [];
  $: allFechas = $masterFechasPatriasStore || [];
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;

  const mesNombres = {
    1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
    5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
    9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre'
  };

  $: items = rawItems.map(item => ({
    ...item,
    mes_nombre: mesNombres[item.mes] || `Mes ${item.mes}`,
    fecha_formateada: `${String(item.dia).padStart(2, '0')} de ${mesNombres[item.mes] || item.mes}`
  }));

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

      const res = await fetch(`/api/master/fechas-patrias?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        rawItems = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar fechas patrias del servidor', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    loadServerData({ page: 1, search: "" });
  }

  const mesOptions = [
    { id: 1, nombre: 'Enero' },
    { id: 2, nombre: 'Febrero' },
    { id: 3, nombre: 'Marzo' },
    { id: 4, nombre: 'Abril' },
    { id: 5, nombre: 'Mayo' },
    { id: 6, nombre: 'Junio' },
    { id: 7, nombre: 'Julio' },
    { id: 8, nombre: 'Agosto' },
    { id: 9, nombre: 'Septiembre' },
    { id: 10, nombre: 'Octubre' },
    { id: 11, nombre: 'Noviembre' },
    { id: 12, nombre: 'Diciembre' }
  ];

  const diaOptions = Array.from({ length: 31 }, (_, i) => ({
    id: i + 1,
    nombre: String(i + 1).padStart(2, '0')
  }));

  $: columns = [
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'dia', label: 'Día', sortable: true, editable: true, type: 'select', options: diaOptions },
    { key: 'mes', label: 'Mes', sortable: true, editable: true, type: 'select', options: mesOptions, displayKey: 'mes_nombre' },
    { key: 'fecha_formateada', label: 'Fecha Conmemorativa', sortable: false, editable: false },
    { key: 'descripcion', label: 'Descripción / Evento Patrio', bold: true, sortable: true, editable: true }
  ];

  $: createFields = [
    { 
      key: 'dia', 
      label: 'Día', 
      type: 'select', 
      options: diaOptions,
      defaultValue: 1,
      required: true 
    },
    { 
      key: 'mes', 
      label: 'Mes', 
      type: 'select', 
      options: mesOptions,
      defaultValue: 1,
      required: true 
    },
    { key: 'descripcion', label: 'Descripción del Evento o Fecha Patria', type: 'text', placeholder: 'Ej. Día de la Independencia, Batalla de Carabobo...', required: true }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      await masterFechasPatriasActions.add(draft);
      triggerToast('Fecha patria registrada exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al registrar fecha patria: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterFechasPatriasActions.update(id, draft);
      triggerToast('Fecha patria actualizada exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar fecha patria: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    try {
      const res = await masterFechasPatriasActions.delete(id);
      if (res && res.blocked) {
        onResult(res);
      } else {
        triggerToast('Fecha patria eliminada exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar fecha patria: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterFechasPatriasActions.delete(id);
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
        entityType: 'fecha patria'
      });
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allFechas}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar fechas patrias por descripción, día o mes..."
  entityType="fecha patria"
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
