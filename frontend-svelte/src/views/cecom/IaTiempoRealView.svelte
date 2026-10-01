<script>
  import { onMount, onDestroy } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { masterSalasStore, masterMesasStore, masterJuegosStore } from "../../controllers/master.store.js";
  import { getCecomIaEventos, getMesasConCamaras, getMesaCamaras, clearCecomIaEventos } from "../../services/cecomVideo.service.js";
  import {
    mesasLiveStatusStore,
    cecomIaLiveEventsStore,
    initCecomIaBackgroundWorker
  } from "../../services/cecomIaBackground.service.js";

  // Filtros
  let selectedSalaUuid = "all";
  let selectedJuego = "all";
  let selectedMesaUuid = "all";
  let fechaDesde = "";
  let fechaHasta = "";
  let searchQuery = "";

  let isLoading = false;
  let eventsList = [];
  let refreshTimer = null;

  // Paginación
  let currentPage = 1;
  let pageSize = 15;

  // Modal Detalle
  let selectedEventDetail = null;

  let mesasConCamaras = [];
  let isLoadingMesas = false;

  function getLocalDateStr(offsetDays = 0) {
    const d = new Date();
    if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  $: salas = $masterSalasStore || [];
  $: liveMesasMap = $mesasLiveStatusStore || {};

  // Lista de mesas para Badges: ÚNICAMENTE mesas asociadas a cámaras
  $: liveMesasBadges = (() => {
    return mesasConCamaras.map(m => {
      const mId = m.mesa_uuid || m.uuid || m.id;
      const live = liveMesasMap[mId] || null;
      return {
        uuid: mId,
        nombre: m.mesa_nombre || m.nombre,
        juego: m.juego_nombre || "Mesa de Juego",
        total_camaras: m.total_camaras || 1,
        ultimo_evento: live?.ultimo_evento || "EN ESPERA",
        descripcion: live?.descripcion || "Mesa activa en monitoreo",
        hora: live?.hora || "",
        es_novedad: live?.es_novedad || false,
        nivel_alerta: live?.nivel_alerta || "INFO"
      };
    });
  })();

  onMount(async () => {
    // Iniciar worker de fondo si aún no corre
    initCecomIaBackgroundWorker();

    // Fecha por defecto: hoy en hora local (evita bug de UTC +1 día)
    const today = getLocalDateStr();
    fechaDesde = today;
    fechaHasta = today;

    await loadMesasConCamaras();
    await loadEvents();

    // Auto-actualizar vista periódicamente cada 4 segundos
    refreshTimer = setInterval(() => {
      loadEvents(false);
    }, 4000);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  async function loadEvents(showLoading = true) {
    if (showLoading) isLoading = true;
    try {
      const params = { limit: 100 };
      if (selectedSalaUuid && selectedSalaUuid !== "all") {
        params.sala_uuid = selectedSalaUuid;
      }
      if (selectedMesaUuid && selectedMesaUuid !== "all") {
        params.mesa_uuid = selectedMesaUuid;
      }
      if (selectedJuego && selectedJuego !== "all") {
        params.juego_nombre = selectedJuego;
      }
      if (fechaDesde) params.fecha_desde = fechaDesde;
      if (fechaHasta) params.fecha_hasta = fechaHasta;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getCecomIaEventos(params);
      if (res && res.success) {
        eventsList = res.data || [];
      }
    } catch (err) {
      console.error("Error al cargar eventos en tiempo real:", err);
    } finally {
      if (showLoading) isLoading = false;
    }
  }

  async function loadMesasConCamaras() {
    isLoadingMesas = true;
    try {
      // 1. Probar ruta centralizada backend
      let loadedFromCentral = false;
      try {
        const res = await getMesasConCamaras({ sala_uuid: selectedSalaUuid });
        if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
          mesasConCamaras = res.data;
          loadedFromCentral = true;
        }
      } catch (err) {
        console.debug("Endpoint centralizado /mesas-con-camaras no disponible, ejecutando sincronización fallback:", err);
      }

      if (loadedFromCentral) {
        return;
      }

      // 2. Fallback de alta resiliencia: resolver mesas y cámaras directamente desde la base de datos
      const allMesas = $masterMesasStore || [];
      const candidateMesas = allMesas.filter(m => {
        if (!selectedSalaUuid || selectedSalaUuid === "all") return true;
        return String(m.sala_uuid || "") === String(selectedSalaUuid);
      });

      const resolved = [];
      await Promise.all(
        candidateMesas.map(async (m) => {
          try {
            const camRes = await getMesaCamaras(m.uuid || m.id);
            if (camRes && camRes.success && Array.isArray(camRes.data) && camRes.data.length > 0) {
              resolved.push({
                mesa_uuid: m.uuid || m.id,
                uuid: m.uuid || m.id,
                id: m.uuid || m.id,
                nombre: m.nombre,
                mesa_nombre: m.nombre,
                sala_uuid: m.sala_uuid,
                juego_nombre: m.juego_nombre || m.juego || "Mesa de Juego",
                total_camaras: camRes.data.length,
                camaras: camRes.data
              });
            }
          } catch (e) {
            // Ignorar errores en mesas individuales
          }
        })
      );

      resolved.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
      mesasConCamaras = resolved;
    } catch (err) {
      console.error("Error cargando mesas asociadas:", err);
      mesasConCamaras = [];
    } finally {
      isLoadingMesas = false;
    }
  }

  async function onSalaChange() {
    selectedMesaUuid = "all";
    currentPage = 1;
    await loadMesasConCamaras();
    await loadEvents();
  }

  function filterByBadgeMesa(mesaUuid) {
    if (selectedMesaUuid === mesaUuid) {
      selectedMesaUuid = "all";
      triggerToast("Filtro de mesa desactivado", "info");
    } else {
      selectedMesaUuid = mesaUuid;
      const m = mesasConCamaras.find(x => String(x.mesa_uuid || x.uuid || x.id) === String(mesaUuid));
      triggerToast(`Filtrando por mesa: ${m?.mesa_nombre || m?.nombre || 'Mesa'}`, "info");
    }
    currentPage = 1;
    loadEvents();
  }

  async function handleClearEvents() {
    if (!confirm("¿Deseas vaciar todos los registros de prueba y eventos de IA?")) return;
    try {
      await clearCecomIaEventos({ sala_uuid: selectedSalaUuid });
      eventsList = [];
      triggerToast("Registros vaciados correctamente", "success");
    } catch (err) {
      console.error("Error al vaciar eventos:", err);
      triggerToast(`Error al vaciar eventos: ${err.message}`, "error");
    }
  }

  // Filtrar para mostrar ÚNICAMENTE eventos de mesas asociadas a cámaras
  $: mesasConCamarasIds = new Set(mesasConCamaras.map(m => String(m.mesa_uuid || m.uuid || m.id)));
  $: filteredEvents = eventsList.filter(ev => {
    const mId = String(ev.mesa_uuid || ev.mesa_id || "");
    return mesasConCamarasIds.has(mId);
  });
  $: totalPages = Math.ceil(filteredEvents.length / pageSize) || 1;
  $: paginatedEvents = filteredEvents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function openDetailModal(ev) {
    selectedEventDetail = ev;
  }

  function closeDetailModal() {
    selectedEventDetail = null;
  }
</script>

<div class="ia-tr-container">
  <!-- Header Principal -->
  <div class="view-header">
    <div class="header-left">
      <div class="icon-badge">⚡</div>
      <div>
        <h1 class="header-title">IA Tiempo Real - Auditoría de Mesas</h1>
        <p class="header-subtitle">
          Monitoreo continuo en segundo plano de jugadas, manos y eventos en vivo de todas las mesas de juego.
        </p>
      </div>
    </div>
    <div class="header-actions">
      <span class="pulse-live">
        <span class="dot"></span>
        Sondeo Activo en Segundo Plano
      </span>
      <button type="button" class="btn-refresh" on:click={() => loadEvents(false)} title="Actualizar eventos">
        <span class="material-icons-round" style="font-size: 16px;">refresh</span>
        Actualizar
      </button>
    </div>
  </div>

  <!-- SECCIÓN 1: Badges en Tiempo Real de las Mesas -->
  <div class="badges-section">
    <div class="badges-header">
      <h2 class="section-title">
        🟢 Mesas Asociadas a Cámaras ({liveMesasBadges.length})
      </h2>
      <span class="badges-hint">Solo se auditan mesas que tengan cámaras vinculadas en CECOM</span>
    </div>

    {#if isLoadingMesas}
      <div class="empty-badges">
        ⏳ Cargando mesas asociadas...
      </div>
    {:else if liveMesasBadges.length === 0}
      <div class="empty-badges">
        ℹ️ No hay mesas asociadas a cámaras en esta sala. Para auditar jugadas en vivo, primero vincula las cámaras a las mesas en <strong>Administración &gt; Mesas y Cámaras</strong>.
      </div>
    {:else}
      <div class="badges-grid">
        {#each liveMesasBadges as badge (badge.uuid)}
          {@const isSelected = selectedMesaUuid === badge.uuid}
          <button
            type="button"
            class="mesa-badge-card"
            class:selected={isSelected}
            class:has-alert={badge.nivel_alerta === 'WARN' || badge.nivel_alerta === 'CRITICAL'}
            on:click={() => filterByBadgeMesa(badge.uuid)}
          >
            <div class="badge-top">
              <span class="mesa-title">{badge.nombre}</span>
              <span class="status-indicator-dot"></span>
            </div>
            <div class="badge-game font-mono">{badge.juego} • 📷 {badge.total_camaras} cam</div>
            <div class="badge-event font-mono">
              {badge.ultimo_evento}
            </div>
            <div class="badge-desc" title={badge.descripcion}>
              {badge.descripcion}
            </div>
            {#if badge.hora}
              <div class="badge-time">Último: {badge.hora}</div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- SECCIÓN 2: Barra de Filtros -->
  <div class="filter-card">
    <div class="filter-row">
      <div class="filter-group">
        <label for="sala-filter">Sala:</label>
        <select id="sala-filter" bind:value={selectedSalaUuid} on:change={onSalaChange}>
          <option value="all">Todas las Salas</option>
          {#each salas as s}
            <option value={s.uuid || s.id}>{s.nombre}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="mesa-filter">Mesa Asociada:</label>
        <select id="mesa-filter" bind:value={selectedMesaUuid} on:change={() => { currentPage = 1; loadEvents(); }}>
          <option value="all">Todas ({mesasConCamaras.length})</option>
          {#each mesasConCamaras as m}
            <option value={m.mesa_uuid || m.uuid || m.id}>{m.mesa_nombre || m.nombre}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="juego-filter">Grupo / Juego:</label>
        <select id="juego-filter" bind:value={selectedJuego} on:change={() => { currentPage = 1; loadEvents(); }}>
          <option value="all">Todos los Juegos</option>
          <option value="BACCARAT">Baccarat (Punto y Banca)</option>
          <option value="BLACKJACK">Blackjack</option>
          <option value="RULETA">Ruleta Americana</option>
          <option value="POKER_CARIBENO">Poker Caribeño</option>
          <option value="TEXAS_BONUS">Texas Bonus</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="fecha-desde">Fecha Desde:</label>
        <input id="fecha-desde" type="date" bind:value={fechaDesde} on:change={() => { currentPage = 1; loadEvents(); }} />
      </div>

      <div class="filter-group">
        <label for="fecha-hasta">Fecha Hasta:</label>
        <input id="fecha-hasta" type="date" bind:value={fechaHasta} on:change={() => { currentPage = 1; loadEvents(); }} />
      </div>

      <div class="filter-group flex-1">
        <label for="search-input">Buscar en Registro:</label>
        <input id="search-input" type="text" placeholder="Buscar por mesa, jugada, ganador..." bind:value={searchQuery} on:input={() => { currentPage = 1; loadEvents(false); }} />
      </div>

      <div class="filter-group-btn">
        <button type="button" class="btn-refresh" on:click={() => loadEvents(true)}>
          🔄 Actualizar
        </button>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 3: DataTable Histórico de Tiempo Real -->
  <div class="datatable-card">
    <div class="table-header-bar">
      <div class="th-title">
        📊 Registro de Jugadas y Eventos en Tiempo Real ({filteredEvents.length} registros)
      </div>
      <div class="header-right-actions">
        {#if filteredEvents.length > 0}
          <button type="button" class="btn-clear-test" on:click={handleClearEvents} title="Vaciar registros">
            🗑️ Limpiar Registros
          </button>
        {/if}
        {#if selectedMesaUuid !== 'all'}
          <button type="button" class="btn-reset-filter" on:click={() => { selectedMesaUuid = 'all'; loadEvents(); }}>
            ✕ Quitar filtro de mesa
          </button>
        {/if}
      </div>
    </div>

    {#if isLoading && eventsList.length === 0}
      <div class="loading-box">
        <div class="spin">⏳</div>
        <span>Cargando eventos de IA en tiempo real...</span>
      </div>
    {:else if paginatedEvents.length === 0}
      <div class="empty-table">
        <span class="empty-icon">📭</span>
        <p>No se encontraron eventos para los filtros seleccionados.</p>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="live-table">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Sala</th>
              <th>Mesa</th>
              <th>Juego</th>
              <th>Tipo Evento</th>
              <th>Descripción de la Jugada</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {#each paginatedEvents as ev (ev.uuid || ev.id)}
              <tr>
                <td class="font-mono text-muted">
                  {new Date(ev.created_at).toLocaleDateString()} {new Date(ev.created_at).toLocaleTimeString()}
                </td>
                <td>{ev.sala_nombre || "Sala"}</td>
                <td><strong class="mesa-name">{ev.mesa_nombre || "Mesa"}</strong></td>
                <td><span class="game-tag">{ev.juego_nombre || "JUEGO"}</span></td>
                <td>
                  <span class="event-type-badge font-mono" class:jugada={ev.tipo_evento === 'JUGADA'}>
                    {ev.tipo_evento}
                  </span>
                </td>
                <td class="event-desc">{ev.descripcion}</td>
                <td>
                  <span class="status-pill info">Registrado</span>
                </td>
                <td>
                  <button type="button" class="btn-view" on:click={() => openDetailModal(ev)}>
                    👁️ Ver
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Paginador -->
      <div class="pagination-bar">
        <span class="page-info">
          Página {currentPage} de {totalPages} (Mostrando {paginatedEvents.length} de {filteredEvents.length})
        </span>
        <div class="pagination-buttons">
          <button type="button" class="btn-page" disabled={currentPage <= 1} on:click={() => currentPage--}>
            ◀ Anterior
          </button>
          <button type="button" class="btn-page" disabled={currentPage >= totalPages} on:click={() => currentPage++}>
            Siguiente ▶
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- MODAL: Detalle del Evento -->
  {#if selectedEventDetail}
    <div class="modal-backdrop" on:click={closeDetailModal}>
      <div class="modal-card" on:click|stopPropagation>
        <div class="modal-header">
          <h3 class="modal-title">Detalle Técnico del Evento IA</h3>
          <button type="button" class="btn-close" on:click={closeDetailModal}>✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-row">
            <span class="dt-lbl">Mesa:</span>
            <span class="dt-val font-bold">{selectedEventDetail.mesa_nombre} ({selectedEventDetail.juego_nombre})</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Sala:</span>
            <span class="dt-val">{selectedEventDetail.sala_nombre}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Fecha y Hora:</span>
            <span class="dt-val font-mono">{new Date(selectedEventDetail.created_at).toLocaleString()}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Tipo de Evento:</span>
            <span class="dt-val font-mono">{selectedEventDetail.tipo_evento}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Descripción:</span>
            <span class="dt-val">{selectedEventDetail.descripcion}</span>
          </div>

          <div class="metadata-box">
            <span class="meta-title">Metadatos de Detección (Cartas / Puntuación / Casilla):</span>
            <pre class="meta-json font-mono">{JSON.stringify(selectedEventDetail.metadata || {}, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ia-tr-container {
    padding: 24px;
    max-width: 1440px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #ffffff;
    padding: 20px 24px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .icon-badge {
    font-size: 32px;
    background: #eff6ff;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid #bfdbfe;
  }

  .header-title {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
  }

  .header-subtitle {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .pulse-live {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.95); opacity: 0.8; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.95); opacity: 0.8; }
  }

  .btn-refresh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-refresh:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  /* Badges Section */
  .badges-section {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
  }

  .badges-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .section-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .badges-hint {
    font-size: 12px;
    color: #64748b;
  }

  .empty-badges {
    padding: 24px;
    text-align: center;
    color: #94a3b8;
    font-size: 13px;
  }

  .badges-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }

  .mesa-badge-card {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 12px 14px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mesa-badge-card:hover {
    border-color: #2563eb;
    background: #eff6ff;
    transform: translateY(-2px);
  }

  .mesa-badge-card.selected {
    border-color: #2563eb;
    background: #dbeafe;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.4);
  }

  .badge-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .mesa-title {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .status-indicator-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
  }

  .badge-game {
    font-size: 11px;
    color: #64748b;
    font-weight: 700;
  }

  .badge-event {
    font-size: 11px;
    font-weight: 800;
    color: #1e40af;
    background: #e0f2fe;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
    margin: 4px 0 2px 0;
  }

  .badge-desc {
    font-size: 11.5px;
    color: #334155;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-time {
    font-size: 10.5px;
    color: #94a3b8;
    margin-top: 4px;
  }

  /* Filters */
  .filter-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 16px 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
  }

  .filter-row {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .flex-1 {
    flex: 1;
    min-width: 220px;
  }

  .filter-group label {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
  }

  .filter-group select, .filter-group input {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    font-size: 13px;
    outline: none;
  }

  .btn-refresh {
    padding: 8px 14px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-weight: 700;
    font-size: 12.5px;
    cursor: pointer;
  }

  /* DataTable */
  .datatable-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04);
    overflow: hidden;
  }

  .table-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .th-title {
    font-size: 14px;
    font-weight: 800;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-right-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-clear-test {
    background: #fee2e2;
    border: 1px solid #fca5a5;
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: #b91c1c;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-clear-test:hover {
    background: #fecaca;
    border-color: #ef4444;
  }

  .btn-reset-filter {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
    cursor: pointer;
  }

  .loading-box, .empty-table {
    padding: 40px;
    text-align: center;
    color: #64748b;
  }

  .empty-icon {
    font-size: 36px;
    display: block;
    margin-bottom: 6px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  .live-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  .live-table th {
    background: #f8fafc;
    padding: 10px 14px;
    text-align: left;
    font-weight: 800;
    color: #475569;
    border-bottom: 2px solid #e2e8f0;
    white-space: nowrap;
  }

  .live-table td {
    padding: 10px 14px;
    border-bottom: 1px solid #e2e8f0;
  }

  .mesa-name {
    color: #0f172a;
  }

  .game-tag {
    background: #f1f5f9;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    color: #334155;
  }

  .event-type-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 800;
    background: #e2e8f0;
    color: #334155;
  }

  .event-type-badge.jugada {
    background: #dbeafe;
    color: #1e40af;
  }

  .event-desc {
    max-width: 420px;
    color: #1e293b;
  }

  .status-pill.info {
    background: #ecfdf5;
    color: #047857;
    font-weight: 800;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .btn-view {
    padding: 4px 8px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .pagination-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .page-info {
    font-size: 12px;
    color: #64748b;
  }

  .pagination-buttons {
    display: flex;
    gap: 8px;
  }

  .btn-page {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-page:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .modal-title {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: #64748b;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 6px;
  }

  .dt-lbl {
    color: #64748b;
    font-weight: 700;
  }

  .metadata-box {
    margin-top: 10px;
    background: #0f172a;
    padding: 12px;
    border-radius: 8px;
    color: #38bdf8;
  }

  .meta-title {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    display: block;
    margin-bottom: 6px;
  }

  .meta-json {
    margin: 0;
    font-size: 11px;
    max-height: 180px;
    overflow-y: auto;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
</style>
