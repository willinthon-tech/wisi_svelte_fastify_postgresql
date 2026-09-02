<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentHorariosFilters = writable({
    selectedSalas: [],
    selectedTipo: [],
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
  let selectedTipo = initial.selectedTipo || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentHorariosFilters.set({
      selectedSalas,
      selectedTipo,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: [],
    tipo: []
  };

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0 ||
    selectedTipo.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) +
    selectedSalas.length +
    selectedTipo.length;

  // Las 2 Plantillas Base del Sistema (Protegidas / Deshabilitadas para eliminación)
  const BASE_PLANTILLAS = [
    {
      id: 'SYS-L',
      codigo: 'L',
      nombre: 'Libre',
      colspans: {
        sala_nombre: {
          colspan: 3,
          align: 'center',
          text: 'Todas las salas'
        }
      },
      skipColumns: ['horas_trabajo', 'jornada'],
      sala_nombre: 'Todas las salas',
      color: '#D9D9D9',
      tipo: 'plantilla', // Se visualiza como 'Excepción'
      is_system: true,
      disabled: true,
      disableDelete: true,
      disableEdit: true
    },
    {
      id: 'SYS-U',
      codigo: 'U',
      nombre: 'Horario Único',
      colspans: {
        sala_nombre: {
          colspan: 3,
          align: 'center',
          text: 'Todas las salas'
        }
      },
      skipColumns: ['horas_trabajo', 'jornada'],
      sala_nombre: 'Todas las salas',
      color: '#86EFAC',
      tipo: 'horario',
      is_system: true,
      disabled: true,
      disableDelete: true,
      disableEdit: true
    }
  ];

  let rawServerItems = [];
  let serverTotalCount = 0;
  let currentPage = 1;
  let pageSize = 10;

  // Filtrar las plantillas base si el usuario aplica filtros de tipo o búsqueda
  $: matchingBasePlantillas = BASE_PLANTILLAS.filter(bp => {
    if (selectedTipo && selectedTipo.length > 0) {
      if (!selectedTipo.includes(bp.tipo)) return false;
    }
    if ((searchQuery || '').trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchCod = bp.codigo.toLowerCase().includes(q);
      const matchNom = bp.nombre.toLowerCase().includes(q);
      const matchTipo = (bp.tipo === 'plantilla' ? 'excepción excepcion' : bp.tipo).toLowerCase().includes(q);
      if (!matchCod && !matchNom && !matchTipo) return false;
    }
    return true;
  });

  // Mostrar las plantillas base de primeritas en la primera página
  $: items = (Number(currentPage) === 1)
    ? [...matchingBasePlantillas, ...rawServerItems]
    : rawServerItems;

  $: totalCount = serverTotalCount + matchingBasePlantillas.length;

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

  // Fetch filter options ONLY when active filters, user assigned salas or search change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedTipo.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedTipo.length > 0) q.set("tipo", selectedTipo.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/plantillas-horarios/filter-options?${q.toString()}`);
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
      if (selectedTipo.length > 0) {
        q.set('tipo', selectedTipo.join(','));
      }

      const res = await fetch(`/api/master/plantillas-horarios?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        rawServerItems = json.data || [];
        serverTotalCount = json.total || 0;
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
    selectedTipo = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredSalasStore = ($masterSalasStore || []).filter(s => {
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
    { key: 'color', label: 'Color', type: 'color', sortable: true, editable: true },
    { key: 'tipo', label: 'Tipo', type: 'badge', sortable: true, editable: true, options: ['horario', 'plantilla'] }
  ];

  $: defaultSalaId = (assignedSalaIds && assignedSalaIds.length > 0) ? assignedSalaIds[0] : '';

  $: createFields = [
    { key: 'codigo', label: 'Código', type: 'text', placeholder: 'Ej. O, T, NC, A', required: true },
    { key: 'nombre', label: 'Descripción / Nombre', type: 'text', placeholder: 'Ej. ADMINISTRACION', required: true },
    { key: 'sala_id', label: 'Sala Asignada', type: 'select', options: filteredSalasStore, required: true, defaultValue: defaultSalaId },
    { 
      key: 'tipo', 
      label: 'Tipo de Registro', 
      type: 'select', 
      options: [
        { id: 'horario', nombre: 'Horario' },
        { id: 'plantilla', nombre: 'Excepción' }
      ], 
      required: true, 
      defaultValue: 'horario' 
    },
    {
      type: 'row',
      fields: [
        { key: 'hora_entrada', label: 'Hora Entrada', type: 'time', placeholder: '08:00:00' },
        { key: 'hora_salida', label: 'Hora Salida', type: 'time', placeholder: '17:00:00' }
      ]
    },
    { key: 'color', label: 'Color de Identificación', type: 'color', defaultValue: '#FFFF99' }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      const res = await fetch('/api/master/plantillas-horarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Registro creado exitosamente', 'success');
        await loadServerData();
      } else {
        throw new Error(json.error || 'Error al guardar');
      }
    } catch (err) {
      triggerToast(`Error al crear: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    if (String(id).startsWith('SYS-')) {
      triggerToast('Esta plantilla base no puede ser modificada', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/master/plantillas-horarios/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Horario/Excepción actualizado exitosamente', 'success');
        await loadServerData();
      } else {
        throw new Error(json.error || 'Error al actualizar');
      }
    } catch (err) {
      triggerToast(`Error al actualizar: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, onResult } = event.detail;
    if (String(id).startsWith('SYS-')) {
      triggerToast('Esta plantilla base no puede ser eliminada', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/master/plantillas-horarios/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json && json.blocked) {
        onResult(json);
      } else {
        triggerToast('Eliminado exitosamente', 'success');
        onResult({ success: true });
        await loadServerData();
      }
    } catch (err) {
      triggerToast(`Error al eliminar: ${err.message}`, 'error');
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const filteredIds = ids.filter(id => !String(id).startsWith('SYS-'));
    if (filteredIds.length === 0) {
      triggerToast('Las plantillas base seleccionadas no pueden ser eliminadas', 'warning');
      return;
    }
    for (const id of filteredIds) {
      try {
        await fetch(`/api/master/plantillas-horarios/${id}`, { method: 'DELETE' });
      } catch (err) {
        triggerToast(`Error al eliminar ID ${id}: ${err.message}`, 'error');
      }
    }
    triggerToast(`${filteredIds.length} registros eliminados en masivo`, 'success');
    onResult({ success: true });
    await loadServerData();
  }
</script>

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
  reservedCodes={['L', 'U']}
  createModalTitle="Agregar Plantilla"
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

    <SmartMultiSelect
      id="filter-horarios-tipo"
      label="Tipo"
      options={filterOptions.tipo}
      bind:selectedValues={selectedTipo}
      on:change={(e) => {
        selectedTipo = e.detail;
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

  <div slot="info-banner" class="plantillas-base-banner">
    <div class="banner-badge-heading">
      <span class="info-icon">📌</span>
      <span class="info-lead">Plantillas Base del Sistema:</span>
      <span class="info-note">Se cuenta con 2 plantillas predeterminadas de uso general:</span>
    </div>

    <div class="plantillas-cards-row">
      <!-- Item 1: Código L - Libre (Tipo: Excepción) -->
      <div class="base-plantilla-pill pill-excepcion">
        <span class="pill-code">L</span>
        <div class="pill-details">
          <span class="pill-desc">Libre</span>
          <span class="pill-sub">Tipo: <strong>Excepción</strong></span>
        </div>
      </div>

      <!-- Item 2: Código U - Horario Único (Tipo: Horario) -->
      <div class="base-plantilla-pill pill-horario">
        <span class="pill-code">U</span>
        <div class="pill-details">
          <span class="pill-desc">Horario Único</span>
          <span class="pill-sub">Tipo: <strong>Horario</strong></span>
        </div>
      </div>
    </div>
  </div>
</PaginatedDataTable>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    align-items: center;
  }

  .plantillas-base-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    padding: 8px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-sizing: border-box;
  }

  .banner-badge-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: #334155;
    flex-wrap: wrap;
  }

  .info-icon {
    font-size: 14px;
  }

  .info-lead {
    font-weight: 800;
    color: #0f172a;
  }

  .info-note {
    color: #64748b;
    font-size: 12px;
  }

  .plantillas-cards-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .base-plantilla-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .pill-excepcion {
    background: #f8fafc;
    border-color: #cbd5e1;
  }

  .pill-horario {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }

  .pill-code {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 900;
    font-family: monospace;
  }

  .pill-excepcion .pill-code {
    background: #94a3b8;
    color: #ffffff;
  }

  .pill-horario .pill-code {
    background: #4ade80;
    color: #064e3b;
  }

  .pill-details {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .pill-desc {
    font-size: 12px;
    font-weight: 800;
    color: #0f172a;
  }

  .pill-sub {
    font-size: 10.5px;
    color: #64748b;
  }

  .pill-excepcion .pill-sub strong {
    color: #4338ca;
  }

  .pill-horario .pill-sub strong {
    color: #15803d;
  }

  @media (max-width: 1024px) {
    .plantillas-base-banner {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
  }

  @media (max-width: 768px) {
    .smart-filters-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
