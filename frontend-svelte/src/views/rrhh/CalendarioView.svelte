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
    const { id, onResult } = (e.detail && typeof e.detail === 'object') ? e.detail : { id: e.detail, onResult: null };
    if (!id) return;

    if (String(id).startsWith('SYS-')) {
      triggerToast('Las fechas patrias base del sistema no pueden eliminarse', 'warning');
      if (onResult) onResult({ blocked: true, message: 'Fecha protegida del sistema' });
      return;
    }

    try {
      const res = await fetch(`/api/master/calendario/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        triggerToast('Fecha patria eliminada exitosamente', 'success');
        if (onResult) onResult({ success: true });
        await loadServerData();
        await fetchFilterOptions();
      } else if (json && json.blocked) {
        if (onResult) onResult(json);
      } else {
        triggerToast(json.message || json.error || 'No se pudo eliminar la fecha patria', 'error');
        if (onResult) onResult({ error: true, message: json.message || json.error });
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error de conexión', 'error');
      if (onResult) onResult({ error: true });
    }
  }

  async function handleBatchDelete(e) {
    const { ids, onResult, onComplete } = e.detail || {};
    const doneCallback = onResult || onComplete;
    if (!ids || ids.length === 0) return;

    let successCount = 0;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      if (String(id).startsWith('SYS-')) {
        blocked.push({
          id,
          name: `ID: ${id}`,
          reason: 'Fecha patria base del sistema (protegida)'
        });
        continue;
      }
      try {
        const res = await fetch(`/api/master/calendario/${id}`, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) {
          successCount++;
          deleted.push({ id });
        } else if (json && json.blocked) {
          blocked.push({
            id,
            name: json.entityName || `ID: ${id}`,
            reason: json.message || 'Tiene elementos asociados',
            dependencies: json.dependencies || []
          });
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

    if (doneCallback) {
      doneCallback({
        deleted,
        blocked,
        errors,
        successCount,
        total: ids.length,
        entityType: 'fecha patria'
      });
    }
  }

  onMount(() => {
    loadServerData();
    fetchFilterOptions();
    fetchCumpleanos();
  });

  // --- ESTADO DEL CALENDARIO MENSUAL INTERACTIVO ---
  const todayDate = new Date();
  let calCurrentYear = todayDate.getFullYear();
  let calCurrentMonth = todayDate.getMonth(); // 0 a 11

  let calSelectedSalas = [];
  let calSelectedTipos = ['FERIADOS', 'CUMPLEANOS'];

  const TIPO_OPTIONS = [
    { id: 'FERIADOS', nombre: 'Feriados / Fechas Patrias' },
    { id: 'CUMPLEANOS', nombre: 'Cumpleaños de Empleados' }
  ];

  let rawCumpleanos = [];
  let loadingCumpleanos = false;

  async function fetchCumpleanos() {
    loadingCumpleanos = true;
    try {
      const q = new URLSearchParams({
        mes: calCurrentMonth + 1
      });
      if (assignedSalaIds.length > 0) q.set('user_sala_ids', assignedSalaIds.join(','));
      if (calSelectedSalas.length > 0) q.set('sala_ids', calSelectedSalas.join(','));

      const res = await fetch(`/api/master/cumpleanos?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        rawCumpleanos = json.data || [];
      }
    } catch (err) {
      console.warn('Error cargando cumpleaños:', err);
    } finally {
      loadingCumpleanos = false;
    }
  }

  function prevMonth() {
    if (calCurrentMonth === 0) {
      calCurrentMonth = 11;
      calCurrentYear--;
    } else {
      calCurrentMonth--;
    }
    fetchCumpleanos();
  }

  function nextMonth() {
    if (calCurrentMonth === 11) {
      calCurrentMonth = 0;
      calCurrentYear++;
    } else {
      calCurrentMonth++;
    }
    fetchCumpleanos();
  }

  function goToToday() {
    calCurrentYear = todayDate.getFullYear();
    calCurrentMonth = todayDate.getMonth();
    fetchCumpleanos();
  }

  function printCalendar() {
    window.print();
  }

  $: calMonthName = MESES[calCurrentMonth]?.nombre || '';
  $: calMonthTitle = `${calMonthName} ${calCurrentYear}`;

  const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  $: calendarMatrix = (function() {
    const firstDayRaw = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
    const startDayOffset = (firstDayRaw + 6) % 7; // Lunes = 0, Domingo = 6

    const daysInCurrentMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calCurrentYear, calCurrentMonth, 0).getDate();

    const cells = [];

    // Días del mes previo
    for (let i = startDayOffset - 1; i >= 0; i--) {
      cells.push({
        day: daysInPrevMonth - i,
        isCurrentMonth: false,
        isToday: false,
        events: []
      });
    }

    // Días del mes actual
    const currentMonthNum = calCurrentMonth + 1;
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const isToday = (
        d === todayDate.getDate() &&
        calCurrentMonth === todayDate.getMonth() &&
        calCurrentYear === todayDate.getFullYear()
      );

      const dayEvents = [];

      // 1. Feriados
      if (calSelectedTipos.includes('FERIADOS')) {
        // Fechas Base Nacionales
        const baseHols = BASE_FERIADOS.filter(bf => bf.mes === currentMonthNum && bf.dia === d);
        for (const bh of baseHols) {
          dayEvents.push({
            type: 'feriado_nacional',
            id: bh.id,
            title: bh.nombre,
            subtitle: 'Nacional'
          });
        }

        // Fechas de Salas en DB
        let serverHols = rawServerItems.filter(rf => Number(rf.mes) === currentMonthNum && Number(rf.dia) === d);
        if (calSelectedSalas.length > 0) {
          const salaSet = new Set(calSelectedSalas.map(Number));
          serverHols = serverHols.filter(rf => salaSet.has(Number(rf.sala_id)));
        }
        for (const sh of serverHols) {
          dayEvents.push({
            type: 'feriado_sala',
            id: sh.id,
            title: sh.nombre,
            subtitle: sh.sala_nombre || 'Sala'
          });
        }
      }

      // 2. Cumpleaños
      if (calSelectedTipos.includes('CUMPLEANOS')) {
        let emps = rawCumpleanos.filter(c => Number(c.dia) === d);
        if (calSelectedSalas.length > 0) {
          const salaSet = new Set(calSelectedSalas.map(Number));
          emps = emps.filter(c => salaSet.has(Number(c.sala_id)));
        }
        for (const emp of emps) {
          const age = emp.anio_nacimiento ? (calCurrentYear - emp.anio_nacimiento) : null;
          dayEvents.push({
            type: 'cumpleanos',
            id: emp.id,
            title: emp.nombre,
            age,
            foto: emp.foto,
            salaNombre: emp.sala_nombre,
            cargoNombre: emp.cargo_nombre
          });
        }
      }

      cells.push({
        day: d,
        isCurrentMonth: true,
        isToday,
        events: dayEvents
      });
    }

    // Días del mes siguiente para completar la cuadrícula
    const remainder = cells.length % 7;
    if (remainder > 0) {
      const needed = 7 - remainder;
      for (let n = 1; n <= needed; n++) {
        cells.push({
          day: n,
          isCurrentMonth: false,
          isToday: false,
          events: []
        });
      }
    }

    return cells;
  })();
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

