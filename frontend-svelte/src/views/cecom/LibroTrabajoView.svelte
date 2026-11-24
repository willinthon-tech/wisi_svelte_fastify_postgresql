<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { getPublicWebUrl } from '../../config/api.config.js';
  import { masterSalasStore } from '../../controllers/master.store.js';
  import { subscribeToLibroUpdates, isWsConnectedStore } from '../../controllers/websocket.store.js';
  import LibroDropMesasView from './LibroDropMesasView.svelte';
  import LibroArqueoFichasView from './LibroArqueoFichasView.svelte';
  import LibroConteoMaquinasView from './LibroConteoMaquinasView.svelte';
  import LibroControlLlavesView from './LibroControlLlavesView.svelte';
  import LibroIncidenciasGeneralesView from './LibroIncidenciasGeneralesView.svelte';
  import LibroControlClientesView from './LibroControlClientesView.svelte';
  import LibroAportesView from './LibroAportesView.svelte';
  import LibroNovedadesMesasView from './LibroNovedadesMesasView.svelte';
  import LibroResumenView from './LibroResumenView.svelte';
  import LibroDatosView from './LibroDatosView.svelte';

  import { getLocalItems, upsertLocalItem } from '../../services/localDb.service.js';

  export let libroId = null;

  let libro = null;
  let isLoading = true;
  let loadError = null;

  // Subvistas disponibles
  const SUBVISTAS = [
    { id: 'datos', label: 'Datos', category: 'Libro', categoryKey: 'libro', icon: '', description: 'Horarios operativos de sala y asignación de operadores' },
    { id: 'drop-mesas', label: 'Drop', category: 'Mesas', categoryKey: 'mesas', icon: '', description: 'Registro y cuadre de drop de mesas en vivo' },
    { id: 'arqueo-fichas', label: 'Apertura y Cierre', category: 'Mesas', categoryKey: 'mesas', icon: '', description: 'Control y arqueo de fichas (apertura y cierre) de mesas en vivo' },
    { id: 'conteo-maquinas', label: 'Billetero', category: 'Máquinas', categoryKey: 'maquinas', icon: '', description: 'Registro y cuadre de conteo de billetes de máquinas por rango' },
    { id: 'aportes-maquinas', label: 'Aporte y Devoluciones', category: 'Máquinas', categoryKey: 'maquinas', icon: '', description: 'Registro y control de aportes y devoluciones de máquinas por empleado y rango' },
    { id: 'control-clientes', label: 'Clientes', category: 'Control', categoryKey: 'control', icon: '', description: 'Seguimiento de jugadores y eventos de sala' },
    { id: 'control-llaves', label: 'Llaves', category: 'Control', categoryKey: 'control', icon: '', description: 'Bitácora de entrega y recepción de llaves' },
    { id: 'incidencias-generales', label: 'Incidencias', category: 'Control', categoryKey: 'control', icon: '', description: 'Eventos e incidentes reportados en sala' },
    { id: 'resumen-libro', label: 'Resumen', category: 'Libro', categoryKey: 'libro', icon: '', description: 'Consolidado general y auditoría de la jornada' }
  ];

  let activeSubvista = 'datos';
  let activeMultisalaUuid = null;

  // Lista reactiva de salas hijas (multisalas) de la sala del libro
  $: subsalasList = (() => {
    let raw = libro?.sala_multisalas;
    if (!raw && libro?.sala_uuid) {
      const s = ($masterSalasStore || []).find(item => item.uuid === libro.sala_uuid || item.id === libro.sala_uuid);
      if (s) raw = s.multisalas;
    }
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { raw = []; }
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && item.nombre && (item.active === 1 || item.active === true || item.active === undefined));
  })();

  // Si la sala es multisala y aún no se ha seleccionado una o la seleccionada no existe, asignar la primera por defecto
  $: if (subsalasList.length > 0) {
    const match = activeMultisalaUuid && subsalasList.some(s => String(s.uuid || s.id) === String(activeMultisalaUuid));
    if (!match) {
      activeMultisalaUuid = subsalasList[0].uuid;
      const targetHash = `#/cecom/libro/${libroId}/${activeSubvista}/${activeMultisalaUuid}`;
      if (libroId && activeSubvista && typeof window !== 'undefined' && window.location.hash !== targetHash) {
        navigateToRoute(`cecom/libro/${libroId}/${activeSubvista}/${activeMultisalaUuid}`);
      }
    }
  } else {
    activeMultisalaUuid = null;
  }

  // Suscribirse a cambios en currentRouteStore para sincronizar la subvista y la multisala
  let unsubRoute = null;
  let unsubWs = null;

  function parseRoute(routeStr) {
    if (!routeStr) return;
    const clean = String(routeStr).replace(/^#\/?/, '').replace(/^\//, '').trim();
    if (clean === 'cecom/libro' || clean === 'libro' || clean === 'libros') {
      return; // Es la vista lista de libros, no un libro individual
    }
    
    // Descomponer en segmentos
    const parts = clean.split('/').filter(Boolean);
    if (parts[0] === 'cecom') parts.shift();
    if (parts[0] === 'libro') parts.shift();

    if (parts.length === 0) return;

    const parsedId = parts[0];
    const secondPart = parts[1];
    const thirdPart = parts[2];

    if (parsedId && parsedId !== libroId) {
      libroId = parsedId;
      loadLibro(libroId);
    }

    if (secondPart) {
      if (secondPart === 'aportes' || secondPart === 'aportes-maquinas' || secondPart === 'aportes-devoluciones' || secondPart === 'aporte-devoluciones') {
        activeSubvista = 'aportes-maquinas';
      } else if (secondPart === 'conteo' || secondPart === 'conteo-maquinas' || secondPart === 'billetero') {
        activeSubvista = 'conteo-maquinas';
      } else if (secondPart === 'arqueo' || secondPart === 'arqueo-fichas' || secondPart === 'sobrantes-faltantes' || secondPart === 'apertura-cierre' || secondPart === 'novedades' || secondPart === 'novedades-mesas') {
        activeSubvista = 'arqueo-fichas';
      } else if (secondPart === 'clientes' || secondPart === 'control-clientes') {
        activeSubvista = 'control-clientes';
      } else if (secondPart === 'llaves' || secondPart === 'control-llaves') {
        activeSubvista = 'control-llaves';
      } else if (secondPart === 'incidencias' || secondPart === 'incidencias-generales') {
        activeSubvista = 'incidencias-generales';
      } else if (secondPart === 'resumen' || secondPart === 'resumen-libro') {
        activeSubvista = 'resumen-libro';
      } else if (secondPart === 'drop' || secondPart === 'drop-mesas') {
        activeSubvista = 'drop-mesas';
      } else if (SUBVISTAS.some(s => s.id === secondPart)) {
        activeSubvista = secondPart;
      }
    } else {
      activeSubvista = 'datos';
    }

    if (thirdPart) {
      activeMultisalaUuid = thirdPart;
    }
  }

  onMount(async () => {
    unsubRoute = currentRouteStore.subscribe(val => {
      parseRoute(val);
    });

    unsubWs = subscribeToLibroUpdates(
      () => [libroId, libro?.uuid, libro?.id].filter(Boolean),
      ['libro'],
      () => {
        if (libroId) loadLibro(libroId, true);
      }
    );

    if (!libroId && typeof window !== 'undefined') {
      parseRoute(window.location.hash || window.location.pathname);
    }

    if (libroId) {
      await loadLibro(libroId);
    }
  });

  onDestroy(() => {
    if (unsubRoute) unsubRoute();
    if (unsubWs) unsubWs();
  });

  async function loadLibro(id, isBackground = false) {
    if (!libro && !isBackground) {
      isLoading = true;
    }
    loadError = null;

    // 1. Carga inmediata desde base de datos local (0ms)
    try {
      const local = await getLocalItems('libros', l => String(l.uuid) === String(id) || String(l.id) === String(id));
      if (local && local.length > 0) {
        libro = local[0];
        isLoading = false;
      }
    } catch (e) {}

    // Si estamos offline sin internet, no intentar fetch a la red
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      if (!libro) {
        loadError = 'Sin conexión a internet. Este libro no se encuentra en el almacenamiento local.';
      }
      isLoading = false;
      return;
    }

    // 2. Consulta al backend si hay red
    try {
      const res = await fetch(`/api/master/libros/${id}`);
      const json = await res.json();
      if (res.ok && json && json.success && json.data) {
        libro = json.data;
        upsertLocalItem('libros', json.data).catch(() => {});
      } else if (!libro) {
        loadError = json?.error || 'Libro no encontrado en el servidor';
      }
    } catch (err) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        console.warn('[LocalDb] Error al conectar con el servidor para cargar libro:', err);
      }
      if (!libro) {
        loadError = 'Error de conexión al cargar los datos del libro';
      }
    } finally {
      isLoading = false;
    }
  }

  function handleSelectSubvista(subId) {
    activeSubvista = subId;
    if (libroId) {
      if (activeMultisalaUuid && subsalasList.length > 0) {
        navigateToRoute(`cecom/libro/${libroId}/${subId}/${activeMultisalaUuid}`);
      } else {
        navigateToRoute(`cecom/libro/${libroId}/${subId}`);
      }
    }
  }

  function handleSelectMultisala(uuid) {
    activeMultisalaUuid = uuid;
    if (libroId) {
      navigateToRoute(`cecom/libro/${libroId}/${activeSubvista}/${uuid}`);
    }
  }

  function handleVolver() {
    navigateToRoute('cecom/libro');
  }

  async function handleCompartir() {
    const targetId = libroId || activeLibro?.uuid || activeLibro?.id || '';
    const targetUrl = getPublicWebUrl(`/#/reportes/cecom/libro/${targetId}`);
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
      triggerToast('Enlace del reporte de libro copiado al portapapeles', 'success');
    } catch (err) {
      prompt('Copia el siguiente enlace del reporte:', targetUrl);
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
              {libro.sala_nombre || libro.sala_nombre_comercial}
            </span>
          {/if}
          {#if libro?.id}
            <span class="badge-id">#{libro.id}</span>
          {/if}
          {#if $isWsConnectedStore}
            <span class="badge-live-ws" title="Sincronización en tiempo real activa">Socket ON</span>
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

  {#if subsalasList.length > 0}
    <!-- Multisalas Horizontal Tab Bar ("BOTONES DE SALAS HIJAS") -->
    <div class="subvistas-tabs-wrapper multisalas-tabs-wrapper">
      <div class="subvistas-tabs" role="tablist">
        {#each subsalasList as sub}
          <button
            type="button"
            role="tab"
            aria-selected={activeMultisalaUuid === sub.uuid}
            class="subvista-tab-btn"
            class:active={activeMultisalaUuid === sub.uuid}
            on:click={() => handleSelectMultisala(sub.uuid)}
          >
            <span class="tab-label">{sub.nombre}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Subviews Horizontal Tab Bar ("BOTONES DE SUBVISTAS") -->
  <div class="subvistas-tabs-wrapper main-subvistas-wrapper">
    <div class="subvistas-tabs main-subvistas-grid" role="tablist">
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
          {#if sub.category}
            <span class="tab-category-badge cat-{sub.categoryKey}">
              {sub.category}
            </span>
          {/if}
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
        <h3>Error al cargar libro</h3>
        <p>{loadError}</p>
        <button type="button" class="btn-retry" on:click={() => loadLibro(libroId)}>Reintentar</button>
      </div>
    {:else}
      {#if activeSubvista === 'datos'}
        <LibroDatosView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'drop-mesas'}
        <LibroDropMesasView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'arqueo-fichas' || activeSubvista === 'arqueo' || activeSubvista === 'novedades-mesas'}
        <LibroArqueoFichasView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'conteo-maquinas'}
        <LibroConteoMaquinasView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'aportes-maquinas' || activeSubvista === 'aportes'}
        <LibroAportesView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'control-clientes'}
        <LibroControlClientesView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'control-llaves'}
        <LibroControlLlavesView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'incidencias-generales'}
        <LibroIncidenciasGeneralesView {libro} {libroId} multisalaUuid={activeMultisalaUuid} />
      {:else if activeSubvista === 'resumen-libro'}
        <LibroResumenView isPublic={false} {libro} {libroId} onSelectSubvista={handleSelectSubvista} />
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

  .badge-live-ws {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #a7f3d0;
    font-size: 11.5px;
    font-weight: 800;
    padding: 2px 9px;
    border-radius: 20px;
    letter-spacing: 0.3px;
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

  .main-subvistas-grid {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    width: 100%;
    gap: 4px;
    box-sizing: border-box;
    min-width: 0;
  }

  @media (max-width: 1024px) {
    .main-subvistas-grid {
      grid-template-columns: repeat(10, minmax(88px, 1fr));
      min-width: 880px;
    }
  }

  .subvista-tab-btn {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 6px 14px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    min-width: 68px;
  }

  .main-subvistas-grid .subvista-tab-btn {
    width: 100%;
    min-width: 0;
    padding: 6px 3px;
    box-sizing: border-box;
  }

  .multisalas-tabs-wrapper .subvista-tab-btn {
    flex-direction: row;
    padding: 8px 16px;
    min-width: auto;
  }

  .subvista-tab-btn:hover {
    background: #f8fafc;
  }

  .subvista-tab-btn.active {
    background: #0f172a;
    box-shadow: 0 2px 4px rgba(15, 23, 42, 0.2);
  }

  .tab-label {
    font-size: 12.5px;
    font-weight: 700;
    color: #475569;
    line-height: 1.2;
    text-align: center;
    transition: color 0.15s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .subvista-tab-btn:hover .tab-label {
    color: #0f172a;
  }

  .subvista-tab-btn.active .tab-label {
    color: #ffffff;
  }

  .tab-category-badge {
    display: inline-block;
    font-size: 7.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 0px 4.5px;
    border-radius: 3px;
    line-height: 1.25;
    text-align: center;
    transition: all 0.15s ease;
  }

  /* Badge colors when tab is inactive */
  .tab-category-badge.cat-libro {
    background: #f3e8ff;
    color: #7e22ce;
    border: 1px solid #e9d5ff;
  }
  .tab-category-badge.cat-mesas {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }
  .tab-category-badge.cat-maquinas {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }
  .tab-category-badge.cat-control {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }

  /* Badge colors when tab is active (dark background) */
  .subvista-tab-btn.active .tab-category-badge.cat-libro {
    background: #9333ea;
    color: #ffffff;
    border: 1px solid #a855f7;
  }
  .subvista-tab-btn.active .tab-category-badge.cat-mesas {
    background: #16a34a;
    color: #ffffff;
    border: 1px solid #22c55e;
  }
  .subvista-tab-btn.active .tab-category-badge.cat-maquinas {
    background: #d97706;
    color: #ffffff;
    border: 1px solid #f59e0b;
  }
  .subvista-tab-btn.active .tab-category-badge.cat-control {
    background: #0284c7;
    color: #ffffff;
    border: 1px solid #38bdf8;
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
