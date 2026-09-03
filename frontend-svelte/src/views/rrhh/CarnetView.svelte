<script>
  import { onMount } from "svelte";
  import html2canvas from "html2canvas";
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
  let selectedModelo = "roraima";
  let selectedColor = "burgundy";
  let searchQuery = "";
  let currentIndex = 0;
  let viewMode = "individual"; // "individual" o "lote"

  let empleados = [];
  let isLoading = false;
  let salasMap = {};

  // Paletas de Color Disponibles (22 opciones de alta gama)
  const colorPalettes = [
    { id: "burgundy",  name: "🍷 Vino / Borgoña",       primary: "#742a35", accent: "#943644", text: "#ffffff" },
    { id: "royal",     name: "🔵 Azul Royal",            primary: "#1e3a8a", accent: "#2563eb", text: "#ffffff" },
    { id: "emerald",   name: "🟢 Verde Esmeralda",       primary: "#065f46", accent: "#059669", text: "#ffffff" },
    { id: "gold",      name: "🟡 Dorado Casino",         primary: "#854d0e", accent: "#d97706", text: "#ffffff" },
    { id: "graphite",  name: "⚫ Grafito / Dark",        primary: "#0f172a", accent: "#334155", text: "#ffffff" },
    { id: "fire",      name: "🟠 Naranja Fuego",         primary: "#9a3412", accent: "#ea580c", text: "#ffffff" },
    { id: "violet",    name: "🟣 Violeta / Púrpura",     primary: "#4c1d95", accent: "#7c3aed", text: "#ffffff" },
    { id: "rose",      name: "🌹 Rosa Elegante",         primary: "#881337", accent: "#e11d48", text: "#ffffff" },
    { id: "teal",      name: "🩵 Turquesa / Teal",       primary: "#134e4a", accent: "#0d9488", text: "#ffffff" },
    { id: "navy",      name: "⚓ Azul Marino",           primary: "#172554", accent: "#1d4ed8", text: "#ffffff" },
    { id: "copper",    name: "🥉 Cobre / Bronce",        primary: "#7c2d12", accent: "#c2410c", text: "#ffffff" },
    { id: "military",  name: "🪖 Verde Militar",         primary: "#14532d", accent: "#166534", text: "#ffffff" },
    { id: "pink",      name: "💗 Rosa Fucsia",           primary: "#831843", accent: "#db2777", text: "#ffffff" },
    { id: "slate",     name: "🌫️ Azul Pizarra",         primary: "#1e293b", accent: "#475569", text: "#ffffff" },
    { id: "amethyst",  name: "🪐 Amatista Místico",      primary: "#581c87", accent: "#9333ea", text: "#ffffff" },
    { id: "sapphire",  name: "💎 Zafiro Profundo",       primary: "#1e40af", accent: "#3b82f6", text: "#ffffff" },
    { id: "forest",    name: "🌲 Verde Bosque",          primary: "#064e3b", accent: "#10b981", text: "#ffffff" },
    { id: "coral",     name: "🌅 Atardecer Coral",       primary: "#9f1239", accent: "#f43f5e", text: "#ffffff" },
    { id: "espresso",  name: "☕ Café Espresso",         primary: "#451a03", accent: "#78350f", text: "#ffffff" },
    { id: "caribbean", name: "🌊 Océano Caribeño",       primary: "#0e7490", accent: "#06b6d4", text: "#ffffff" },
    { id: "plum",      name: "🍇 Ciruela Imperial",      primary: "#701a75", accent: "#c026d3", text: "#ffffff" },
    { id: "platinum",  name: "🪙 Platino Titanio",       primary: "#334155", accent: "#64748b", text: "#ffffff" }
  ];

  $: activePalette = colorPalettes.find((c) => c.id === selectedColor) || colorPalettes[0];

  // Modelos de Diseño Disponibles (12 opciones profesionales)
  const modelos = [
    { id: "roraima",   name: "🛡️ Tálamo Hexagonal (Oficial)",  desc: "Cabecera negra con corte en V, foto hexagonal y ecualizador" },
    { id: "wave",      name: "🌊 Modern Wave",                  desc: "Curvas fluidas, marco circular con aro decorativo" },
    { id: "minimal",   name: "📐 Minimalista Tech",             desc: "Líneas rectas, estética limpia con código de barras" },
    { id: "vip",       name: "👑 Casino VIP Gold",              desc: "Elegante fondo de gala con línea dorada y ribetes" },
    { id: "diamond",   name: "💎 Diamond Royale",              desc: "Rombos decorativos y bisel dorado premium" },
    { id: "neon",      name: "⚡ Neon Futurista",               desc: "Fondo oscuro con detalles neón y trazo brillante" },
    { id: "corporate", name: "🏢 Corporativo Clásico",          desc: "Cabecera lateral con franjas y marco sobrio" },
    { id: "retro",     name: "🎰 Retro Casino",                 desc: "Ficha circular, patrones dorados y borde vintage" },
    { id: "geometric", name: "📐 Diagonal Modern",             desc: "Cortes angulares dinámicos y franja de acento" },
    { id: "executive", name: "👔 Ejecutivo Deluxe",             desc: "Bisel metálico premium con cabecera en degradé" },
    { id: "cyber",     name: "🌐 Cyber Matrix",                 desc: "Fondo tech oscuro con líneas de escaneo luminosas" },
    { id: "aurora",    name: "🌌 Aurora Gradient",              desc: "Curvas suaves con degradado moderno multicolor" }
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

  // Estados y elementos para descarga en Ultra Alta Resolución
  let frontCardEl;
  let backCardEl;
  let isDownloading = false;
  let downloadProgress = "";

  function getSanitizedName(emp) {
    if (!emp) return "Empleado";
    const name = (emp.nombre || "").trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    const cedula = (emp.cedula || "").trim().replace(/[^a-zA-Z0-9]/g, "");
    return `${name}_${cedula}`;
  }

  async function downloadCard(element, filename) {
    if (!element || isDownloading) return;
    isDownloading = true;
    downloadProgress = "Generando Ultra HD...";
    try {
      // Escala 5x = 1590 x 2500 px (Ultra Alta Resolución PVC 450+ DPI real)
      const canvas = await html2canvas(element, {
        scale: 5,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
        imageTimeout: 20000,
        removeContainer: true,
        onclone: (clonedDoc, clonedEl) => {
          clonedEl.style.boxShadow = "none";
          clonedEl.style.transform = "none";
          clonedEl.style.animation = "none";
          clonedEl.style.transition = "none";
          clonedEl.style.webkitPrintColorAdjust = "exact";
          clonedEl.style.printColorAdjust = "exact";
        }
      });

      const dataUrl = canvas.toDataURL("image/png", 1.0);
      const link = document.createElement("a");
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Error al generar carnet en ultra alta resolución:", err);
      alert("No se pudo generar la imagen del carnet. Por favor reintente.");
    } finally {
      isDownloading = false;
      downloadProgress = "";
    }
  }

  async function downloadBothSides() {
    if (!currentEmp || isDownloading) return;
    isDownloading = true;
    downloadProgress = "Frente HD...";
    const baseName = getSanitizedName(currentEmp);

    try {
      await downloadCard(frontCardEl, `Carnet_Frontal_${baseName}.png`);
      downloadProgress = "Reverso HD...";
      await new Promise((resolve) => setTimeout(resolve, 600));
      await downloadCard(backCardEl, `Carnet_Reverso_${baseName}.png`);
    } finally {
      isDownloading = false;
      downloadProgress = "";
    }
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

  // Generar foto con recorte hexagonal transparente vía canvas para que html2canvas la dibuje al 100%
  let hexPhotoDataUrl = "";

  async function generateHexPhoto(src) {
    if (!src) {
      hexPhotoDataUrl = "";
      return;
    }
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = src;
      });

      // Multiplicador 4x de alta resolución (784 x 992 px) para calidad cristalina en la descarga Ultra HD
      const hdFactor = 4;
      const w = 196 * hdFactor;
      const h = 248 * hdFactor;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");

      // Trazar hexágono proporcional con recorte
      ctx.beginPath();
      ctx.moveTo(w * 0.5, 0);
      ctx.lineTo(w, h * 0.25);
      ctx.lineTo(w, h * 0.75);
      ctx.lineTo(w * 0.5, h);
      ctx.lineTo(0, h * 0.75);
      ctx.lineTo(0, h * 0.25);
      ctx.closePath();
      ctx.clip();

      // Dibujar foto ajustada preservando aspecto (cover)
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const targetRatio = w / h;
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      let sx = 0;
      let sy = 0;

      if (imgRatio > targetRatio) {
        sw = sh * targetRatio;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = sw / targetRatio;
        sy = (img.naturalHeight - sh) / 2;
      }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      hexPhotoDataUrl = canvas.toDataURL("image/png");
    } catch (err) {
      console.warn("No se pudo generar recorte hexagonal en canvas:", err);
      hexPhotoDataUrl = src;
    }
  }

  $: if (currentEmp && currentEmp.foto) {
    generateHexPhoto(currentEmp.foto);
  }
