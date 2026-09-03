<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentReportesFilters = writable({
    selectedSalas: [],
    selectedDispositivoIds: [],
    selectedDepartamentos: [],
    selectedAreas: [],
    selectedCargos: [],
    selectedSexo: [],
    searchQuery: "",
    pageSize: 10,
    currentPage: 1,
    fechaDesde: "",
    fechaHasta: "",
    hasSearched: false,
    reportData: {
      mesesAgrupados: [],
      diasDelMes: [],
      salas: [],
      empleados: []
    },
    allEvaluatedEmployees: []
  });
</script>

<script>
  import { onMount } from "svelte";
  import { currentUserStore, userSalasStore as authUserSalasStore } from "../../controllers/auth.store.js";
  import { userSalasStore as masterUserSalasStore } from "../../controllers/master.store.js";
  import { triggerToast } from "../../controllers/ui.store.js";
  import SmartMultiSelect from "../../components/common/SmartMultiSelect.svelte";
  import ExcepcionHorarioModal from "../../components/modals/ExcepcionHorarioModal.svelte";

  export let items = [];
  $: void items;

  function toTitleCase(str) {
    if (!str || typeof str !== "string") return str;
    return str
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  // Initialize from persistent store so filters survive route/tab transitions
  let initial = {};
  const unsubInit = persistentReportesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let selectedDispositivoIds = initial.selectedDispositivoIds || [];
  let selectedDepartamentos = initial.selectedDepartamentos || [];
  let selectedAreas = initial.selectedAreas || [];
  let selectedCargos = initial.selectedCargos || [];
  let selectedSexo = initial.selectedSexo || [];

  // Filter and Pagination Options
  let currentPage = initial.currentPage || 1;
  let pageSize = initial.pageSize || 10;
  let searchQuery = initial.searchQuery || "";

  // Date Filters State (Limited to today strictly)
  const nowObj = new Date();
  const todayStr = `${nowObj.getFullYear()}-${String(nowObj.getMonth() + 1).padStart(2, "0")}-${String(nowObj.getDate()).padStart(2, "0")}`;
  let fechaDesde = initial.fechaDesde || "";
  let fechaHasta = initial.fechaHasta || todayStr;
  let hasSearched = initial.hasSearched || false;
  let reportData = initial.reportData || {
    mesesAgrupados: [],
    diasDelMes: [],
    salas: [],
    empleados: []
  };
  let allEvaluatedEmployees = initial.allEvaluatedEmployees || [];

  // Sync back to persistent store whenever state changes
  $: {
    persistentReportesFilters.set({
      selectedSalas,
      selectedDispositivoIds,
      selectedDepartamentos,
      selectedAreas,
      selectedCargos,
      selectedSexo,
      searchQuery,
      pageSize,
      currentPage,
      fechaDesde,
      fechaHasta,
      hasSearched,
      reportData,
      allEvaluatedEmployees
    });
  }

  // Extract assigned sala IDs strictly for the logged-in user
  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const userId = user?.id || 1;

    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    const masterMap = $masterUserSalasStore;
    if (
      masterMap &&
      typeof masterMap === "object" &&
      !Array.isArray(masterMap)
    ) {
      const userList = masterMap[userId] || masterMap[String(userId)];
      if (Array.isArray(userList)) {
        return userList
          .map((s) => (typeof s === "object" ? s.id : Number(s)))
          .filter(Boolean);
      }
    }

    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    return [];
  })();

  // Excepcion Horario Modal State
  let showExcepcionModal = false;
  let activeEmpleadoExcepcion = null;
  let activeDiaExcepcion = null;
  let plantillasSalaExcepcion = [];

  async function loadPlantillasSala(salaId) {
    if (!salaId) return;
    try {
      const res = await fetch(`/api/master/plantillas-horarios?sala_ids=${salaId}&limit=1000`);
      const json = await res.json();
      if (json && json.success) {
        plantillasSalaExcepcion = json.data || [];
      }
    } catch (e) {
      console.error(e);
    }
  }

  function openExcepcionModal(emp, dia) {
    activeEmpleadoExcepcion = emp;
    activeDiaExcepcion = dia;
    const targetSalaId = emp.sala_id || selectedSalas[0] || 1;
    loadPlantillasSala(targetSalaId);
    showExcepcionModal = true;
  }

  function handleExcepcionSaved() {
    fetchReporteData(true);
  }

  function handleFechaDesdeChange() {
    updateInitialDaysHeader();
  }

  function handleFechaHastaChange(e) {
    const val = e.target.value;
    if (val && val > todayStr) {
      fechaHasta = todayStr;
      triggerToast("La fecha hasta no puede ser mayor al día en curso", "warning");
    }
    updateInitialDaysHeader();
  }

  function updateInitialDaysHeader() {
    if (!fechaDesde || !fechaHasta) return;
    try {
      const startDate = new Date(`${fechaDesde}T00:00:00Z`);
      const endDate = new Date(`${fechaHasta}T00:00:00Z`);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) return;

      const daysList = [];
      let curr = new Date(startDate);
      while (curr <= endDate) {
        daysList.push(new Date(curr));
        curr.setUTCDate(curr.getUTCDate() + 1);
      }

      const monthsMap = new Map();
      const MESES = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
      ];
      const DIAS = ["D", "L", "M", "M", "J", "V", "S"];

      daysList.forEach((d) => {
        const key = `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        monthsMap.set(key, (monthsMap.get(key) || 0) + 1);
      });

      reportData.mesesAgrupados = Array.from(monthsMap.entries()).map(([nombre, colspan]) => ({
        nombre,
        colspan,
      }));
      reportData.diasDelMes = daysList.map((d) => ({
        fechaStr: d.toISOString().split("T")[0],
        num: d.getUTCDate(),
        diaSemana: DIAS[d.getUTCDay()],
        rawDate: d,
      }));
    } catch (e) {
      console.error("Error updating days header:", e);
    }
  }

  // Dispositivos Biométricos Filter State
  let dispositivos = [];
  let dispositivosLoading = false;

  // Filter options from Backend
  let filterOptions = {
    salas: [],
    departamentos: [],
    areas: [],
    cargos: [],
    sexo: []
  };

  $: preparedCargos = (filterOptions.cargos || []).map((c) => ({
    ...c,
    subgroup_label:
      c.departamento_nombre && c.area_nombre
        ? `${c.departamento_nombre} › ${c.area_nombre}`
        : c.area_nombre || c.departamento_nombre || "Sin Área",
  }));

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0 ||
    selectedDepartamentos.length > 0 ||
    selectedAreas.length > 0 ||
    selectedCargos.length > 0 ||
    selectedSexo.length > 0 ||
    selectedDispositivoIds.length > 0
  );

  $: totalFilters =
    ((searchQuery || "").trim() ? 1 : 0) +
    selectedSalas.length +
    selectedDepartamentos.length +
    selectedAreas.length +
    selectedCargos.length +
    selectedSexo.length +
    selectedDispositivoIds.length;

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    selectedDepartamentos = [];
    selectedAreas = [];
    selectedCargos = [];
    selectedSexo = [];
    selectedDispositivoIds = [];
    currentPage = 1;
    fetchReporteData();
  }

  function removeFilterChip(type, val) {
    if (type === 'search') {
      searchQuery = '';
    } else if (type === 'sala') {
      selectedSalas = selectedSalas.filter(x => x !== val && String(x) !== String(val));
    } else if (type === 'dispositivo') {
      selectedDispositivoIds = selectedDispositivoIds.filter(x => x !== val && String(x) !== String(val));
    } else if (type === 'departamento') {
      selectedDepartamentos = selectedDepartamentos.filter(x => x !== val && String(x) !== String(val));
    } else if (type === 'area') {
      selectedAreas = selectedAreas.filter(x => x !== val && String(x) !== String(val));
    } else if (type === 'cargo') {
      selectedCargos = selectedCargos.filter(x => x !== val && String(x) !== String(val));
    } else if (type === 'sexo') {
      selectedSexo = selectedSexo.filter(x => x !== val && String(x) !== String(val));
    }
    currentPage = 1;
  }

  $: activeFilterChips = (function() {
    const chips = [];
    if (searchQuery && searchQuery.trim()) {
      chips.push({ type: 'search', val: searchQuery, label: `"${searchQuery.trim()}"`, category: 'Búsqueda' });
    }
    (selectedSalas || []).forEach(id => {
      const found = (filterOptions.salas || []).find(s => s.id === id || String(s.id) === String(id));
      chips.push({ type: 'sala', val: id, label: found ? found.nombre : `Sala #${id}`, category: 'Sala' });
    });
    (selectedDispositivoIds || []).forEach(id => {
      const found = (dispositivos || []).find(d => d.id === id || String(d.id) === String(id));
      chips.push({ type: 'dispositivo', val: id, label: found ? (found.nombre || found.alias || `Dispositivo #${id}`) : `Disp #${id}`, category: 'Dispositivo' });
    });
    (selectedDepartamentos || []).forEach(id => {
      const found = (filterOptions.departamentos || []).find(d => d.id === id || String(d.id) === String(id));
      chips.push({ type: 'departamento', val: id, label: found ? found.nombre : `Depto #${id}`, category: 'Depto' });
    });
    (selectedAreas || []).forEach(id => {
      const found = (filterOptions.areas || []).find(a => a.id === id || String(a.id) === String(id));
      chips.push({ type: 'area', val: id, label: found ? found.nombre : `Área #${id}`, category: 'Área' });
    });
    (selectedCargos || []).forEach(id => {
      const found = (filterOptions.cargos || []).find(c => c.id === id || String(c.id) === String(id));
      chips.push({ type: 'cargo', val: id, label: found ? found.nombre : `Cargo #${id}`, category: 'Cargo' });
    });
    (selectedSexo || []).forEach(s => {
      chips.push({ type: 'sexo', val: s, label: s, category: 'Sexo' });
    });
    return chips;
  })();

  let loading = false;

  // Reactive filtering of employees for the unified table
  $: filteredEmployees = (function () {
    let list = allEvaluatedEmployees || [];

    // 1. Restricción estricta por salas asignadas al usuario logueado
    if (assignedSalaIds && assignedSalaIds.length > 0) {
      const allowedSet = new Set(assignedSalaIds.map(Number));
      list = list.filter((e) => allowedSet.has(Number(e.sala_id)));
    }

    // 2. Filtro por salas seleccionadas en el multi-select
    if (selectedSalas && selectedSalas.length > 0) {
      const setSalas = new Set(selectedSalas.map(Number));
      list = list.filter((e) => setSalas.has(Number(e.sala_id)));
    }

    const q = (searchQuery || "").toLowerCase().trim();

    if (q) {
      list = list.filter(
        (e) =>
          (e.nombre || "").toLowerCase().includes(q) ||
          (e.cedula || "").toLowerCase().includes(q) ||
          (e.cargo_nombre || "").toLowerCase().includes(q) ||
          (e.departamento_nombre || "").toLowerCase().includes(q) ||
          (e.sala_nombre || "").toLowerCase().includes(q)
      );
    }

    if (selectedDepartamentos && selectedDepartamentos.length > 0) {
      const setDept = new Set(selectedDepartamentos.map(String));
      list = list.filter((e) => setDept.has(String(e.departamento_id)));
    }

    if (selectedAreas && selectedAreas.length > 0) {
      const setArea = new Set(selectedAreas.map(String));
      list = list.filter((e) => setArea.has(String(e.area_id)));
    }

    if (selectedCargos && selectedCargos.length > 0) {
      const setCargo = new Set(selectedCargos.map(String));
      list = list.filter((e) => setCargo.has(String(e.cargo_id)));
    }

    if (selectedSexo && selectedSexo.length > 0) {
      const setSexo = new Set(selectedSexo.map((s) => String(s).toUpperCase()));
      list = list.filter((e) => setSexo.has(String(e.sexo || "").toUpperCase()));
    }

    return list;
  })();

  $: totalCount = filteredEmployees.length;
  $: totalPages = pageSize >= 999999 ? 1 : Math.ceil(totalCount / pageSize) || 1;
  $: if (currentPage > totalPages && totalPages > 0) {
    currentPage = totalPages;
  }
  $: paginatedEmployees =
    pageSize >= 999999
      ? filteredEmployees
      : filteredEmployees.slice((currentPage - 1) * pageSize, (currentPage - 1) * pageSize + pageSize);
  $: startRec = totalCount === 0 ? 0 : (currentPage - 1) * (pageSize >= 999999 ? totalCount : pageSize) + 1;
  $: endRec = pageSize >= 999999 ? totalCount : Math.min(currentPage * pageSize, totalCount);

  // Cascading Filter Options Fetching
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDepartamentos.join(",")}_${selectedAreas.join(",")}_${selectedCargos.join(",")}_${selectedSexo.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedDepartamentos.length > 0) q.set("departamento_ids", selectedDepartamentos.join(","));
      if (selectedAreas.length > 0) q.set("area_ids", selectedAreas.join(","));
      if (selectedCargos.length > 0) q.set("cargo_ids", selectedCargos.join(","));
      if (selectedSexo.length > 0) q.set("sexo", selectedSexo.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/empleados/filter-options?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          filterOptions = json.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching filter options for report:", e);
    }
  }

  // Salas strictly filtered by user permissions
  $: availableSalas = (function () {
    const raw = filterOptions.salas || [];
    if (!assignedSalaIds || assignedSalaIds.length === 0) return raw;
    return raw.filter((s) => assignedSalaIds.map(Number).includes(Number(s.id)));
  })();

  // Dispositivos strictly filtered by user permissions and selected salas
  $: preparedDispositivos = (function () {
    let list = dispositivos || [];
    if (assignedSalaIds && assignedSalaIds.length > 0) {
      list = list.filter((d) => assignedSalaIds.map(Number).includes(Number(d.sala_id)));
    }
    return list.map((d) => ({
      id: d.id,
      nombre: d.nombre || d.alias || `Dispositivo #${d.id}`,
      sala_nombre: d.sala_nombre || "Sin Sala",
      sala_id: d.sala_id,
    }));
  })();

  // Load available devices when selected salas change
  $: {
    const salaIdsToFetch = selectedSalas.length > 0 ? selectedSalas : assignedSalaIds;
    if (salaIdsToFetch.length > 0) {
      loadDispositivosForSalas(salaIdsToFetch);
    } else {
      loadDispositivosForSalas([]);
    }
  }

  async function loadDispositivosForSalas(sIds) {
    dispositivosLoading = true;
    try {
      const q = new URLSearchParams();
      if (sIds.length > 0) q.set("sala_ids", sIds.join(","));
      const res = await fetch(`/api/master/dispositivos?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        dispositivos = json.data || [];
      }
    } catch (err) {
      console.error("Error loading dispositivos:", err);
    } finally {
      dispositivosLoading = false;
    }
  }

  onMount(async () => {
    // Only set default quincena if no date range was previously selected/restored
    if (!fechaDesde) {
      const currentYear = nowObj.getFullYear();
      const currentMonth = nowObj.getMonth();
      const currentDay = nowObj.getDate();

      if (currentDay <= 15) {
        fechaDesde = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-01`;
      } else {
        fechaDesde = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-16`;
      }
      fechaHasta = todayStr;
    }

    if (!hasSearched) {
      updateInitialDaysHeader();
    }

    await Promise.all([
      fetchFilterOptions(),
      (fechaDesde && fechaHasta) ? fetchReporteData(true) : Promise.resolve()
    ]);
  });

  async function fetchReporteData(silent = false) {
    if (!fechaDesde || !fechaHasta) {
      triggerToast("Seleccione fecha desde y fecha hasta", "warning");
      return;
    }

    if (!silent) {
      loading = true;
    }
    try {
      const q = new URLSearchParams({
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        user_sala_ids: assignedSalaIds && assignedSalaIds.length > 0 ? assignedSalaIds.join(",") : "",
        sala_ids: selectedSalas.join(","),
        dispositivo_ids: selectedDispositivoIds.join(","),
        departamento_ids: selectedDepartamentos.join(","),
        area_ids: selectedAreas.join(","),
        cargo_ids: selectedCargos.join(","),
        sexo: selectedSexo.join(","),
        search: searchQuery,
      });

      const res = await fetch(`/api/reports/marcaje-personal?${q.toString()}`);
      const json = await res.json();

      if (json && json.success) {
        reportData = {
          mesesAgrupados: json.mesesAgrupados || [],
          diasDelMes: json.diasDelMes || [],
          salas: json.salas || [],
          empleados: json.empleados || [],
        };

        // Flatten all evaluated employees into a single list
        if (json.empleados && json.empleados.length > 0) {
          allEvaluatedEmployees = json.empleados;
        } else {
          const flat = [];
          (json.salas || []).forEach((s) => {
            (s.departamentos || []).forEach((d) => {
              (d.empleados || []).forEach((e) => {
                flat.push({
                  ...e,
                  sala_id: s.id,
                  sala_nombre: s.nombre,
                  departamento_id: d.id,
                  departamento_nombre: d.nombre,
                });
              });
            });
          });
          allEvaluatedEmployees = flat;
        }

        currentPage = 1;
        hasSearched = true;
      } else {
        triggerToast(json?.error || "Error al obtener el reporte", "error");
      }
    } catch (err) {
      console.error("Error fetching report data:", err);
      triggerToast("Error al cargar el reporte de asistencia", "error");
    } finally {
      if (!silent) {
        loading = false;
      }
    }
  }

  function getFotoUrl(emp) {
    if (!emp) return null;
    let foto = emp.foto;
    if (!foto && emp.id) foto = `${emp.id}.jpg`;
    if (!foto) return null;

    if (foto.startsWith("http") || foto.startsWith("data:")) return foto;

    let cleanFoto = String(foto)
      .replace(/^\/+/, "")
      .replace(/^empleados\//, "")
      .replace(/^photos\//, "")
      .trim();
    return `/empleados/${cleanFoto}`;
  }

  function getEntradaSalidaTimes(marcajeStr) {
    if (!marcajeStr || marcajeStr === "Sin Registros") return { entrada: null, salida: null };
    const clean = String(marcajeStr).replace(/ - (Sin descanso|Descanso Automático|Con descanso)/gi, "").trim();
    const parts = clean.split("-").map((s) => s.trim());
    if (parts.length >= 2) {
      return { entrada: parts[0], salida: parts[1] };
    } else if (parts.length === 1 && parts[0]) {
      return { entrada: parts[0], salida: null };
    }
    return { entrada: null, salida: null };
  }

  // Dynamic Zoom Matrix State (Cell width & height control)
  let dayColWidth = 100; // Default 100px width per day cell
  $: dayColHeight = dayColWidth < 70 ? Math.round((dayColWidth / 100) * 50) : Math.round((dayColWidth / 100) * 58);
  $: zoomScale = Number((dayColWidth / 100).toFixed(2));
  $: zoomPercent = Math.round(zoomScale * 100);

  function zoomIn() {
    if (dayColWidth < 185) {
      dayColWidth += 15;
    }
  }

  function zoomOut() {
    if (dayColWidth > 65) {
      dayColWidth -= 15;
    }
  }

  function resetZoom() {
    dayColWidth = 100;
  }

  function handleGenerarCorte() {
    triggerToast("Generando reporte de corte de asistencia...", "info");
    // Action trigger for Generating attendance cut/report
  }
</script>

<div class="reportes-container">
  
  <!-- Top Section: Header with 3 Spaces (Desde, Hasta, Botón) + Smart MultiSelects + Search Bar -->
  <div class="header-card">
    
    <!-- Row 1: 3 Control Spaces (Desde, Hasta, Botón Buscar) -->
    <div class="date-controls-row">
      <div class="date-control-item">
        <label for="fechaDesde" class="control-label">Desde:</label>
        <input
          type="date"
          id="fechaDesde"
          bind:value={fechaDesde}
          max={todayStr}
          on:change={handleFechaDesdeChange}
          class="form-date-input"
          disabled={loading}
        />
      </div>

      <div class="date-control-item">
        <label for="fechaHasta" class="control-label">Hasta:</label>
        <input
          type="date"
          id="fechaHasta"
          bind:value={fechaHasta}
          max={todayStr}
          on:change={handleFechaHastaChange}
          class="form-date-input"
          disabled={loading}
        />
      </div>

      <div class="date-control-item date-filter-multiselect">
        <SmartMultiSelect
          id="filter-reportes-dispositivos"
          label="Dispositivos"
          options={preparedDispositivos}
          groupBy="sala_nombre"
          bind:selectedValues={selectedDispositivoIds}
          on:change={(e) => {
            selectedDispositivoIds = e.detail;
            currentPage = 1;
          }}
        />
      </div>

      <!-- Zoom Controller Widget placed next to Buscar Marcajes button -->
      <div class="toolbar-zoom-widget">
        <div class="zoom-btn-group">
          <button type="button" class="btn-zoom-action" on:click={zoomOut} title="Alejar celdas (-)">
            −
          </button>
          <span class="zoom-val-badge" on:click={resetZoom} title="Clic para restablecer zoom a 100%" style="cursor: pointer;">
            {zoomPercent}%
          </span>
          <button type="button" class="btn-zoom-action" on:click={zoomIn} title="Acercar celdas (+)">
            +
          </button>
        </div>
      </div>

      <div class="date-control-item action-btn-item">
        <button
          class="btn-buscar active"
          on:click={() => fetchReporteData()}
          disabled={loading || !fechaDesde || !fechaHasta}
        >
          {#if loading}
            <span class="spinner-dot"></span> Procesando...
          {:else}
            Buscar Registros
          {/if}
        </button>

        <button
          type="button"
          class="btn-generar-corte"
          on:click={handleGenerarCorte}
          disabled={loading}
          title="Generar reporte de corte de asistencia"
        >
          Generar Corte
        </button>
      </div>
    </div>

    <!-- Row 2: Smart MultiSelect Filters (Salas, Departamento, Área, Cargo, Sexo) -->
    <div class="smart-filters-grid">
      <SmartMultiSelect
        id="filter-reportes-salas"
        label="Salas"
        options={availableSalas}
        bind:selectedValues={selectedSalas}
        on:change={(e) => {
          selectedSalas = e.detail;
          currentPage = 1;
        }}
      />

      <SmartMultiSelect
        id="filter-reportes-departamentos"
        label="Departamento"
        options={filterOptions.departamentos}
        groupBy="sala_nombre"
        bind:selectedValues={selectedDepartamentos}
        on:change={(e) => {
          selectedDepartamentos = e.detail;
          currentPage = 1;
        }}
      />

      <SmartMultiSelect
        id="filter-reportes-areas"
        label="Área"
        options={filterOptions.areas}
        groupParentBy="sala_nombre"
        groupBy="departamento_nombre"
        bind:selectedValues={selectedAreas}
        on:change={(e) => {
          selectedAreas = e.detail;
          currentPage = 1;
        }}
      />

      <SmartMultiSelect
        id="filter-reportes-cargos"
        label="Cargo"
        options={preparedCargos}
        groupParentBy="sala_nombre"
        groupBy="subgroup_label"
        bind:selectedValues={selectedCargos}
        on:change={(e) => {
          selectedCargos = e.detail;
          currentPage = 1;
        }}
      />

      <SmartMultiSelect
        id="filter-reportes-sexo"
        label="Sexo"
        options={filterOptions.sexo}
        bind:selectedValues={selectedSexo}
        on:change={(e) => {
          selectedSexo = e.detail;
          currentPage = 1;
        }}
      />
    </div>

    <!-- Row 3: Search Bar and Active Filters Reset -->
    <div class="search-and-actions-row">
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input
          type="text"
          bind:value={searchQuery}
          on:input={() => (currentPage = 1)}
          placeholder="Buscar por empleado, cédula, cargo, sala o departamento..."
          class="global-search-input"
        />
        {#if searchQuery}
          <button
            type="button"
            class="clear-search-btn"
            on:click={() => {
              searchQuery = "";
              currentPage = 1;
            }}
            title="Borrar búsqueda"
          >
            &times;
          </button>
        {/if}
      </div>

      {#if hasActiveFilters}
        <button
          type="button"
          on:click={clearAllFilters}
          class="btn-limpiar-filtros"
          title="Restablecer búsqueda y todos los filtros"
        >
          <span>✕</span> Limpiar Filtros ({totalFilters})
        </button>
      {/if}
    </div>

    <!-- Active Filter Badges / Chips Row -->
    {#if activeFilterChips.length > 0}
      <div class="active-filter-chips-row">
        <span class="active-filter-label">Filtros:</span>
        <div class="active-chips-list">
          {#each activeFilterChips as chip}
            <div class="active-filter-chip">
              <span class="chip-category">{chip.category}:</span>
              <span class="chip-value">{chip.label}</span>
              <button
                type="button"
                class="chip-remove-btn"
                on:click={() => removeFilterChip(chip.type, chip.val)}
                title="Eliminar este filtro"
              >
                ✕
              </button>
            </div>
          {/each}
          {#if activeFilterChips.length > 1}
            <button
              type="button"
              class="chip-clear-all-btn"
              on:click={clearAllFilters}
              title="Limpiar todos los filtros"
            >
              Borrar todos
            </button>
          {/if}
        </div>
      </div>
    {/if}

  </div>

  <!-- Unified Single Table Matrix for Attendance Reports -->
  <div class="unified-table-card">
    
    {#if loading}
      <div class="empty-state-full-box">
        <div class="pulse-loader"></div>
        <span style="color: #64748b; font-size: 13px; font-weight: 700;">Cotejando registros de asistencia y horarios en el servidor...</span>
      </div>
    {:else if paginatedEmployees.length === 0}
      <div class="empty-state-full-box">
        <span>No se encontraron registros</span>
      </div>
    {:else}
      <!-- Table Container with Horizontal Scroll for 31-Day Matrix -->
      <div class="unified-table-scroll-wrap">
        <table class="report-matrix-table" style="--day-col-width: {dayColWidth}px; --day-col-height: {dayColHeight}px; --zoom-scale: {zoomScale};">
          <thead>
            <!-- Header Row 1: Fixed EMPLEADO + Month Groups Colspan -->
            <tr class="header-months-tr">
              <th
                rowspan="2"
                class="th-empleado-sticky"
              >
                EMPLEADO
              </th>
              {#each reportData.mesesAgrupados as mes}
                <th
                  colspan={mes.colspan}
                  style="text-align: center; padding: 2px 4px; font-size: 9px; font-weight: 800; color: #1e293b; background: #f1f5f9; border-right: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.1;"
                  title={mes.nombre}
                >
                  {mes.nombre}
                </th>
              {/each}
            </tr>

            <!-- Header Row 2: Days (Number & Day Letter Side-by-Side: e.g. 28 V) -->
            <tr class="header-days-tr">
              {#each reportData.diasDelMes as dia}
                <th>
                  <div style="display: flex; align-items: center; justify-content: center; gap: 4px; line-height: 1.1;">
                    <span style="font-weight: 900; font-size: 12px; color: #0f172a;">{dia.num}</span>
                    <span style="font-size: 11px; color: #64748b; font-weight: 800; text-transform: uppercase;">{dia.diaSemana}</span>
                  </div>
                </th>
              {/each}
            </tr>
          </thead>

          <tbody>
            {#each paginatedEmployees as emp (emp.id)}
              <tr class="tbody-emp-tr">
                
                <!-- Fixed Sticky Employee Column (Clear 165px) -->
                <td class="td-empleado-sticky">
                  <div class="emp-sticky-content">
                    <div class="emp-avatar-box">
                      {#if getFotoUrl(emp)}
                        <img
                          src={getFotoUrl(emp)}
                          alt={emp.nombre}
                          class="emp-avatar-img"
                          on:error={(e) => {
                            e.currentTarget.style.display = "none";
                            const fallback = e.currentTarget.nextElementSibling;
                            if (fallback) fallback.style.display = "flex";
                          }}
                        />
                        <div class="emp-avatar-fallback" style="display: none;">
                          {(emp.nombre || "E").charAt(0).toUpperCase()}
                        </div>
                      {:else}
                        <div class="emp-avatar-fallback">
                          {(emp.nombre || "E").charAt(0).toUpperCase()}
                        </div>
                      {/if}
                    </div>

                    <div class="emp-info-box">
                      <span class="emp-name-text" title={emp.nombre}>
                        {toTitleCase(emp.nombre)}
                      </span>
                      <span class="emp-cedula-pill" title={emp.cedula || `ID: #${emp.id}`}>
                        {emp.cedula || `ID: #${emp.id}`}
                      </span>
                      <span class="emp-cargo-text" title={emp.cargo_nombre || "Sin Cargo"}>
                        {emp.cargo_nombre || "Sin Cargo"}
                      </span>
                    </div>
                  </div>
                </td>

                <!-- 31 Day Data Cells (Comfortable & Compact 116px x 65px Fixed Boxes) -->
                {#each emp.dias as dia}
                  {@const times = getEntradaSalidaTimes(dia.marcajeStr)}
                  <td class="td-day-matrix-cell">
                    <div class="day-cell-inner-wrap">
                      
                      <!-- Top Row: [ Shift Badge ] [ Entrada / Salida Stack ] [ Worked Hours Pill ] -->
                      <div class="day-top-row">
                        <!-- Left: Shift Badge Button for Excepcion Especial -->
                        <button
                          type="button"
                          on:click={() => openExcepcionModal(emp, dia)}
                          style="display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 14px; padding: 0 2px; border-radius: 2.5px; font-weight: 900; font-size: 8px; text-transform: uppercase; background-color: {dia.resultadoStr === 'ERROR' ? '#dc2626' : (dia.resultadoStr === 'EN ESPERA' ? '#2563eb' : (dia.shift ? (dia.shift.color || '#2563eb') : '#f1f5f9'))}; color: {dia.resultadoStr === 'ERROR' || dia.resultadoStr === 'EN ESPERA' ? '#ffffff' : (dia.shift && (dia.shift.codigo === 'U' || dia.shift.color === '#86EFAC' || dia.shift.color === '#D9D9D9') ? '#0f172a' : '#ffffff')}; box-shadow: 0 1px 2px rgba(0,0,0,0.06); flex-shrink: 0; border: {dia.isExcepcion ? '1.5px solid #7c3aed' : 'none'}; cursor: pointer; transition: transform 0.1s ease; position: relative;"
                          title={dia.isExcepcion ? '⚡ Excepción Especial Activa - Clic para cambiar' : (dia.shift ? (dia.shift.nombre || dia.shift.codigo) : 'Clic para asignar excepción')}
                        >
                          {dia.shift ? dia.shift.codigo : '-'}
                          {#if dia.isExcepcion}
                            <span style="position: absolute; top: -2px; right: -2px; width: 5px; height: 5px; background: #7c3aed; border-radius: 50%; border: 1px solid #ffffff;"></span>
                          {/if}
                        </button>

                        <!-- Center: Entrada (top) & Salida (bottom) Stack -->
                        <div class="times-stack-center">
                          {#if times.entrada && dia.resultadoStr !== 'LIBRE'}
                            <span style="color: #0f172a; font-weight: 800;">{times.entrada}</span>
                            {#if times.salida}
                              <span style="color: #0f172a; font-weight: 800;">{times.salida}</span>
                            {/if}
                          {:else}
                            <span style="color: #cbd5e1; font-size: 8px; font-weight: 800; letter-spacing: 1px;">||||||</span>
                          {/if}
                        </div>

                        <!-- Right: Worked Hours Pill (Only when dayColWidth >= 70) -->
                        {#if dayColWidth >= 70}
                          <div class="worked-hours-pill {dia.resultadoStr === 'ERROR' ? 'error' : (dia.resultadoStr === 'EN ESPERA' ? 'espera' : (dia.trabajadosMins > 0 && dia.resultadoStr !== 'LIBRE' ? 'active' : 'zero'))}">
                            {dia.trabajadoStr || "00:00"}
                          </div>
                        {/if}
                      </div>

                      <!-- Middle Row: Result Status Title -->
                      <div
                        class="result-status-title"
                        style="color: {dia.resultadoStr === 'ERROR' ? '#dc2626' : (dia.resultadoStr === 'EN ESPERA' ? '#2563eb' : (dia.resultadoStr === 'LIBRE' ? '#475569' : '#0f172a'))};"
                      >
                        {#if dayColWidth < 70 && dia.resultadoStr && dia.resultadoStr.includes('(D)') && dia.resultadoStr.includes('(N)')}
                          <div class="mixed-status-stack">
                            <span class="mixed-d-text">{dia.resultadoStr.split('-')[0].trim()}</span>
                            <span class="mixed-n-text">{dia.resultadoStr.split('-')[1] ? dia.resultadoStr.split('-')[1].trim() : ''}</span>
                          </div>
                        {:else}
                          {@html (dia.resultadoStr || "").replace(/\(\s*D\s*\)/gi, "(D)").replace(/\(\s*N\s*\)/gi, "(N)")}
                        {/if}
                      </div>

                      <!-- Bottom Row: [ entBadge (Left) ] & [ salBadge (Right) ] (Only when dayColWidth >= 70) -->
                      {#if dayColWidth >= 70}
                        <div class="badges-bottom-row">
                          <!-- Entrada Badge -->
                          <div
                            class="ent-sal-pill {dia.entBadge && dia.entBadge.isAlert ? 'alert' : ''}"
                            style="background-color: {dia.entBadge ? dia.entBadge.bg : '#f8fafc'}; color: {dia.entBadge ? dia.entBadge.color : '#94a3b8'}; border: 1px solid {dia.entBadge ? dia.entBadge.border : '#e2e8f0'};"
                          >
                            {dia.entBadge ? dia.entBadge.text : "00:00"}
                          </div>

                          <!-- Salida Badge -->
                          <div
                            class="ent-sal-pill {dia.salBadge && dia.salBadge.isAlert ? 'alert' : ''}"
                            style="background-color: {dia.salBadge ? dia.salBadge.bg : '#f8fafc'}; color: {dia.salBadge ? dia.salBadge.color : '#94a3b8'}; border: 1px solid {dia.salBadge ? dia.salBadge.border : '#e2e8f0'};"
                          >
                            {dia.salBadge ? dia.salBadge.text : "00:00"}
                          </div>
                        </div>
                      {/if}

                    </div>
                  </td>
                {/each}

              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Pagination Footer Bar (Exactly like PaginatedDataTable / Image 2) -->
    <div class="unified-pagination-footer">
      
      <!-- Left: Totals & Active Filters summary -->
      <div class="pagination-footer-left">
        <strong>Total: ({totalCount})</strong>
        <span class="divider-dot">|</span>
        <span>Filtros Totales: ({totalFilters})</span>
        <span>Filtros: {hasActiveFilters ? `${totalFilters} activos` : 'Ninguno'}</span>
      </div>

      <!-- Right: Page Size Dropdown, Records Range & Page Nav Buttons -->
      <div class="pagination-footer-right">
        
        <!-- Page Size Dropdown (Default 10 filas) -->
        <div class="page-size-selector-wrap">
          <select
            bind:value={pageSize}
            on:change={() => (currentPage = 1)}
            class="page-size-select"
          >
            <option value={10}>10 filas</option>
            <option value={25}>25 filas</option>
            <option value={50}>50 filas</option>
            <option value={999999}>Ver Todos ({totalCount})</option>
          </select>
        </div>

        <!-- Records Range Text -->
        <span class="records-range-text">
          {startRec} - {endRec} de {totalCount}
        </span>

        <!-- Prev & Next Page Navigation Group -->
        <div class="page-nav-btn-group">
          <button
            class="btn-nav-page"
            disabled={currentPage <= 1}
            on:click={() => currentPage--}
            title="Página Anterior"
          >
            &lt;
          </button>
          <span class="page-nav-badge">
            {currentPage} / {totalPages}
          </span>
          <button
            class="btn-nav-page"
            disabled={currentPage >= totalPages}
            on:click={() => currentPage++}
            title="Página Siguiente"
          >
            &gt;
          </button>
        </div>

      </div>

    </div>

  </div>

</div>

<!-- Modal para Asignar / Cambiar Excepción Especial de Horario -->
<ExcepcionHorarioModal
  bind:show={showExcepcionModal}
  empleado={activeEmpleadoExcepcion}
  dia={activeDiaExcepcion}
  plantillasSala={plantillasSalaExcepcion}
  on:saved={handleExcepcionSaved}
/>

<style>
  .reportes-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }

  /* Header Card with Date Controls, MultiSelects and Search */
  .header-card {
    background: #ffffff;
    border-radius: 12px;
    padding: 16px 20px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* Row 1: 3 Control Spaces (Desde, Hasta, Botón) */
  .date-controls-row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .date-control-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .date-filter-multiselect {
    min-width: 180px;
    max-width: 220px;
  }

  .control-label {
    font-size: 13px;
    font-weight: 800;
    color: #1e293b;
    white-space: nowrap;
  }

  .form-date-input {
    padding: 7px 12px;
    font-size: 12.5px;
    font-weight: 700;
    color: #0f172a;
    background-color: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    outline: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .form-date-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
  }

  .action-btn-item {
    margin-left: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-generar-corte {
    padding: 8px 16px;
    font-size: 12.5px;
    font-weight: 800;
    color: #ffffff;
    background: linear-gradient(135deg, #10b981, #059669);
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(16, 185, 129, 0.25);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .btn-generar-corte:hover:not(:disabled) {
    background: linear-gradient(135deg, #059669, #047857);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(16, 185, 129, 0.35);
  }

  .btn-generar-corte:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-buscar {
    padding: 8px 18px;
    font-size: 12.5px;
    font-weight: 800;
    border-radius: 8px;
    cursor: pointer;
    border: none;
    background: #cbd5e1;
    color: #64748b;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    white-space: nowrap;
  }

  .btn-buscar.active {
    background: #2563eb;
    color: #ffffff;
    box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.25);
  }

  .btn-buscar.active:hover {
    background: #1d4ed8;
    transform: translateY(-1px);
  }

  .spinner-dot {
    width: 12px;
    height: 12px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    display: inline-block;
  }

  /* Row 2: Smart Filters Grid (5 MultiSelects) */
  .smart-filters-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  /* Row 3: Search Bar and Actions */
  .search-and-actions-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search-input-wrapper {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    font-size: 13px;
    color: #64748b;
    pointer-events: none;
  }

  .global-search-input {
    width: 100%;
    padding: 8px 36px 8px 34px;
    font-size: 12px;
    font-weight: 600;
    color: #0f172a;
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    outline: none;
    transition: all 0.15s ease;
  }

  .global-search-input:focus {
    background: #ffffff;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
  }

  .clear-search-btn {
    position: absolute;
    right: 10px;
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 16px;
    cursor: pointer;
    line-height: 1;
    padding: 2px 4px;
  }

  .btn-limpiar-filtros {
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
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    white-space: nowrap;
  }

  .btn-limpiar-filtros:hover {
    background: #fee2e2;
  }

  /* Active Filter Badges / Chips Row */
  .active-filter-chips-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 8px;
    border-top: 1px solid #f1f5f9;
    width: 100%;
  }

  .active-filter-label {
    font-size: 11px;
    font-weight: 800;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .active-chips-list {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .active-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11.5px;
    color: #1e293b;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    transition: all 0.15s ease;
  }

  .active-filter-chip:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .chip-category {
    font-weight: 800;
    color: #475569;
    font-size: 10.5px;
  }

  .chip-value {
    font-weight: 700;
    color: #0f172a;
  }

  .chip-remove-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 3px;
    margin-left: 2px;
    border-radius: 4px;
    line-height: 1;
    transition: all 0.15s ease;
  }

  .chip-remove-btn:hover {
    background: #fee2e2;
    color: #ef4444;
  }

  .chip-clear-all-btn {
    background: transparent;
    border: none;
    color: #ef4444;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    text-decoration: underline;
  }

  .chip-clear-all-btn:hover {
    background: #fee2e2;
  }

  /* Unified Single Table Card */
  .unified-table-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .empty-state-full-box {
    width: 100%;
    padding: 38px 20px;
    text-align: center;
    color: #334155;
    font-size: 13.5px;
    font-weight: 600;
    background: #ffffff;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .unified-table-scroll-wrap {
    overflow: auto;
    max-height: calc(100vh - 230px);
    min-height: auto;
    max-width: 100%;
    position: relative;
  }

  .report-matrix-table {
    width: max-content;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }

  /* Sticky Thead (Entire Block Sticks Together Cleanly without Overlap) */
  .report-matrix-table thead {
    position: sticky;
    top: 0;
    z-index: 25;
  }

  .header-months-tr th {
    background: #f1f5f9;
  }

  .header-days-tr th {
    background: #f8fafc;
  }

  /* Sticky Employee Column (Horizontal Sticky) */
  .th-empleado-sticky {
    position: sticky;
    left: 0;
    z-index: 35 !important;
    background: #f8fafc !important;
    width: 165px;
    min-width: 165px;
    max-width: 165px;
    padding: 6px 8px;
    box-sizing: border-box;
    border-right: 2px solid #cbd5e1;
    border-bottom: 2px solid #cbd5e1;
    vertical-align: middle;
  }

  .th-empleado-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
  }

  .th-empleado-label {
    font-size: 11px;
    font-weight: 900;
    color: #0f172a;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .th-zoom-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }

  .btn-th-zoom {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #1e293b;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0;
    transition: all 0.12s ease;
  }

  .btn-th-zoom:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .th-zoom-badge {
    font-size: 9.5px;
    font-weight: 800;
    color: #475569;
    min-width: 28px;
    text-align: center;
  }

  .td-empleado-sticky {
    position: sticky;
    left: 0;
    z-index: 10;
    background: #ffffff;
    width: 165px;
    min-width: 165px;
    max-width: 165px;
    height: var(--day-col-height, 58px);
    padding: 6px 8px;
    box-sizing: border-box;
    border-right: 2px solid #cbd5e1;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
    transition: height 0.15s ease;
  }

  .emp-sticky-content {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    overflow: hidden;
  }

  .emp-avatar-box {
    flex-shrink: 0;
  }

  .emp-avatar-img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid #cbd5e1;
    display: block;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .emp-avatar-fallback {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #2563eb, #4f46e5);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 800;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .emp-info-box {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1.5px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .emp-name-text {
    font-size: 10.5px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  .emp-cedula-pill {
    font-size: 7.5px;
    color: #334155;
    font-weight: 800;
    background: #f1f5f9;
    padding: 0px 4px;
    line-height: 12px;
    height: 12px;
    border-radius: 3px;
    white-space: nowrap;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .emp-cargo-text {
    font-size: 8px;
    color: #2563eb;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    line-height: 1.1;
  }

  /* Matrix Header & Body Day Cells with CSS Variable --day-col-width */
  .header-days-tr th {
    text-align: center;
    width: var(--day-col-width, 100px);
    min-width: var(--day-col-width, 100px);
    max-width: var(--day-col-width, 100px);
    padding: 4px 2px;
    font-size: 11px;
    font-weight: 900;
    color: #334155;
    background: #f8fafc;
    border-right: 1px solid #e2e8f0;
    border-bottom: 2px solid #cbd5e1;
    box-sizing: border-box;
    transition: width 0.15s ease, min-width 0.15s ease, max-width 0.15s ease;
  }

  /* 31-Day Matrix Cell */
  .td-day-matrix-cell {
    padding: 4px 2px 4px 2px;
    text-align: center;
    width: var(--day-col-width, 100px);
    min-width: var(--day-col-width, 100px);
    max-width: var(--day-col-width, 100px);
    height: var(--day-col-height, 58px);
    box-sizing: border-box;
    border-right: 1px solid #f1f5f9;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
    transition: width 0.15s ease, min-width 0.15s ease, max-width 0.15s ease, height 0.15s ease;
  }

  /* Toolbar Zoom Widget */
  .toolbar-zoom-widget {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 4px 10px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    margin-left: auto;
  }

  .zoom-label {
    font-size: 11.5px;
    font-weight: 800;
    color: #475569;
    white-space: nowrap;
  }

  .zoom-btn-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .btn-zoom-action {
    width: 26px;
    height: 24px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    background: #ffffff;
    color: #0f172a;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    user-select: none;
  }

  .btn-zoom-action:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .zoom-val-badge {
    font-size: 11px;
    font-weight: 800;
    color: #1e293b;
    min-width: 36px;
    text-align: center;
  }

  .btn-zoom-reset-link {
    background: transparent;
    border: none;
    color: #2563eb;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    padding: 2px 4px;
    text-decoration: underline;
  }

  .btn-zoom-reset-link:hover {
    color: #1d4ed8;
  }

  .day-cell-inner-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    width: 100%;
    gap: 1px;
    box-sizing: border-box;
    overflow: hidden;
    padding-top: 1px;
    padding-bottom: 0px;
  }

  .day-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: calc(2px * var(--zoom-scale, 1));
    min-height: calc(14px * var(--zoom-scale, 1));
    overflow: hidden;
  }

  .times-stack-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.05;
    font-size: clamp(6px, calc(7.5px * var(--zoom-scale, 1)), 11px);
    font-weight: 800;
    color: #0f172a;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .worked-hours-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 calc(3px * var(--zoom-scale, 1));
    border-radius: 2.5px;
    font-size: clamp(6px, calc(7.5px * var(--zoom-scale, 1)), 11px);
    height: calc(13px * var(--zoom-scale, 1));
    line-height: 1;
    flex-shrink: 0;
    max-width: 48%;
    overflow: hidden;
  }

  .worked-hours-pill.active {
    font-weight: 800;
    background-color: #dcfce7;
    color: #15803d;
    border: 1px solid #86efac;
  }

  .worked-hours-pill.error {
    font-weight: 800;
    background-color: #fff1f2;
    color: #dc2626;
    border: 1px solid #fecdd3;
  }

  .worked-hours-pill.espera {
    font-weight: 800;
    background-color: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
  }

  .worked-hours-pill.zero {
    font-weight: 700;
    background-color: #f8fafc;
    color: #94a3b8;
    border: 1px solid #e2e8f0;
  }

  .result-status-title {
    font-size: clamp(6.5px, calc(7.5px * var(--zoom-scale, 1)), 12px);
    font-weight: 800;
    line-height: 1.1;
    white-space: normal;
    overflow: hidden;
    width: 100%;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 1px 0;
    padding: 0;
  }

  .mixed-status-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.05;
    font-size: clamp(5.5px, calc(6.8px * var(--zoom-scale, 1)), 10.5px);
    font-weight: 900;
    width: 100%;
    overflow: hidden;
  }

  .mixed-d-text {
    color: #0f172a;
    white-space: nowrap;
  }

  .mixed-n-text {
    color: #0f172a;
    white-space: nowrap;
  }

  .badges-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: calc(2px * var(--zoom-scale, 1));
    margin-top: 0;
    padding-bottom: 0px;
    height: calc(13px * var(--zoom-scale, 1));
    overflow: hidden;
  }

  .ent-sal-pill {
    flex: 1;
    min-width: 0;
    height: calc(13px * var(--zoom-scale, 1));
    line-height: calc(13px * var(--zoom-scale, 1));
    text-align: center;
    font-size: clamp(6px, calc(7.5px * var(--zoom-scale, 1)), 11px);
    font-weight: 800;
    padding: 0 1px;
    border-radius: 2.5px;
    box-sizing: border-box;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Bottom Pagination Footer Bar (Image 2) */
  .unified-pagination-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    flex-wrap: wrap;
    gap: 12px;
  }

  .pagination-footer-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .divider-dot {
    color: #cbd5e1;
  }

  .pagination-footer-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .page-size-select {
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 6px;
    outline: none;
    cursor: pointer;
  }

  .records-range-text {
    font-size: 12.5px;
    font-weight: 800;
    color: #0f172a;
    white-space: nowrap;
  }

  .page-nav-btn-group {
    display: inline-flex;
    align-items: center;
    border: 1.5px solid #cbd5e1;
    border-radius: 6px;
    overflow: hidden;
    background: #ffffff;
  }

  .btn-nav-page {
    padding: 5px 10px;
    border: none;
    background: #ffffff;
    color: #475569;
    font-weight: 800;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-nav-page:hover:not(:disabled) {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-nav-page:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-nav-badge {
    padding: 5px 10px;
    background: #64748b;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    border-left: 1px solid #cbd5e1;
    border-right: 1px solid #cbd5e1;
    white-space: nowrap;
  }

  /* .loading-state-box y .empty-state-box eliminados (no usados en este componente) */

  .pulse-loader {
    width: 40px;
    height: 40px;
    border: 4px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 16px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
