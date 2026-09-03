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

  // Opciones de salas disponibles para el usuario (con id, key y value garantizados)
  let salasOptions = [];
  $: {
    const allSalas = $masterSalasStore || [];
    let filtered = allSalas;
    if (assignedSalaIds.length > 0) {
      filtered = allSalas.filter((s) => assignedSalaIds.includes(Number(s.id)));
    }
    salasOptions = filtered.map((s) => ({
      id: s.id,
      key: s.id,
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

  // Limpiar texto para prevenir mojibake o tildes rotas (ej. Monseñor)
  function cleanText(str) {
    if (!str) return "";
    return String(str)
      .replace(/Ã±/g, "ñ")
      .replace(/Ã‘/g, "Ñ")
      .replace(/Ã¡/g, "á")
      .replace(/Ã©/g, "é")
      .replace(/Ã­/g, "í")
      .replace(/Ã³/g, "ó")
      .replace(/Ãº/g, "ú")
      .replace(/&amp;/g, "&");
  }

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
      if (selectedSalas && selectedSalas.length > 0) {
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

  // Ejecutar búsqueda cuando cambie la selección de salas
  let lastSalasKey = "";
  $: {
    const currentSalasKey = (selectedSalas || []).join(",");
    if (currentSalasKey !== lastSalasKey) {
      lastSalasKey = currentSalasKey;
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
    if (
      clean.toUpperCase().startsWith("V") ||
      clean.toUpperCase().startsWith("E") ||
      clean.toUpperCase().startsWith("J")
    ) {
      return clean.toUpperCase();
    }
    return `V${clean}`;
  }

  // Resolver datos enriquecidos de la sala del empleado
  function getSalaInfo(emp) {
    if (!emp) return {};
    const fromMap = salasMap[emp.sala_id] || {};
    const salasConLogo = [1, 2, 6, 7];
    const hasLogo = salasConLogo.includes(Number(emp.sala_id));
    return {
      id: emp.sala_id,
      nombre: fromMap.nombre || emp.sala_nombre || "CASINO",
      nombre_comercial: fromMap.nombre_comercial || emp.sala_nombre_comercial || emp.sala_nombre || "Casino",
      rif: fromMap.rif || emp.sala_rif || "J-30606591-6",
      ubicacion: cleanText(fromMap.ubicacion || emp.sala_ubicacion || "Instalaciones del Casino"),
      correo: fromMap.correo || emp.sala_correo || "rrhh@casino.com",
      telefono: fromMap.telefono || emp.sala_telefono || "0424-968.86.12",
      has_logo: hasLogo,
      logo_url: hasLogo ? `/api/salas/${emp.sala_id}.png` : null
    };
  }

  // Disparar diálogo nativo de impresión
  function handlePrint() {
    window.print();
  }

  // Generar barras dinámicas de código de barras basadas estrictamente en la cédula del empleado (extremo a extremo)
  function generateCedulaBarcode(cedula) {
    const raw = String(cedula || "").trim().toUpperCase();
    const cleanDigits = raw.replace(/\D/g, "") || "12345678";
    const digits = cleanDigits.split("").map(Number);
    const bars = [];
    
    // Guardas de inicio (estilo barcode profesional)
    bars.push({ h: 35, w: 2.5 });
    bars.push({ h: 15, w: 1.8 });
    bars.push({ h: 32, w: 2.2 });

    // 42 barras centrales para alcanzar 48 barras en total de extremo a extremo
    const count = 42;
    for (let i = 0; i < count; i++) {
      const d = digits[i % digits.length];
      const prev = digits[(i - 1 + digits.length) % digits.length];
      const next = digits[(i + 1) % digits.length];
      const p = (i * 7) + 13;

      // Alturas moduladas dinámicamente según la cédula (12px a 36px)
      const h = 12 + ((d * 11 + prev * 5 + next * 7 + p) % 25);

      // Grosor dinámico tipo barcode auténtico
      const w = ((d + i) % 3 === 0) ? 3.0 : ((d % 2 === 0) ? 2.4 : 1.8);

      bars.push({ h: Math.min(36, Math.max(12, h)), w: w });
    }

    // Guardas de fin
    bars.push({ h: 32, w: 2.2 });
    bars.push({ h: 15, w: 1.8 });
    bars.push({ h: 35, w: 2.5 });

    return bars;
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
        on:change={fetchCarnetsData}
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
  {:else if viewMode === 'individual' && currentEmp && currentSala}
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
          <!-- Cabecera Superior con Espacio Dedicado y Permanente para el Logo -->
          <div class="card-header-top">
            <div class="sala-logo-box">
              {#if currentSala.has_logo && currentSala.logo_url}
                <img
                  src={currentSala.logo_url}
                  alt="Logo {currentSala.nombre}"
                  class="sala-logo-img"
                  on:error={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              {/if}
            </div>
          </div>

          <!-- Marco de Foto según Modelo (Hexagonal en modelo Roraima) -->
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

          <!-- Nombre del Empleado (Inmediatamente debajo del marco y logo) -->
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
              <span class="detail-label">Cedula :</span>
              <span class="detail-value">{formatCedula(currentEmp.cedula)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Departamento :</span>
              <span class="detail-value">{currentEmp.departamento_nombre || "General"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Área :</span>
              <span class="detail-value">{currentEmp.area_nombre || currentEmp.departamento_nombre || "CECOM"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Ingreso :</span>
              <span class="detail-value">{formatDate(currentEmp.fecha_ingreso)}</span>
            </div>
          </div>

          <!-- Código de Barras Dinámico generado con la Cédula -->
          <div class="card-footer-decoration">
            <div class="equalizer-bars" title="Código de barras: {formatCedula(currentEmp.cedula)}">
              {#each generateCedulaBarcode(currentEmp.cedula) as bar}
                <span class="eq-bar" style="height: {bar.h}px; width: {bar.w}px;"></span>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- Tarjeta Detrás / Reverso (Diseño balanceado sin espacios vacíos feos) -->
      <div class="card-stage">
        <div class="stage-label no-print">
          <span class="badge-tag secondary">DETRÁS</span>
          <span class="stage-sub">Parte trasera</span>
        </div>

        <div
          class="carnet-card carnet-back modelo-{selectedModelo}"
          style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent};"
        >
          <!-- Contenedor Interno Estilizado -->
          <div class="back-card-inner-frame">
            <!-- Sección 1: Cabecera Acreditación -->
            <p class="legal-intro">
              El portador del presente Carnet presta sus servicios Profesionales a:
            </p>

            <!-- Sección 2: Nombre de la Empresa y RIF -->
            <div class="company-block">
              <div class="company-name-highlight">
                <u>{currentSala.nombre_comercial || currentSala.nombre}</u>
              </div>
              <div class="company-rif">
                R.I.F.: {currentSala.rif}
              </div>
            </div>

            <!-- Divisor sutil institucional sin estrellas -->
            <div class="ornament-divider">
              <span class="divider-line"></span>
            </div>

            <!-- Bloque Central: Aviso Legal, Teléfono y Dirección (Centrado vertical en el height disponible) -->
            <div class="back-middle-group">
              <!-- Sección 3: Aviso a Autoridades -->
              <p class="legal-notice">
                Se le agradece a las autoridades Civiles, Militares y otros Organismos Públicos,
                brindarle todo su apoyo y colaboración. En caso de emergencia o pérdida,
                favor avisar al teléfono:
              </p>

              <!-- Sección 4: Teléfono de Contacto en Negrita -->
              <div class="company-phone">
                {currentSala.telefono}
              </div>

              <!-- Sección 5: Ubicación Física Completa -->
              <div class="company-address">
                {currentSala.ubicacion}
              </div>
            </div>

            <!-- Sección 6: Bloque de Correo Institucional (2 Líneas exactas) -->
            <div class="back-footer-pill">
              <span class="footer-email-label">CORREO:</span>
              <span class="footer-email-val">{currentSala.correo}</span>
            </div>
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
                {#if sala.has_logo && sala.logo_url}
                  <img
                    src={sala.logo_url}
                    alt="Logo {sala.nombre}"
                    class="sala-logo-img"
                    on:error={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                {/if}
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
                <span class="detail-label">Cedula :</span>
                <span class="detail-value">{formatCedula(emp.cedula)}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Departamento :</span>
                <span class="detail-value">{emp.departamento_nombre || "General"}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Área :</span>
                <span class="detail-value">{emp.area_nombre || emp.departamento_nombre || "CECOM"}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Ingreso :</span>
                <span class="detail-value">{formatDate(emp.fecha_ingreso)}</span>
              </div>
            </div>

            <!-- Código de Barras Dinámico generado con la Cédula -->
            <div class="card-footer-decoration">
              <div class="equalizer-bars" title="Código de barras: {formatCedula(emp.cedula)}">
                {#each generateCedulaBarcode(emp.cedula) as bar}
                  <span class="eq-bar" style="height: {bar.h}px; width: {bar.w}px;"></span>
                {/each}
              </div>
            </div>
          </div>

          <!-- Cara Trasera -->
          <div
            class="carnet-card carnet-back modelo-{selectedModelo}"
            style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent};"
          >
            <div class="back-card-inner-frame">
              <p class="legal-intro">
                El portador del presente Carnet presta sus servicios Profesionales a:
              </p>

              <div class="company-block">
                <div class="company-name-highlight">
                  <u>{sala.nombre_comercial || sala.nombre}</u>
                </div>
                <div class="company-rif">
                  R.I.F.: {sala.rif}
                </div>
              </div>

              <!-- Divisor sutil institucional sin estrellas -->
              <div class="ornament-divider">
                <span class="divider-line"></span>
              </div>

              <!-- Bloque Central: Aviso Legal, Teléfono y Dirección (Centrado vertical en el height disponible) -->
              <div class="back-middle-group">
                <p class="legal-notice">
                  Se le agradece a las autoridades Civiles, Militares y otros Organismos Públicos,
                  brindarle todo su apoyo y colaboración. En caso de emergencia o pérdida,
                  favor avisar al teléfono:
                </p>

                <div class="company-phone">{sala.telefono}</div>

                <div class="company-address">{sala.ubicacion}</div>
              </div>

              <!-- Sección 6: Bloque de Correo Institucional (2 Líneas exactas) -->
              <div class="back-footer-pill">
                <span class="footer-email-label">CORREO:</span>
                <span class="footer-email-val">{sala.correo}</span>
              </div>
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
     Proporción estándar: 318px x 500px
     ---------------------------------------------------- */
  .carnet-card {
    width: 318px;
    height: 500px;
    background: #ffffff;
    border-radius: 18px;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
    border: 1px solid rgba(0, 0, 0, 0.1);
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
    height: 165px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 0;
    box-sizing: border-box;
  }

  /* Corte curvo / angular estilo Tálamo / Roraima */
  .modelo-roraima .card-header-top {
    clip-path: polygon(0 0, 100% 0, 100% 64%, 50% 100%, 0 64%);
  }

  .modelo-wave .card-header-top {
    background: linear-gradient(135deg, #000000 0%, var(--accent-color) 100%);
    clip-path: ellipse(125% 95% at 50% 5%);
  }

  .modelo-vip .card-header-top {
    background: linear-gradient(180deg, #18181b 0%, #09090b 100%);
    border-bottom: 2.5px solid #d4af37;
    clip-path: polygon(0 0, 100% 0, 100% 75%, 50% 100%, 0 75%);
  }

  .sala-logo-box {
    width: 100%;
    height: 122px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    padding: 4px 18px 0 18px;
    margin: 0 auto;
    text-align: center;
  }

  .sala-logo-svg {
    width: 100%;
    max-width: 250px;
    height: 80px;
  }

  .sala-logo-img {
    max-width: 78%;
    max-height: 84px;
    object-fit: contain;
    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.6));
    margin: auto;
    display: block;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: FOTO DEL EMPLEADO
     ---------------------------------------------------- */
  .photo-wrapper {
    display: flex;
    justify-content: center;
    margin-top: -46px;
    position: relative;
    z-index: 10;
  }

  /* Marco Hexagonal (Modelo Roraima) */
  .modelo-roraima .photo-frame {
    width: 116px;
    height: 130px;
    background: var(--accent-color);
    padding: 3.5px;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.3));
  }

  .modelo-roraima .employee-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    background: #e2e8f0;
  }

  /* Marco Circular (Modelo Wave) */
  .modelo-wave .photo-frame {
    width: 114px;
    height: 114px;
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
    width: 108px;
    height: 118px;
    border-radius: 14px;
    border: 3.5px solid var(--accent-color);
    padding: 2px;
    background: #ffffff;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
  }

  .modelo-minimal .employee-photo {
    width: 100%;
    height: 100%;
    border-radius: 10px;
    object-fit: cover;
    background: #e2e8f0;
  }

  /* Marco Dorado VIP (Modelo VIP) */
  .modelo-vip .photo-frame {
    width: 112px;
    height: 124px;
    border: 2.5px solid #d4af37;
    background: #000000;
    padding: 3px;
    box-shadow: 0 0 14px rgba(212, 175, 55, 0.4);
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
    padding: 0 12px;
  }

  .emp-name {
    font-size: clamp(14px, 3.8vw, 17px);
    font-weight: 900;
    color: #000000;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.18;
    max-width: 100%;
    word-break: break-word;
  }

  .cargo-banner-wrap {
    display: flex;
    justify-content: center;
    margin: 5px 0 8px 0;
    max-width: 100%;
  }

  .cargo-banner {
    background: var(--accent-color);
    color: #ffffff;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3.5px 16px;
    border-radius: 4px;
    display: inline-block;
    max-width: 94%;
    text-align: center;
    white-space: normal;
    line-height: 1.25;
    word-break: break-word;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
  }

  .modelo-roraima .cargo-banner {
    clip-path: polygon(6px 0%, calc(100% - 6px) 0%, 100% 50%, calc(100% - 6px) 100%, 6px 100%, 0% 50%);
    padding: 4px 18px;
    border-radius: 0;
  }

  .modelo-wave .cargo-banner {
    border-radius: 20px;
    padding: 3.5px 16px;
  }

  .modelo-vip .cargo-banner {
    background: linear-gradient(135deg, #1c1917, #292524);
    border: 1px solid #d4af37;
    color: #fef08a;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: GRILLA DE DETALLES
     ---------------------------------------------------- */
  .emp-details-grid {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0 22px;
    margin-top: 4px;
    box-sizing: border-box;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 13px;
    line-height: 1.35;
    border-bottom: 1px dashed rgba(0, 0, 0, 0.08);
    padding-bottom: 2px;
  }

  .detail-label {
    font-weight: 800;
    color: #000000;
    min-width: 100px;
  }

  .detail-value {
    font-weight: 700;
    color: #1e293b;
    text-align: right;
    word-break: break-word;
  }

  /* ----------------------------------------------------
     CARA FRONTAL: BARRAS / ECUALIZADOR INFERIOR
     ---------------------------------------------------- */
  .card-footer-decoration {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: 4px 14px 12px 14px;
    margin-top: auto;
    width: 100%;
    box-sizing: border-box;
  }

  .equalizer-bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    width: 100%;
    height: 36px;
    box-sizing: border-box;
  }

  .eq-bar {
    background: var(--accent-color);
    border-radius: 2px;
    opacity: 0.9;
    transition: height 0.3s ease;
  }

  /* ----------------------------------------------------
     CARA TRASERA / REVERSO DEL CARNET
     (Diseño balanceado, armónico y lleno sin huecos feos)
     ---------------------------------------------------- */
  .carnet-back {
    background: #ffffff;
    display: flex;
    flex-direction: column;
    padding: 14px;
    box-sizing: border-box;
  }

  .back-card-inner-frame {
    width: 100%;
    height: 100%;
    border: 1.5px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    padding: 18px 14px 14px 14px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    text-align: center;
    background: #ffffff;
  }

  .legal-intro {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
    margin: 0;
    line-height: 1.35;
  }

  .company-block {
    margin: 8px 0 4px 0;
    max-width: 100%;
  }

  .company-name-highlight {
    font-size: clamp(14px, 3.8vw, 18px);
    font-weight: 900;
    color: #000000;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.22;
    text-decoration: underline;
    text-underline-offset: 3.5px;
    max-width: 100%;
    word-break: break-word;
  }

  .company-rif {
    font-size: clamp(13px, 3.2vw, 15px);
    font-weight: 800;
    color: #000000;
    letter-spacing: 0.5px;
    margin-top: 2px;
  }

  .ornament-divider {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 82%;
    margin: 10px 0 0 0;
  }

  .divider-line {
    width: 100%;
    height: 1.5px;
    background: #e2e8f0;
    border-radius: 1px;
  }

  /* Contenedor del Bloque Central para centrado vertical perfecto */
  .back-middle-group {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    margin: auto 0;
    padding: 6px 0;
    box-sizing: border-box;
  }

  .legal-notice {
    font-size: 11.5px;
    font-weight: 500;
    color: #1e293b;
    margin: 0 0 10px 0;
    line-height: 1.45;
    padding: 0 4px;
  }

  .company-phone {
    font-size: 21px;
    font-weight: 900;
    color: #000000;
    letter-spacing: 0.8px;
    margin: 0 0 10px 0;
  }

  .company-address {
    font-size: 11.5px;
    font-style: italic;
    font-weight: 600;
    color: #334155;
    line-height: 1.4;
    padding: 0 6px;
    margin: 0;
  }

  .back-footer-pill {
    background: var(--accent-color);
    color: #ffffff;
    border-radius: 10px;
    padding: 6px 10px 7px 10px;
    width: calc(100% - 6px);
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15);
    margin-top: 8px;
    box-sizing: border-box;
  }

  .footer-email-label {
    font-size: 9.5px;
    font-weight: 800;
    opacity: 0.95;
    text-transform: uppercase;
    letter-spacing: 1px;
    line-height: 1.2;
    margin-bottom: 2px;
    display: block;
  }

  .footer-email-val {
    font-size: clamp(9.5px, 2.7vw, 12px);
    font-weight: 700;
    letter-spacing: 0.2px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    display: block;
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
      height: 28mm !important;
      padding: 0 2mm !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .sala-logo-box {
      width: 100% !important;
      height: 20mm !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .sala-logo-svg {
      max-width: 44mm !important;
      height: 14mm !important;
    }

    .sala-logo-img {
      max-width: 44mm !important;
      max-height: 18mm !important;
      object-fit: contain !important;
      margin: auto !important;
    }

    .photo-wrapper {
      margin-top: -8mm !important;
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
      padding: 2.5mm !important;
    }

    .back-card-inner-frame {
      padding: 3mm 2.5mm !important;
      border: 0.8px solid #d1d5db !important;
    }

    .legal-intro {
      font-size: 5.8pt !important;
      line-height: 1.25 !important;
    }

    .company-block {
      margin: 1.5mm 0 1mm 0 !important;
    }

    .company-name-highlight {
      font-size: 7.8pt !important;
    }

    .company-rif {
      font-size: 6.8pt !important;
    }

    .back-middle-group {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      margin: auto 0 !important;
    }

    .legal-notice {
      font-size: 5.4pt !important;
      line-height: 1.28 !important;
      margin-bottom: 1.2mm !important;
    }

    .company-phone {
      font-size: 8pt !important;
      margin: 0 0 1.2mm 0 !important;
    }

    .company-address {
      font-size: 5.2pt !important;
      line-height: 1.25 !important;
      margin-bottom: 0 !important;
    }

    .back-footer-pill {
      padding: 1.5mm 2mm !important;
      border-radius: 1.5mm !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .footer-email-label {
      font-size: 4.8pt !important;
    }

    .footer-email-val {
      font-size: 5.8pt !important;
    }
  }
</style>
