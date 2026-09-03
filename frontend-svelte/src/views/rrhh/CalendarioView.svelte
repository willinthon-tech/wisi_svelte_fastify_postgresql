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

  let selectedDayModalData = null;

  function openDayModal(cell) {
    if (!cell || !cell.isCurrentMonth) return;
    selectedDayModalData = {
      day: cell.day,
      monthName: MESES[calCurrentMonth]?.nombre || '',
      year: calCurrentYear,
      cumples: cell.cumpleEvents || [],
      feriados: cell.feriadoEvents || []
    };
  }

  function closeDayModal() {
    selectedDayModalData = null;
  }

  $: calMonthName = MESES[calCurrentMonth]?.nombre || '';
  $: calMonthTitle = `${calMonthName} ${calCurrentYear}`;

  // Nombre de sala para la cabecera (si es una sola sala seleccionada o asignada)
  $: singleSalaName = (function() {
    // 1. Si hay 1 sala seleccionada en calSelectedSalas
    if (calSelectedSalas && calSelectedSalas.length === 1) {
      const sId = String(calSelectedSalas[0]);
      // En filterOptions.salas
      const f1 = (filterOptions.salas || []).find(s => String(s.id ?? s.value) === sId);
      if (f1) return (f1.nombre || f1.label || '').toUpperCase();
      // En masterSalasStore
      const f2 = ($masterSalasStore || []).find(s => String(s.id) === sId);
      if (f2) return (f2.nombre || '').toUpperCase();
      // En rawCumpleanos
      const f3 = rawCumpleanos.find(c => String(c.sala_id) === sId);
      if (f3 && f3.sala_nombre) return f3.sala_nombre.toUpperCase();
      // En rawServerItems
      const f4 = rawServerItems.find(rf => String(rf.sala_id) === sId);
      if (f4 && f4.sala_nombre) return f4.sala_nombre.toUpperCase();
    }
    // 2. Si no seleccionó nada pero solo tiene 1 sala asignada o disponible
    if (!calSelectedSalas || calSelectedSalas.length === 0) {
      if (assignedSalaIds && assignedSalaIds.length === 1) {
        const sId = String(assignedSalaIds[0]);
        const f1 = ($masterSalasStore || []).find(s => String(s.id) === sId) ||
                   (filterOptions.salas || []).find(s => String(s.id ?? s.value) === sId);
        if (f1) return (f1.nombre || f1.label || '').toUpperCase();
      }
      if ($masterSalasStore && $masterSalasStore.length === 1) {
        return ($masterSalasStore[0].nombre || '').toUpperCase();
      }
    }
    return '';
  })();

  // Resumen para impresión: Cumpleañeros del mes agrupados por Departamento
  $: printCumpleanosGrouped = (function() {
    let emps = [...rawCumpleanos];
    if (calSelectedSalas.length > 0) {
      const salaSet = new Set(calSelectedSalas.map(Number));
      emps = emps.filter(c => salaSet.has(Number(c.sala_id)));
    }
    emps.sort((a, b) => Number(a.dia) - Number(b.dia) || a.nombre.localeCompare(b.nombre));

    const groups = {};
    for (const emp of emps) {
      const depKey = emp.departamento_nombre || emp.sala_nombre || 'General';
      if (!groups[depKey]) {
        groups[depKey] = [];
      }
      const age = emp.anio_nacimiento ? (calCurrentYear - emp.anio_nacimiento) : null;
      groups[depKey].push({
        ...emp,
        age
      });
    }
    return groups;
  })();

  // Total de cumpleañeros del mes filtrados
  $: totalCumpleanosMonth = (function() {
    let count = 0;
    for (const list of Object.values(printCumpleanosGrouped)) {
      count += list.length;
    }
    return count;
  })();

  // Resumen para impresión: Feriados del mes
  $: printFeriadosMonth = (function() {
    const list = [];
    const currentMonthNum = calCurrentMonth + 1;

    // 1. Base nacionales
    for (const bf of BASE_FERIADOS) {
      if (bf.mes === currentMonthNum) {
        list.push({
          dia: bf.dia,
          nombre: bf.nombre,
          tipo: 'Nacional',
          sala: 'Todas las salas'
        });
      }
    }

    // 2. Feriados de sala en DB
    let serverHols = rawServerItems.filter(rf => Number(rf.mes) === currentMonthNum);
    if (calSelectedSalas.length > 0) {
      const salaSet = new Set(calSelectedSalas.map(Number));
      serverHols = serverHols.filter(rf => salaSet.has(Number(rf.sala_id)));
    }
    for (const sh of serverHols) {
      list.push({
        dia: Number(sh.dia),
        nombre: sh.nombre,
        tipo: 'Sala',
        sala: sh.sala_nombre || 'Sala'
      });
    }

    list.sort((a, b) => a.dia - b.dia);
    return list;
  })();

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
        cumpleEvents: [],
        feriadoEvents: [],
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

      const feriadoEvents = [];
      const cumpleEvents = [];

      // 1. Cumpleaños (encima)
      if (calSelectedTipos.includes('CUMPLEANOS')) {
        let emps = rawCumpleanos.filter(c => Number(c.dia) === d);
        if (calSelectedSalas.length > 0) {
          const salaSet = new Set(calSelectedSalas.map(Number));
          emps = emps.filter(c => salaSet.has(Number(c.sala_id)));
        }
        for (const emp of emps) {
          const age = emp.anio_nacimiento ? (calCurrentYear - emp.anio_nacimiento) : null;
          cumpleEvents.push({
            type: 'cumpleanos',
            id: emp.id,
            title: emp.nombre,
            cedula: emp.cedula,
            age,
            foto: emp.foto,
            salaNombre: emp.sala_nombre,
            cargoNombre: emp.cargo_nombre
          });
        }
      }

      // 2. Feriados (abajo)
      if (calSelectedTipos.includes('FERIADOS')) {
        // Fechas Base Nacionales
        const baseHols = BASE_FERIADOS.filter(bf => bf.mes === currentMonthNum && bf.dia === d);
        for (const bh of baseHols) {
          feriadoEvents.push({
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
          feriadoEvents.push({
            type: 'feriado_sala',
            id: sh.id,
            title: sh.nombre,
            subtitle: sh.sala_nombre || 'Sala'
          });
        }
      }

      cells.push({
        day: d,
        isCurrentMonth: true,
        isToday,
        cumpleEvents,
        feriadoEvents,
        events: [...cumpleEvents, ...feriadoEvents]
      });
    }

    // Completar la cuadrícula siempre a 42 celdas (6 filas exactas de 7 días)
    // Esto asegura que todos los cuadros de cada día midan lo mismo mes a mes de todo el año
    let nextMonthDay = 1;
    while (cells.length < 42) {
      cells.push({
        day: nextMonthDay++,
        isCurrentMonth: false,
        isToday: false,
        cumpleEvents: [],
        feriadoEvents: [],
        events: []
      });
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
      <!-- Izquierda: Nombre de sala para impresión / vista -->
      <div class="cal-header-left">
        {#if singleSalaName}
          <span class="cal-print-sala-name">{singleSalaName}</span>
        {/if}
      </div>

      <!-- Centro: Navegación y Título del Mes -->
      <div class="cal-nav-group">
        <button type="button" class="cal-nav-arrow print-hidden" on:click={prevMonth} title="Mes anterior">
          <span>◀</span>
        </button>
        <h3 class="cal-month-title">{calMonthTitle}</h3>
        <button type="button" class="cal-nav-arrow print-hidden" on:click={nextMonth} title="Mes siguiente">
          <span>▶</span>
        </button>
      </div>

      <!-- Derecha: Botones en pantalla / spacer en impresión -->
      <div class="cal-header-right">
        <div class="cal-actions-group print-hidden">
          <button type="button" class="cal-btn-today" on:click={goToToday} title="Ir al mes actual">
            Hoy
          </button>
          <button type="button" class="cal-btn-print" on:click={printCalendar} title="Imprimir este calendario">
            <span class="print-icon">🖨️</span> Imprimir
          </button>
        </div>
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
        <div 
          class="cal-day-cell {cell.isCurrentMonth ? 'is-current' : 'is-outside'} {cell.isToday ? 'is-today' : ''}"
          on:click={() => openDayModal(cell)}
          title={cell.isCurrentMonth ? `Ver detalles del día ${cell.day} de ${calMonthName}` : ''}
        >
          <div class="cal-day-header">
            <span class="cal-day-num {cell.isToday ? 'today-badge' : ''}">{cell.day}</span>
          </div>

          <div class="cal-events-list">
            <!-- 1. Cumpleaños encima (col-3, 4 por fila) -->
            {#if cell.cumpleEvents && cell.cumpleEvents.length > 0}
              <div class="cal-cumples-grid">
                {#each cell.cumpleEvents as evt}
                  <div 
                    class="cal-event-item evt-cumple" 
                    title="{evt.title} (cumple {evt.age} años) - {evt.salaNombre} ({evt.cargoNombre})"
                  >
                    <img 
                      src="{evt.foto}" 
                      alt="{evt.title}" 
                      class="cal-avatar-img"
                      on:error={(e) => { e.currentTarget.src = '/user.png'; }}
                    />
                    {#if evt.age !== null && evt.age > 0}
                      <span class="cal-age-single-green">{evt.age}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <!-- 2. Feriados abajo (col-6, 2 por fila) -->
            {#if cell.feriadoEvents && cell.feriadoEvents.length > 0}
              <div class="cal-feriados-grid">
                {#each cell.feriadoEvents as evt}
                  {#if evt.type === 'feriado_nacional'}
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
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- RESUMEN INFERIOR EXCLUSIVO PARA IMPRESIÓN (Cumpleañeros y Feriados con flujo a 2 columnas) -->
    <div class="cal-print-bottom-summary">
      <!-- 1. Bloque Cumpleañeros del Mes -->
      <div class="cal-print-section-block cal-print-cumples-block">
        <h4 class="cal-print-col-title">CUMPLEAÑEROS DEL MES ({totalCumpleanosMonth})</h4>
        {#if Object.keys(printCumpleanosGrouped).length > 0}
          <div class="cal-print-groups-list">
            {#each Object.entries(printCumpleanosGrouped) as [depName, empList]}
              <div class="cal-print-dep-group">
                <h5 class="cal-print-dep-title">{depName.toUpperCase()}</h5>
                <div class="cal-print-emp-items">
                  {#each empList as emp}
                    <div class="cal-print-emp-row">
                      <span class="print-emp-bullet">•</span>
                      <span class="print-emp-day">Día {emp.dia}:</span>
                      <span class="print-emp-name">{emp.nombre}</span>
                      {#if emp.cargo_nombre}
                        <span class="print-emp-cargo">({emp.cargo_nombre})</span>
                      {/if}
                      {#if emp.age !== null && emp.age > 0}
                        <span class="print-emp-age">- {emp.age} años</span>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="cal-print-empty">No hay cumpleaños registrados para este mes.</p>
        {/if}
      </div>

      <!-- 2. Bloque Feriados del Mes (debajo de cumpleaños, y fluye a la otra columna si sobrepasa) -->
      <div class="cal-print-section-block cal-print-feriados-block">
        <h4 class="cal-print-col-title">FERIADOS DEL MES</h4>
        {#if printFeriadosMonth.length > 0}
          <div class="cal-print-feriados-list">
            {#each printFeriadosMonth as fer}
              <div class="cal-print-feriado-row">
                <span class="print-fer-bullet">•</span>
                <span class="print-fer-day">Día {fer.dia}:</span>
                <span class="print-fer-name">{fer.nombre}</span>
                <span class="print-fer-scope">({fer.sala})</span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="cal-print-empty">No hay feriados registrados para este mes.</p>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- MODAL DE DETALLES DEL DÍA -->
{#if selectedDayModalData}
  <div class="day-modal-backdrop" on:click={closeDayModal}>
    <div class="day-modal-card" on:click|stopPropagation>
      <!-- Header -->
      <div class="day-modal-header">
        <div class="day-modal-title-group">
          <span class="day-modal-cal-icon">📅</span>
          <div>
            <h3 class="day-modal-title">
              {selectedDayModalData.day} de {selectedDayModalData.monthName} {selectedDayModalData.year}
            </h3>
            <p class="day-modal-subtitle">Resumen de eventos, cumpleaños y fechas patrias</p>
          </div>
        </div>
        <button type="button" class="day-modal-close" on:click={closeDayModal} title="Cerrar ventana">✕</button>
      </div>

      <!-- Body -->
      <div class="day-modal-body">
        <!-- 1. CUMPLEAÑEROS -->
        <div class="modal-section-box">
          <div class="modal-sec-header cumple-header">
            <span class="sec-icon">🎂</span>
            <span class="sec-title">Cumpleañeros del Día</span>
            <span class="sec-count-badge badge-green">{selectedDayModalData.cumples.length}</span>
          </div>

          {#if selectedDayModalData.cumples.length > 0}
            <div class="modal-cumples-cards-grid">
              {#each selectedDayModalData.cumples as c}
                <div class="modal-cumple-item-card">
                  <img 
                    src="{c.foto}" 
                    alt="{c.title}" 
                    class="modal-emp-img" 
                    on:error={(e) => { e.currentTarget.src = '/user.png'; }}
                  />
                  <div class="modal-emp-details">
                    <div class="modal-emp-top">
                      <span class="modal-emp-name">{c.title}</span>
                      {#if c.age !== null && c.age > 0}
                        <span class="modal-emp-age-badge">Cumple {c.age} años 🎂</span>
                      {/if}
                    </div>
                    <div class="modal-emp-bottom">
                      <span class="modal-emp-tag tag-sala">🏛️ {c.salaNombre}</span>
                      {#if c.cargoNombre}
                        <span class="modal-emp-tag tag-cargo">💼 {c.cargoNombre}</span>
                      {/if}
                      {#if c.cedula}
                        <span class="modal-emp-tag tag-cedula">🪪 {c.cedula}</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="modal-empty-state">
              <span class="empty-icon">🎈</span>
              <p>No hay cumpleaños registrados para este día.</p>
            </div>
          {/if}
        </div>

        <!-- 2. FERIADOS / FECHAS PATRIAS -->
        <div class="modal-section-box">
          <div class="modal-sec-header feriado-header">
            <span class="sec-icon">🏛️</span>
            <span class="sec-title">Fechas Patrias y Feriados</span>
            <span class="sec-count-badge badge-blue">{selectedDayModalData.feriados.length}</span>
          </div>

          {#if selectedDayModalData.feriados.length > 0}
            <div class="modal-feriados-cards-grid">
              {#each selectedDayModalData.feriados as f}
                <div class="modal-feriado-item-card {f.type === 'feriado_nacional' ? 'border-nac' : 'border-sala'}">
                  <div class="modal-feriado-flag">
                    {f.type === 'feriado_nacional' ? '🇻🇪' : '🏛️'}
                  </div>
                  <div class="modal-feriado-details">
                    <span class="modal-feriado-name">{f.title}</span>
                    <span class="modal-feriado-type-badge {f.type === 'feriado_nacional' ? 'type-nac' : 'type-sala'}">
                      {f.type === 'feriado_nacional' ? 'Fecha Patria Nacional (Aplica a todas las salas)' : `Fecha Feriada de Sala: ${f.subtitle}`}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="modal-empty-state">
              <span class="empty-icon">🗓️</span>
              <p>No hay feriados ni fechas patrias registradas para este día.</p>
            </div>
          {/if}
        </div>
      </div>

      <!-- Footer -->
      <div class="day-modal-footer">
        <button type="button" class="btn-modal-close-action" on:click={closeDayModal}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}

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

  .cal-header-left {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }

  .cal-print-sala-name {
    font-size: 13px;
    font-weight: 800;
    color: #1e3a8a;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .cal-nav-group {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 auto;
  }

  .cal-header-right {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
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
    grid-template-columns: repeat(7, minmax(0, 1fr));
    grid-template-rows: repeat(6, 110px);
    background: #cbd5e1;
    gap: 1px;
    border-bottom: 1px solid #e2e8f0;
  }

  .cal-day-cell {
    background: #ffffff;
    height: 110px;
    min-height: 110px;
    max-height: 110px;
    padding: 5px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow: hidden;
  }

  .cal-day-cell.is-outside {
    background: #f8fafc;
  }

  .cal-day-cell.is-today {
    background: #f0fdf4;
  }

  .cal-day-cell.is-current {
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cal-day-cell.is-current:hover {
    background: #f1f5f9;
    box-shadow: inset 0 0 0 2px #3b82f6;
    z-index: 2;
  }

  .cal-day-cell.is-current.is-today:hover {
    background: #dcfce7;
    box-shadow: inset 0 0 0 2px #16a34a;
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
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff !important;
  }

  .cal-events-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    scrollbar-width: thin;
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

  .cal-cumples-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2.5px;
    width: 100%;
  }

  .evt-cumple {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 2px 2px;
    border-radius: 5px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .cal-avatar-img {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
    background: #cbd5e1;
    flex-shrink: 0;
    border: 1px solid #e2e8f0;
  }

  .cal-age-single-green {
    font-size: 10.5px;
    font-weight: 800;
    color: #16a34a;
    line-height: 1;
    white-space: nowrap;
  }

  .cal-feriados-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
    width: 100%;
  }

  .evt-feriado-nac,
  .evt-feriado-sala {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px;
    border-radius: 4px;
    min-width: 0;
    box-sizing: border-box;
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

  .cal-print-bottom-summary {
    display: none;
  }

  @media print {
    @page {
      size: portrait;
      margin: 14mm;
    }

    :global(body *) {
      visibility: hidden !important;
    }

    .monthly-calendar-card,
    .monthly-calendar-card * {
      visibility: visible !important;
    }

    .monthly-calendar-card {
      position: absolute !important;
      left: 14mm !important;
      top: 14mm !important;
      right: 14mm !important;
      width: calc(100% - 28mm) !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 1.5px solid #0f172a !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .print-hidden,
    .cal-actions-group,
    .cal-nav-arrow,
    .cal-controls-card,
    .plantillas-base-banner,
    .day-modal-backdrop {
      display: none !important;
    }

    .cal-top-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 5px 8px !important;
      border-bottom: 2px solid #0f172a !important;
    }

    .cal-header-left {
      flex: 1 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
    }

    .cal-print-sala-name {
      display: block !important;
      font-size: 13px !important;
      font-weight: 900 !important;
      color: #0f172a !important;
      letter-spacing: 0.5px !important;
      text-transform: uppercase !important;
      white-space: nowrap !important;
    }

    .cal-nav-group {
      flex: 2 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      margin: 0 !important;
    }

    .cal-month-title {
      font-size: 18px !important;
      font-weight: 900 !important;
      color: #000000 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
      text-align: center !important;
      width: auto !important;
    }

    .cal-header-right {
      flex: 1 !important;
      display: block !important;
    }

    .cal-weekdays-grid {
      background: #f8fafc !important;
      border-bottom: 1.5px solid #0f172a !important;
    }

    .cal-weekday-cell {
      padding: 3px 2px !important;
      font-size: 10.5px !important;
      font-weight: 800 !important;
      color: #000000 !important;
      border-right: 1px solid #cbd5e1 !important;
    }

    .cal-days-grid {
      display: grid !important;
      grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
      grid-template-rows: repeat(6, 58px) !important;
      border-bottom: 2px solid #0f172a !important;
      background: #cbd5e1 !important;
      gap: 1px !important;
    }

    .cal-day-cell {
      height: 58px !important;
      min-height: 58px !important;
      max-height: 58px !important;
      padding: 2px 2px !important;
      border-right: 1px solid #cbd5e1 !important;
      border-bottom: 1px solid #cbd5e1 !important;
      overflow: hidden !important;
      background: #ffffff !important;
      box-sizing: border-box !important;
    }

    .cal-day-cell.is-outside {
      background: #f8fafc !important;
    }

    .cal-day-num {
      font-size: 9.5px !important;
      font-weight: 700 !important;
    }

    .today-badge {
      width: 15px !important;
      height: 15px !important;
      font-size: 8.5px !important;
    }

    .cal-cumples-grid {
      display: grid !important;
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      gap: 2px !important;
      width: 100% !important;
    }

    .cal-event-item.evt-cumple {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    .cal-avatar-img {
      width: 16px !important;
      height: 16px !important;
      border-radius: 50% !important;
      border: 1px solid #64748b !important;
      margin: 0 auto !important;
    }

    /* Ocultar edad en versión de impresión dentro de los días del calendario */
    .cal-age-single-green {
      display: none !important;
    }

    .cal-icon-feriado {
      font-size: 8px !important;
    }

    .cal-feriado-title {
      font-size: 8px !important;
    }

    /* Resumen inferior con flujo dinámico a 2 columnas (feriados debajo de cumpleaños) */
    .cal-print-bottom-summary {
      display: block !important;
      columns: 2 !important;
      column-gap: 20px !important;
      margin-top: 10px !important;
      padding: 8px 6px !important;
      border-top: 2px solid #0f172a !important;
      background: #ffffff !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .cal-print-section-block {
      break-inside: auto !important;
      page-break-inside: auto !important;
    }

    .cal-print-cumples-block {
      margin-bottom: 10px !important;
    }

    .cal-print-feriados-block {
      margin-top: 10px !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }

    .cal-print-col-title {
      font-size: 12px !important;
      font-weight: 900 !important;
      color: #000000 !important;
      margin: 0 0 5px 0 !important;
      border-bottom: 1.5px solid #000000 !important;
      padding-bottom: 2px !important;
      letter-spacing: 0.5px !important;
      text-transform: uppercase !important;
      break-after: avoid !important;
      page-break-after: avoid !important;
    }

    .cal-print-groups-list {
      display: flex !important;
      flex-direction: column !important;
      gap: 6px !important;
    }

    .cal-print-dep-group {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      margin-bottom: 5px !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 1.5px !important;
    }

    .cal-print-dep-title {
      font-size: 10px !important;
      font-weight: 800 !important;
      color: #1e3a8a !important;
      margin: 2px 0 1px 0 !important;
      text-transform: uppercase !important;
      border-bottom: 1px dashed #cbd5e1 !important;
      padding-bottom: 1px !important;
      break-after: avoid !important;
      page-break-after: avoid !important;
    }

    .cal-print-emp-items,
    .cal-print-feriados-list {
      display: flex !important;
      flex-direction: column !important;
      gap: 1.5px !important;
    }

    .cal-print-emp-row,
    .cal-print-feriado-row {
      font-size: 9px !important;
      color: #0f172a !important;
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
      line-height: 1.3 !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }

    .print-emp-bullet,
    .print-fer-bullet {
      font-size: 10px !important;
      color: #64748b !important;
    }

    .print-emp-day,
    .print-fer-day {
      font-weight: 800 !important;
      color: #0f172a !important;
      min-width: 40px !important;
    }

    .print-emp-name,
    .print-fer-name {
      font-weight: 700 !important;
      color: #0f172a !important;
    }

    .print-emp-cargo,
    .print-fer-scope {
      color: #475569 !important;
      font-size: 8.5px !important;
    }

    .print-emp-age {
      font-weight: 800 !important;
      color: #15803d !important;
      margin-left: auto !important;
    }

    .cal-print-empty {
      font-size: 9.5px !important;
      color: #64748b !important;
      font-style: italic !important;
      margin: 3px 0 !important;
    }
  }

  /* MODAL DE DETALLES DEL DÍA */
  .day-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    padding: 16px;
    box-sizing: border-box;
    animation: fadeInModal 0.15s ease-out;
  }

  .day-modal-card {
    background: #ffffff;
    border-radius: 14px;
    width: 100%;
    max-width: 620px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    animation: scaleInModal 0.18s ease-out;
  }

  @keyframes fadeInModal {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes scaleInModal {
    from { transform: scale(0.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .day-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .day-modal-title-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .day-modal-cal-icon {
    font-size: 26px;
  }

  .day-modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
    text-transform: capitalize;
  }

  .day-modal-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: #64748b;
  }

  .day-modal-close {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: #e2e8f0;
    color: #475569;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .day-modal-close:hover {
    background: #cbd5e1;
    color: #0f172a;
  }

  .day-modal-body {
    padding: 18px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-section-box {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .modal-sec-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
  }

  .cumple-header {
    background: #f0fdf4;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .feriado-header {
    background: #eff6ff;
    color: #1e40af;
    border: 1px solid #bfdbfe;
  }

  .sec-count-badge {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11.5px;
    font-weight: 800;
  }

  .badge-green {
    background: #16a34a;
    color: #ffffff;
  }

  .badge-blue {
    background: #2563eb;
    color: #ffffff;
  }

  .modal-cumples-cards-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .modal-cumple-item-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
    transition: all 0.15s ease;
  }

  .modal-cumple-item-card:hover {
    border-color: #86efac;
    background: #f9fdfa;
  }

  .modal-emp-img {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    background: #cbd5e1;
    border: 2px solid #e2e8f0;
    flex-shrink: 0;
  }

  .modal-emp-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .modal-emp-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .modal-emp-name {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .modal-emp-age-badge {
    padding: 3px 8px;
    border-radius: 6px;
    background: #dcfce7;
    color: #15803d;
    font-size: 11.5px;
    font-weight: 800;
  }

  .modal-emp-bottom {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .modal-emp-tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
  }

  .tag-sala {
    background: #f1f5f9;
    color: #334155;
  }

  .tag-cargo {
    background: #f8fafc;
    color: #475569;
    border: 1px solid #e2e8f0;
  }

  .tag-cedula {
    background: #fef3c7;
    color: #92400e;
  }

  .modal-feriados-cards-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .modal-feriado-item-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #ffffff;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  }

  .modal-feriado-item-card.border-nac {
    border-left: 4px solid #2563eb;
    background: #f8fafc;
  }

  .modal-feriado-item-card.border-sala {
    border-left: 4px solid #9333ea;
    background: #faf5ff;
  }

  .modal-feriado-flag {
    font-size: 24px;
    flex-shrink: 0;
  }

  .modal-feriado-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .modal-feriado-name {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .modal-feriado-type-badge {
    font-size: 11.5px;
    color: #64748b;
  }

  .modal-empty-state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px dashed #cbd5e1;
    color: #64748b;
    font-size: 12px;
  }

  .day-modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .btn-modal-close-action {
    padding: 7px 18px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-modal-close-action:hover {
    background: #f1f5f9;
    color: #0f172a;
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
