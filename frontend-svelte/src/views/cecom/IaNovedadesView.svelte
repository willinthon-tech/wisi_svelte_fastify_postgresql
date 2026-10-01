<script>
  import { onMount, onDestroy } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { currentUserStore } from "../../controllers/auth.store.js";
  import { masterSalasStore, masterMesasStore } from "../../controllers/master.store.js";
  import { getCecomIaEventos, getMesasConCamaras, getMesaCamaras, marcarEventoAtendido } from "../../services/cecomVideo.service.js";

  // Filtros
  let selectedSalaUuid = "all";
  let selectedMesaUuid = "all";
  let selectedTipoNovedad = "all"; // all, DROP, MALDON, CAMBIO_BARAJO, ANOMALIA
  let selectedEstadoAtencion = "all"; // all, pendientes, atendidas
  let fechaDesde = "";
  let fechaHasta = "";
  let searchQuery = "";

  let isLoading = false;
  let novedadesList = [];
  let refreshTimer = null;

  // Paginación
  let currentPage = 1;
  let pageSize = 15;

  // Modal Detalle
  let selectedNovedadDetail = null;

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

  // Métricas calculadas sobre la lista actual
  $: totalNovedades = novedadesList.length;
  $: countDrops = novedadesList.filter(n => n.tipo_evento === 'DROP').length;
  $: countMaldones = novedadesList.filter(n => n.tipo_evento === 'MALDON').length;
  $: countBarajos = novedadesList.filter(n => n.tipo_evento === 'CAMBIO_BARAJO').length;
  $: countPendientes = novedadesList.filter(n => !n.atendido).length;

  onMount(async () => {
    // Fecha por defecto: hoy en hora local (evita bug de UTC +1 día)
    const today = getLocalDateStr();
    fechaDesde = today;
    fechaHasta = today;

    await loadMesasConCamaras();
    await loadNovedades();

    // Auto-refresco en segundo plano cada 5 segundos
    refreshTimer = setInterval(() => {
      loadNovedades(false);
    }, 5000);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  async function loadMesasConCamaras() {
    isLoadingMesas = true;
    try {
      // 1. Probar ruta centralizada backend
      const res = await getMesasConCamaras({ sala_uuid: selectedSalaUuid });
      if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
        mesasConCamaras = res.data;
        return;
      }
    } catch (e) {
      console.debug("Endpoint centralizado /mesas-con-camaras no disponible, ejecutando sincronización fallback:", e);
    }

    // 2. Fallback de alta resiliencia: resolver mesas y cámaras directamente desde la base de datos
    try {
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
      console.error("Error en fallback de mesas asociadas:", err);
      mesasConCamaras = [];
    } finally {
      isLoadingMesas = false;
    }
  }

  async function onSalaChange() {
    selectedMesaUuid = "all";
    currentPage = 1;
    await loadMesasConCamaras();
    await loadNovedades();
  }

  async function loadNovedades(showLoading = true) {
    if (showLoading) isLoading = true;
    try {
      const params = {
        es_novedad: true,
        limit: 150
      };

      if (selectedSalaUuid && selectedSalaUuid !== "all") {
        params.sala_uuid = selectedSalaUuid;
      }
      if (selectedMesaUuid && selectedMesaUuid !== "all") {
        params.mesa_uuid = selectedMesaUuid;
      }
      if (selectedTipoNovedad && selectedTipoNovedad !== "all") {
        params.tipo_evento = selectedTipoNovedad;
      }
      if (fechaDesde) params.fecha_desde = fechaDesde;
      if (fechaHasta) params.fecha_hasta = fechaHasta;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getCecomIaEventos(params);
      if (res && res.success) {
        let list = res.data || [];
        if (selectedEstadoAtencion === "pendientes") {
          list = list.filter(n => !n.atendido);
        } else if (selectedEstadoAtencion === "atendidas") {
          list = list.filter(n => n.atendido);
        }
        novedadesList = list;
      }
    } catch (err) {
      console.error("Error cargando novedades de IA:", err);
    } finally {
      if (showLoading) isLoading = false;
    }
  }

  function setQuickTipo(tipo) {
    selectedTipoNovedad = tipo;
    currentPage = 1;
    loadNovedades();
  }

  async function handleMarcarAtendido(ev) {
    const uName = $currentUserStore?.nombre_apellido || $currentUserStore?.usuario || "Operador CECOM";
    try {
      const res = await marcarEventoAtendido(ev.uuid || ev.id, uName);
      if (res && res.success) {
        triggerToast("Incidencia marcada como verificada/atendida", "success");
        await loadNovedades(false);
        if (selectedNovedadDetail && (selectedNovedadDetail.uuid || selectedNovedadDetail.id) === (ev.uuid || ev.id)) {
          selectedNovedadDetail = { ...selectedNovedadDetail, atendido: true, atendido_por: uName };
        }
      }
    } catch (err) {
      triggerToast(`Error al marcar incidencia: ${err.message}`, "error");
    }
  }

  // Filtrado y paginación
  $: filteredNovedades = novedadesList;
  $: totalPages = Math.ceil(filteredNovedades.length / pageSize) || 1;
  $: paginatedNovedades = filteredNovedades.slice((currentPage - 1) * pageSize, currentPage * pageSize);

</script>

<div class="ia-nov-container">
  <!-- Header Principal -->
  <div class="view-header">
    <div class="header-left">
      <div class="icon-badge">🚨</div>
      <div>
        <h1 class="header-title">IA Novedades - Auditoría de Incidencias</h1>
        <p class="header-subtitle">
          Supervisión de anomalías, ingreso de efectivo a buzones de drop, violaciones de reglas (maldones) y cambios de barajo.
        </p>
      </div>
    </div>
    <div class="header-actions">
      <button type="button" class="btn-refresh" on:click={() => loadNovedades(false)} title="Actualizar novedades">
        <span class="material-icons-round" style="font-size: 16px;">refresh</span>
        Actualizar
      </button>
    </div>
  </div>

  <!-- SECCIÓN 1: Tarjetas Métricas -->
  <div class="metrics-grid">
    <div class="metric-card" class:active-card={selectedTipoNovedad === 'all'} on:click={() => setQuickTipo('all')}>
      <div class="metric-icon">📑</div>
      <div class="metric-data">
        <span class="m-val">{totalNovedades}</span>
        <span class="m-lbl">Total Novedades</span>
      </div>
    </div>

    <div class="metric-card drop" class:active-card={selectedTipoNovedad === 'DROP'} on:click={() => setQuickTipo('DROP')}>
      <div class="metric-icon">💵</div>
      <div class="metric-data">
        <span class="m-val">{countDrops}</span>
        <span class="m-lbl">Drops de Efectivo</span>
      </div>
    </div>

    <div class="metric-card maldon" class:active-card={selectedTipoNovedad === 'MALDON'} on:click={() => setQuickTipo('MALDON')}>
      <div class="metric-icon">🚨</div>
      <div class="metric-data">
        <span class="m-val text-red">{countMaldones}</span>
        <span class="m-lbl">Alertas Maldón</span>
      </div>
    </div>

    <div class="metric-card barajo" class:active-card={selectedTipoNovedad === 'CAMBIO_BARAJO'} on:click={() => setQuickTipo('CAMBIO_BARAJO')}>
      <div class="metric-icon">🎴</div>
      <div class="metric-data">
        <span class="m-val">{countBarajos}</span>
        <span class="m-lbl">Cambios de Barajo</span>
      </div>
    </div>

    <div class="metric-card pending">
      <div class="metric-icon">⏳</div>
      <div class="metric-data">
        <span class="m-val text-amber">{countPendientes}</span>
        <span class="m-lbl">Pendientes CECOM</span>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 2: Barra de Filtros -->
  <div class="filter-card">
    <div class="filter-row">
      <div class="filter-group">
        <label for="sala-nov-filter">Sala:</label>
        <select id="sala-nov-filter" bind:value={selectedSalaUuid} on:change={onSalaChange}>
          <option value="all">Todas las Salas</option>
          {#each salas as s}
            <option value={s.uuid || s.id}>{s.nombre}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="mesa-nov-filter">Mesa Asociada:</label>
        <select id="mesa-nov-filter" bind:value={selectedMesaUuid} on:change={() => { currentPage = 1; loadNovedades(); }}>
          <option value="all">Todas ({mesasConCamaras.length})</option>
          {#each mesasConCamaras as m}
            <option value={m.mesa_uuid || m.uuid || m.id}>{m.mesa_nombre || m.nombre}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="tipo-nov-filter">Tipo de Novedad:</label>
        <select id="tipo-nov-filter" bind:value={selectedTipoNovedad} on:change={() => { currentPage = 1; loadNovedades(); }}>
          <option value="all">Todas las Novedades</option>
          <option value="DROP">💵 DROP (Buzón de Efectivo)</option>
          <option value="MALDON">🚨 MALDÓN (Reglas / Apuestas)</option>
          <option value="CAMBIO_BARAJO">🎴 CAMBIO DE BARAJO</option>
          <option value="ANOMALIA">⚠️ ANOMALÍA GENERAL</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="atencion-filter">Estado Revisión:</label>
        <select id="atencion-filter" bind:value={selectedEstadoAtencion} on:change={() => { currentPage = 1; loadNovedades(); }}>
          <option value="all">Todos los Estados</option>
          <option value="pendientes">Pendientes de Atención</option>
          <option value="atendidas">Atendidas / Verificadas</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="fecha-desde-nov">Fecha Desde:</label>
        <input id="fecha-desde-nov" type="date" bind:value={fechaDesde} on:change={() => { currentPage = 1; loadNovedades(); }} />
      </div>

      <div class="filter-group">
        <label for="fecha-hasta-nov">Fecha Hasta:</label>
        <input id="fecha-hasta-nov" type="date" bind:value={fechaHasta} on:change={() => { currentPage = 1; loadNovedades(); }} />
      </div>

      <div class="filter-group flex-1">
        <label for="search-nov-input">Buscar:</label>
        <input id="search-nov-input" type="text" placeholder="Buscar por mesa, incidencia..." bind:value={searchQuery} on:input={() => { currentPage = 1; loadNovedades(false); }} />
      </div>

      <div class="filter-group-btn">
        <button type="button" class="btn-refresh" on:click={() => loadNovedades(true)}>
          🔄 Actualizar
        </button>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 3: DataTable de Novedades -->
  <div class="datatable-card">
    <div class="table-header-bar">
      <div class="th-title">
        <span class="material-icons-round">warning_amber</span>
        Registro de Novedades e Incidencias ({filteredNovedades.length} registros)
      </div>
    </div>

    {#if isLoading && novedadesList.length === 0}
      <div class="loading-box">
        <div class="spin">⏳</div>
        <span>Cargando novedades de mesas...</span>
      </div>
    {:else if paginatedNovedades.length === 0}
      <div class="empty-table">
        <span class="empty-icon">🛡️</span>
        <p>No se encontraron novedades o incidencias para el criterio seleccionado.</p>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="live-table">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Mesa</th>
              <th>Juego</th>
              <th>Tipo Novedad</th>
              <th>Severidad</th>
              <th>Descripción de la Incidencia</th>
              <th>Verificación CECOM</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {#each paginatedNovedades as nov (nov.uuid || nov.id)}
              <tr class:row-maldon={nov.tipo_evento === 'MALDON' && !nov.atendido}>
                <td class="font-mono text-muted">
                  {new Date(nov.created_at).toLocaleDateString()} {new Date(nov.created_at).toLocaleTimeString()}
                </td>
                <td><strong class="mesa-name">{nov.mesa_nombre || "Mesa"}</strong></td>
                <td><span class="game-tag">{nov.juego_nombre || "JUEGO"}</span></td>
                <td>
                  <span class="nov-badge font-mono" class:maldon={nov.tipo_evento === 'MALDON'} class:drop={nov.tipo_evento === 'DROP'} class:barajo={nov.tipo_evento === 'CAMBIO_BARAJO'}>
                    {#if nov.tipo_evento === 'MALDON'}🚨 MALDÓN
                    {:else if nov.tipo_evento === 'DROP'}💵 DROP
                    {:else if nov.tipo_evento === 'CAMBIO_BARAJO'}🎴 BARAJO
                    {:else}⚠️ {nov.tipo_evento}{/if}
                  </span>
                </td>
                <td>
                  <span class="sev-badge" class:critical={nov.nivel_alerta === 'CRITICAL'} class:warn={nov.nivel_alerta === 'WARN'}>
                    {nov.nivel_alerta}
                  </span>
                </td>
                <td class="nov-desc">{nov.descripcion}</td>
                <td>
                  {#if nov.atendido}
                    <span class="status-pill checked" title="Atendido por {nov.atendido_por}">
                      ✅ Atendido por {nov.atendido_por || 'CECOM'}
                    </span>
                  {:else}
                    <button type="button" class="btn-attend" on:click={() => handleMarcarAtendido(nov)}>
                      ⚠️ Marcar Atendido
                    </button>
                  {/if}
                </td>
                <td>
                  <button type="button" class="btn-view" on:click={() => selectedNovedadDetail = nov}>
                    👁️ Detalle
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
          Página {currentPage} de {totalPages} (Mostrando {paginatedNovedades.length} de {filteredNovedades.length})
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

  <!-- MODAL: Detalle de la Novedad -->
  {#if selectedNovedadDetail}
    <div class="modal-backdrop" on:click={() => selectedNovedadDetail = null}>
      <div class="modal-card" on:click|stopPropagation>
        <div class="modal-header">
          <h3 class="modal-title">Detalle de Incidencia CECOM</h3>
          <button type="button" class="btn-close" on:click={() => selectedNovedadDetail = null}>✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-row">
            <span class="dt-lbl">Mesa de Juego:</span>
            <span class="dt-val font-bold">{selectedNovedadDetail.mesa_nombre} ({selectedNovedadDetail.juego_nombre})</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Tipo de Novedad:</span>
            <span class="dt-val font-bold font-mono text-red">{selectedNovedadDetail.tipo_evento}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Fecha y Hora:</span>
            <span class="dt-val font-mono">{new Date(selectedNovedadDetail.created_at).toLocaleString()}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Descripción:</span>
            <span class="dt-val">{selectedNovedadDetail.descripcion}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Estado de Atención:</span>
            <span class="dt-val">
              {#if selectedNovedadDetail.atendido}
                <span class="text-green font-bold">✅ Atendido por {selectedNovedadDetail.atendido_por}</span>
              {:else}
                <span class="text-amber font-bold">⚠️ Pendiente de verificación</span>
              {/if}
            </span>
          </div>

          <div class="metadata-box">
            <span class="meta-title">Metadatos de la Detección IA:</span>
            <pre class="meta-json font-mono">{JSON.stringify(selectedNovedadDetail.metadata || {}, null, 2)}</pre>
          </div>

          {#if !selectedNovedadDetail.atendido}
            <div style="margin-top: 14px; text-align: right;">
              <button type="button" class="btn-mark-modal" on:click={() => handleMarcarAtendido(selectedNovedadDetail)}>
                ✅ Marcar como Revisado y Atendido
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ia-nov-container {
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
    background: #fef2f2;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid #fecaca;
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
    gap: 8px;
    flex-wrap: wrap;
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

  /* Metrics Grid */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 14px;
  }

  .metric-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
  }

  .metric-card:hover, .metric-card.active-card {
    border-color: #2563eb;
    background: #f8fafc;
    transform: translateY(-2px);
  }

  .metric-icon {
    font-size: 28px;
  }

  .metric-data {
    display: flex;
    flex-direction: column;
  }

  .m-val {
    font-size: 22px;
    font-weight: 900;
    color: #0f172a;
  }

  .m-lbl {
    font-size: 11.5px;
    color: #64748b;
    font-weight: 700;
  }

  .text-red { color: #dc2626; }
  .text-amber { color: #d97706; }
  .text-green { color: #059669; }

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

  .row-maldon {
    background: #fff5f5 !important;
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

  .nov-badge {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 800;
    background: #f1f5f9;
    color: #334155;
  }

  .nov-badge.maldon {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .nov-badge.drop {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .nov-badge.barajo {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  .sev-badge {
    font-size: 10px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    background: #e2e8f0;
    color: #475569;
  }

  .sev-badge.critical {
    background: #dc2626;
    color: #ffffff;
  }

  .sev-badge.warn {
    background: #d97706;
    color: #ffffff;
  }

  .nov-desc {
    max-width: 420px;
    color: #1e293b;
    font-weight: 500;
  }

  .status-pill.checked {
    font-size: 11px;
    font-weight: 700;
    color: #047857;
  }

  .btn-attend {
    padding: 4px 8px;
    background: #fef3c7;
    border: 1px solid #fde68a;
    color: #92400e;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
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

  .btn-mark-modal {
    padding: 8px 16px;
    background: #059669;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-weight: 800;
    font-size: 12.5px;
    cursor: pointer;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  .font-bold {
    font-weight: 800;
  }
</style>