</script>

<div class="carnet-view-container">
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

    <!-- Paginador Rápido de Empleados -->
    {#if empleados.length > 0}
      <div class="control-item pager-item">
        <span class="control-label">
          <span class="label-icon">👤</span> Empleado
        </span>
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
  {:else if currentEmp && currentSala}
    <!-- Vista de Carnet: Frente y Reverso Lado a Lado -->
    <div class="carnet-workspace">
      <!-- Tarjeta Frente -->
      <div class="card-stage">
        <div class="stage-label no-print">
          <span class="badge-tag">FRONTAL</span>
          <span class="stage-sub">Parte delantera</span>
        </div>

        <div
          bind:this={frontCardEl}
          class="carnet-card carnet-front modelo-{selectedModelo}"
          style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent}; {selectedModelo === 'neon' ? 'background:#050510;' : selectedModelo === 'retro' ? 'background:#1a0a00;' : selectedModelo === 'cyber' ? 'background:#020617;' : ''}"
        >
          <!-- Cabecera Superior con Forma Geométrica SVG Nativa (Preservada al 100% en la descarga) -->
          <div class="card-header-top">
            {#if selectedModelo === 'wave'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="wave-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#000000" />
                    <stop offset="100%" stop-color="{activePalette.primary}" />
                  </linearGradient>
                </defs>
                <path d="M 0,0 L 318,0 L 318,110 Q 159,175 0,110 Z" fill="url(#wave-grad)" />
              </svg>
            {:else if selectedModelo === 'vip'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="vip-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#18181b" />
                    <stop offset="100%" stop-color="#09090b" />
                  </linearGradient>
                </defs>
                <polygon points="0,0 318,0 318,124 159,165 0,124" fill="url(#vip-grad)" />
                <polyline points="0,124 159,165 318,124" fill="none" stroke="#d4af37" stroke-width="3" />
              </svg>
            {:else if selectedModelo === 'diamond'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="diamond-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="{activePalette.primary}" />
                    <stop offset="100%" stop-color="#000000" />
                  </linearGradient>
                </defs>
                <!-- Cabecera trapezoidal -->
                <polygon points="0,0 318,0 318,140 0,165" fill="url(#diamond-grad)" />
                <!-- Linea dorada decorativa -->
                <line x1="0" y1="140" x2="318" y2="165" stroke="#d4af37" stroke-width="2.5" />
                <!-- Rombos decorativos -->
                <polygon points="30,20 44,34 30,48 16,34" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" />
                <polygon points="280,20 294,34 280,48 266,34" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" />
                <polygon points="155,8 163,16 155,24 147,16" fill="#d4af37" opacity="0.8" />
              </svg>
            {:else if selectedModelo === 'neon'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="neon-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#050510" />
                    <stop offset="100%" stop-color="#0d0d1a" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="318" height="165" fill="url(#neon-grad)" />
                <!-- Línea neón inferior -->
                <line x1="0" y1="158" x2="318" y2="158" stroke="{activePalette.accent}" stroke-width="3" opacity="0.9" />
                <!-- Cuadrícula de puntos sutil -->
                {#each [40,80,120,160,200,240,280] as x}
                  {#each [30,60,90,120,150] as y}
                    <circle cx={x} cy={y} r="1" fill="rgba(255,255,255,0.08)" />
                  {/each}
                {/each}
                <!-- Marco inferior tipo circuito -->
                <polyline points="0,150 40,130 80,145 120,125 160,140 200,120 240,135 280,118 318,130" fill="none" stroke="{activePalette.accent}" stroke-width="1.5" opacity="0.5" />
              </svg>
            {:else if selectedModelo === 'corporate'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="corp-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="{activePalette.primary}" />
                    <stop offset="60%" stop-color="{activePalette.primary}" />
                    <stop offset="100%" stop-color="{activePalette.accent}" />
                  </linearGradient>
                </defs>
                <!-- Barra lateral izquierda ancha -->
                <rect x="0" y="0" width="70" height="165" fill="url(#corp-grad)" />
                <!-- Fondo cabecera claro -->
                <rect x="70" y="0" width="248" height="165" fill="#f8fafc" />
                <!-- Líneas decorativas corporativas -->
                <line x1="70" y1="0" x2="70" y2="165" stroke="{activePalette.accent}" stroke-width="4" />
                <line x1="76" y1="0" x2="76" y2="165" stroke="{activePalette.accent}" stroke-width="1.5" opacity="0.5" />
                <!-- Detalle esquina -->
                <rect x="70" y="140" width="248" height="25" fill="{activePalette.primary}" opacity="0.08" />
              </svg>
            {:else if selectedModelo === 'retro'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="retro-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#1a0a00" />
                    <stop offset="100%" stop-color="#2d1600" />
                  </linearGradient>
                  <pattern id="retro-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="10" cy="10" r="1.5" fill="rgba(212,175,55,0.18)" />
                  </pattern>
                </defs>
                <rect x="0" y="0" width="318" height="165" fill="url(#retro-grad)" />
                <rect x="0" y="0" width="318" height="165" fill="url(#retro-dots)" />
                <!-- Marco dorado superior e inferior -->
                <rect x="0" y="0" width="318" height="4" fill="#d4af37" />
                <rect x="0" y="155" width="318" height="4" fill="#d4af37" />
                <!-- Marco lateral izquierdo y derecho -->
                <rect x="0" y="0" width="4" height="165" fill="#d4af37" />
                <rect x="314" y="0" width="4" height="165" fill="#d4af37" />
                <!-- Filigrana central tipo casino -->
                <circle cx="159" cy="82" r="40" fill="none" stroke="rgba(212,175,55,0.2)" stroke-width="1" />
                <circle cx="159" cy="82" r="30" fill="none" stroke="rgba(212,175,55,0.15)" stroke-width="1" />
              </svg>
            {:else if selectedModelo === 'geometric'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="geom-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#0f172a" />
                    <stop offset="100%" stop-color="{activePalette.primary}" />
                  </linearGradient>
                </defs>
                <polygon points="0,0 318,0 318,100 230,145 0,115" fill="url(#geom-grad)" />
                <polygon points="0,115 230,145 200,160 0,135" fill="{activePalette.accent}" opacity="0.85" />
                <polygon points="230,145 318,100 318,125 200,160" fill="{activePalette.primary}" opacity="0.4" />
              </svg>
            {:else if selectedModelo === 'executive'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="exec-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#1e293b" />
                    <stop offset="50%" stop-color="#0f172a" />
                    <stop offset="100%" stop-color="{activePalette.primary}" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="318" height="150" fill="url(#exec-grad)" />
                <rect x="0" y="146" width="318" height="4" fill="#94a3b8" />
                <rect x="0" y="150" width="318" height="2" fill="{activePalette.accent}" />
                <line x1="20" y1="130" x2="298" y2="130" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
              </svg>
            {:else if selectedModelo === 'cyber'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="cyber-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#020617" />
                    <stop offset="100%" stop-color="#091322" />
                  </linearGradient>
                </defs>
                <rect x="0" y="0" width="318" height="165" fill="url(#cyber-grad)" />
                <polygon points="0,150 120,150 140,162 318,162 318,165 0,165" fill="{activePalette.accent}" />
                <line x1="0" y1="140" x2="318" y2="140" stroke="{activePalette.primary}" stroke-width="1.5" opacity="0.6" stroke-dasharray="8 4" />
                <circle cx="140" cy="162" r="3" fill="#38bdf8" />
              </svg>
            {:else if selectedModelo === 'aurora'}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="aurora-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="{activePalette.primary}" />
                    <stop offset="50%" stop-color="{activePalette.accent}" />
                    <stop offset="100%" stop-color="#0284c7" />
                  </linearGradient>
                </defs>
                <path d="M 0,0 L 318,0 L 318,125 C 240,165 120,100 0,145 Z" fill="url(#aurora-grad)" />
                <path d="M 0,145 C 120,100 240,165 318,125 L 318,135 C 240,175 120,110 0,155 Z" fill="rgba(255,255,255,0.25)" />
              </svg>
            {:else}
              <svg class="header-bg-svg" viewBox="0 0 318 165" preserveAspectRatio="none">
                <polygon points="0,0 318,0 318,106 159,165 0,106" fill="#000000" />
              </svg>
            {/if}

            <div class="sala-logo-box">
              {#if currentSala.has_logo && currentSala.logo_url}
                <img
                  src={currentSala.logo_url}
                  alt="Logo {currentSala.nombre}"
                  class="sala-logo-img"
                  crossorigin="anonymous"
                  on:error={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              {/if}
            </div>
          </div>

          <!-- Marco de Foto según modelo -->
          <div class="photo-wrapper">
            {#if selectedModelo === 'roraima'}
              <div class="photo-hex-container">
                <svg viewBox="0 0 116 130" width="116" height="130" class="svg-photo-hex-bg">
                  <polygon points="58,0 110,30 110,100 58,130 6,100 6,30" fill="{activePalette.primary}" />
                </svg>
                <img
                  src={hexPhotoDataUrl || currentEmp.foto}
                  alt={currentEmp.nombre}
                  class="employee-hex-photo"
                  crossorigin="anonymous"
                  on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }}
                />
              </div>
            {:else if selectedModelo === 'wave'}
              <div class="photo-circle-container" style="--accent-ring: {activePalette.primary};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-circle-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'diamond'}
              <!-- Foto con marco de diamante / octágono -->
              <div class="photo-diamond-container" style="--diamond-color: {activePalette.primary};">
                <svg viewBox="0 0 120 120" width="120" height="120" class="svg-photo-diamond-bg">
                  <polygon points="60,2 118,30 118,90 60,118 2,90 2,30" fill="{activePalette.primary}" />
                  <polygon points="60,8 112,34 112,86 60,112 8,86 8,34" fill="#d4af37" opacity="0.5" />
                </svg>
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-diamond-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'neon'}
              <!-- Foto con marco neón circular con glow -->
              <div class="photo-neon-container" style="--neon-color: {activePalette.accent};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-neon-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'corporate'}
              <!-- Foto corporativa: rectangular sobria -->
              <div class="photo-corporate-container" style="border-color: {activePalette.primary};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-corporate-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'retro'}
              <!-- Foto con marco tipo ficha de casino -->
              <div class="photo-retro-container">
                <svg viewBox="0 0 124 124" width="124" height="124" class="svg-photo-retro-bg">
                  <circle cx="62" cy="62" r="60" fill="{activePalette.primary}" />
                  <circle cx="62" cy="62" r="56" fill="none" stroke="#d4af37" stroke-width="2" />
                  <circle cx="62" cy="62" r="50" fill="none" stroke="rgba(212,175,55,0.4)" stroke-width="1" stroke-dasharray="4 3" />
                </svg>
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-retro-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'geometric'}
              <!-- Foto con marco angular moderno -->
              <div class="photo-geometric-container" style="--accent-border: {activePalette.primary};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-geometric-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'executive'}
              <!-- Foto con marco ejecutivo bimetálico -->
              <div class="photo-executive-container" style="--exec-accent: {activePalette.primary};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-executive-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'cyber'}
              <!-- Foto con visor tech y halo cyber -->
              <div class="photo-cyber-container" style="--cyber-accent: {activePalette.accent};">
                <div class="cyber-scan-ring"></div>
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-cyber-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else if selectedModelo === 'aurora'}
              <!-- Foto con halo fluido degradado aurora -->
              <div class="photo-aurora-container" style="--aurora-p: {activePalette.primary}; --aurora-a: {activePalette.accent};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-aurora-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {:else}
              <div class="photo-rect-container" style="border-color: {activePalette.primary};">
                <img src={currentEmp.foto} alt={currentEmp.nombre} class="employee-rect-photo"
                  crossorigin="anonymous" on:error={(e) => { e.target.src = "/apple-touch-icon.png"; }} />
              </div>
            {/if}
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

        <!-- Botón Debajo del Carnet Frontal -->
        <div class="stage-bottom-actions no-print">
          <button
            type="button"
            class="btn-card-download"
            on:click={() => downloadCard(frontCardEl, `Carnet_Frontal_${getSanitizedName(currentEmp)}.png`)}
            disabled={isDownloading}
            title="Descargar Frente en Alta Resolución"
          >
            <span class="btn-icon">📥</span>
            <span>Descargar Frente (Ultra HD)</span>
          </button>
        </div>
      </div>

      <!-- Tarjeta Detrás / Reverso (Diseño balanceado sin espacios vacíos feos) -->
      <div class="card-stage">
        <div class="stage-label no-print">
          <span class="badge-tag secondary">DETRÁS</span>
          <span class="stage-sub">Parte trasera</span>
        </div>

        <div
          bind:this={backCardEl}
          class="carnet-card carnet-back modelo-{selectedModelo}"
          style="--accent-color: {activePalette.primary}; --accent-light: {activePalette.accent}; {selectedModelo === 'neon' ? 'background:#050510;' : selectedModelo === 'retro' ? 'background:#1a0a00;' : selectedModelo === 'cyber' ? 'background:#020617;' : ''}"
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

        <!-- Botón Debajo de la Parte Detrás del Carnet -->
        <div class="stage-bottom-actions no-print">
          <button
            type="button"
            class="btn-card-download secondary"
            on:click={() => downloadCard(backCardEl, `Carnet_Reverso_${getSanitizedName(currentEmp)}.png`)}
            disabled={isDownloading}
            title="Descargar Reverso en Alta Resolución"
          >
            <span class="btn-icon">📥</span>
            <span>Descargar Reverso (Ultra HD)</span>
          </button>
        </div>
      </div>
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

  .stage-bottom-actions {
    display: flex;
    justify-content: center;
    width: 100%;
    margin-top: 12px;
  }

  .btn-card-download {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #0f172a;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    padding: 10px 20px;
    border-radius: 9px;
    border: 1px solid #334155;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
    width: 100%;
    max-width: 318px;
    letter-spacing: 0.3px;
  }

  .btn-card-download:hover:not(:disabled) {
    background: #1e293b;
    border-color: #3b82f6;
    color: #60a5fa;
    transform: translateY(-1.5px);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.25);
  }

  .btn-card-download.secondary {
    background: #1e293b;
    border-color: #475569;
  }

  .btn-card-download.secondary:hover:not(:disabled) {
    background: #334155;
    border-color: #94a3b8;
    color: #ffffff;
  }

  .btn-card-download:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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
    background: transparent;
    height: 165px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 0;
    box-sizing: border-box;
  }

  .header-bg-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  .sala-logo-box {
    position: relative;
    z-index: 2;
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
     CARA FRONTAL: FOTO DEL EMPLEADO (SVG NATIVO)
     ---------------------------------------------------- */
  .photo-wrapper {
    display: flex;
    justify-content: center;
    margin-top: -46px;
    position: relative;
    z-index: 10;
  }

  .photo-hex-container {
    position: relative;
    width: 116px;
    height: 130px;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
  }

  .svg-photo-hex-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  .employee-hex-photo {
    position: relative;
    z-index: 2;
    width: 98px;
    height: 124px;
    object-fit: cover;
    display: block;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  }

  /* Marco Circular (Modelo Wave) */
  .photo-circle-container {
    width: 114px;
    height: 114px;
    border-radius: 50%;
    padding: 3.5px;
    background: linear-gradient(135deg, var(--accent-ring), #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }

  .employee-circle-photo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  /* Marco Rectangular (Modelo Minimal / VIP) */
  .photo-rect-container {
    width: 110px;
    height: 120px;
    border-radius: 14px;
    border: 3.5px solid;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
  }

  .employee-rect-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
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

  /* Marco Diamond (Modelo Diamond Premium) */
  .photo-diamond-container {
    position: relative;
    width: 120px;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
  }

  .svg-photo-diamond-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  .employee-diamond-photo {
    position: relative;
    z-index: 2;
    width: 96px;
    height: 96px;
    object-fit: cover;
    display: block;
    clip-path: polygon(50% 0%, 96% 25%, 96% 75%, 50% 100%, 4% 75%, 4% 25%);
  }

  /* Marco Neón (Modelo Neon Futurista) */
  .photo-neon-container {
    width: 112px;
    height: 112px;
    border-radius: 50%;
    padding: 3px;
    background: var(--neon-color);
    box-shadow:
      0 0 10px var(--neon-color),
      0 0 20px var(--neon-color),
      0 0 6px rgba(255, 255, 255, 0.6) inset;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .employee-neon-photo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid rgba(0, 0, 0, 0.5);
  }

  /* Marco Corporativo (Modelo Corporate) */
  .photo-corporate-container {
    width: 96px;
    height: 116px;
    border-radius: 4px;
    border: 3px solid;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
  }

  .employee-corporate-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Marco Retro / Ficha Casino (Modelo Retro) */
  .photo-retro-container {
    position: relative;
    width: 124px;
    height: 124px;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45));
  }

  .svg-photo-retro-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  .employee-retro-photo {
    position: relative;
    z-index: 2;
    width: 94px;
    height: 94px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  /* Ajustes de photo-wrapper para modelo corporativo (logo en barra lateral) */
  .modelo-corporate .photo-wrapper {
    margin-top: -38px;
    justify-content: flex-end;
    padding-right: 20px;
  }

  /* Ajuste del fondo de tarjeta para Neon */
  .modelo-neon .carnet-card,
  .modelo-neon.carnet-card {
    background: #050510 !important;
  }

  /* Fondo oscuro para modelo Retro */
  .modelo-retro.carnet-card {
    background: #1a0a00 !important;
  }

  /* Colores de texto para Neon */
  .modelo-neon .emp-name {
    color: #ffffff;
    text-shadow: 0 0 8px var(--accent-light);
  }

  .modelo-neon .detail-label,
  .modelo-neon .detail-value {
    color: #e2e8f0;
  }

  .modelo-neon .detail-row {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  /* Colores de texto para Retro */
  .modelo-retro .emp-name {
    color: #fef08a;
  }

  .modelo-retro .detail-label {
    color: #d4af37;
  }

  .modelo-retro .detail-value {
    color: #fef9c3;
  }

  .modelo-retro .detail-row {
    border-bottom-color: rgba(212, 175, 55, 0.2);
  }

  .modelo-retro .cargo-banner {
    background: linear-gradient(135deg, #d4af37, #92400e) !important;
    color: #1a0a00 !important;
    font-weight: 900;
  }

  /* Marco Geometric (Modelo Diagonal Modern) */
  .photo-geometric-container {
    width: 110px;
    height: 118px;
    border: 3px solid var(--accent-border);
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    background: #ffffff;
  }

  .employee-geometric-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Marco Executive (Modelo Ejecutivo Deluxe) */
  .photo-executive-container {
    width: 106px;
    height: 120px;
    border: 3px solid #94a3b8;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25), 0 0 0 1.5px var(--exec-accent);
    background: #ffffff;
  }

  .employee-executive-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Marco Cyber (Modelo Cyber Matrix) */
  .photo-cyber-container {
    position: relative;
    width: 114px;
    height: 114px;
    border-radius: 50%;
    padding: 3px;
    background: #020617;
    border: 2px solid var(--cyber-accent);
    box-shadow: 0 0 14px var(--cyber-accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .employee-cyber-photo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .modelo-cyber .emp-name {
    color: #f8fafc;
    text-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
  }

  .modelo-cyber .detail-label {
    color: #38bdf8;
  }

  .modelo-cyber .detail-value {
    color: #e2e8f0;
  }

  .modelo-cyber .detail-row {
    border-bottom-color: rgba(56, 189, 248, 0.15);
  }

  .modelo-cyber .cargo-banner {
    background: #091322 !important;
    border: 1px solid var(--accent-light);
    color: #38bdf8 !important;
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
  }

  /* Marco Aurora (Modelo Aurora Gradient) */
  .photo-aurora-container {
    width: 114px;
    height: 114px;
    border-radius: 50%;
    padding: 4px;
    background: linear-gradient(135deg, var(--aurora-p), var(--aurora-a), #38bdf8);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .employee-aurora-photo {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    background: #ffffff;
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
     REVERSO PERSONALIZADO POR MODELO
     ---------------------------------------------------- */
  /* Reverso Neon Futurista */
  .modelo-neon .back-card-inner-frame {
    background: #0a0a18 !important;
    border-color: var(--accent-light) !important;
    box-shadow: 0 0 14px rgba(0, 0, 0, 0.7);
  }

  .modelo-neon .legal-intro,
  .modelo-neon .legal-notice {
    color: #cbd5e1 !important;
  }

  .modelo-neon .company-name-highlight,
  .modelo-neon .company-rif {
    color: #ffffff !important;
  }

  .modelo-neon .company-phone {
    color: var(--accent-light) !important;
    text-shadow: 0 0 10px var(--accent-light);
  }

  .modelo-neon .company-address {
    color: #94a3b8 !important;
  }

  .modelo-neon .divider-line {
    background: rgba(255, 255, 255, 0.15) !important;
  }

  /* Reverso Retro Casino */
  .modelo-retro .back-card-inner-frame {
    background: #251101 !important;
    border-color: #d4af37 !important;
    box-shadow: 0 0 14px rgba(212, 175, 55, 0.2);
  }

  .modelo-retro .legal-intro,
  .modelo-retro .legal-notice {
    color: #fef08a !important;
  }

  .modelo-retro .company-name-highlight,
  .modelo-retro .company-rif {
    color: #fef9c3 !important;
  }

  .modelo-retro .company-phone {
    color: #d4af37 !important;
  }

  .modelo-retro .company-address {
    color: #e2d2aa !important;
  }

  .modelo-retro .divider-line {
    background: rgba(212, 175, 55, 0.3) !important;
  }

  .modelo-retro .back-footer-pill {
    background: linear-gradient(135deg, #d4af37, #92400e) !important;
    color: #1a0a00 !important;
  }

  /* Reverso Cyber Matrix */
  .modelo-cyber .back-card-inner-frame {
    background: #07101e !important;
    border-color: #0284c7 !important;
    box-shadow: 0 0 14px rgba(2, 132, 199, 0.3);
  }

  .modelo-cyber .legal-intro,
  .modelo-cyber .legal-notice {
    color: #94a3b8 !important;
  }

  .modelo-cyber .company-name-highlight,
  .modelo-cyber .company-rif {
    color: #f8fafc !important;
  }

  .modelo-cyber .company-phone {
    color: #38bdf8 !important;
    text-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  .modelo-cyber .company-address {
    color: #64748b !important;
  }

  .modelo-cyber .divider-line {
    background: rgba(56, 189, 248, 0.2) !important;
  }

  /* Reverso VIP & Diamond (Elegancia dorada) */
  .modelo-vip .back-card-inner-frame,
  .modelo-diamond .back-card-inner-frame {
    border-color: #d4af37 !important;
  }

  .modelo-vip .company-name-highlight,
  .modelo-diamond .company-name-highlight {
    color: #854d0e !important;
  }

  .modelo-vip .company-phone,
  .modelo-diamond .company-phone {
    color: #854d0e !important;
  }

  .modelo-vip .divider-line,
  .modelo-diamond .divider-line {
    background: #d4af37 !important;
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
