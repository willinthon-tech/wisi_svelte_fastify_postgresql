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
  import { toBackendUrl } from '../../config/api.config.js';

  import { 
    getLocalItems, 
    saveLocalItems, 
    upsertLocalItem, 
    deleteLocalItem, 
    queueOutboxAction,
    generateSafeUuid 
  } from '../../services/localDb.service.js';

  // Extract assigned sala IDs strictly for the logged-in user
  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const userId = user?.uuid || user?.id;

    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas
        .map((s) => (typeof s === "object" ? (s.uuid || s.id) : s))
        .filter(Boolean)
        .map(String);
    }

    const masterMap = $masterUserSalasStore;
    if (
      masterMap &&
      typeof masterMap === "object" &&
      !Array.isArray(masterMap)
    ) {
      const userList = userId ? (masterMap[userId] || masterMap[String(userId)] || (user?.id ? masterMap[user.id] : null)) : null;
      if (Array.isArray(userList) && userList.length > 0) {
        return userList
          .map((s) => (typeof s === "object" ? (s.uuid || s.id) : s))
          .filter(Boolean)
          .map(String);
      }
    }

    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? (s.uuid || s.id) : s))
        .filter(Boolean)
        .map(String);
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
  let isLoading = true;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'uuid',
    sortDir: 'desc'
  };

  let unsubscribeClientesStore;
  let isMounted = false;

  onMount(async () => {
    isLoading = true;
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
      const res = await fetch(toBackendUrl(`/api/master/clientes/filter-options?${q.toString()}`));
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
    isLoading = true;
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        page: currentParams.page,
        limit: currentParams.limit,
        search: currentParams.search || '',
        sortBy: currentParams.sortBy || 'uuid',
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

      const res = await fetch(toBackendUrl(`/api/master/clientes?${q.toString()}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !json.success) throw new Error(json?.message || 'Error en respuesta');

      items = json.data || [];
      totalCount = json.total || 0;
      currentPage = json.page || 1;
      pageSize = json.limit || 10;
    } catch (err) {
      console.warn('Fallback local IndexedDB para clientes:', err);
      const local = await getLocalItems('clientes', null, 'created_at', 'desc');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterClientesStore || []);
      const query = (currentParams.search || '').trim().toLowerCase();
      const filtered = query ? source.filter(x => (x.nombre || '').toLowerCase().includes(query) || (x.descripcion || '').toLowerCase().includes(query)) : source;
      totalCount = filtered.length;
      const start = ((currentParams.page || 1) - 1) * (currentParams.limit || 10);
      items = filtered.slice(start, start + (currentParams.limit || 10));
    } finally {
      isLoading = false;
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
    return assignedSalaIds.includes(String(s.uuid || s.id));
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
    uuid: t.uuid || t.id,
    id: t.uuid || t.id,
    nombre: t.nombre
  }));

  $: columns = [
    { key: 'foto', label: 'Foto', type: 'photo', sortable: false, editable: false },
    { key: 'uuid', label: 'UUID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Nombre del Cliente', bold: true, sortable: true, editable: false },
    { 
      key: 'tipo_cliente_nombre', 
      keyId: 'tipo_cliente_uuid', 
      label: 'Tipo de Cliente', 
      sortable: true, 
      editable: false, 
      options: tipoClientesOptions 
    },
    { 
      key: 'sala_nombre', 
      keyId: 'sala_uuid', 
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

    // 0ms instant local-first execution
    const newUuid = draft.uuid || generateSafeUuid();
    const salaObj = ($masterSalasStore || []).find(s => String(s.uuid || s.id) === String(draft.sala_uuid || draft.sala_id));
    const tipoObj = tipoClientesOptions.find(t => String(t.uuid || t.id) === String(draft.tipo_cliente_uuid || draft.tipo_cliente_id));

    const newRecord = {
      ...draft,
      uuid: newUuid,
      id: newUuid,
      sala_nombre: salaObj ? salaObj.nombre : (draft.sala_nombre || 'Sala'),
      tipo_cliente_nombre: tipoObj ? tipoObj.nombre : (draft.tipo_cliente_nombre || 'Cliente'),
      created_at: new Date().toISOString()
    };

    // 1. Inmediatamente actualizar memoria de la vista y cerrar modal (0ms)
    items = [newRecord, ...items.filter(x => String(x.uuid || x.id) !== String(newRecord.uuid))];
    totalCount++;
    isFormModalOpen = false;
    formModalItem = null;
    if (onDone) onDone(null);
    triggerToast('Cliente creado exitosamente', 'success');

    // 2. Persistencia local inmediata en IndexedDB (<5ms)
    upsertLocalItem('clientes', newRecord).catch(() => {});
    masterClientesStore.update(l => [newRecord, ...(Array.isArray(l) ? l.filter(x => String(x.uuid || x.id) !== String(newRecord.uuid)) : [])]);

    // 3. Sincronización en segundo plano con timeout y outbox fallback
    (async () => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'clientes',
          action: 'create',
          endpoint: '/api/master/clientes',
          method: 'POST',
          payload: draft,
          uuid: newUuid
        });
        return;
      }

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(toBackendUrl('/api/master/clientes'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, uuid: newUuid }),
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json && json.success) {
          const serverData = json.data || newRecord;
          await upsertLocalItem('clientes', serverData);
          items = items.map(x => String(x.uuid || x.id) === String(newUuid) ? { ...x, ...serverData } : x);
        } else {
          throw new Error(json?.error || 'Error al guardar cliente en servidor');
        }
      } catch (err) {
        console.warn('[LocalDb] Encolando outbox para cliente:', err.message);
        await queueOutboxAction({
          entity: 'clientes',
          action: 'create',
          endpoint: `/api/master/clientes`,
          method: 'POST',
          payload: draft,
          uuid: newUuid
        });
      }
    })();
  }

  async function handleSaveInline(event) {
    const detail = event.detail || {};
    const targetUuid = detail.uuid || detail.id;
    const { draft } = detail;
    const onDone = draft?.onDone || detail.onDone;
    const cleanDraft = { ...draft };
    delete cleanDraft.onDone;

    const existing = items.find(x => String(x.uuid || x.id) === String(targetUuid)) || {};
    const salaObj = cleanDraft.sala_uuid || cleanDraft.sala_id ? ($masterSalasStore || []).find(s => String(s.uuid || s.id) === String(cleanDraft.sala_uuid || cleanDraft.sala_id)) : null;
    const tipoObj = cleanDraft.tipo_cliente_uuid || cleanDraft.tipo_cliente_id ? tipoClientesOptions.find(t => String(t.uuid || t.id) === String(cleanDraft.tipo_cliente_uuid || cleanDraft.tipo_cliente_id)) : null;

    const updatedRecord = {
      ...existing,
      ...cleanDraft,
      uuid: targetUuid,
      id: targetUuid,
      foto: cleanDraft.fotoBase64 ? cleanDraft.fotoBase64 : (cleanDraft.removeFoto ? null : existing.foto),
      sala_nombre: salaObj ? salaObj.nombre : existing.sala_nombre,
      tipo_cliente_nombre: tipoObj ? tipoObj.nombre : existing.tipo_cliente_nombre,
      updated_at: new Date().toISOString()
    };

    // 1. Inmediatamente actualizar memoria de la vista y cerrar modal (0ms)
    items = items.map(x => String(x.uuid || x.id) === String(targetUuid) ? updatedRecord : x);
    isFormModalOpen = false;
    formModalItem = null;
    if (onDone) onDone(null);
    triggerToast('Cliente actualizado exitosamente', 'success');

    // 2. Persistencia local inmediata en IndexedDB (<5ms)
    upsertLocalItem('clientes', updatedRecord).catch(() => {});
    masterClientesStore.update(l => (Array.isArray(l) ? l.map(it => String(it.uuid || it.id) === String(targetUuid) ? updatedRecord : it) : []));

    // 3. Sincronización en segundo plano con timeout y outbox fallback
    (async () => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'clientes',
          action: 'update',
          endpoint: `/api/master/clientes/${targetUuid}`,
          method: 'PUT',
          payload: cleanDraft,
          targetId: targetUuid
        });
        return;
      }

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(toBackendUrl(`/api/master/clientes/${targetUuid}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleanDraft),
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json && json.success) {
          const serverData = json.data || updatedRecord;
          await upsertLocalItem('clientes', serverData);
          items = items.map(x => String(x.uuid || x.id) === String(targetUuid) ? { ...x, ...serverData } : x);
        } else {
          throw new Error(json?.error || 'Error al actualizar cliente en servidor');
        }
      } catch (err) {
        console.warn('[LocalDb] Encolando outbox para actualizar cliente:', err.message);
        await queueOutboxAction({
          entity: 'clientes',
          action: 'update',
          endpoint: `/api/master/clientes/${targetUuid}`,
          method: 'PUT',
          payload: cleanDraft,
          targetId: targetUuid
        });
      }
    })();
  }

  async function handleDelete(event) {
    const detail = event.detail || {};
    const { id, item, onResult } = detail;
    const targetUuid = detail.uuid || id || item?.uuid || item?.id;
    try {
      const res = await masterClientesActions.delete(targetUuid);
      if (res && res.blocked) {
        if (onResult) {
          onResult(res);
        } else {
          triggerToast(res.message || 'No se puede eliminar el cliente porque tiene registros vinculados en el libro.', 'warning');
        }
      } else {
        triggerToast(`Cliente eliminado exitosamente`, 'success');
        items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
        totalCount = Math.max(0, totalCount - 1);
        if (onResult) onResult({ success: true });
        loadServerData().catch(() => {});
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
  {isLoading}
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
      options={(filterOptions.salas || []).filter(s => !assignedSalaIds || assignedSalaIds.length === 0 || assignedSalaIds.includes(String(s.uuid || s.id)))}
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
