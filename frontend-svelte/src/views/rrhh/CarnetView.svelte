<script>
  import { onMount } from "svelte";
  import SmartMultiSelect from "../../components/common/SmartMultiSelect.svelte";
  import { currentUserStore, userSalasStore as authUserSalasStore } from "../../controllers/auth.store.js";
  import { userSalasStore as masterUserSalasStore, masterSalasStore } from "../../controllers/master.store.js";

  // Extraer las salas asignadas estrictamente para el usuario logueado
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

    const authList = $authUserSalasStore;
    if (Array.isArray(authList) && authList.length > 0) {
      return authList
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    return [];
  })();

  // Opciones de salas disponibles para el usuario
  let salasOptions = [];
  $: {
    const allSalas = $masterSalasStore || [];
    let filtered = allSalas;
    if (assignedSalaIds.length > 0) {
      filtered = allSalas.filter((s) => assignedSalaIds.includes(Number(s.id)));
    }
    salasOptions = filtered.map((s) => ({
      value: s.id,
      label: s.nombre || s.nombre_comercial || `Sala #${s.id}`
    }));
  }

  // Filtros y Estados
  let selectedSalas = [];
  let selectedModelo = "roraima"; // "roraima", "wave", "minimal", "vip"
  let selectedColor = "burgundy"; // "burgundy", "royal", "emerald", "gold", "graphite", "fire"
  let searchQuery = "";
  let currentIndex = 0;
  let viewMode = "individual"; // "individual" o "lote"

  let empleados = [];
  let isLoading = false;
  let salasMap = {};

  // Paletas de Color Disponibles
  const colorPalettes = [
    { id: "burgundy", name: "🍷 Vino / Borgoña", primary: "#742a35", accent: "#943644", text: "#ffffff" },
    { id: "royal", name: "🔵 Azul Royal", primary: "#1e3a8a", accent: "#2563eb", text: "#ffffff" },
    { id: "emerald", name: "🟢 Verde Esmeralda", primary: "#065f46", accent: "#059669", text: "#ffffff" },
    { id: "gold", name: "🟡 Dorado Casino", primary: "#854d0e", accent: "#d97706", text: "#ffffff" },
    { id: "graphite", name: "⚫ Grafito / Dark", primary: "#0f172a", accent: "#334155", text: "#ffffff" },
    { id: "fire", name: "🟠 Naranja Fuego", primary: "#9a3412", accent: "#ea580c", text: "#ffffff" }
  ];

  $: activePalette = colorPalettes.find((c) => c.id === selectedColor) || colorPalettes[0];

  // Modelos de Diseño Disponibles
  const modelos = [
    { id: "roraima", name: "🛡️ Tálamo / Hexagonal (Oficial)", desc: "Cabecera oscura, foto hexagonal y ecualizador" },
    { id: "wave", name: "🌊 Modern Wave", desc: "Curvas fluidas, marco circular con aro decorativo" },
    { id: "minimal", name: "📐 Minimalista Tech", desc: "Líneas rectas, estética limpia con código de barras" },
    { id: "vip", name: "👑 Casino VIP Gold", desc: "Elegante fondo de gala con destellos dorados" }
  ];

  // Cargar salas completas desde el backend
  async function fetchSalasData() {
    try {
      const res = await fetch("/api/master/salas?limit=all");
      if (res.ok) {
        const json = await res.json();
        const list = json.data || json || [];
        const map = {};
        for (const s of list) {
          map[s.id] = s;
        }
        salasMap = map;
      }
    } catch (e) {
      console.warn("Error cargando salas:", e);
    }
  }

  // Cargar empleados para la vista de carnets
  async function fetchCarnetsData() {
    isLoading = true;
    try {
      const q = new URLSearchParams();
      if (selectedSalas.length > 0) {
        q.set("sala_ids", selectedSalas.join(","));
      } else if (assignedSalaIds.length > 0) {
        q.set("user_sala_ids", assignedSalaIds.join(","));
      }

      if (searchQuery.trim()) {
        q.set("search", searchQuery.trim());
      }

      const res = await fetch(`/api/master/carnets?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        empleados = json.data || [];
        if (currentIndex >= empleados.length) {
          currentIndex = 0;
        }
      } else {
        empleados = [];
      }
    } catch (err) {
      console.error("Error fetching carnets data:", err);
      empleados = [];
    } finally {
      isLoading = false;
    }
  }

  // Recargar cuando cambien las salas seleccionadas o la búsqueda
  $: {
    if (selectedSalas !== undefined) {
      fetchCarnetsData();
    }
  }

  onMount(async () => {
    await fetchSalasData();
    await fetchCarnetsData();
  });

  // Navegación de empleados
  function prevEmpleado() {
    if (empleados.length === 0) return;
    currentIndex = (currentIndex - 1 + empleados.length) % empleados.length;
  }

  function nextEmpleado() {
    if (empleados.length === 0) return;
    currentIndex = (currentIndex + 1) % empleados.length;
  }

  function selectEmpleado(index) {
    currentIndex = index;
  }

  // Formateador de fecha
  function formatDate(str) {
    if (!str) return "N/D";
    try {
      const d = new Date(str);
      if (isNaN(d.getTime())) return str;
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    } catch {
      return str;
    }
  }

  // Formateador de cédula
  function formatCedula(cedula) {
    if (!cedula) return "V00000000";
    const clean = String(cedula).trim();
    if (clean.toUpperCase().startsWith("V") || clean.toUpperCase().startsWith("E") || clean.toUpperCase().startsWith("J")) {
      return clean.toUpperCase();
    }
    return `V${clean}`;
  }

  // Resolver datos enriquecidos de la sala del empleado
  function getSalaInfo(emp) {
    if (!emp) return {};
    const fromMap = salasMap[emp.sala_id] || {};
    return {
      nombre: fromMap.nombre || emp.sala_nombre || "CASINO",
      nombre_comercial: fromMap.nombre_comercial || emp.sala_nombre_comercial || emp.sala_nombre || "Casino",
      rif: fromMap.rif || emp.sala_rif || "J-30606591-6",
      ubicacion: fromMap.ubicacion || emp.sala_ubicacion || "Instalaciones del Casino",
      correo: fromMap.correo || emp.sala_correo || "rrhh@casino.com",
      telefono: fromMap.telefono || emp.sala_telefono || "0424-968.86.12",
      logo_url: `/salas/${emp.sala_id}.svg`
    };
  }

  // Disparar diálogo nativo de impresión
  function handlePrint() {
    window.print();
  }

  $: currentEmp = empleados[currentIndex] || null;
  $: currentSala = currentEmp ? getSalaInfo(currentEmp) : null;
</script>

<div class="carnet-view-container">
  <!-- Cabecera Principal (Oculta en impresión) -->
  <div class="header-section no-print">
    <div class="title-wrap">
      <div class="icon-badge">🪪</div>
      <div>
        <h1 class="main-title">Carnets de Empleados</h1>
        <p class="subtitle">
          Personalización, visualización y emisión de credenciales de identificación institucional
        </p>
      </div>
    </div>

    <div class="top-actions">
      <!-- Selector de Modo de Vista -->
      <div class="mode-switch">
        <button
          type="button"
          class="mode-btn {viewMode === 'individual' ? 'active' : ''}"
          on:click={() => (viewMode = 'individual')}
          title="Ver frente y reverso detallados del empleado actual"
        >
          👁️ Vista Detallada
        </button>
        <button
          type="button"
          class="mode-btn {viewMode === 'lote' ? 'active' : ''}"
          on:click={() => (viewMode = 'lote')}
          title="Ver todos los carnets en cuadrícula para impresión múltiple"
        >
          📑 Todos ({empleados.length})
        </button>
      </div>

      <!-- Botón de Impresión -->
      <button
        type="button"
        class="print-action-btn"
        on:click={handlePrint}
        disabled={empleados.length === 0}
      >
        <span class="btn-icon">🖨️</span>
        <span>Imprimir Carnet{viewMode === 'lote' ? 's' : ''}</span>
      </button>
    </div>
  </div>

  <!-- Barra de Filtros y Configuración (Oculta en impresión) -->
  <div class="controls-toolbar no-print">
    <!-- Multiselect de Salas -->
    <div class="control-item sala-select-item">
      <SmartMultiSelect
        id="carnet-filter-salas"
        label="Salas"
        options={salasOptions}
        bind:selectedValues={selectedSalas}
      />
    </div>

    <!-- Selector de Modelo -->
    <div class="control-item">
      <label class="control-label" for="select-modelo">
        <span class="label-icon">🎨</span> Modelo
      </label>
      <div class="select-wrapper">
        <select id="select-modelo" class="custom-select" bind:value={selectedModelo}>
          {#each modelos as mod}
            <option value={mod.id}>{mod.name}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Selector de Color de Acento -->
    <div class="control-item">
      <label class="control-label" for="select-color">
        <span class="label-icon">🎭</span> Color
      </label>
      <div class="select-wrapper">
        <select id="select-color" class="custom-select" bind:value={selectedColor}>
          {#each colorPalettes as col}
            <option value={col.id}>{col.name}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Buscador de Empleado -->
    <div class="control-item search-item">
      <label class="control-label" for="search-emp">
        <span class="label-icon">🔍</span> Buscar
      </label>
      <div class="search-input-wrap">
        <input
          id="search-emp"
          type="text"
          class="custom-input"
          placeholder="Nombre, cédula o cargo..."
          bind:value={searchQuery}
          on:input={() => {
            clearTimeout(window._searchTimer);
            window._searchTimer = setTimeout(fetchCarnetsData, 300);
          }}
        />
        {#if searchQuery}
          <button
            type="button"
            class="clear-search-btn"
            on:click={() => {
              searchQuery = "";
              fetchCarnetsData();
            }}
          >
            ✕
          </button>
        {/if}
      </div>
    </div>

    <!-- Paginador Rápido de Empleados (en modo individual) -->
    {#if viewMode === 'individual' && empleados.length > 0}
      <div class="control-item pager-item">
        <label class="control-label">
          <span class="label-icon">👤</span> Empleado
        </label>
        <div class="pager-box">
          <button
            type="button"
            class="nav-btn"
            on:click={prevEmpleado}
            title="Empleado anterior"
          >
            ◀
          </button>
          <span class="pager-text">
            <strong>{currentIndex + 1}</strong> / {empleados.length}
          </span>
          <button
            type="button"
            class="nav-btn"
            on:click={nextEmpleado}
            title="Siguiente empleado"
          >
            ▶
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Contenido de Carnets -->
  {#if isLoading}
    <div class="state-container no-print">
      <div class="spinner"></div>
      <p>Cargando información de credenciales...</p>
    </div>
  {:else if empleados.length === 0}
    <div class="state-container empty no-print">
      <div class="empty-icon">🪪</div>
      <h3>No se encontraron empleados</h3>
      <p>Ajusta el filtro de salas o el término de búsqueda para generar los carnets.</p>
    </div>
  {:else if viewMode === 'individual'}
    <!-- Vista Individual: Frente y Reverso Lado a Lado -->
    <div class="carnet-workspace">
      <!-- Tarjeta Frente -->
      <div class="card-stage">
        <div class="stage-label no-print">
          <span class="badge-tag">FRONTAL</span>
          <span class="stage-sub">Parte delantera</span>
        </div>

        <div
          class="carnet-card carnet-front modelo-{selectedModelo}"
          style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent};"
        >
          <!-- Cabecera con Logo de la Sala -->
          <div class="card-header-top">
            <div class="sala-logo-box">
              <img
                src={currentSala.logo_url}
                alt={currentSala.nombre}
                class="sala-logo-img"
                on:error={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextElementSibling.style.display = 'block';
                }}
              />
              <div class="sala-fallback-logo" style="display: none;">
                <div class="fallback-stars">★★★★★</div>
                <div class="fallback-title">{currentSala.nombre}</div>
                <div class="fallback-rif">{currentSala.rif}</div>
              </div>
            </div>
          </div>

          <!-- Marco de Foto según Modelo -->
          <div class="photo-wrapper">
            <div class="photo-frame">
              <img
                src={currentEmp.foto}
                alt={currentEmp.nombre}
                class="employee-photo"
                on:error={(e) => {
                  e.target.src = "/apple-touch-icon.png";
                }}
              />
            </div>
          </div>

          <!-- Nombre del Empleado -->
          <div class="emp-name-wrap">
            <h2 class="emp-name">{currentEmp.nombre}</h2>
          </div>

          <!-- Banner / Píldora de Cargo -->
          <div class="cargo-banner-wrap">
            <div class="cargo-banner">
              {currentEmp.cargo_nombre || "PERSONAL"}
            </div>
          </div>

          <!-- Tabla de Datos del Empleado -->
          <div class="emp-details-grid">
            <div class="detail-row">
              <span class="detail-label">Cédula :</span>
              <span class="detail-value">{formatCedula(currentEmp.cedula)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Departamento :</span>
              <span class="detail-value">{currentEmp.departamento_nombre || "General"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Área :</span>
              <span class="detail-value">{currentEmp.area_nombre || currentEmp.departamento_nombre || "Operaciones"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Ingreso :</span>
              <span class="detail-value">{formatDate(currentEmp.fecha_ingreso)}</span>
            </div>
          </div>

          <!-- Decoración Inferior de Barras / Ecualizador -->
          <div class="card-footer-decoration">
            <div class="equalizer-bars">
              {#each [18, 28, 14, 32, 22, 12, 26, 34, 16, 24, 30, 20, 36, 15, 28, 32, 19, 25, 33, 14, 27] as h}
                <span class="eq-bar" style="height: {h}px;"></span>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- Tarjeta Detrás / Reverso -->
      <div class="card-stage">
        <div class="stage-label no-print">
          <span class="badge-tag secondary">DETRÁS</span>
          <span class="stage-sub">Parte trasera</span>
        </div>

        <div
          class="carnet-card carnet-back modelo-{selectedModelo}"
          style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent};"
        >
          <!-- Contenido Reverso -->
          <div class="back-content-inner">
            <p class="legal-intro">
              El portador del presente Carnet presta sus servicios Profesionales a:
            </p>

            <div class="company-name-highlight">
              <u>{currentSala.nombre_comercial || currentSala.nombre}</u>
            </div>

            <div class="company-rif">
              R.I.F.: {currentSala.rif}
            </div>

            <p class="legal-notice">
              Se le agradece a las autoridades Civiles, Militares y otros Organismos Públicos,
              brindarle todo su apoyo y colaboración. En caso de emergencia o pérdida,
              favor avisar al teléfono:
            </p>

            <div class="company-phone">
              {currentSala.telefono}
            </div>

            <div class="company-address">
              {currentSala.ubicacion}
            </div>
          </div>

          <!-- Bloque de Pie con Correo Institucional -->
          <div class="back-footer-pill">
            <span class="footer-email-text">
              Correo: {currentSala.correo}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Carrusel de Miniaturas para Selección Rápida (Oculto en impresión) -->
    <div class="thumbnail-strip no-print">
      <div class="strip-header">
        <span class="strip-title">Personal de la Sala ({empleados.length})</span>
        <span class="strip-hint">Haz clic en un empleado para previsualizar su carnet</span>
      </div>
      <div class="strip-scroll">
        {#each empleados as emp, idx}
          <button
            type="button"
            class="thumb-item {idx === currentIndex ? 'active' : ''}"
            on:click={() => selectEmpleado(idx)}
          >
            <img
              src={emp.foto}
              alt={emp.nombre}
              class="thumb-photo"
              on:error={(e) => (e.target.src = "/apple-touch-icon.png")}
            />
            <div class="thumb-info">
              <div class="thumb-name">{emp.nombre}</div>
              <div class="thumb-cargo">{emp.cargo_nombre}</div>
            </div>
          </button>
        {/each}
      </div>
    </div>

  {:else}
    <!-- Vista Lote / Imprimir Todos -->
    <div class="batch-grid">
      {#each empleados as emp}
        {@const sala = getSalaInfo(emp)}
        <div class="batch-pair">
          <!-- Cara Frontal -->
          <div
            class="carnet-card carnet-front modelo-{selectedModelo}"
            style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent};"
          >
            <div class="card-header-top">
              <div class="sala-logo-box">
                <img src={sala.logo_url} alt={sala.nombre} class="sala-logo-img" />
              </div>
            </div>

            <div class="photo-wrapper">
              <div class="photo-frame">
                <img
                  src={emp.foto}
                  alt={emp.nombre}
                  class="employee-photo"
                  on:error={(e) => (e.target.src = "/apple-touch-icon.png")}
                />
              </div>
            </div>

            <div class="emp-name-wrap">
              <h2 class="emp-name">{emp.nombre}</h2>
            </div>

            <div class="cargo-banner-wrap">
              <div class="cargo-banner">{emp.cargo_nombre || "PERSONAL"}</div>
            </div>

            <div class="emp-details-grid">
              <div class="detail-row">
                <span class="detail-label">Cédula :</span>
                <span class="detail-value">{formatCedula(emp.cedula)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Departamento :</span>
                <span class="detail-value">{emp.departamento_nombre || "General"}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Área :</span>
                <span class="detail-value">{emp.area_nombre || emp.departamento_nombre || "Operaciones"}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Ingreso :</span>
                <span class="detail-value">{formatDate(emp.fecha_ingreso)}</span>
              </div>
            </div>

            <div class="card-footer-decoration">
              <div class="equalizer-bars">
                {#each [18, 28, 14, 32, 22, 12, 26, 34, 16, 24, 30, 20, 36, 15, 28, 32, 19, 25, 33, 14, 27] as h}
                  <span class="eq-bar" style="height: {h}px;"></span>
                {/each}
              </div>
            </div>
          </div>

          <!-- Cara Trasera -->
          <div
            class="carnet-card carnet-back modelo-{selectedModelo}"
            style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent};"
          >
            <div class="back-content-inner">
              <p class="legal-intro">
                El portador del presente Carnet presta sus servicios Profesionales a:
              </p>
              <div class="company-name-highlight">
                <u>{sala.nombre_comercial || sala.nombre}</u>
              </div>
              <div class="company-rif">
                R.I.F.: {sala.rif}
              </div>
              <p class="legal-notice">
                Se le agradece a las autoridades Civiles, Militares y otros Organismos Públicos,
                brindarle todo su apoyo y colaboración. En caso de emergencia o pérdida,
                favor avisar al teléfono:
              </p>
              <div class="company-phone">{sala.telefono}</div>
              <div class="company-address">{sala.ubicacion}</div>
            </div>

            <div class="back-footer-pill">
              <span class="footer-email-text">Correo: {sala.correo}</span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* ----------------------------------------------------
     ESTILOS BASE & LAYOUT GENERAL
     ---------------------------------------------------- */
  .carnet-view-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 20px;
    min-height: calc(100vh - 70px);
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }

  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    color: #ffffff;
    padding: 16px 22px;
    border-radius: 12px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  }

  .title-wrap {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .icon-badge {
    font-size: 28px;
    background: rgba(255, 255, 255, 0.1);
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }

  .main-title {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
    letter-spacing: -0.3px;
  }

  .subtitle {
    font-size: 12.5px;
    color: #94a3b8;
    margin: 2px 0 0 0;
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .mode-switch {
    display: flex;
    background: rgba(0, 0, 0, 0.3);
    padding: 3px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .mode-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mode-btn.active {
    background: #3b82f6;
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4);
  }

  .print-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: #ffffff;
    border: none;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 700;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    transition: all 0.2s ease;
  }

  .print-action-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
  }

  .print-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ----------------------------------------------------
     BARRA DE HERRAMIENTAS / CONTROLES
     ---------------------------------------------------- */
  .controls-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
    background: #ffffff;
    padding: 14px 18px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
  }

  .control-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .sala-select-item {
    min-width: 220px;
    flex: 1 1 220px;
  }

  .control-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .select-wrapper {
    position: relative;
  }

  .custom-select {
    appearance: none;
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 30px 8px 12px;
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
    cursor: pointer;
    outline: none;
    min-width: 170px;
    transition: all 0.2s ease;
  }

  .custom-select:focus {
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .search-item {
    flex: 1 1 180px;
  }

  .search-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .custom-input {
    width: 100%;
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 30px 8px 12px;
    font-size: 13px;
    color: #1e293b;
    outline: none;
    transition: all 0.2s ease;
  }

  .custom-input:focus {
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .clear-search-btn {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 13px;
  }

  .pager-box {
    display: flex;
    align-items: center;
    background: #f1f5f9;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    padding: 3px 6px;
    gap: 8px;
  }

  .nav-btn {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    color: #334155;
    transition: all 0.15s ease;
  }

  .nav-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .pager-text {
    font-size: 12px;
    color: #475569;
    white-space: nowrap;
  }

  /* ----------------------------------------------------
     ÁREA DE VISUALIZACIÓN / WORKSPACE DE CARNET
     ---------------------------------------------------- */
  .carnet-workspace {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    gap: 36px;
    padding: 24px 0;
    flex-wrap: wrap;
  }

  .card-stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .stage-label {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-tag {
    background: #3b82f6;
    color: #ffffff;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
    padding: 3px 10px;
    border-radius: 20px;
  }

  .badge-tag.secondary {
    background: #64748b;
  }

  .stage-sub {
    font-size: 12px;
    color: #64748b;
    font-weight: 500;
  }

  /* ----------------------------------------------------
     ESTRUCTURA DE LA TARJETA (CR80: 54mm x 85.6mm)
     Proporción estándar: 320px x 506px
     ---------------------------------------------------- */
  .carnet-card {
    width: 310px;
    height: 490px;
    background: #ffffff;
    border-radius: 16px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-sizing: border-box;
    user-select: none;
    background-clip: padding-box;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: CABECERA Y LOGO
     ---------------------------------------------------- */
  .card-header-top {
    position: relative;
    background: #000000;
    height: 105px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 12px 18px 12px;
    box-sizing: border-box;
  }

  /* Corte curvo / angular estilo Tálamo / Roraima */
  .modelo-roraima .card-header-top {
    clip-path: ellipse(115% 100% at 50% 0%);
  }

  .modelo-wave .card-header-top {
    background: linear-gradient(135deg, #000000 0%, var(--accent-color) 100%);
    clip-path: ellipse(125% 95% at 50% 5%);
  }

  .modelo-vip .card-header-top {
    background: linear-gradient(180deg, #18181b 0%, #09090b 100%);
    border-bottom: 2px solid #d4af37;
  }

  .sala-logo-box {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sala-logo-img {
    max-width: 210px;
    max-height: 68px;
    object-fit: contain;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  }

  .sala-fallback-logo {
    text-align: center;
    color: #ffffff;
  }

  .fallback-stars {
    color: #fbbf24;
    font-size: 12px;
    letter-spacing: 2px;
  }

  .fallback-title {
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .fallback-rif {
    font-size: 9.5px;
    color: #cbd5e1;
    letter-spacing: 0.5px;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: FOTO DEL EMPLEADO
     ---------------------------------------------------- */
  .photo-wrapper {
    display: flex;
    justify-content: center;
    margin-top: -30px;
    position: relative;
    z-index: 10;
  }

  /* Marco Hexagonal (Modelo Roraima) */
  .modelo-roraima .photo-frame {
    width: 110px;
    height: 124px;
    background: var(--accent-color);
    padding: 3.5px;
    clip-path: polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%);
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25));
  }

  .modelo-roraima .employee-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    clip-path: polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%);
    background: #e2e8f0;
  }

  /* Marco Circular (Modelo Wave) */
  .modelo-wave .photo-frame {
    width: 112px;
    height: 112px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-color), #ffffff);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .modelo-wave .employee-photo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    background: #e2e8f0;
  }

  /* Marco Rectangular Redondeado (Modelo Minimalista) */
  .modelo-minimal .photo-frame {
    width: 105px;
    height: 115px;
    border-radius: 12px;
    border: 3px solid var(--accent-color);
    padding: 2px;
    background: #ffffff;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
  }

  .modelo-minimal .employee-photo {
    width: 100%;
    height: 100%;
    border-radius: 8px;
    object-fit: cover;
    background: #e2e8f0;
  }

  /* Marco Dorado VIP (Modelo VIP) */
  .modelo-vip .photo-frame {
    width: 108px;
    height: 120px;
    border: 2px solid #d4af37;
    background: #000000;
    padding: 3px;
    box-shadow: 0 0 12px rgba(212, 175, 55, 0.35);
  }

  .modelo-vip .employee-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: NOMBRE Y BANNER DE CARGO
     ---------------------------------------------------- */
  .emp-name-wrap {
    text-align: center;
    margin-top: 8px;
    padding: 0 14px;
  }

  .emp-name {
    font-size: 16.5px;
    font-weight: 900;
    color: #000000;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.15;
  }

  .cargo-banner-wrap {
    display: flex;
    justify-content: center;
    margin: 6px 0 10px 0;
  }

  .cargo-banner {
    background: var(--accent-color);
    color: #ffffff;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 4px 18px;
    border-radius: 4px;
    display: inline-block;
    max-width: 85%;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);
  }

  .modelo-roraima .cargo-banner {
    clip-path: polygon(6px 0%, calc(100% - 6px) 0%, 100% 50%, calc(100% - 6px) 100%, 6px 100%, 0% 50%);
    padding: 4px 22px;
    border-radius: 0;
  }

  .modelo-wave .cargo-banner {
    border-radius: 20px;
    padding: 4px 18px;
  }

  .modelo-vip .cargo-banner {
    background: linear-gradient(135deg, #1c1917, #292524);
    border: 1px solid #d4af37;
    color: #fef08a;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: TABLA DE DATOS DEL EMPLEADO
     ---------------------------------------------------- */
  .emp-details-grid {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 24px;
    margin-top: 2px;
    flex: 1;
  }

  .detail-row {
    display: flex;
    align-items: baseline;
    font-size: 11.5px;
    line-height: 1.35;
  }

  .detail-label {
    font-weight: 800;
    color: #1e293b;
    min-width: 105px;
    flex-shrink: 0;
  }

  .detail-value {
    font-weight: 700;
    color: #334155;
    word-break: break-word;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: BARRAS / ECUALIZADOR INFERIOR
     ---------------------------------------------------- */
  .card-footer-decoration {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    padding: 4px 16px 10px 16px;
    margin-top: auto;
  }

  .equalizer-bars {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 4.5px;
    width: 100%;
    height: 40px;
  }

  .eq-bar {
    width: 3.2px;
    background: var(--accent-color);
    border-radius: 2px;
    opacity: 0.85;
    transition: height 0.3s ease;
  }

  /* ----------------------------------------------------
     CARA TRASERA / REVERSO DEL CARNET
     ---------------------------------------------------- */
  .carnet-back {
    background: #ffffff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 22px 18px 14px 18px;
    box-sizing: border-box;
  }

  .back-content-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    flex: 1;
  }

  .legal-intro {
    font-size: 11px;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
    line-height: 1.35;
  }

  .company-name-highlight {
    font-size: 14.5px;
    font-weight: 900;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.25;
    margin: 2px 0;
  }

  .company-rif {
    font-size: 13px;
    font-weight: 900;
    color: #0f172a;
    letter-spacing: 0.5px;
  }

  .legal-notice {
    font-size: 10.2px;
    font-weight: 500;
    color: #334155;
    margin: 6px 0 2px 0;
    line-height: 1.38;
    padding: 0 4px;
  }

  .company-phone {
    font-size: 15px;
    font-weight: 900;
    color: #000000;
    letter-spacing: 0.8px;
    margin: 2px 0;
  }

  .company-address {
    font-size: 10px;
    font-style: italic;
    font-weight: 500;
    color: #475569;
    line-height: 1.35;
    padding: 0 6px;
    margin-top: 4px;
  }

  .back-footer-pill {
    background: var(--accent-color);
    color: #ffffff;
    border-radius: 8px;
    padding: 8px 12px;
    text-align: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
    margin-top: auto;
  }

  .footer-email-text {
    font-size: 11px;
    font-weight: 700;
    word-break: break-all;
    letter-spacing: 0.3px;
  }

  /* ----------------------------------------------------
     TIRA DE MINIATURAS (STRIP)
     ---------------------------------------------------- */
  .thumbnail-strip {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 14px 18px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
    margin-top: 8px;
  }

  .strip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .strip-title {
    font-size: 13px;
    font-weight: 800;
    color: #1e293b;
  }

  .strip-hint {
    font-size: 11px;
    color: #64748b;
  }

  .strip-scroll {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 6px;
  }

  .strip-scroll::-webkit-scrollbar {
    height: 6px;
  }

  .strip-scroll::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 10px;
  }

  .thumb-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
    min-width: 190px;
    text-align: left;
    transition: all 0.15s ease;
  }

  .thumb-item:hover {
    border-color: #94a3b8;
    background: #f1f5f9;
  }

  .thumb-item.active {
    border-color: #3b82f6;
    background: #eff6ff;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
  }

  .thumb-photo {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    object-fit: cover;
    background: #cbd5e1;
    flex-shrink: 0;
  }

  .thumb-info {
    overflow: hidden;
  }

  .thumb-name {
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .thumb-cargo {
    font-size: 10.5px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ----------------------------------------------------
     VISTA LOTE / IMPRESIÓN MÚLTIPLE
     ---------------------------------------------------- */
  .batch-grid {
    display: flex;
    flex-direction: column;
    gap: 28px;
    align-items: center;
    padding: 16px 0;
  }

  .batch-pair {
    display: flex;
    gap: 24px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  /* ----------------------------------------------------
     ESTADOS DE CARGA Y VACÍO
     ---------------------------------------------------- */
  .state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    color: #64748b;
    gap: 12px;
  }

  .state-container.empty {
    color: #475569;
  }

  .empty-icon {
    font-size: 48px;
  }

  .state-container h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #1e293b;
  }

  .state-container p {
    margin: 0;
    font-size: 13px;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3.5px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ----------------------------------------------------
     REGLAS DE IMPRESIÓN (@media print)
     Escala exacta CR80 (54mm x 85.6mm)
     ---------------------------------------------------- */
  @media print {
    :global(body),
    :global(html) {
      background: #ffffff !important;
      padding: 0 !important;
      margin: 0 !important;
    }

    /* Ocultar elementos de navegación del sistema y controles */
    :global(.sidebar-container),
    :global(.header-container),
    :global(.top-bar),
    .no-print {
      display: none !important;
    }

    .carnet-view-container {
      padding: 0 !important;
      margin: 0 !important;
    }

    .carnet-workspace {
      display: flex !important;
      flex-direction: row !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 8mm !important;
      padding: 10mm 0 !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .batch-pair {
      display: flex !important;
      flex-direction: row !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 8mm !important;
      margin-bottom: 12mm !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .carnet-card {
      width: 54mm !important;
      height: 85.6mm !important;
      box-shadow: none !important;
      border: 1px solid #d1d5db !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .card-header-top {
      height: 19mm !important;
      padding: 1.5mm 2mm 2.5mm 2mm !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .sala-logo-img {
      max-width: 36mm !important;
      max-height: 12mm !important;
    }

    .photo-wrapper {
      margin-top: -5.5mm !important;
    }

    .modelo-roraima .photo-frame {
      width: 19.5mm !important;
      height: 22mm !important;
      padding: 0.6mm !important;
    }

    .emp-name-wrap {
      margin-top: 1mm !important;
      padding: 0 2mm !important;
    }

    .emp-name {
      font-size: 8.5pt !important;
    }

    .cargo-banner-wrap {
      margin: 1mm 0 1.5mm 0 !important;
    }

    .cargo-banner {
      font-size: 5.8pt !important;
      padding: 1mm 3.5mm !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .emp-details-grid {
      padding: 0 4mm !important;
      gap: 0.6mm !important;
    }

    .detail-row {
      font-size: 6.2pt !important;
    }

    .detail-label {
      min-width: 18mm !important;
    }

    .card-footer-decoration {
      padding: 1mm 2mm 1.5mm 2mm !important;
    }

    .equalizer-bars {
      height: 6.5mm !important;
      gap: 0.8mm !important;
    }

    .eq-bar {
      width: 0.6mm !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Reverso en Impresión */
    .carnet-back {
      padding: 3.5mm 3mm 2.5mm 3mm !important;
    }

    .legal-intro {
      font-size: 5.8pt !important;
      line-height: 1.25 !important;
    }

    .company-name-highlight {
      font-size: 7.5pt !important;
      margin: 0.5mm 0 !important;
    }

    .company-rif {
      font-size: 6.8pt !important;
    }

    .legal-notice {
      font-size: 5.4pt !important;
      line-height: 1.28 !important;
      margin: 1mm 0 0.5mm 0 !important;
    }

    .company-phone {
      font-size: 7.8pt !important;
      margin: 0.5mm 0 !important;
    }

    .company-address {
      font-size: 5.2pt !important;
      line-height: 1.25 !important;
      margin-top: 0.8mm !important;
    }

    .back-footer-pill {
      padding: 1.2mm 2mm !important;
      border-radius: 1.5mm !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .footer-email-text {
      font-size: 5.8pt !important;
    }
  }
</style>
