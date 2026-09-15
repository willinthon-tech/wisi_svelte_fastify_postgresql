<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentHorariosFilters = writable({
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import { masterHorariosActions, masterHorariosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { getLocalItems, saveLocalItems } from '../../services/localDb.service.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentHorariosFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever search query changes
  $: {
    persistentHorariosFilters.set({
      searchQuery
    });
  }

  $: hasActiveFilters = Boolean((searchQuery || "").trim());

  let items = [];
  $: allHorarios = $masterHorariosStore || [];
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
          saveLocalItems('excepciones', globalExcepciones).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Error fetching excepciones in HorariosView:", e);
      const local = await getLocalItems('excepciones');
      if (Array.isArray(local) && local.length > 0) {
        globalExcepciones = local;
      }
    }
  }

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'codigo',
    sortDir: 'asc'
  };

  onMount(async () => {
    // 1. Carga instantánea (0ms) desde IndexedDB local
    try {
      const [localHor, localExc] = await Promise.all([
        getLocalItems('horarios'),
        getLocalItems('excepciones')
      ]);
      if (Array.isArray(localHor) && localHor.length > 0) {
        items = localHor;
        totalCount = localHor.length;
      } else if (Array.isArray(allHorarios) && allHorarios.length > 0) {
        items = allHorarios;
        totalCount = allHorarios.length;
      }
      if (Array.isArray(localExc) && localExc.length > 0) {
        globalExcepciones = localExc;
      }
    } catch (e) {}

    // 2. Carga en segundo plano
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadExcepciones(),
      loadServerData(currentParams)
    ]);
  });

  async function loadServerData(params = {}) {
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        page: currentParams.page || 1,
        limit: currentParams.limit || 10,
        search: currentParams.search || '',
        sort_by: currentParams.sortBy || currentParams.sort_by || 'codigo',
        sort_order: currentParams.sortDir || currentParams.sort_order || 'asc'
      });

      const res = await fetch(`/api/master/horarios?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
        saveLocalItems('horarios', items).catch(() => {});
      }
    } catch (err) {
      console.warn('Fallback local IndexedDB para horarios:', err);
      const local = await getLocalItems('horarios');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterHorariosStore || []);
      const q = (currentParams.search || '').trim().toLowerCase();
      const filtered = q ? source.filter(x => (x.codigo || '').toLowerCase().includes(q) || (x.nombre || '').toLowerCase().includes(q)) : source;
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
    { key: 'uuid', label: 'UUID', type: 'id', sortable: true, editable: false },
    { key: 'codigo', label: 'Código', bold: true, sortable: true, editable: true },
    { key: 'nombre', label: 'Descripción / Nombre', bold: true, sortable: true, editable: true },
    { key: 'horas_trabajo', label: 'Horas de Trabajo', type: 'horario_badge', sortable: true, editable: true },
    { key: 'descanso', label: 'Descanso', type: 'time', sortable: true, editable: true },
    { key: 'jornada', label: 'Jornada', type: 'jornada', sortable: true, editable: false },
    { key: 'color', label: 'Color', type: 'color', sortable: true, editable: true }
  ];

  $: createFields = [
    { key: 'codigo', label: 'Código', type: 'text', placeholder: 'Ej. M, T, N, ADM', required: true },
    { key: 'nombre', label: 'Descripción / Nombre', type: 'text', placeholder: 'Ej. TURNO MAÑANA', required: true },
    {
      type: 'row',
      fields: [
        { key: 'hora_entrada', label: 'Hora Entrada', type: 'time', placeholder: '08:00:00', required: true },
        { key: 'hora_salida', label: 'Hora Salida', type: 'time', placeholder: '17:00:00', required: true }
      ]
    },
    { key: 'descanso', label: 'Tiempo de Descanso', type: 'time', defaultValue: '00:00:00' },
    { key: 'color', label: 'Color de Identificación', type: 'color', defaultValue: '#86EFAC' }
  ];

  async function handleCreate(event) {
    const draft = event.detail;
    try {
      const created = await masterHorariosActions.add(draft);
      triggerToast('Horario creado exitosamente', 'success');
      if (created) {
        items = [created, ...items.filter(x => String(x.uuid || x.id) !== String(created.uuid || created.id))];
        totalCount++;
      }
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(err.message?.startsWith('El código') ? err.message : `Error al crear: ${err.message}`, 'error');
    }
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    const targetUuid = id;
    try {
      await masterHorariosActions.update(targetUuid, draft);
      triggerToast('Horario actualizado exitosamente', 'success');
      items = items.map(x => (String(x.uuid || x.id) === String(targetUuid)) ? { ...x, ...draft } : x);
      loadServerData().catch(() => {});
    } catch (err) {
      triggerToast(err.message?.startsWith('El código') ? err.message : `Error al actualizar: ${err.message}`, 'error');
    }
  }

  async function handleDelete(event) {
    const { id, item, onResult } = event.detail;
    const targetUuid = item?.uuid || id || item?.id;
    try {
      const res = await masterHorariosActions.delete(targetUuid);
      if (res && res.blocked) {
        if (onResult) {
          onResult(res);
        } else {
          triggerToast(res.message || 'No se puede eliminar porque tiene dependencias vinculadas.', 'warning');
        }
      } else {
        triggerToast('Horario eliminado exitosamente', 'success');
        items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
        totalCount = Math.max(0, totalCount - 1);
        if (onResult) onResult({ success: true });
        loadServerData().catch(() => {});
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
        const res = await masterHorariosActions.delete(id);
        if (res && res.blocked) {
          blocked.push({
            id,
            name: res.entityName || `ID: ${id}`,
            reason: res.message || 'Tiene elementos o empleados asociados en la base de datos',
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
        entityType: 'horario'
      });
    }
  }
</script>

{#if globalExcepciones && globalExcepciones.length > 0}
  <div class="excepciones-banner-card">
    <div class="excepciones-banner-header">
      <span class="excepciones-pin" style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: 900;">EXP</span>
      <strong class="excepciones-title">Excepciones Base del Sistema:</strong>
      <span class="excepciones-subtitle">
        Se cuenta con {globalExcepciones.length} excepciones predeterminadas de horario y asistencia (códigos reservados globales):
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
  reservedCodes={globalExcepciones}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  {createFields}
  bind:searchQuery
  searchPlaceholder="Buscar por código o descripción de horario..."
  entityType="horario"
  createModalTitle="Agregar Horario"
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
</style>
