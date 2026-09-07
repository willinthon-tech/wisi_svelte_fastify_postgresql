<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentHorariosFilters = writable({
    selectedSalas: [],
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

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentHorariosFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentHorariosFilters.set({
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

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) + selectedSalas.length;

  let items = [];
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;
  let globalExcepciones = [];

  function getContrastColor(hexColor) {
    if (!hexColor || typeof hexColor !== 'string') return '#ffffff';
    let hex = hexColor.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length !== 6) return '#ffffff';
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#0f172a' : '#ffffff';
  }

  async function loadExcepciones() {
    try {
      const res = await fetch('/api/master/excepciones?limit=1000&sortBy=codigo&sortDir=asc');
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          globalExcepciones = json.data || [];
        }
      }
    } catch (e) {
      console.warn("Error fetching excepciones in HorariosView:", e);
    }
  }

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
      loadExcepciones(),
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

      const res = await fetch(`/api/master/horarios/filter-options?${q.toString()}`);
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
        search: currentParams.search || '',
        sort_by: currentParams.sortBy || currentParams.sort_by || 'id',
        sort_order: currentParams.sortDir || currentParams.sort_order || 'asc'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (selectedSalas.length > 0) {
        q.set('sala_ids', selectedSalas.join(','));
      }

      const res = await fetch(`/api/master/plantillas-horarios?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar horarios del servidor', 'error');
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
    return assignedSalaIds.includes(s.id);
  });

  $: columns = [
    { key: 'id', label: 'N°', type: 'id', sortable: true, editable: false },
    { key: 'codigo', label: 'Código', bold: true, sortable: true, editable: true },
    { key: 'nombre', label: 'Descripción', bold: true, sortable: true, editable: true },
    { key: 'sala_nombre', keyId: 'sala_id', label: 'Sala', sortable: true, editable: false },
    { key: 'horas_trabajo', label: 'Horas de Trabajo', type: 'horario_badge', sortable: true, editable: true },
    { key: 'jornada', label: 'Jornada', type: 'jornada', sortable: true, editable: false },
    { key: 'color', label: 'Color', type: 'color', sortable: true, editable: true }
  ];

  $: defaultSalaId = (assignedSalaIds && assignedSalaIds.length > 0) ? assignedSalaIds[0] : '';

  $: createFields = [
    { key: 'codigo', label: 'Código', type: 'text', placeholder: 'Ej. M, T, N, ADM', required: true },
    { key: 'nombre', label: 'Descripción / Nombre', type: 'text', placeholder: 'Ej. TURNO MAÑANA', required: true },
    { key: 'sala_id', label: 'Sala Asignada', type: 'select', options: filteredSalasStore, required: true, defaultValue: defaultSalaId },
    {
      type: 'row',
      fields: [
        { key: 'hora_entrada', label: 'Hora Entrada', type: 'time', placeholder: '08:00:00', required: true },
        { key: 'hora_salida', label: 'Hora Salida', type: 'time', placeholder: '17:00:00', required: true }
      ]
    },
    { key: 'color', label: 'Color de Identificación', type: 'color', defaultValue: '#86EFAC' }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      const res = await fetch('/api/master/horarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Horario creado exitosamente', 'success');
        await loadServerData();
      } else {
        throw new Error(json.error || 'Error al guardar horario');
      }
    } catch (err) {
      triggerToast(`Error al crear: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      const res = await fetch(`/api/master/horarios/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Horario actualizado exitosamente', 'success');
        await loadServerData();
      } else {
        throw new Error(json.error || 'Error al actualizar horario');
      }
    } catch (err) {
      triggerToast(`Error al actualizar: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    try {
      const res = await fetch(`/api/master/horarios/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json && json.blocked) {
        onResult(json);
      } else {
        triggerToast('Horario eliminado exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await fetch(`/api/master/horarios/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json && json.blocked) {
          blocked.push({
            id,
            name: json.entityName || `ID: ${id}`,
            reason: json.message || 'Tiene elementos o empleados asociados en la base de datos',
            dependencies: json.dependencies || []
          });
        } else if (res.ok && (json.success || json.id)) {
          deleted.push({ id });
        } else {
          blocked.push({
            id,
            name: `ID: ${id}`,
            reason: json?.error || 'No se pudo eliminar por restricciones de datos',
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
        entityType: 'horario'
      });
    }
  }
</script>

{#if globalExcepciones && globalExcepciones.length > 0}
  <div class="excepciones-banner-card">
    <div class="excepciones-banner-header">
      <span class="excepciones-pin">📌</span>
      <strong class="excepciones-title">Excepciones Base del Sistema:</strong>
      <span class="excepciones-subtitle">
        Se cuenta con {globalExcepciones.length} excepciones predeterminadas de horario y asistencia (aplican a todas las salas):
      </span>
    </div>
    <div class="excepciones-badges-grid">
      {#each globalExcepciones as exp}
        <div class="excepcion-badge-item" title="{exp.codigo} - {exp.descripcion} ({exp.tipo || 'Asignable'})">
          <span
            class="exp-code-chip"
            style="background-color: {exp.color || '#3b82f6'}; color: {getContrastColor(exp.color)};"
          >
            {exp.codigo}
          </span>
          <span class="exp-name-text">{exp.descripcion || exp.nombre}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}

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
  searchPlaceholder="Buscar por código, descripción, sala..."
  entityType="horario"
  createModalTitle="Agregar Horario"
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-horarios-salas"
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
        title="Restablecer búsqueda y filtros"
      >
        <span>✕</span> Limpiar Filtros ({totalFilters})
      </button>
    {/if}
  </div>
</PaginatedDataTable>

<style>
  .excepciones-banner-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 18px;
    margin-bottom: 20px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  }

  .excepciones-banner-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #1e293b;
    flex-wrap: wrap;
  }

  .excepciones-pin {
    font-size: 14px;
  }

  .excepciones-title {
    font-weight: 800;
    color: #0f172a;
  }

  .excepciones-subtitle {
    color: #64748b;
    font-size: 12.5px;
  }

  .excepciones-badges-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    width: 100%;
  }

  .excepcion-badge-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    box-sizing: border-box;
    transition: all 0.15s ease;
    overflow: hidden;
  }

  .excepcion-badge-item:hover {
    background: #dbeafe;
    border-color: #93c5fd;
    transform: translateY(-1px);
  }

  .exp-code-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    font-size: 11px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 6px;
    white-space: nowrap;
    letter-spacing: 0.3px;
    flex-shrink: 0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .exp-name-text {
    font-size: 12px;
    font-weight: 700;
    color: #1e40af;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .smart-filters-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    width: 100%;
    align-items: center;
  }
</style>
