<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { getPublicWebUrl } from '../../config/api.config.js';
  import LibroDropMesasView from './LibroDropMesasView.svelte';
  import LibroControlLlavesView from './LibroControlLlavesView.svelte';
  import LibroIncidenciasGeneralesView from './LibroIncidenciasGeneralesView.svelte';
  import LibroControlClientesView from './LibroControlClientesView.svelte';
  import LibroNovedadesMesasView from './LibroNovedadesMesasView.svelte';
  import LibroDatosView from './LibroDatosView.svelte';

  export let libroId = null;

  let libro = null;
  let isLoading = true;
  let loadError = null;

  // Subvistas disponibles
  const SUBVISTAS = [
    { id: 'datos', label: 'Datos', icon: '📋', description: 'Horarios operativos de sala y asignación de operadores' },
    { id: 'drop-mesas', label: 'Drop Mesas', icon: '🎲', description: 'Registro y cuadre de drop de mesas en vivo' },
    { id: 'control-llaves', label: 'Control Llaves', icon: '🔑', description: 'Bitácora de entrega y recepción de llaves' },
    { id: 'incidencias-generales', label: 'Incidencias Generales', icon: '⚠️', description: 'Eventos e incidentes reportados en sala' },
    { id: 'control-clientes', label: 'Control Clientes', icon: '👥', description: 'Seguimiento de jugadores y eventos de sala' },
    { id: 'novedades-mesas', label: 'Novedades Mesas', icon: '🃏', description: 'Control de aperturas, cierres, pitboss y croupiers de mesas' },
    { id: 'resumen-libro', label: 'Resumen Libro', icon: '📊', description: 'Consolidado general y auditoría de la jornada' }
  ];

  let activeSubvista = 'datos';

  // Suscribirse a cambios en currentRouteStore para sincronizar la subvista
  let unsubRoute = null;

  function parseRoute(routeStr) {
    if (!routeStr) return;
    const clean = String(routeStr).replace(/^#\/?/, '').replace(/^\//, '').trim();
    // Match pattern cecom/libro/:id(/:subvista)? o libro/:id(/:subvista)? o :id(/:subvista)?
    const match = clean.match(/(?:cecom\/libro\/|libro\/|^)(\d+)(?:\/([a-z0-9-]+))?/i);
    if (match) {
      const parsedId = match[1];
      const parsedSub = match[2];
      if (parsedId && parsedId !== libroId) {
        libroId = parsedId;
        loadLibro(libroId);
      }
      if (parsedSub && SUBVISTAS.some(s => s.id === parsedSub)) {
        activeSubvista = parsedSub;
      } else if (!parsedSub) {
        activeSubvista = 'datos';
      }
    }
  }

  onMount(async () => {
    unsubRoute = currentRouteStore.subscribe(val => {
      parseRoute(val);
    });

    if (!libroId && typeof window !== 'undefined') {
      parseRoute(window.location.hash || window.location.pathname);
    }

    if (libroId) {
      await loadLibro(libroId);
    }
  });

  onDestroy(() => {
    if (unsubRoute) unsubRoute();
  });

  async function loadLibro(id) {
    isLoading = true;
    loadError = null;
    try {
      const res = await fetch(`/api/master/libros/${id}`);
      const json = await res.json();
      if (res.ok && json && json.success && json.data) {
        libro = json.data;
      } else {
        loadError = json?.error || 'Libro no encontrado en el servidor';
      }
    } catch (err) {
      console.error('Error al cargar libro:', err);
      loadError = 'Error de conexión al cargar los datos del libro';
    } finally {
      isLoading = false;
    }
  }

  function handleSelectSubvista(subId) {
    activeSubvista = subId;
    if (libroId) {
      navigateToRoute(`cecom/libro/${libroId}/${subId}`);
    }
  }

  function handleVolver() {
    navigateToRoute('cecom/libro');
  }

  async function handleCompartir() {
    const targetUrl = getPublicWebUrl(`/#/cecom/libro/${libroId || ''}/${activeSubvista}`);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(targetUrl);
      } else {
        const input = document.createElement('input');
        input.value = targetUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      triggerToast('Enlace de la subvista copiado al portapapeles', 'success');
    } catch (err) {
      prompt('Copia el siguiente enlace del libro:', targetUrl);
    }
  }

  function formatDateDisplay(d) {
    if (!d) return '—';
    const str = String(d).trim();
    const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      return `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}`;
    }
    const ddmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[1].padStart(2, '0')}/${ddmmyyyy[2].padStart(2, '0')}/${ddmmyyyy[3]}`;
    }
    return str;
  }
</script>

<div class="libro-trabajo-container">
  <!-- Top Navigation Header -->
  <div class="top-nav-bar">
    <div class="nav-left">
      <div class="header-titles">
        <div class="title-row">
          <h1 class="main-title">
            Libro <span class="highlight-date">{libro?.descripcion ? formatDateDisplay(libro.descripcion) : (isLoading ? 'Cargando...' : '—')}</span>
          </h1>
          {#if libro?.sala_nombre || libro?.sala_nombre_comercial}
            <span class="badge-sala">
              📍 {libro.sala_nombre || libro.sala_nombre_comercial}
            </span>
          {/if}
          {#if libro?.id}
            <span class="badge-id">#{libro.id}</span>
          {/if}
        </div>
        <p class="subtitle">
          Panel de Trabajo Operativo CECOM • {SUBVISTAS.find(s => s.id === activeSubvista)?.label || 'Subvista'}
        </p>
      </div>
    </div>

    <div class="nav-right">
      <button type="button" class="btn-back" on:click={handleVolver} title="Volver a la lista de Libros">
        <span class="icon">‹</span>
        <span>Volver a Libros</span>
      </button>
    </div>
  </div>

  <!-- Subviews Horizontal Tab Bar ("BOTONES DE SUBVISTAS") -->
  <div class="subvistas-tabs-wrapper">
    <div class="subvistas-tabs" role="tablist">
      {#each SUBVISTAS as sub}
        <button
          type="button"
          role="tab"
          aria-selected={activeSubvista === sub.id}
          class="subvista-tab-btn"
          class:active={activeSubvista === sub.id}
          on:click={() => handleSelectSubvista(sub.id)}
        >
          <span class="tab-label">{sub.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Main Content Area ("VISTAS DE CADA SUB") -->
  <div class="subvista-content-area">
    {#if isLoading}
      <div class="state-card loading-state">
        <div class="spinner"></div>
        <p class="state-msg">Cargando libro y configuración operativa...</p>
      </div>
    {:else if loadError}
      <div class="state-card error-state">
        <span class="state-icon">⚠️</span>
        <h3>Error al cargar libro</h3>
        <p>{loadError}</p>
        <button type="button" class="btn-retry" on:click={() => loadLibro(libroId)}>Reintentar</button>
      </div>
    {:else}
      {#if activeSubvista === 'datos'}
        <LibroDatosView {libro} {libroId} />
      {:else if activeSubvista === 'drop-mesas'}
        <LibroDropMesasView {libro} {libroId} />
      {:else if activeSubvista === 'control-llaves'}
        <LibroControlLlavesView {libro} {libroId} />
      {:else if activeSubvista === 'incidencias-generales'}
        <LibroIncidenciasGeneralesView {libro} {libroId} />
      {:else if activeSubvista === 'control-clientes'}
        <LibroControlClientesView {libro} {libroId} />
      {:else if activeSubvista === 'novedades-mesas'}
        <LibroNovedadesMesasView {libro} {libroId} />
      {:else}
        <!-- Workspace Card de la Subvista Activa -->
        <div class="subvista-workspace-card">
          <div class="workspace-header">
            <div class="ws-header-left">
              <span class="ws-icon">{SUBVISTAS.find(s => s.id === activeSubvista)?.icon}</span>
              <div>
                <h2 class="ws-title">{SUBVISTAS.find(s => s.id === activeSubvista)?.label}</h2>
                <p class="ws-desc">{SUBVISTAS.find(s => s.id === activeSubvista)?.description}</p>
              </div>
            </div>
            <div class="ws-header-actions">
              <button type="button" class="btn-ws-action btn-add" on:click={() => triggerToast(`Nuevo registro en ${SUBVISTAS.find(s => s.id === activeSubvista)?.label}`, 'info')}>
                <span>+</span>
                <span>Nuevo Registro</span>
              </button>
            </div>
          </div>

          <!-- Dynamic Subview Workspace Placeholder / Module Body -->
          <div class="workspace-body">
            {#if activeSubvista === 'resumen-libro'}
            <div class="sub-panel">
              <div class="resumen-container">
                <div class="resumen-header-banner">
                  <div class="banner-title">
                    <h3>Resumen Consolidado del Libro</h3>
                    <p>Fecha: {formatDateDisplay(libro?.descripcion)} • Sala: {libro?.sala_nombre || libro?.sala_nombre_comercial || 'Asignada'}</p>
                  </div>
                  <span class="status-chip open">En Curso</span>
                </div>

                <div class="resumen-cards-grid">
                  {#each SUBVISTAS.filter(s => s.id !== 'resumen-libro') as item}
                    <div class="resumen-card">
                      <div class="rc-header">
                        <span class="rc-icon">{item.icon}</span>
                        <span class="rc-name">{item.label}</span>
                      </div>
                      <div class="rc-body">
                        <span class="rc-count">0 registros</span>
                        <button type="button" class="rc-link-btn" on:click={() => handleSelectSubvista(item.id)}>
                          Ver subvista →
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
</div>

<style>
  .libro-trabajo-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100%;
    gap: 16px;
    box-sizing: border-box;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Top Navigation Bar */
  .top-nav-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #ffffff;
    padding: 16px 22px;
    border-radius: 14px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    gap: 16px;
    flex-wrap: wrap;
  }

  .nav-left {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }

  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    color: #334155;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-back:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #94a3b8;
  }

  .btn-back .icon {
    font-size: 18px;
    font-weight: 800;
    line-height: 1;
  }

  .header-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .main-title {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.3px;
  }

  .highlight-date {
    color: #2563eb;
    font-family: monospace;
    letter-spacing: 0.5px;
  }

  .badge-sala {
    background: #eff6ff;
    color: #1e40af;
    border: 1px solid #bfdbfe;
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
  }

  .badge-id {
    background: #f1f5f9;
    color: #64748b;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 800;
  }

  .subtitle {
    margin: 0;
    font-size: 12.5px;
    color: #64748b;
    font-weight: 500;
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .btn-share {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: #f5f3ff;
    border: 1.5px solid #ddd6fe;
    color: #6d28d9;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-share:hover {
    background: #ede9fe;
    color: #5b21b6;
    transform: translateY(-1px);
  }

  /* Subviews Tab Bar ("BOTONES DE SUBVISTAS") */
  .subvistas-tabs-wrapper {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    overflow-x: auto;
  }

  .subvistas-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: max-content;
  }

  .subvista-tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .subvista-tab-btn:hover {
    background: #f8fafc;
    color: #0f172a;
  }

  .subvista-tab-btn.active {
    background: #0f172a;
    color: #ffffff;
    box-shadow: 0 2px 4px rgba(15, 23, 42, 0.2);
  }

  .tab-icon {
    font-size: 15px;
  }

  /* Workspace Card */
  .subvista-workspace-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 22px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 16px;
    flex-wrap: wrap;
  }

  .ws-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .ws-icon {
    font-size: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 50px;
    height: 50px;
    background: #f1f5f9;
    border-radius: 12px;
  }

  .ws-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  .ws-desc {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: #64748b;
  }

  .btn-ws-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }

  .btn-add {
    background: #2563eb;
    color: #ffffff;
    box-shadow: 0 2px 4px rgba(37,99,235,0.25);
  }

  .btn-add:hover {
    background: #1d4ed8;
  }

  /* Panels & States */
  .sub-panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
  }

  .metric-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric-box.highlight {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .metric-title {
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .metric-num {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
  }

  .metric-box.highlight .metric-num {
    color: #1d4ed8;
  }

  .empty-workspace-state {
    text-align: center;
    padding: 50px 20px;
    background: #f8fafc;
    border: 1.5px dashed #cbd5e1;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .empty-icon {
    font-size: 36px;
  }

  .empty-workspace-state h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #1e293b;
  }

  .empty-workspace-state p {
    margin: 0;
    font-size: 13px;
    color: #64748b;
    max-width: 480px;
    line-height: 1.4;
  }

  .btn-primary {
    margin-top: 8px;
    background: #0f172a;
    color: #ffffff;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-primary:hover {
    background: #1e293b;
    transform: translateY(-1px);
  }

  /* Resumen Container */
  .resumen-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .resumen-header-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px 20px;
  }

  .banner-title h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  .banner-title p {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: #64748b;
  }

  .status-chip {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .status-chip.open {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .resumen-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px;
  }

  .resumen-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: all 0.15s ease;
  }

  .resumen-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 3px 6px rgba(0,0,0,0.04);
  }

  .rc-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 800;
    font-size: 13.5px;
    color: #1e293b;
  }

  .rc-icon {
    font-size: 16px;
  }

  .rc-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px solid #f1f5f9;
  }

  .rc-count {
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
  }

  .rc-link-btn {
    background: transparent;
    border: none;
    color: #2563eb;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .rc-link-btn:hover {
    background: #eff6ff;
  }

  .state-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 50px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .btn-retry {
    background: #2563eb;
    color: #ffffff;
    border: none;
    padding: 8px 18px;
    border-radius: 8px;
    font-weight: 700;
    cursor: pointer;
  }
</style>
