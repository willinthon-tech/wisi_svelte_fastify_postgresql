<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentCalendarioFilters = writable({
    selectedSalas: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { masterSalasStore } from '../../controllers/master.store.js';
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
  const unsubInit = persistentCalendarioFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State (Sólo Salas, según requerimiento)
  let selectedSalas = initial.selectedSalas || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentCalendarioFilters.set({
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

  // Catálogo de los 12 meses
  const MESES = [
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

  // Las 10 Fechas Patrias Base Nacionales del Sistema (Hardcodeadas, protegidas, aplican a todas las salas)
  const BASE_FERIADOS = [
    { id: 'SYS-12', nombre: 'Año Nuevo', mes: 1, dia: 1, mes_nombre: 'Enero', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-13', nombre: 'Declaración de la Independencia', mes: 4, dia: 19, mes_nombre: 'Abril', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-14', nombre: 'Día del Trabajador', mes: 5, dia: 1, mes_nombre: 'Mayo', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-15', nombre: 'Batalla de Carabobo', mes: 6, dia: 24, mes_nombre: 'Junio', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-16', nombre: 'Día de la Independencia', mes: 7, dia: 5, mes_nombre: 'Julio', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-17', nombre: 'Natalicio del Libertador Simón Bolívar', mes: 7, dia: 24, mes_nombre: 'Julio', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-18', nombre: 'Día de la Resistencia Indígena', mes: 10, dia: 12, mes_nombre: 'Octubre', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-19', nombre: 'Víspera de Navidad', mes: 12, dia: 24, mes_nombre: 'Diciembre', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-20', nombre: 'Navidad', mes: 12, dia: 25, mes_nombre: 'Diciembre', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true },
    { id: 'SYS-21', nombre: 'Fin de Año', mes: 12, dia: 31, mes_nombre: 'Diciembre', sala_nombre: 'Todas las salas', is_system: true, disabled: true, disableDelete: true, disableEdit: true }
  ];

  let rawServerItems = [];

  // Combinar fechas base nacionales con las fechas patrias de las salas del servidor
  $: combinedItems = (function() {
    let serverList = [...rawServerItems];
    if (selectedSalas.length > 0) {
      const set = new Set(selectedSalas.map(Number));
      serverList = serverList.filter(item => set.has(Number(item.sala_id)));
    }
    return [...BASE_FERIADOS, ...serverList];
  })();

  // Fetch filter options ONLY when active filters, user assigned salas or search change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));

      const res = await fetch(`/api/master/calendario/filter-options?${q.toString()}`);
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

  async function loadServerData() {
    try {
      const q = new URLSearchParams({
        limit: 1000,
        sort_by: 'mes',
        sort_order: 'asc'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }

      const res = await fetch(`/api/master/calendario?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        rawServerItems = json.data || [];
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar fechas patrias del servidor', 'error');
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
  }

  $: filteredSalasStore = ($masterSalasStore || []).filter(s => {
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return assignedSalaIds.includes(s.id);
  });

  $: columns = [
    { key: 'id', label: 'N°', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Fecha Patria / Feriado', bold: true, sortable: true, editable: true },
    { key: 'dia', label: 'Día', sortable: true, editable: true, type: 'number' },
    { key: 'mes_nombre', keyId: 'mes', label: 'Mes', sortable: true, editable: true, type: 'select', options: MESES },
    { key: 'sala_nombre', keyId: 'sala_id', label: 'Sala', sortable: true, editable: false }
  ];

  $: defaultSalaId = (assignedSalaIds && assignedSalaIds.length > 0) ? assignedSalaIds[0] : (filteredSalasStore[0]?.id || 1);

  $: createFields = [
    { key: 'nombre', label: 'Nombre de la Fecha Patria / Feriado', type: 'text', placeholder: 'Ej. Día de la Virgen del Valle', required: true },
    { key: 'sala_id', label: 'Sala Asignada', type: 'select', options: filteredSalasStore, required: true, defaultValue: defaultSalaId },
    {
      type: 'row',
      fields: [
        { key: 'mes', label: 'Mes', type: 'select', options: MESES, required: true, defaultValue: 1 },
        { key: 'dia', label: 'Día (1 - 31)', type: 'number', placeholder: '1 - 31', min: 1, max: 31, required: true, defaultValue: 1 }
      ]
    }
  ];

  async function handleCreate(e) {
    const data = e.detail;
    try {
      const res = await fetch('/api/master/calendario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const json = await res.json();
      if (res.ok && json.success) {
        triggerToast('Fecha patria agregada exitosamente', 'success');
        await loadServerData({ page: 1 });
        await fetchFilterOptions();
      } else {
        triggerToast(json.error || 'Error al guardar fecha patria', 'error');
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error de conexión al servidor', 'error');
    }
  }

  async function handleSaveInline(e) {
    const { id, field, value } = e.detail;
    if (String(id).startsWith('SYS-')) {
      triggerToast('Las fechas patrias base del sistema no pueden modificarse', 'warning');
      return;
    }
    try {
      const payload = { [field]: value };
      const res = await fetch(`/api/master/calendario/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json.success) {
        triggerToast('Fecha patria actualizada', 'success');
        await loadServerData();
      } else {
        triggerToast(json.error || 'Error al actualizar fecha patria', 'error');
        await loadServerData();
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error de conexión', 'error');
      await loadServerData();
    }
  }

  async function handleDelete(e) {
    const id = e.detail;
    if (String(id).startsWith('SYS-')) {
      triggerToast('Las fechas patrias base del sistema no pueden eliminarse', 'warning');
      return;
    }
    try {
      const res = await fetch(`/api/master/calendario/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json.success) {
        triggerToast('Fecha patria eliminada exitosamente', 'success');
        await loadServerData();
        await fetchFilterOptions();
      } else {
        triggerToast(json.message || json.error || 'No se pudo eliminar la fecha patria', 'error');
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error de conexión', 'error');
    }
  }

  async function handleBatchDelete(e) {
    const { ids, onComplete } = e.detail || {};
    if (!ids || ids.length === 0) return;

    let successCount = 0;
    const errors = [];

    for (const id of ids) {
      if (String(id).startsWith('SYS-')) {
        errors.push({ id, reason: 'Fecha patria base del sistema (protegida)' });
        continue;
      }
      try {
        const res = await fetch(`/api/master/calendario/${id}`, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) {
          successCount++;
        } else {
          errors.push({
            id,
            reason: json.message || json.error || 'Error al eliminar registro'
          });
        }
      } catch (err) {
        errors.push({ id, reason: 'Error de conexión con el servidor' });
      }
    }

    await loadServerData();
    await fetchFilterOptions();

    if (onComplete) {
      onComplete({
        successCount,
        errors,
        total: ids.length,
        entityType: 'fecha patria'
      });
    }
  }

  onMount(() => {
    loadServerData();
    fetchFilterOptions();
  });
</script>

<PaginatedDataTable 
  items={combinedItems}
  existingItems={combinedItems}
  isServerSide={false}
  pageSize={10}
  sortBy="mes_nombre"
  sortDir="asc"
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar por fecha patria, sala..."
  entityType="fecha patria"
  createModalTitle="Agregar Fecha Patria"
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-calendario-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
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
      <span class="info-lead">Fechas Patrias Base del Sistema:</span>
      <span class="info-note">Se cuenta con 10 fechas patrias predeterminadas de carácter nacional (aplican a todas las salas):</span>
    </div>

    <div class="plantillas-cards-row">
      {#each BASE_FERIADOS as bf}
        <div class="base-plantilla-pill pill-feriado-base" title="{bf.nombre} - Aplica a todas las salas">
          <span class="pill-date">{String(bf.dia).padStart(2, '0')} {bf.mes_nombre.slice(0, 3)}</span>
          <span class="pill-name">{bf.nombre}</span>
        </div>
      {/each}
    </div>
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

  .plantillas-base-banner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 10px 16px;
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
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
  }

  .base-plantilla-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    min-width: 0;
    overflow: hidden;
  }

  .pill-feriado-base {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .pill-date {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 6px;
    border-radius: 4px;
    background: #2563eb;
    color: #ffffff;
    font-size: 11px;
    font-weight: 800;
    font-family: monospace;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pill-name {
    font-size: 12px;
    font-weight: 700;
    color: #1e3a8a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  @media (max-width: 1200px) {
    .plantillas-cards-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .plantillas-cards-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .plantillas-cards-row {
      grid-template-columns: 1fr;
    }
  }
</style>