<!-- CALENDARIO MENSUAL INTERACTIVO -->
<div class="monthly-calendar-section">
  <!-- Filtros superiores del Calendario -->
  <div class="cal-controls-card">
    <div class="cal-filters-heading">
      <span class="cal-section-icon">📅</span>
      <span class="cal-section-title">Vista de Calendario Mensual</span>
      <span class="cal-section-subtitle">Filtra por salas y tipo de evento (feriados y cumpleaños de empleados):</span>
    </div>

    <div class="cal-filters-row">
      <div class="cal-filter-col">
        <SmartMultiSelect
          id="filter-monthly-cal-salas"
          label="Salas"
          options={filterOptions.salas}
          bind:selectedValues={calSelectedSalas}
          on:change={fetchCumpleanos}
        />
      </div>

      <div class="cal-filter-col">
        <SmartMultiSelect
          id="filter-monthly-cal-tipos"
          label="Tipo de Evento"
          options={TIPO_OPTIONS}
          bind:selectedValues={calSelectedTipos}
        />
      </div>
    </div>
  </div>

  <!-- Tarjeta Principal del Calendario -->
  <div class="monthly-calendar-card" id="printable-monthly-calendar">
    <!-- Cabecera del Calendario -->
    <div class="cal-top-header">
      <div class="cal-nav-group">
        <button type="button" class="cal-nav-arrow" on:click={prevMonth} title="Mes anterior">
          <span>◀</span>
        </button>
        <h3 class="cal-month-title">{calMonthTitle}</h3>
        <button type="button" class="cal-nav-arrow" on:click={nextMonth} title="Mes siguiente">
          <span>▶</span>
        </button>
      </div>

      <div class="cal-actions-group">
        <button type="button" class="cal-btn-today" on:click={goToToday} title="Ir al mes actual">
          Hoy
        </button>
        <button type="button" class="cal-btn-print" on:click={printCalendar} title="Imprimir este calendario">
          <span class="print-icon">🖨️</span> Imprimir
        </button>
      </div>
    </div>

    <!-- Barra de días de la semana -->
    <div class="cal-weekdays-grid">
      {#each WEEKDAYS as wd}
        <div class="cal-weekday-cell">{wd}</div>
      {/each}
    </div>

    <!-- Cuadrícula de días -->
    <div class="cal-days-grid">
      {#each calendarMatrix as cell}
        <div class="cal-day-cell {cell.isCurrentMonth ? 'is-current' : 'is-outside'} {cell.isToday ? 'is-today' : ''}">
          <div class="cal-day-header">
            <span class="cal-day-num {cell.isToday ? 'today-badge' : ''}">{cell.day}</span>
          </div>

          <div class="cal-events-list">
            {#each cell.events as evt}
              {#if evt.type === 'cumpleanos'}
                <div 
                  class="cal-event-item evt-cumple" 
                  title="{evt.title} ({evt.age ? evt.age + ' años' : ''}) - {evt.salaNombre} ({evt.cargoNombre})"
                >
                  <img 
                    src="{evt.foto}" 
                    alt="{evt.title}" 
                    class="cal-avatar-img"
                    on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <span class="cal-emp-name">{evt.title}</span>
                  {#if evt.age !== null}
                    <span class="cal-emp-age">( {evt.age} )</span>
                  {/if}
                </div>
              {:else if evt.type === 'feriado_nacional'}
                <div 
                  class="cal-event-item evt-feriado-nac" 
                  title="{evt.title} - Nacional (Aplica a todas las salas)"
                >
                  <span class="cal-icon-feriado">🇻🇪</span>
                  <span class="cal-feriado-title">{evt.title}</span>
                </div>
              {:else if evt.type === 'feriado_sala'}
                <div 
                  class="cal-event-item evt-feriado-sala" 
                  title="{evt.title} - {evt.subtitle}"
                >
                  <span class="cal-icon-feriado">🏛️</span>
                  <span class="cal-feriado-title">{evt.title}</span>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .monthly-calendar-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    margin-top: 24px;
  }

  .cal-controls-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  }

  .cal-filters-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #1e293b;
    flex-wrap: wrap;
  }

  .cal-section-icon {
    font-size: 15px;
  }

  .cal-section-title {
    font-weight: 800;
    color: #0f172a;
  }

  .cal-section-subtitle {
    color: #64748b;
    font-size: 12px;
  }

  .cal-filters-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
  }

  .cal-filter-col {
    width: 100%;
  }

  .monthly-calendar-card {
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
    overflow: hidden;
    width: 100%;
    box-sizing: border-box;
  }

  .cal-top-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    position: relative;
  }

  .cal-nav-group {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 auto;
  }

  .cal-nav-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: #16a34a;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .cal-nav-arrow:hover {
    background: #15803d;
    transform: scale(1.04);
  }

  .cal-month-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
    text-transform: capitalize;
    letter-spacing: -0.2px;
    min-width: 160px;
    text-align: center;
  }

  .cal-actions-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cal-btn-today {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cal-btn-today:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .cal-btn-print {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 6px;
    border: none;
    background: #475569;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .cal-btn-print:hover {
    background: #334155;
  }

  .print-icon {
    font-size: 13px;
  }

  .cal-weekdays-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .cal-weekday-cell {
    padding: 8px 4px;
    text-align: center;
    font-size: 12px;
    font-weight: 800;
    color: #475569;
    border-right: 1px solid #e2e8f0;
  }

  .cal-weekday-cell:last-child {
    border-right: none;
  }

  .cal-days-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    background: #cbd5e1;
    gap: 1px;
    border-bottom: 1px solid #e2e8f0;
  }

  .cal-day-cell {
    background: #ffffff;
    min-height: 100px;
    padding: 6px 6px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
  }

  .cal-day-cell.is-outside {
    background: #f8fafc;
  }

  .cal-day-cell.is-today {
    background: #f0fdf4;
  }

  .cal-day-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }

  .cal-day-num {
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
  }

  .cal-day-cell.is-outside .cal-day-num {
    color: #94a3b8;
  }

  .today-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff !important;
  }

  .cal-events-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
    max-height: 130px;
  }

  .cal-event-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 11px;
    box-sizing: border-box;
    min-width: 0;
  }

  .evt-cumple {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .cal-avatar-img {
    width: 17px;
    height: 17px;
    border-radius: 50%;
    object-fit: cover;
    background: #cbd5e1;
    flex-shrink: 0;
  }

  .cal-emp-name {
    font-weight: 700;
    color: #1e293b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .cal-emp-age {
    font-weight: 800;
    color: #16a34a;
    font-size: 10.5px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .evt-feriado-nac {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
  }

  .evt-feriado-sala {
    background: #faf5ff;
    border: 1px solid #e9d5ff;
  }

  .cal-icon-feriado {
    font-size: 11px;
    flex-shrink: 0;
  }

  .cal-feriado-title {
    font-weight: 800;
    color: #1e3a8a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .evt-feriado-sala .cal-feriado-title {
    color: #7e22ce;
  }

  @media (max-width: 768px) {
    .cal-filters-row {
      grid-template-columns: 1fr;
    }

    .cal-top-header {
      flex-direction: column;
      gap: 10px;
    }

    .cal-nav-group {
      margin: 0;
    }

    .cal-day-cell {
      min-height: 75px;
      padding: 3px;
    }

    .cal-emp-name {
      max-width: 50px;
    }
  }

  @media print {
    :global(body *) {
      visibility: hidden !important;
    }

    .monthly-calendar-card,
    .monthly-calendar-card * {
      visibility: visible !important;
    }

    .monthly-calendar-card {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 1px solid #94a3b8 !important;
      box-shadow: none !important;
    }

    .cal-actions-group,
    .cal-nav-arrow,
    .cal-controls-card {
      display: none !important;
    }

    .cal-top-header {
      justify-content: center !important;
      border-bottom: 2px solid #334155 !important;
    }

    .cal-day-cell {
      min-height: 120px !important;
    }

    @page {
      size: landscape;
      margin: 8mm;
    }
  }

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
