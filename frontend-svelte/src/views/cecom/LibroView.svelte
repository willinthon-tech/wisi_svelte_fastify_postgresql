<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentLibrosFilters = writable({
    selectedSalas: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { 
    masterLibrosActions, 
    masterLibrosStore, 
    masterSalasStore, 
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { navigateToRoute } from '../../controllers/router.store.js';
  import { getPublicWebUrl } from '../../config/api.config.js';
  import { getLocalItems, saveLocalItems } from '../../services/localDb.service.js';

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.uuid ? (userSalasMap[$currentUserStore.uuid] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas.map(String)
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => String(typeof s === 'object' ? (s.uuid || s.id) : s)) : []);

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentLibrosFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentLibrosFilters.set({
      selectedSalas,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: []
  };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) +
    selectedSalas.length;

  let items = [];
  $: allLibros = $masterLibrosStore || [];
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
    // 1. Carga instantánea (0ms) desde IndexedDB local (filtrada por salas asignadas para evitar pestañeo)
    try {
      const local = await getLocalItems('libros');
      let source = (Array.isArray(local) && local.length > 0) ? local : allLibros;
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        source = source.filter(item => {
          const sId = String(item.sala_uuid || item.sala_id || '');
          return !sId || assignedSalaIds.includes(sId);
        });
      }
      if (source && source.length > 0) {
        items = source.slice(0, currentParams.limit || 10);
        totalCount = source.length;
      }
    } catch (e) {}

    // 2. Carga en segundo plano
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options ONLY when active filters, user assigned salas or search change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/libros/filter-options?${q.toString()}`);
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

      const res = await fetch(`/api/master/libros?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
        saveLocalItems('libros', items).catch(() => {});
      }
    } catch (err) {
      console.warn('Fallback local IndexedDB para libros:', err);
      const local = await getLocalItems('libros');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterLibrosStore || []);
      const q = (currentParams.search || '').trim().toLowerCase();
      const filtered = q ? source.filter(x => (x.descripcion || '').toLowerCase().includes(q)) : source;
      totalCount = filtered.length;
      const start = ((currentParams.page || 1) - 1) * (currentParams.limit || 10);
      items = filtered.slice(start, start + (currentParams.limit || 10));
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredSalasStore = ($masterSalasStore || []).filter(s => {
    if (s.grupo_id && Number(s.grupo_id) === 2) return false;
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return assignedSalaIds.includes(String(s.uuid || s.id));
  });

  $: columns = [
    { key: 'uuid', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'descripcion', label: 'Fecha', type: 'date', bold: true, sortable: true, editable: true },
    { key: 'sala_nombre', keyId: 'sala_uuid', label: 'Sala Asignada', sortable: true, editable: false }
  ];

  $: createFields = [
    { key: 'descripcion', label: 'Fecha', type: 'date', required: true },
    { key: 'sala_uuid', label: 'Sala Asignada', type: 'select', options: filteredSalasStore, required: true }
  ];

  async function handleCreate(event) {
    const draft = { ...event.detail };
    if (draft.sala_uuid && !draft.sala_id) draft.sala_id = draft.sala_uuid;
    try {
      const created = await masterLibrosActions.add(draft);
      triggerToast('Libro creado exitosamente', 'success');
      if (created) {
        items = [created, ...items.filter(x => String(x.uuid || x.id) !== String(created.uuid || created.id))];
        totalCount++;
      }
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(`Error al crear libro: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    const targetUuid = id;
    const payload = { ...draft };
    if (payload.sala_uuid && !payload.sala_id) payload.sala_id = payload.sala_uuid;
    try {
      await masterLibrosActions.update(targetUuid, payload);
      triggerToast('Libro actualizado exitosamente', 'success');
      items = items.map(x => (String(x.uuid || x.id) === String(targetUuid)) ? { ...x, ...payload } : x);
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(`Error al actualizar libro: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, item, onResult } = event.detail;
    const targetUuid = item?.uuid || id || item?.id;
    try {
      const res = await masterLibrosActions.delete(targetUuid);
      if (res && res.blocked) {
        if (onResult) {
          onResult(res);
        } else {
          triggerToast(res.message || 'No se puede eliminar el libro.', 'warning');
        }
      } else {
        triggerToast('Libro eliminado exitosamente', 'success');
        items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
        totalCount = Math.max(0, totalCount - 1);
        if (onResult) onResult({ success: true });
        loadServerData().catch(() => {});
      }
    } catch (err) {
      triggerToast(`Error al eliminar libro: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await masterLibrosActions.delete(id);
        if (res && res.blocked) {
          blocked.push({
            id,
            name: res.entityName || `ID: ${id}`,
            reason: res.message || 'Tiene elementos asociados en la base de datos',
            dependencies: res.dependencies || []
          });
        } else if (res && (res.success || res.id)) {
          deleted.push({ id });
          items = items.filter(x => String(x.id) !== String(id) && String(x.uuid) !== String(id));
          totalCount = Math.max(0, totalCount - 1);
        } else {
          blocked.push({
            id,
            name: `ID: ${id}`,
            reason: res?.error || 'No se pudo eliminar',
            dependencies: []
          });
        }
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    loadServerData().catch(() => {});

    if (onResult) {
      onResult({
        deleted,
        blocked,
        errors,
        total: ids.length,
        entityType: 'libro'
      });
    }
  }

  function handleTrabajarLibro(event) {
    const item = event.detail;
    const targetUuid = item?.uuid || item?.id;
    if (targetUuid) {
      navigateToRoute(`cecom/libro/${targetUuid}`);
    }
  }

  async function handleCompartirLibro(event) {
    const item = event.detail;
    const targetUuid = item?.uuid || item?.id;
    if (!item || !targetUuid) return;
    const shareUrl = getPublicWebUrl(`/#/reportes/cecom/libro/${targetUuid}`);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      triggerToast(`Enlace del reporte de libro #${item.codigo || (item.uuid ? item.uuid.slice(0, 8) : item.id)} copiado al portapapeles`, 'success');
    } catch (e) {
      prompt('Copia el siguiente enlace del reporte:', shareUrl);
    }
  }
</script>

<PaginatedDataTable 
  {items}
  existingItems={allLibros}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar libros por fecha, sala o ID..."
  entityType="libro"
  uniqueByField="sala_id"
  actions={{ 
    trabajar: true,
    trabajarLabel: 'Trabajar',
    edit: true, 
    editLabel: 'Editar Fecha',
    compartir: false,
    delete: false 
  }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:trabajar={handleTrabajarLibro}
  on:compartir={handleCompartirLibro}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-libros-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
      on:change={(e) => {
        selectedSalas = e.detail;
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
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    align-items: center;
  }
</style>
