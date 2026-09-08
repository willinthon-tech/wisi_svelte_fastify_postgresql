<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { getPublicWebUrl } from '../../config/api.config.js';
  import { navigateToRoute } from '../../controllers/router.store.js';
  import { masterSalasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let isPublic = false;
  export let libro = null;
  export let libroId = null;
  export let onSelectSubvista = null;

  let isLoading = true;
  let isSyncing = false;
  let loadError = null;
  let reporteExists = false;
  let updatedAt = null;

  // Conteos en vivo para las tarjetas de cada subvista
  let liveCounts = {
    datos: 0,
    drop_mesas: 0,
    novedades_mesas: 0,
    control_llaves: 0,
    control_clientes: 0,
    incidencias_generales: 0
  };

  // Datos consolidados del reporte (consumidos de la tabla libro_reporte)
  let resumenData = {
    libro: null,
    datos: null,
    drop_mesas: [],
    novedades_mesas: [],
    control_llaves: [],
    control_clientes: [],
    incidencias_generales: []
  };

  // Selector de visualización en pantalla
  let viewMode = 'documento'; // 'documento' (completo ordenado) | 'drop' | 'resumen' | 'llaves' | 'clientes' | 'incidencias'

  onMount(async () => {
    // Si no viene libroId, extraerlo de la URL (/reportes/cecom/libro/:id o /reportes/cecom/ibro/:id)
    if (!libroId && typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const matchHash = hash.match(/reportes\/cecom\/(?:libro|ibro)\/(\d+)/i);
      if (matchHash) libroId = matchHash[1];

      if (!libroId) {
        const path = window.location.pathname || '';
        const matchPath = path.match(/reportes\/cecom\/(?:libro|ibro)\/(\d+)/i);
        if (matchPath) libroId = matchPath[1];
      }
    }

    await loadMasterStoresFromBackend();

    if (libroId || libro?.id) {
      await loadFullResumen(libroId || libro?.id);
    } else {
      isLoading = false;
      loadError = 'No se especificó ningún libro para generar el reporte';
    }
  });

  $: if (libroId && (!resumenData.libro || Number(resumenData.libro.id) !== Number(libroId))) {
    loadFullResumen(libroId);
  }

  async function loadFullResumen(id) {
    if (!id) return;
    isLoading = true;
    loadError = null;

    try {
      // Consume directamente del endpoint de la tabla libro_reporte
      const res = await fetch(`/api/master/libros/${id}/reporte`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          reporteExists = Boolean(json.exists);
          if (json.liveCounts) {
            liveCounts = { ...liveCounts, ...json.liveCounts };
          }
          updatedAt = json.data.updated_at || json.data.created_at || null;
          const payload = json.data.data || json.data;
          resumenData = {
            libro: payload.libro || json.data.libro || libro,
            datos: payload.datos || null,
            drop_mesas: payload.drop_mesas || [],
            novedades_mesas: payload.novedades_mesas || [],
            control_llaves: payload.control_llaves || [],
            control_clientes: payload.control_clientes || [],
            incidencias_generales: payload.incidencias_generales || []
          };
          if (!libro && resumenData.libro) {
            libro = resumenData.libro;
          }
          isLoading = false;
          return;
        }
      }

      loadError = 'No se pudo cargar la información del libro';
    } catch (err) {
      console.error('Error al cargar reporte consolidado de libro:', err);
      loadError = 'Error de conexión al cargar la información del libro';
    } finally {
      isLoading = false;
    }
  }

  // Generar o actualizar instantánea en la tabla libro_reporte (Botón principal solicitado)
  async function handleGenerarOActualizarReporte() {
    const id = libroId || libro?.id || resumenData.libro?.id;
    if (!id) return;
    isSyncing = true;
    try {
      const res = await fetch(`/api/master/libros/${id}/reporte`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && json && json.success) {
        const wasExisting = reporteExists;
        reporteExists = true;
        if (json.liveCounts) {
          liveCounts = { ...liveCounts, ...json.liveCounts };
        }
        updatedAt = json.data?.updated_at || json.data?.created_at || new Date().toISOString();
        const payload = json.data?.data || json.data;
        if (payload) {
          resumenData = {
            libro: payload.libro || json.data.libro || libro,
            datos: payload.datos || null,
            drop_mesas: payload.drop_mesas || [],
            novedades_mesas: payload.novedades_mesas || [],
            control_llaves: payload.control_llaves || [],
            control_clientes: payload.control_clientes || [],
            incidencias_generales: payload.incidencias_generales || []
          };
          if (!libro && resumenData.libro) {
            libro = resumenData.libro;
          }
        }
        triggerToast(
          wasExisting ? 'Reporte consolidado actualizado exitosamente en libro_reporte' : 'Reporte consolidado generado y guardado exitosamente en libro_reporte',
          'success'
        );
      } else {
        triggerToast(json?.error || 'Error al procesar reporte consolidado', 'error');
      }
    } catch (err) {
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSyncing = false;
    }
  }

  // Navegar directamente a la subvista seleccionada
  function handleGoToSubvista(subId) {
    if (typeof onSelectSubvista === 'function') {
      onSelectSubvista(subId);
    } else {
      const id = libroId || libro?.id || resumenData.libro?.id;
      if (id) {
        navigateToRoute(`cecom/libro/${id}/${subId}`);
      }
    }
  }

  // Formato amigable de fecha y hora
  function formatDateTimeDisplay(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-VE') + ' ' + d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  }

  // Nombre de la sala asignada al libro
  $: salaNombre = (() => {
    const l = resumenData.libro || libro;
    if (l?.sala_nombre) return l.sala_nombre;
    if (l?.sala_nombre_comercial) return l.sala_nombre_comercial;
    if (l?.sala_id) {
      const s = ($masterSalasStore || []).find(sala => Number(sala.id) === Number(l.sala_id));
      if (s) return s.nombre_comercial || s.nombre;
    }
    return 'Sala de Casino';
  })();

  // Desglose de fecha [ D | M | A ]
  $: dateParts = (() => {
    const dStr = (resumenData.libro || libro)?.descripcion || '';
    if (!dStr) return { day: '—', month: '—', year: '—', formatted: '—' };
    
    // Si viene YYYY-MM-DD
    const mYMD = String(dStr).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mYMD) {
      return {
        day: mYMD[3].padStart(2, '0'),
        month: mYMD[2].padStart(2, '0'),
        year: mYMD[1].slice(-2),
        formatted: `${mYMD[3].padStart(2, '0')}/${mYMD[2].padStart(2, '0')}/${mYMD[1]}`
      };
    }
    // Si viene DD/MM/YYYY
    const mDMY = String(dStr).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (mDMY) {
      return {
        day: mDMY[1].padStart(2, '0'),
        month: mDMY[2].padStart(2, '0'),
        year: mDMY[3].slice(-2),
        formatted: `${mDMY[1].padStart(2, '0')}/${mDMY[2].padStart(2, '0')}/${mDMY[3]}`
      };
    }
    return { day: '—', month: '—', year: '—', formatted: dStr };
  })();

  // Parser para formatear la mercancía e incidencias tipo Word (Título con hora en negrita e items en sangría)
  function parseIncidenciaContent(desc, hora) {
    if (!desc) return { title: '', items: [] };
    const rawLines = String(desc).split('\n');
    const lines = rawLines.map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    if (lines.length === 0) return { title: '', items: [] };

    let titleLine = lines[0].trim();
    const horaRegex = /^\d{1,2}:\d{2}/;
    if (hora && !horaRegex.test(titleLine)) {
      titleLine = `${hora} ${titleLine}`;
    }

    const items = lines.slice(1).map(l => {
      return l.replace(/^[\s•\-\*]+/, '').trim();
    }).filter(Boolean);

    return {
      title: titleLine,
      items
    };
  }

  // 1. Clasificación reactiva de Incidencias en Bloque de 3 (Mercancía, Generales, Empleados)
  $: incidenciasBloque = (() => {
    const list = resumenData.incidencias_generales || [];
    const mercancia = [];
    const empleado = [];
    const generales = [];

    for (const inc of list) {
      const t = (inc.tipo || '').toLowerCase().trim();
      const desc = (inc.descripcion || '').toLowerCase();
      if (t.includes('mercanc') || t.includes('proveedor') || desc.includes('proveedor') || desc.includes('mercanc') || desc.includes('factura') || desc.includes('insumo')) {
        mercancia.push(inc);
      } else if (t.includes('emplead') || t.includes('personal') || t.includes('rrhh') || t.includes('croupier') || desc.includes('emplead') || desc.includes('croupier') || desc.includes('personal') || desc.includes('asistencia') || desc.includes('retraso')) {
        empleado.push(inc);
      } else {
        generales.push(inc);
      }
    }

    return { mercancia, empleado, generales };
  })();

  // 2. Agrupación reactiva de Clientes por Método de Pago
  $: clientesPorMetodo = (() => {
    const list = resumenData.control_clientes || [];
    const map = {};
    for (const c of list) {
      const metodo = (c.metodo || 'No especificado').trim();
      if (!map[metodo]) {
        map[metodo] = { metodo, ops: 0, compras: 0, pagos: 0, balance: 0 };
      }
      const m = parseFloat(c.monto) || 0;
      const t = (c.tipo || 'compra').toLowerCase();
      map[metodo].ops += 1;
      if (t === 'pago') {
        map[metodo].pagos += m;
      } else {
        map[metodo].compras += m;
      }
    }
    return Object.values(map).map(item => ({
      ...item,
      balance: item.compras - item.pagos
    })).sort((a, b) => (b.compras + b.pagos) - (a.compras + a.pagos));
  })();

  $: totalesPorMetodo = (() => {
    const list = clientesPorMetodo;
    const ops = list.reduce((acc, r) => acc + r.ops, 0);
    const compras = list.reduce((acc, r) => acc + r.compras, 0);
    const pagos = list.reduce((acc, r) => acc + r.pagos, 0);
    return { ops, compras, pagos, balance: compras - pagos };
  })();

  // 3. Agrupación reactiva de Clientes por Cliente / Jugador
  $: clientesPorJugador = (() => {
    const list = resumenData.control_clientes || [];
    const map = {};
    for (const c of list) {
      const cliente = (c.cliente || 'Anónimo / General').trim();
      if (!map[cliente]) {
        map[cliente] = { cliente, ops: 0, compras: 0, pagos: 0, balance: 0 };
      }
      const m = parseFloat(c.monto) || 0;
      const t = (c.tipo || 'compra').toLowerCase();
      map[cliente].ops += 1;
      if (t === 'pago') {
        map[cliente].pagos += m;
      } else {
        map[cliente].compras += m;
      }
    }
    return Object.values(map).map(item => ({
      ...item,
      balance: item.compras - item.pagos
    })).sort((a, b) => (b.compras + b.pagos) - (a.compras + a.pagos));
  })();

  $: totalesPorJugador = (() => {
    const list = clientesPorJugador;
    const ops = list.reduce((acc, r) => acc + r.ops, 0);
    const compras = list.reduce((acc, r) => acc + r.compras, 0);
    const pagos = list.reduce((acc, r) => acc + r.pagos, 0);
    return { ops, compras, pagos, balance: compras - pagos };
  })();

  // Totales de Drop
  $: dropTotales = (() => {
    const list = resumenData.drop_mesas || [];
    const sum100 = list.reduce((acc, r) => acc + (Number(r.denominacion_100 ?? r.b100 ?? 0) || 0), 0);
    const sum50 = list.reduce((acc, r) => acc + (Number(r.denominacion_50 ?? r.b50 ?? 0) || 0), 0);
    const sum20 = list.reduce((acc, r) => acc + (Number(r.denominacion_20 ?? r.b20 ?? 0) || 0), 0);
    const sum10 = list.reduce((acc, r) => acc + (Number(r.denominacion_10 ?? r.b10 ?? 0) || 0), 0);
    const sum5 = list.reduce((acc, r) => acc + (Number(r.denominacion_5 ?? r.b5 ?? 0) || 0), 0);
    const sum1 = list.reduce((acc, r) => acc + (Number(r.denominacion_1 ?? r.b1 ?? 0) || 0), 0);
    const grandTotal = list.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    return { sum100, sum50, sum20, sum10, sum5, sum1, grandTotal };
  })();

  // Resumen financiero de Clientes
  $: clientesTotales = (() => {
    const list = resumenData.control_clientes || [];
    let totalCompras = 0;
    let totalPagos = 0;
    for (const c of list) {
      const m = parseFloat(c.monto) || 0;
      const t = (c.tipo || 'compra').toLowerCase();
      if (t === 'pago') {
        totalPagos += m;
      } else {
        totalCompras += m;
      }
    }
    const balanceNeto = totalCompras - totalPagos;
    return { totalCompras, totalPagos, balanceNeto, totalOps: list.length };
  })();

  // Producción = drop - (Total Compra - Total Pagos)
  $: produccionTotal = dropTotales.grandTotal - (clientesTotales.totalCompras - clientesTotales.totalPagos);

  // Resumen de Llaves
  $: llavesTotales = (() => {
    const list = resumenData.control_llaves || [];
    let enCustodia = 0;
    let devueltas = 0;
    for (const k of list) {
      if (k.hora_recepcion && k.hora_recepcion.trim()) {
        devueltas++;
      } else {
        enCustodia++;
      }
    }
    return { total: list.length, enCustodia, devueltas };
  })();

  // Formatear montos en dólares
  function formatMoney(n) {
    if (n == null || isNaN(n)) return '$0';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  // Copiar enlace y abrir vista de compartir
  async function handleCompartir() {
    const id = libroId || libro?.id || resumenData.libro?.id;
    if (!id) return;
    const shareUrl = getPublicWebUrl(`/#/reportes/cecom/libro/${id}`);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      triggerToast(`Enlace copiado al portapapeles`, 'success');
    } catch (e) {
      prompt('Copia el enlace del reporte:', shareUrl);
    }
    // Abrir la vista de compartir en una nueva pestaña
    window.open(shareUrl, '_blank');
  }

  function handleImprimir() {
    window.print();
  }
</script>

<div class="resumen-reporte-wrapper {isPublic ? 'is-public-mode' : 'is-internal-mode'}">
  {#if isPublic}
    <!-- Barra Superior en Modo Público -->
    <div class="report-tools-bar no-print">
      <div class="tools-left">
        <span class="report-tag">📋 Reporte Consolidado Libro CECOM</span>
        <span class="public-badge">Vista Pública</span>
        <span class="libro-badge">Libro #{libroId || libro?.id || resumenData.libro?.id || '—'}</span>
        <span class="date-badge">{dateParts.formatted}</span>
      </div>
      <div class="tools-right">
        <button type="button" class="btn-tool btn-print" on:click={handleImprimir} title="Imprimir reporte">
          <span>🖨️</span>
          <span>Imprimir</span>
        </button>
      </div>
    </div>
  {:else}
    <!-- ============================================================
         TARJETA SUPERIOR "RESUMEN LIBRO" (Conforme a la foto compartida)
         ============================================================ -->
    <div class="resumen-overview-card no-print">
      <!-- Fila 1: Cabecera con Icono, Título y Botón Principal (con la flecha roja indicada por el usuario) -->
      <div class="overview-header-row">
        <div class="header-titles-group">
          <div class="overview-icon-container">
            <span class="icon-graphic">📊</span>
          </div>
          <div class="overview-title-box">
            <h2 class="overview-title">Resumen Libro</h2>
            <p class="overview-subtitle">
              Consolidado general y auditoría • <span class="meta-highlight">{salaNombre}</span> ({dateParts.formatted})
              {#if updatedAt}
                <span class="meta-sep">•</span>
                <span class="meta-updated">Última sinc: {formatDateTimeDisplay(updatedAt)}</span>
              {/if}
            </p>
          </div>
        </div>

        <div class="header-actions-group">
          <!-- BOTÓN COMPARTIR -->
          <button
            type="button"
            class="btn-action-share"
            on:click={handleCompartir}
            title="Abrir vista de compartir y copiar enlace al portapapeles"
          >
            <span class="share-icon">🔗</span>
            <span>Compartir</span>
          </button>

          <!-- BOTÓN PRINCIPAL: "Generar Reporte" (si no existe) o "Actualizar Reporte" (si ya existe) -->
          <button
            type="button"
            class="btn-action-primary {reporteExists ? 'btn-actualizar' : 'btn-generar'}"
            on:click={handleGenerarOActualizarReporte}
            disabled={isSyncing}
            title={reporteExists ? 'Actualizar y sincronizar snapshot en tabla libro_reporte' : 'Generar y consolidar reporte en tabla libro_reporte'}
          >
            {#if isSyncing}
              <span class="btn-spinner"></span>
              <span>{reporteExists ? 'Actualizando...' : 'Generando...'}</span>
            {:else if reporteExists}
              <span>Actualizar Reporte</span>
            {:else}
              <span>Generar Reporte</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if isLoading}
    <div class="report-state-card loading">
      <div class="report-spinner"></div>
      <p>Cargando información consolidada desde libro_reporte...</p>
    </div>
  {:else if loadError}
    <div class="report-state-card error">
      <span class="error-icon">⚠️</span>
      <h3>Error al generar reporte</h3>
      <p>{loadError}</p>
      <button type="button" class="btn-retry" on:click={() => loadFullResumen(libroId || libro?.id)}>Reintentar</button>
    </div>
  {:else}
    <div class="official-sheet-container">
      
      <!-- ============================================================
           ENCABEZADO: SALA Y FECHA (Sin las 5 estrellas del logo)
           ============================================================ -->
      <div class="sheet-header">
        <div class="casino-logo-box">
          <span class="logo-main-text">{salaNombre.toUpperCase()}</span>
          <span class="logo-sub-text">CENTRO DE CONTROL Y MONITOREO (CECOM)</span>
        </div>

        <div class="sheet-date-box">
          <table class="date-matrix-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>{dateParts.day}</th>
                <th>{dateParts.month}</th>
                <th>{dateParts.year}</th>
              </tr>
            </thead>
          </table>
        </div>
      </div>

      <!-- ============================================================
           1. INFORMACIÓN DE SALA (Horarios Operativos Oficiales)
           ============================================================ -->
      <div class="sheet-section official-incidencias-block first-section">
        <div class="sheet-main-title-box">
          <h1 class="sheet-title-text">Resumen De Incidencias Diarias.</h1>
        </div>

        <div class="horarios-section">
          <div class="horarios-list">
            
            <!-- 1. Apertura de la sala -->
            <div class="horario-item">
              <span class="item-num">1.</span>
              <span class="item-label">Apertura de la sala</span>
              <div class="item-values">
                <span class="h-text">h inicio:</span>
                <span class="h-val">{resumenData.datos?.apertura_sala_inicio || '—'}</span>
                <span class="h-text">h cierre:</span>
                <span class="h-val">{resumenData.datos?.apertura_sala_fin || '—'}</span>
              </div>
            </div>

            <!-- 2. Apertura de maquinas -->
            <div class="horario-item">
              <span class="item-num">2.</span>
              <span class="item-label">Apertura de maquinas</span>
              <div class="item-values">
                <span class="h-text">h inicio:</span>
                <span class="h-val">{resumenData.datos?.apertura_maquinas_inicio || '—'}</span>
                <span class="h-text">h cierre:</span>
                <span class="h-val">{resumenData.datos?.apertura_maquinas_fin || '—'}</span>
              </div>
            </div>

            <!-- 3. Apertura de bingo -->
            <div class="horario-item">
              <span class="item-num">3.</span>
              <span class="item-label">Apertura de bingo</span>
              <div class="item-values">
                <span class="h-text">h inicio:</span>
                <span class="h-val">{resumenData.datos?.apertura_bingo_inicio || '—'}</span>
                <span class="h-text">h cierre:</span>
                <span class="h-val">{resumenData.datos?.apertura_bingo_fin || '—'}</span>
              </div>
            </div>

            <!-- 4. Retiro de dropbox general -->
            <div class="horario-item">
              <span class="item-num">4.</span>
              <span class="item-label">Retiro de dropbox general</span>
              <div class="item-values">
                <span class="h-text">h inicio:</span>
                <span class="h-val">{resumenData.datos?.retiros_dropbox_inicio || '—'}</span>
                <span class="h-text">h cierre:</span>
                <span class="h-val">{resumenData.datos?.retiros_dropbox_fin || '—'}</span>
              </div>
            </div>

            <!-- 5. Conteo DROP -->
            <div class="horario-item">
              <span class="item-num">5.</span>
              <span class="item-label">Conteo DROP</span>
              <div class="item-values">
                <span class="h-text">h inicio:</span>
                <span class="h-val">{resumenData.datos?.conteo_dropbox_inicio || '—'}</span>
                <span class="h-text">h cierre:</span>
                <span class="h-val">{resumenData.datos?.conteo_dropbox_fin || '—'}</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- ============================================================
           2. DROP DE MESAS (Arqueo de Efectivo)
           ============================================================ -->
      <div class="sheet-section sub-module-section">
        <div class="sub-header-row">
          <div class="sub-title-group">
            <h2 class="sub-section-title">🎲 2. Drop de Mesas (Arqueo de Efectivo)</h2>
            <span class="sub-count-badge">{resumenData.drop_mesas.length} mesas registradas</span>
          </div>
          <span class="sub-total-badge {produccionTotal >= 0 ? 'badge-produccion-positive' : 'badge-produccion-negative'}">
            Producción: <b>{formatMoney(produccionTotal)}</b>
          </span>
        </div>

        <!-- Indicadores rápidos de rendimiento -->
        <div class="quick-kpi-grid">
          <div class="kpi-card">
            <span class="kpi-label">Total Drop</span>
            <span class="kpi-value text-emerald">{formatMoney(dropTotales.grandTotal)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total Compra</span>
            <span class="kpi-value text-blue">{formatMoney(clientesTotales.totalCompras)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total Pagos</span>
            <span class="kpi-value text-rose">{formatMoney(clientesTotales.totalPagos)}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-label">Total Compra - Total Pagos</span>
            <span class="kpi-value {clientesTotales.balanceNeto >= 0 ? 'text-emerald' : 'text-rose'}">
              {formatMoney(clientesTotales.balanceNeto)}
            </span>
          </div>
        </div>

        {#if resumenData.drop_mesas.length === 0}
          <div class="empty-sub-alert">No hay registros de drop para este libro.</div>
        {:else}
          <table class="sheet-detail-table">
            <thead>
              <tr>
                <th class="th-mesa">MESA</th>
                <th class="th-num">$100</th>
                <th class="th-num">$50</th>
                <th class="th-num">$20</th>
                <th class="th-num">$10</th>
                <th class="th-num">$5</th>
                <th class="th-num">$1</th>
                <th class="th-total">TOTAL RECAUDADO</th>
              </tr>
            </thead>
            <tbody>
              {#each resumenData.drop_mesas as d}
                <tr>
                  <td class="cell-mesa-bold">{d.mesa_nombre || `Mesa #${d.mesa_id}`}</td>
                  <td class="cell-num">{d.denominacion_100 ?? d.b100 ?? 0}</td>
                  <td class="cell-num">{d.denominacion_50 ?? d.b50 ?? 0}</td>
                  <td class="cell-num">{d.denominacion_20 ?? d.b20 ?? 0}</td>
                  <td class="cell-num">{d.denominacion_10 ?? d.b10 ?? 0}</td>
                  <td class="cell-num">{d.denominacion_5 ?? d.b5 ?? 0}</td>
                  <td class="cell-num">{d.denominacion_1 ?? d.b1 ?? 0}</td>
                  <td class="cell-total-money">{formatMoney(d.total)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr class="tfoot-totals">
                <td>TOTALES</td>
                <td class="cell-num">{dropTotales.sum100}</td>
                <td class="cell-num">{dropTotales.sum50}</td>
                <td class="cell-num">{dropTotales.sum20}</td>
                <td class="cell-num">{dropTotales.sum10}</td>
                <td class="cell-num">{dropTotales.sum5}</td>
                <td class="cell-num">{dropTotales.sum1}</td>
                <td class="cell-grand-total">{formatMoney(dropTotales.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        {/if}
      </div>

      <!-- ============================================================
           3. NOVEDADES DE MESAS (Apertura y Cierre de Mesas)
           ============================================================ -->
      <div class="sheet-section sub-module-section">
        <div class="sub-header-row">
          <div class="sub-title-group">
            <h2 class="sub-section-title">🎭 3. Novedades de Mesas (Apertura y Cierre)</h2>
            <span class="sub-count-badge">{resumenData.novedades_mesas.length} registros</span>
          </div>
        </div>

        <div class="mesas-section">
          <table class="sheet-official-table">
            <thead>
              <tr>
                <th class="th-hora-a">HORA<br/>A</th>
                <th class="th-mesa">MESA</th>
                <th class="th-pitboss">PITBOSS</th>
                <th class="th-croupier">CROUPIER<br/>APERTURA</th>
                <th class="th-croupier">CROUPIER<br/>CIERRE</th>
                <th class="th-hora-c">HORA<br/>C</th>
                <th class="th-obs">OBSERVACIÓN</th>
              </tr>
            </thead>
            <tbody>
              {#if resumenData.novedades_mesas.length === 0}
                <tr>
                  <td colspan="7" class="cell-empty-text">No hay novedades registradas de mesas para este día.</td>
                </tr>
              {:else}
                {#each resumenData.novedades_mesas as nov}
                  <tr>
                    <td class="cell-center">{nov.hora_apertura || '—'}</td>
                    <td class="cell-mesa-name">{nov.mesa_nombre || `Mesa #${nov.mesa_id}`}</td>
                    <td class="cell-left">{nov.pitboss || '—'}</td>
                    <td class="cell-left">{nov.croupier_apertura || '—'}</td>
                    <td class="cell-left">{nov.croupier_cierre || '—'}</td>
                    <td class="cell-center">{nov.hora_cierre || '—'}</td>
                    <td class="cell-left cell-obs">{nov.observacion || '—'}</td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      </div>

      <!-- ============================================================
           4. INCIDENCIAS EN BLOQUE DE 3 (Mercancía, Generales, Empleados)
           ============================================================ -->
      <div class="sheet-section sub-module-section">
        <div class="sub-header-row">
          <div class="sub-title-group">
            <h2 class="sub-section-title">⚠️ 4. Bitácora de Incidencias (Mercancía, Generales y Empleados)</h2>
            <span class="sub-count-badge">{resumenData.incidencias_generales.length} reportes en total</span>
          </div>
        </div>

        <div class="incidencias-bloque-tres">
          
          <!-- Bloque 1: Mercancía / Proveedores -->
          <div class="incidencia-subbloque">
            <div class="incidencia-subbloque-header">
              <h3 class="incidencia-subbloque-title">
                <span>📦 Mercancía / Proveedores</span>
              </h3>
              <span class="incidencia-badge">{incidenciasBloque.mercancia.length}</span>
            </div>
            <div class="incidencia-subbloque-content">
              {#if incidenciasBloque.mercancia.length === 0}
                <div class="empty-sub-alert">Sin recepción de mercancía registrada.</div>
              {:else}
                {#each incidenciasBloque.mercancia as inc}
                  {@const parsed = parseIncidenciaContent(inc.descripcion, inc.hora)}
                  <div class="incidencia-item-card">
                    <div class="inc-item-title-bold">{parsed.title}</div>
                    {#if parsed.items && parsed.items.length > 0}
                      <ul class="inc-subitems-list">
                        {#each parsed.items as subItem}
                          <li>{subItem}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          </div>

          <!-- Bloque 2: Generales -->
          <div class="incidencia-subbloque">
            <div class="incidencia-subbloque-header">
              <h3 class="incidencia-subbloque-title">
                <span>📋 Incidencias Generales</span>
              </h3>
              <span class="incidencia-badge">{incidenciasBloque.generales.length}</span>
            </div>
            <div class="incidencia-subbloque-content">
              {#if incidenciasBloque.generales.length === 0}
                <div class="empty-sub-alert">Sin incidencias generales reportadas.</div>
              {:else}
                {#each incidenciasBloque.generales as inc}
                  {@const parsed = parseIncidenciaContent(inc.descripcion, inc.hora)}
                  <div class="incidencia-item-card">
                    <div class="inc-item-title-bold">{parsed.title}</div>
                    {#if parsed.items && parsed.items.length > 0}
                      <ul class="inc-subitems-list">
                        {#each parsed.items as subItem}
                          <li>{subItem}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          </div>

          <!-- Bloque 3: Empleados / Personal -->
          <div class="incidencia-subbloque">
            <div class="incidencia-subbloque-header">
              <h3 class="incidencia-subbloque-title">
                <span>👤 Personal / Empleados</span>
              </h3>
              <span class="incidencia-badge">{incidenciasBloque.empleado.length}</span>
            </div>
            <div class="incidencia-subbloque-content">
              {#if incidenciasBloque.empleado.length === 0}
                <div class="empty-sub-alert">Sin novedades de empleados registradas.</div>
              {:else}
                {#each incidenciasBloque.empleado as inc}
                  {@const parsed = parseIncidenciaContent(inc.descripcion, inc.hora)}
                  <div class="incidencia-item-card">
                    <div class="inc-item-title-bold">{parsed.title}</div>
                    {#if parsed.items && parsed.items.length > 0}
                      <ul class="inc-subitems-list">
                        {#each parsed.items as subItem}
                          <li>{subItem}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          </div>

        </div>
      </div>

      <!-- ============================================================
           5. CONTROL DE LLAVES
           ============================================================ -->
      <div class="sheet-section sub-module-section">
        <div class="sub-header-row">
          <div class="sub-title-group">
            <h2 class="sub-section-title">🔑 5. Bitácora de Control de Llaves</h2>
            <span class="sub-count-badge">{llavesTotales.total} registros</span>
          </div>
          <div class="badges-status-group">
            <span class="badge-kpi-pill active">En Custodia: <b>{llavesTotales.enCustodia}</b></span>
            <span class="badge-kpi-pill success">Devueltas: <b>{llavesTotales.devueltas}</b></span>
          </div>
        </div>

        {#if resumenData.control_llaves.length === 0}
          <div class="empty-sub-alert">No hay movimientos de control de llaves registrados en este libro.</div>
        {:else}
          <table class="sheet-detail-table">
            <thead>
              <tr>
                <th class="th-num">N°</th>
                <th class="th-llave">LLAVES</th>
                <th class="th-desc">DESCRIPCIÓN / MOTIVO</th>
                <th class="th-hora">HORA SALIDA</th>
                <th class="th-hora">HORA RECEPCIÓN</th>
                <th class="th-estado">ESTADO</th>
              </tr>
            </thead>
            <tbody>
              {#each resumenData.control_llaves as k, idx}
                {@const isDevuelta = Boolean(k.hora_recepcion && k.hora_recepcion.trim())}
                {@const llavesTexto = (k.llaves_detalle && k.llaves_detalle.length > 0)
                  ? k.llaves_detalle.map(l => l.nombre).join(', ')
                  : (k.llave_nombre || (k.llaves_ids ? `${k.llaves_ids.length} llaves` : '—'))}
                <tr>
                  <td class="cell-center">{idx + 1}</td>
                  <td class="cell-llave-bold">🔑 {llavesTexto}</td>
                  <td class="cell-left">{k.descripcion || 'General'}</td>
                  <td class="cell-center">{k.hora_salida || '—'}</td>
                  <td class="cell-center">{k.hora_recepcion || '—'}</td>
                  <td class="cell-center">
                    {#if isDevuelta}
                      <span class="tag-status tag-success">✓ Devuelta</span>
                    {:else}
                      <span class="tag-status tag-warning">⏳ En Custodia</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- ============================================================
           6. CONTROL DE CLIENTES (Detallado + 2 Tablitas Agrupadas)
           ============================================================ -->
      <div class="sheet-section sub-module-section">
        <div class="sub-header-row">
          <div class="sub-title-group">
            <h2 class="sub-section-title">👥 6. Control de Clientes / Jugadores en Sala</h2>
            <span class="sub-count-badge">{clientesTotales.totalOps} transacciones</span>
          </div>
          <div class="badges-status-group">
            <span class="badge-kpi-pill success">Total Compras: <b>{formatMoney(clientesTotales.totalCompras)}</b></span>
            <span class="badge-kpi-pill info">Total Pagos: <b>{formatMoney(clientesTotales.totalPagos)}</b></span>
            <span class="badge-kpi-pill {clientesTotales.balanceNeto >= 0 ? 'highlight-positive' : 'highlight-negative'}">
              Balance Neto: <b>{formatMoney(clientesTotales.balanceNeto)}</b>
            </span>
          </div>
        </div>

        <!-- 6.1 Detallado de Operación -->
        {#if resumenData.control_clientes.length === 0}
          <div class="empty-sub-alert">No hay operaciones de control de clientes registradas en este libro.</div>
        {:else}
          <table class="sheet-detail-table">
            <thead>
              <tr>
                <th class="th-num">N°</th>
                <th class="th-hora">HORA</th>
                <th class="th-cliente">CLIENTE / JUGADOR</th>
                <th class="th-tipo">TIPO</th>
                <th class="th-metodo">MÉTODO</th>
                <th class="th-total">MONTO</th>
              </tr>
            </thead>
            <tbody>
              {#each resumenData.control_clientes as c, idx}
                {@const isCompra = (c.tipo || '').toLowerCase() === 'compra'}
                <tr>
                  <td class="cell-center">{idx + 1}</td>
                  <td class="cell-center">{c.hora || '—'}</td>
                  <td class="cell-client-name">👤 {c.cliente || '—'}</td>
                  <td class="cell-center">
                    <span class="tag-tipo {isCompra ? 'tag-compra' : 'tag-pago'}">
                      {c.tipo || 'Compra'}
                    </span>
                  </td>
                  <td class="cell-center tag-metodo-text">{c.metodo || 'General'}</td>
                  <td class="cell-total-money">{formatMoney(c.monto)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr class="tfoot-totals">
                <td colspan="5">BALANCE NETO (COMPRAS - PAGOS)</td>
                <td class="cell-grand-total">{formatMoney(clientesTotales.balanceNeto)}</td>
              </tr>
            </tfoot>
          </table>

          <!-- 6.2 Las 2 Tablitas Agrupadas (Por Método de Pago y Por Cliente) -->
          <div class="client-summaries-grid">
            
            <!-- Tablita A: Agrupado por Método de Pago -->
            <div class="summary-subtable-box">
              <div class="subtable-header">
                <h4 class="subtable-title">💳 Resumen por Método de Pago</h4>
                <span class="incidencia-badge">{clientesPorMetodo.length} métodos</span>
              </div>
              <table class="compact-table">
                <thead>
                  <tr>
                    <th>MÉTODO</th>
                    <th>OPS</th>
                    <th>COMPRAS</th>
                    <th>PAGOS</th>
                    <th>BALANCE</th>
                  </tr>
                </thead>
                <tbody>
                  {#each clientesPorMetodo as m}
                    <tr>
                      <td class="cell-left font-bold">{m.metodo}</td>
                      <td class="cell-center">{m.ops}</td>
                      <td class="cell-total-money">{formatMoney(m.compras)}</td>
                      <td class="cell-total-money text-blue">{formatMoney(m.pagos)}</td>
                      <td class="cell-total-money {m.balance >= 0 ? 'text-emerald' : 'text-rose'}">
                        {formatMoney(m.balance)}
                      </td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr class="tfoot-totals">
                    <td>TOTAL</td>
                    <td class="cell-center">{totalesPorMetodo.ops}</td>
                    <td class="cell-total-money">{formatMoney(totalesPorMetodo.compras)}</td>
                    <td class="cell-total-money text-blue">{formatMoney(totalesPorMetodo.pagos)}</td>
                    <td class="cell-grand-total">{formatMoney(totalesPorMetodo.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <!-- Tablita B: Agrupado por Cliente / Jugador -->
            <div class="summary-subtable-box">
              <div class="subtable-header">
                <h4 class="subtable-title">👤 Resumen por Cliente / Jugador</h4>
                <span class="incidencia-badge">{clientesPorJugador.length} clientes</span>
              </div>
              <table class="compact-table">
                <thead>
                  <tr>
                    <th>CLIENTE</th>
                    <th>OPS</th>
                    <th>COMPRAS</th>
                    <th>PAGOS</th>
                    <th>BALANCE</th>
                  </tr>
                </thead>
                <tbody>
                  {#each clientesPorJugador as cl}
                    <tr>
                      <td class="cell-left font-bold">{cl.cliente}</td>
                      <td class="cell-center">{cl.ops}</td>
                      <td class="cell-total-money">{formatMoney(cl.compras)}</td>
                      <td class="cell-total-money text-blue">{formatMoney(cl.pagos)}</td>
                      <td class="cell-total-money {cl.balance >= 0 ? 'text-emerald' : 'text-rose'}">
                        {formatMoney(cl.balance)}
                      </td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr class="tfoot-totals">
                    <td>TOTAL</td>
                    <td class="cell-center">{totalesPorJugador.ops}</td>
                    <td class="cell-total-money">{formatMoney(totalesPorJugador.compras)}</td>
                    <td class="cell-total-money text-blue">{formatMoney(totalesPorJugador.pagos)}</td>
                    <td class="cell-grand-total">{formatMoney(totalesPorJugador.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

          </div>
        {/if}
      </div>

      <!-- ============================================================
           7. OPERADORES CECOM (APERTURA Y CIERRE) Y AUDITORÍA FINAL
           ============================================================ -->
      <div class="sheet-section sub-module-section operadores-final-section">
        <div class="operadores-section-box">
          <span class="op-main-title">OPERADORES CECOM:</span>
          <div class="op-line">
            <span class="op-label">TURNO A (APERTURA):</span>
            <span class="op-names">NOMBRES: {resumenData.datos?.operador_turno_a || '—'}</span>
          </div>
          <div class="op-line">
            <span class="op-label">TURNO C (CIERRE):</span>
            <span class="op-names">NOMBRES: {resumenData.datos?.operador_turno_c || '—'}</span>
          </div>
        </div>

        <!-- Firmas Oficiales de Auditoría -->
        <div class="sheet-footer-signatures">
          <div class="signature-box">
            <div class="sign-line"></div>
            <span class="sign-title">Operador CECOM (Turno A - Apertura)</span>
            <span class="sign-name">{resumenData.datos?.operador_turno_a || 'Firma y Huella'}</span>
          </div>

          <div class="signature-box">
            <div class="sign-line"></div>
            <span class="sign-title">Operador CECOM (Turno C - Cierre)</span>
            <span class="sign-name">{resumenData.datos?.operador_turno_c || 'Firma y Huella'}</span>
          </div>

          <div class="signature-box">
            <div class="sign-line"></div>
            <span class="sign-title">Supervisión / Auditoría de Sala</span>
            <span class="sign-name">Firma y Sello Oficial</span>
          </div>
        </div>

        <div class="sheet-bottom-note">
          Documento oficial consolidado emitido por el Sistema WISI.
        </div>
      </div>


    </div>
  {/if}
</div>

<style>
  /* Contenedor general */
  .resumen-reporte-wrapper {
    width: 100%;
    min-height: 100vh;
    box-sizing: border-box;
    font-family: Arial, Helvetica, sans-serif;
  }

  .resumen-reporte-wrapper.is-public-mode {
    background-color: #f1f5f9;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .resumen-reporte-wrapper.is-internal-mode {
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* ============================================================
     TARJETA SUPERIOR "RESUMEN LIBRO" (Conforme a la imagen del usuario)
     ============================================================ */
  .resumen-overview-card {
    width: 100%;
    max-width: 1100px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 24px 28px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
    margin-bottom: 20px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .overview-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-titles-group {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .overview-icon-container {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    flex-shrink: 0;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .overview-title-box {
    display: flex;
    flex-direction: column;
  }

  .overview-title {
    font-size: 1.35rem;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    line-height: 1.2;
    letter-spacing: -0.2px;
  }

  .overview-subtitle {
    font-size: 0.85rem;
    color: #64748b;
    margin: 4px 0 0 0;
  }

  .header-actions-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  /* Botón Compartir al lado de Actualizar Reporte */
  .btn-action-share {
    background: #0284c7;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);
    transition: all 0.15s ease;
  }
  .btn-action-share:hover {
    background: #0369a1;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(2, 132, 199, 0.32);
  }

  /* Botón Principal (Generar / Actualizar Reporte) */
  .btn-action-primary {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 10px 22px;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.28);
    transition: all 0.15s ease;
  }
  .btn-action-primary:hover:not(:disabled) {
    background: #1d4ed8;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  }
  .btn-action-primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .btn-action-secondary {
    background: #f8fafc;
    color: #334155;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 9px 14px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
  }
  .btn-action-secondary:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }
  .btn-action-secondary.btn-icon-only {
    padding: 9px 11px;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  /* Sub-tarjeta: Resumen Consolidado del Libro */
  .consolidado-banner-card {
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 12px;
    padding: 14px 20px;
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .consolidado-banner-title {
    font-size: 1.05rem;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
  }

  .consolidado-banner-meta {
    font-size: 0.85rem;
    color: #64748b;
    margin: 4px 0 0 0;
  }

  .meta-highlight {
    font-weight: 700;
    color: #1e293b;
  }

  .meta-sep {
    margin: 0 6px;
    color: #cbd5e1;
  }

  .meta-updated {
    font-size: 0.8rem;
    color: #059669;
    font-weight: 600;
  }

  .badge-status {
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.5px;
    padding: 4px 12px;
    border-radius: 9999px;
    display: inline-flex;
    align-items: center;
  }

  .badge-en-curso {
    background: #dcfce7;
    color: #15803d;
  }

  .badge-sin-generar {
    background: #fef3c7;
    color: #92400e;
  }

  /* Grid de las 6 subvistas */
  .subvistas-cards-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-top: 20px;
  }

  @media (max-width: 1024px) {
    .subvistas-cards-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 600px) {
    .subvistas-cards-grid {
      grid-template-columns: 1fr;
    }
  }

  .subvista-metric-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subvista-metric-card:hover {
    border-color: #93c5fd;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
    transform: translateY(-1px);
  }

  .metric-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .metric-icon {
    font-size: 1.1rem;
  }

  .metric-title {
    font-size: 0.95rem;
    font-weight: 800;
    color: #0f172a;
  }

  .metric-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }

  .metric-count {
    color: #64748b;
    font-weight: 500;
  }

  .metric-link {
    color: #2563eb;
    font-weight: 700;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .metric-link:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }

  /* Barra de herramientas superior para modo público */
  .report-tools-bar {
    width: 100%;
    max-width: 1100px;
    background: #1e293b;
    color: #ffffff;
    padding: 10px 18px;
    border-radius: 8px;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  }

  .tools-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .report-tag {
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 0.2px;
  }

  .public-badge {
    background: #10b981;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .libro-badge {
    background: rgba(255, 255, 255, 0.15);
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .date-badge {
    background: #2563eb;
    color: #ffffff;
    font-size: 11.5px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: monospace;
  }

  .tools-center {
    display: flex;
    align-items: center;
  }

  .view-switch-btns {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .btn-switch {
    background: rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 5px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-switch:hover,
  .btn-switch.active {
    background: #2563eb;
    color: #ffffff;
    border-color: #3b82f6;
  }

  .tools-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
  }

  .btn-sync {
    background: #4f46e5;
    color: #ffffff;
  }
  .btn-sync:hover:not(:disabled) {
    background: #4338ca;
  }
  .btn-sync:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-share {
    background: #3b82f6;
    color: #ffffff;
  }
  .btn-share:hover {
    background: #2563eb;
  }

  .btn-print {
    background: #10b981;
    color: #ffffff;
  }
  .btn-print:hover {
    background: #059669;
  }

  .btn-refresh {
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
    padding: 6px 10px;
  }
  .btn-refresh:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  /* Estados de carga y error */
  .report-state-card {
    width: 100%;
    max-width: 600px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 40px;
    text-align: center;
    margin: 40px auto;
  }

  .report-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #cbd5e1;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 16px;
  }

  .btn-retry {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 700;
    cursor: pointer;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ─────────────────────────────────────────────────────────────
     HOJA OFICIAL DEL CASINO (Estilo documento físico de las fotos)
     ───────────────────────────────────────────────────────────── */
  .official-sheet-container {
    width: 100%;
    max-width: 1100px;
    background: #ffffff;
    border: 1px solid #d1d5db;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    padding: 36px 44px;
    box-sizing: border-box;
    border-radius: 4px;
    color: #000000;
  }

  /* Encabezado del documento (Sin estrellas) */
  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 12px;
  }

  .casino-logo-box {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .logo-main-text {
    font-size: 26px;
    font-weight: 900;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    letter-spacing: -0.3px;
    color: #0f172a;
    line-height: 1.1;
  }

  .logo-sub-text {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: #475569;
  }

  .sheet-date-box {
    display: flex;
  }

  .date-matrix-table {
    border-collapse: collapse;
    border: 2px solid #000000;
    font-size: 13px;
    font-weight: 800;
  }

  .date-matrix-table th {
    border: 1px solid #000000;
    padding: 5px 12px;
    text-align: center;
    background: #f8fafc;
  }

  /* Título principal */
  .sheet-main-title-box {
    text-align: center;
    margin: 18px 0 16px;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 6px;
  }

  .sheet-title-text {
    font-size: 20px;
    font-weight: 900;
    color: #1e40af;
    margin: 0;
    text-decoration: underline;
    letter-spacing: 0.3px;
  }

  /* Lista de Horarios Operativos */
  .horarios-section {
    margin-bottom: 20px;
    font-size: 13.5px;
    line-height: 1.4;
  }

  .horarios-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .horario-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .horario-item.multi-line {
    align-items: flex-start;
  }

  .item-num {
    font-weight: 900;
    width: 20px;
    color: #111827;
  }

  .item-label {
    font-weight: 800;
    color: #111827;
    min-width: 210px;
  }

  .item-values {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .h-text {
    font-style: italic;
    color: #374151;
    font-size: 13px;
  }

  .h-val {
    font-weight: 800;
    color: #000000;
    min-width: 50px;
    border-bottom: 1px dotted #9ca3af;
  }

  .h-val-none {
    color: #64748b;
    font-style: italic;
    font-size: 12px;
  }

  .h-val.highlight-money {
    color: #15803d;
    font-size: 14px;
    font-weight: 900;
  }

  /* Desglose de mercancía en item 4 */
  .mercancia-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .mercancia-sublist {
    padding-left: 28px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mercancia-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mercancia-title-line {
    font-size: 13px;
  }

  .m-title-bold {
    font-weight: 800;
    color: #0f172a;
  }

  .mercancia-items-block {
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mercancia-sub-item {
    font-size: 12.5px;
    color: #1e293b;
    line-height: 1.35;
  }

  /* Tabla Oficial de Mesas */
  .sheet-official-table {
    width: 100%;
    border-collapse: collapse;
    border: 2px solid #000000;
    font-size: 12px;
    margin-bottom: 18px;
  }

  .sheet-official-table thead tr {
    background: #b8cce4; /* Azul suave idéntico a las fotos */
    color: #000000;
  }

  .sheet-official-table th {
    border: 1px solid #000000;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.3px;
    text-align: center;
    line-height: 1.2;
  }

  .sheet-official-table td {
    border: 1px solid #000000;
    padding: 5px 8px;
    vertical-align: middle;
  }

  .th-hora-a, .th-hora-c { width: 75px; }
  .th-mesa { width: 85px; text-align: center; }
  .th-pitboss { width: 140px; }
  .th-croupier { width: 160px; }
  .th-obs { min-width: 120px; }

  .cell-center { text-align: center; font-weight: 700; }
  .cell-left { text-align: left; }
  .cell-mesa-name { text-align: center; font-weight: 900; }
  .cell-obs { font-weight: 700; font-style: italic; }
  .cell-empty-text { text-align: center; padding: 18px; color: #4b5563; font-style: italic; }

  /* Operadores CECOM */
  .operadores-section {
    margin: 12px 0 20px;
    border-top: 1px solid #000000;
    padding-top: 10px;
  }

  .operadores-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }

  .op-main-title {
    font-weight: 900;
    text-decoration: underline;
  }

  .op-line {
    display: flex;
    gap: 8px;
  }

  .op-label {
    font-weight: 800;
    min-width: 90px;
  }

  .op-names {
    font-weight: 700;
  }

  /* ─────────────────────────────────────────────────────────────
     SECCIONES DETALLADAS DE SUBMÓDULOS
     ───────────────────────────────────────────────────────────── */
  .sub-module-section {
    margin-top: 24px;
    border-top: 2px dashed #9ca3af;
    padding-top: 18px;
  }

  .sub-module-section.first-section {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }

  .official-incidencias-block {
    margin-top: 24px;
    border-top: 2px dashed #9ca3af;
    padding-top: 16px;
  }

  .hidden-on-screen {
    display: none !important;
  }

  .sub-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .sub-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .sub-section-title {
    font-size: 15.5px;
    font-weight: 900;
    color: #1e3a8a;
    margin: 0;
  }

  .sub-total-badge {
    font-size: 13px;
    background: #dcfce7;
    color: #15803d;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #bbf7d0;
  }
  .sub-total-badge.badge-produccion-positive {
    background: #dcfce7;
    color: #15803d;
    border-color: #86efac;
  }
  .sub-total-badge.badge-produccion-negative {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fca5a5;
  }

  .sub-count-badge {
    font-size: 12px;
    background: #f1f5f9;
    color: #475569;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
  }

  .badges-status-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge-kpi-pill {
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 600;
  }
  .badge-kpi-pill.active { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
  .badge-kpi-pill.success { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
  .badge-kpi-pill.info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .badge-kpi-pill.highlight-positive { background: #d1fae5; color: #047857; font-weight: 800; border: 1px solid #a7f3d0; }
  .badge-kpi-pill.highlight-negative { background: #fee2e2; color: #b91c1c; font-weight: 800; border: 1px solid #fecaca; }

  /* Quick KPI Cards */
  .quick-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .kpi-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
    letter-spacing: 0.3px;
  }

  .kpi-value {
    font-size: 15px;
    font-weight: 900;
    color: #0f172a;
  }

  .text-emerald {
    color: #059669;
  }

  .empty-sub-alert {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 14px;
    border-radius: 4px;
    font-size: 13px;
    color: #64748b;
    text-align: center;
    font-style: italic;
  }

  .sheet-detail-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #6b7280;
    font-size: 12px;
    margin-bottom: 16px;
  }

  .sheet-detail-table thead tr {
    background: #e5e7eb;
    color: #111827;
  }

  .sheet-detail-table th {
    border: 1px solid #9ca3af;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 800;
    text-align: center;
  }

  .sheet-detail-table td {
    border: 1px solid #d1d5db;
    padding: 6px 8px;
  }

  .th-num { width: 45px; text-align: center; }
  .th-hora { width: 80px; text-align: center; }
  .th-cliente { width: 180px; }
  .th-tipo { width: 100px; text-align: center; }
  .th-metodo { width: 110px; text-align: center; }
  .th-total { width: 130px; text-align: right; }
  .th-llave { width: 200px; }
  .th-estado { width: 110px; text-align: center; }

  .cell-num { text-align: center; font-variant-numeric: tabular-nums; }
  .cell-mesa-bold { font-weight: 800; color: #111827; }
  .cell-total-money { text-align: right; font-weight: 800; color: #15803d; font-variant-numeric: tabular-nums; }

  .tfoot-totals {
    background: #f3f4f6;
    font-weight: 900;
  }
  .tfoot-totals td {
    border-top: 2px solid #000000;
  }
  .cell-grand-total {
    text-align: right;
    font-size: 13px;
    font-weight: 900;
    color: #166534;
  }

  .cell-llave-bold { font-weight: 800; color: #1e3a8a; }
  .cell-client-name { font-weight: 700; color: #111827; }

  .tag-tipo {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }
  .tag-compra { background: #dcfce7; color: #15803d; }
  .tag-pago { background: #eff6ff; color: #1d4ed8; }
  .tag-inc-tipo { background: #f1f5f9; color: #475569; }

  .tag-metodo-text {
    font-weight: 600;
    color: #475569;
  }

  .tag-status {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }
  .tag-success { background: #dcfce7; color: #166534; }
  .tag-warning { background: #fef3c7; color: #92400e; }

  .inc-text-wrapper {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .inc-title-bold {
    font-weight: 700;
    color: #0f172a;
  }

  .inc-items-ul {
    margin: 2px 0 0 16px;
    padding: 0;
    font-size: 11.5px;
    color: #334155;
  }

  /* ─────────────────────────────────────────────────────────────
     BLOQUE DE 3: INCIDENCIAS (Mercancía, Generales, Empleados)
     ───────────────────────────────────────────────────────────── */
  .incidencias-bloque-tres {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    align-items: stretch;
    gap: 14px;
    margin-top: 12px;
  }

  @media (max-width: 900px) {
    .incidencias-bloque-tres {
      grid-template-columns: 1fr;
    }
  }

  .incidencia-subbloque {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .incidencia-subbloque-header {
    background: #e2e8f0;
    border-bottom: 1px solid #cbd5e1;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .incidencia-subbloque-title {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .incidencia-badge {
    font-size: 11px;
    font-weight: 700;
    background: #ffffff;
    color: #334155;
    border: 1px solid #cbd5e1;
    padding: 2px 7px;
    border-radius: 9999px;
  }

  .incidencia-subbloque-content {
    padding: 12px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .incidencia-item-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 8px 10px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .inc-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .inc-item-time {
    font-weight: 800;
    font-size: 11px;
    color: #1e40af;
    background: #eff6ff;
    padding: 1px 6px;
    border-radius: 3px;
  }

  .inc-item-tag {
    font-size: 10px;
    font-weight: 700;
    color: #475569;
    background: #f1f5f9;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .inc-item-title-bold {
    font-weight: 700;
    color: #0f172a;
    font-size: 12px;
    line-height: 1.3;
  }

  .inc-subitems-list {
    margin: 4px 0 0 16px;
    padding: 0;
    font-size: 11px;
    color: #334155;
    line-height: 1.35;
  }

  /* ─────────────────────────────────────────────────────────────
     CLIENTES: 2 TABLITAS AGRUPADAS (Por Método y Por Jugador)
     ───────────────────────────────────────────────────────────── */
  .client-summaries-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    align-items: stretch;
    gap: 16px;
    margin-top: 16px;
  }

  @media (max-width: 900px) {
    .client-summaries-grid {
      grid-template-columns: 1fr;
    }
  }

  .summary-subtable-box {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    overflow: hidden;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .subtable-header {
    background: #f1f5f9;
    border-bottom: 1px solid #cbd5e1;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .subtable-title {
    font-size: 12px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
  }

  .compact-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }

  .compact-table thead tr {
    background: #e2e8f0;
    color: #0f172a;
  }

  .compact-table th {
    border: 1px solid #cbd5e1;
    padding: 5px 6px;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
  }

  .compact-table td {
    border: 1px solid #e2e8f0;
    padding: 5px 6px;
  }

  .font-bold {
    font-weight: 700;
  }

  .text-blue {
    color: #2563eb !important;
  }

  .text-rose {
    color: #e11d48 !important;
  }

  /* ─────────────────────────────────────────────────────────────
     OPERADORES CECOM FINAL
     ───────────────────────────────────────────────────────────── */
  .operadores-final-section {
    border-top: 2px solid #0f172a;
    margin-top: 30px;
    padding-top: 20px;
  }

  .operadores-section-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 14px 18px;
    font-size: 13px;
    margin-bottom: 16px;
  }

  /* Firmas */
  .sheet-footer-signatures {
    display: flex;
    justify-content: space-between;
    margin-top: 40px;
    padding-top: 24px;
    gap: 20px;
  }

  .signature-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .sign-line {
    width: 80%;
    height: 1px;
    background: #000000;
    margin-bottom: 6px;
  }

  .sign-title {
    font-size: 11.5px;
    font-weight: 800;
    color: #111827;
  }

  .sign-name {
    font-size: 11px;
    color: #4b5563;
  }

  .sheet-bottom-note {
    text-align: center;
    font-size: 10px;
    color: #9ca3af;
    margin-top: 28px;
  }

  /* ─────────────────────────────────────────────────────────────
     OPTIMIZACIÓN PARA IMPRESIÓN (window.print() / PDF)
     ───────────────────────────────────────────────────────────── */
  @page {
    size: auto;
    margin: 8mm 6mm;
  }

  @media print {
    /* 1. Reset Global de HTML y BODY */
    :global(html),
    :global(body) {
      background: #ffffff !important;
      padding: 0 !important;
      margin: 0 !important;
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
      width: 100% !important;
      font-size: 11px !important;
    }

    /* 2. Desenlazar contenedores raíz del layout para permitir paginación fluida */
    :global(#app),
    :global(.standalone-public-report),
    :global(.app-layout),
    :global(.main-wrapper),
    :global(.content-body),
    :global(.libro-trabajo-container),
    :global(.subvista-content-area) {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      box-shadow: none !important;
      position: static !important;
      transform: none !important;
      background: #ffffff !important;
    }

    /* 3. Ocultar todos los elementos de navegación y herramientas */
    :global(.no-print),
    :global(.sidebar),
    :global(.sidebar-container),
    :global(.sidebar-backdrop),
    :global(.top-navbar),
    :global(.navbar),
    :global(.page-header),
    :global(.top-nav-bar),
    :global(.subvistas-tabs-wrapper),
    :global(.resumen-overview-card),
    :global(.report-tools-bar),
    :global(.offline-banner),
    :global(footer),
    .no-print {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* 4. Forzar visibilidad y fidelidad cromática del documento consolidado */
    .official-sheet-container,
    .official-sheet-container * {
      visibility: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .resumen-reporte-wrapper {
      display: block !important;
      padding: 0 !important;
      margin: 0 !important;
      background: #ffffff !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      width: 100% !important;
    }

    .official-sheet-container {
      display: block !important;
      border: none !important;
      box-shadow: none !important;
      padding: 2px 4px !important;
      margin: 0 auto !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      background: #ffffff !important;
      overflow: visible !important;
    }

    /* 5. Reglas de Paginación y Saltos de Hoja */
    .sheet-header {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      margin-bottom: 12px !important;
    }

    .sub-module-section,
    .official-incidencias-block {
      display: block !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      overflow: visible !important;
      margin-bottom: 14px !important;
    }

    .sheet-official-table {
      width: 100% !important;
      border-collapse: collapse !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }

    .sheet-official-table thead {
      display: table-header-group !important;
    }

    .sheet-official-table tr {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }

    .sheet-footer-signatures {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      display: flex !important;
      flex-direction: row !important;
      justify-content: space-between !important;
      margin-top: 24px !important;
      padding-top: 10px !important;
    }

    .incidencias-bloque-tres {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 12px !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      align-items: stretch !important;
    }

    .incidencia-subbloque-content {
      max-height: none !important;
      overflow: visible !important;
    }

    .client-summaries-grid {
      display: grid !important;
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 12px !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
  }

  @media (max-width: 768px) {
    .official-sheet-container {
      padding: 16px 12px;
    }
    .sheet-header {
      flex-direction: column;
      gap: 12px;
    }
    .sheet-footer-signatures {
      flex-direction: column;
      gap: 24px;
    }
    .sign-line {
      width: 100%;
    }
  }
</style>
