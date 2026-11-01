<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { currentUserStore } from '../../controllers/auth.store.js';
  import { currentRoutePermissionsStore } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  // Subvistas del Módulo Administrativo
  const SUBVISTAS = [
    { id: 'inventario', label: 'Inventario', desc: 'Artículos, costos, categorías y existencias' },
    { id: 'ventas', label: 'Ventas y Facturación', desc: 'Facturas, cotizaciones, IVA 16% e IGTF 3%' },
    { id: 'compras', label: 'Compras y Proveedores', desc: 'Registro de proveedores y facturas de compras' },
    { id: 'cxc-cxp', label: 'Cuentas por Cobrar / Pagar', desc: 'Control de cobros, pagos y saldos' },
    { id: 'reportes-fiscales', label: 'Libros Fiscales SENIAT', desc: 'Libro de Ventas, Compras y Retenciones' }
  ];

  let activeSubvista = 'inventario';
  let tasaBcv = 62.50; // Tasa referencial oficial BCV editable

  // Sincronización con el router
  let unsubRoute;
  onMount(() => {
    unsubRoute = currentRouteStore.subscribe(val => {
      const clean = String(val || '').replace(/^#\/?/, '').replace(/^\//, '').trim();
      const parts = clean.split('/');
      if (parts[0] === 'erp' && parts[1] === 'administrativo') {
        if (parts[2] && SUBVISTAS.some(s => s.id === parts[2])) {
          activeSubvista = parts[2];
        } else {
          activeSubvista = 'inventario';
        }
      } else if (parts[0] === 'administrativo') {
        if (parts[1] && SUBVISTAS.some(s => s.id === parts[1])) {
          activeSubvista = parts[1];
        } else {
          activeSubvista = 'inventario';
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubRoute) unsubRoute();
  });

  function cambiarSubvista(id) {
    activeSubvista = id;
    navigateToRoute(`erp/administrativo/${id}`);
  }

  // --- DATOS DEMO / ESTADO V1 INVENTARIO ---
  let articulos = [
    { uuid: 'a1b2c3d4-1111-4000-8000-000000000001', codigo: 'ART-001', nombre: 'Baraja Baccarat Premium 100% Plástica', categoria: 'Insumos de Juego', unidad: 'Mazo', stock: 145, costo_usd: 4.50, precio_usd: 8.50 },
    { uuid: 'a1b2c3d4-2222-4000-8000-000000000002', codigo: 'ART-002', nombre: 'Fichas Cerámicas de Juego 1000 Pts', categoria: 'Insumos de Juego', unidad: 'Pieza', stock: 850, costo_usd: 0.80, precio_usd: 1.75 },
    { uuid: 'a1b2c3d4-3333-4000-8000-000000000003', codigo: 'ART-003', nombre: 'Rollo Térmico 80mm Impresora Fiscal', categoria: 'Papelería y Fiscal', unidad: 'Unidad', stock: 95, costo_usd: 1.10, precio_usd: 2.20 },
    { uuid: 'a1b2c3d4-4444-4000-8000-000000000004', codigo: 'ART-004', nombre: 'Bandeja Portafichas Acrílica 6 Columnas', categoria: 'Accesorios Sala', unidad: 'Unidad', stock: 18, costo_usd: 15.00, precio_usd: 28.00 },
    { uuid: 'a1b2c3d4-5555-4000-8000-000000000005', codigo: 'ART-005', nombre: 'Líquido Limpiador de Cartas y Paño 1L', categoria: 'Mantenimiento', unidad: 'Litro', stock: 12, costo_usd: 7.20, precio_usd: 14.00 }
  ];

  let filtroArticulo = '';
  $: articulosFiltrados = articulos.filter(a => 
    a.nombre.toLowerCase().includes(filtroArticulo.toLowerCase()) || 
    a.codigo.toLowerCase().includes(filtroArticulo.toLowerCase()) ||
    a.categoria.toLowerCase().includes(filtroArticulo.toLowerCase())
  );

  // Modal Nuevo Artículo
  let showModalArticulo = false;
  let nuevoArt = { codigo: '', nombre: '', categoria: 'Insumos de Juego', unidad: 'Unidad', stock: 0, costo_usd: 0, precio_usd: 0 };

  function guardarArticulo() {
    if (!nuevoArt.nombre.trim()) {
      triggerToast('El nombre del artículo es obligatorio', 'error');
      return;
    }
    const nuevoUuid = crypto.randomUUID ? crypto.randomUUID() : 'art-' + Date.now();
    articulos = [...articulos, { ...nuevoArt, uuid: nuevoUuid }];
    showModalArticulo = false;
    nuevoArt = { codigo: '', nombre: '', categoria: 'Insumos de Juego', unidad: 'Unidad', stock: 0, costo_usd: 0, precio_usd: 0 };
    triggerToast('Artículo registrado exitosamente', 'success');
  }

  // --- DATOS DEMO / ESTADO V1 FACTURACIÓN ---
  let facturas = [
    { uuid: 'f101-1111-4000-8000-000000000001', nro: 'FAC-000124', control: '00-000854', cliente: 'Inversiones Royal C.A.', rif: 'J-30495821-0', fecha: '2026-10-28', base_usd: 240.00, iva_usd: 38.40, igtf_usd: 7.20, total_usd: 285.60, pagado_divisas: true, estado: 'EMITIDA' },
    { uuid: 'f101-2222-4000-8000-000000000002', nro: 'FAC-000125', control: '00-000855', cliente: 'Operadora Gran Casino C.A.', rif: 'J-40112345-2', fecha: '2026-10-29', base_usd: 520.00, iva_usd: 83.20, igtf_usd: 0.00, total_usd: 603.20, pagado_divisas: false, estado: 'EMITIDA' },
    { uuid: 'f101-3333-4000-8000-000000000003', nro: 'FAC-000126', control: '00-000856', cliente: 'Servicios Turísticos Monagas', rif: 'J-50291823-1', fecha: '2026-10-31', base_usd: 180.00, iva_usd: 28.80, igtf_usd: 5.40, total_usd: 214.20, pagado_divisas: true, estado: 'ANULADA_NC' }
  ];

  let showModalFactura = false;
  let nuevaFac = {
    cliente: '',
    rif: '',
    monto_base_usd: 100,
    aplica_igtf: true
  };

  $: facIvaUsd = (nuevaFac.monto_base_usd || 0) * 0.16;
  $: facIgtfUsd = nuevaFac.aplica_igtf ? ((nuevaFac.monto_base_usd || 0) + facIvaUsd) * 0.03 : 0;
  $: facTotalUsd = (nuevaFac.monto_base_usd || 0) + facIvaUsd + facIgtfUsd;
  $: facTotalBs = facTotalUsd * tasaBcv;

  function emitirFactura() {
    if (!nuevaFac.cliente.trim() || !nuevaFac.rif.trim()) {
      triggerToast('Cliente y RIF son requeridos por normativa SENIAT', 'error');
      return;
    }
    const nroSiguiente = facturas.length + 125;
    const nroCtrlSiguiente = facturas.length + 855;
    const facUuid = crypto.randomUUID ? crypto.randomUUID() : 'fac-' + Date.now();

    facturas = [
      {
        uuid: facUuid,
        nro: `FAC-${String(nroSiguiente).padStart(6, '0')}`,
        control: `00-${String(nroCtrlSiguiente).padStart(6, '0')}`,
        cliente: nuevaFac.cliente,
        rif: nuevaFac.rif,
        fecha: new Date().toISOString().split('T')[0],
        base_usd: Number(nuevaFac.monto_base_usd),
        iva_usd: Number(facIvaUsd),
        igtf_usd: Number(facIgtfUsd),
        total_usd: Number(facTotalUsd),
        pagado_divisas: nuevaFac.aplica_igtf,
        estado: 'EMITIDA'
      },
      ...facturas
    ];
    showModalFactura = false;
    triggerToast('Factura Fiscal emitida con correlativo oficial SENIAT', 'success');
  }

  function anularConNotaCredito(fac) {
    if (confirm(`¿Confirma anulación fiscal de la ${fac.nro}? Por ley SENIAT no se puede eliminar, se generará Nota de Crédito correlativa.`)) {
      fac.estado = 'ANULADA_NC';
      facturas = [...facturas];
      triggerToast(`Nota de Crédito generada para la ${fac.nro}`, 'info');
    }
  }

  // --- DATOS DEMO / ESTADO V1 PROVEEDORES Y COMPRAS ---
  let proveedores = [
    { uuid: 'prv-01', nombre: 'Distribuidora Gaming Venezuela S.A.', rif: 'J-29837162-4', telefono: '0212-9854120', retencion_iva: '75%', saldo_pendiente_usd: 620.00 },
    { uuid: 'prv-02', nombre: 'Papelería e Impresos Caracas C.A.', rif: 'J-31092837-1', telefono: '0212-7629102', retencion_iva: '100%', saldo_pendiente_usd: 145.00 },
    { uuid: 'prv-03', nombre: 'Tecnología y Seguridad Biométrica C.A.', rif: 'J-40819284-9', telefono: '0414-2391029', retencion_iva: '75%', saldo_pendiente_usd: 0.00 }
  ];

  // Helper formateadores
  function fmtUsd(val) {
    return '$' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtBs(val) {
    return 'Bs. ' + Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
</script>

<div class="admin-container">
  <!-- ENCABEZADO PRINCIPAL -->
  <div class="erp-view-header">
    <div class="erp-title-box">
      <h1 class="erp-main-title">Administrativo</h1>
      <p class="erp-main-desc">Gestión integral de inventario multimoneda, facturación fiscal SENIAT, compras y cuentas corrientes.</p>
    </div>

    <!-- WIDGET TASA BCV -->
    <div class="bcv-widget">
      <span class="bcv-label">TASA OFICIAL BCV</span>
      <div class="bcv-val-row">
        <span class="bcv-currency">1 USD =</span>
        <input 
          type="number" 
          step="0.01" 
          bind:value={tasaBcv} 
          class="bcv-input" 
          title="Tasa oficial del BCV en Bolívares por Dólar"
        />
        <span class="bcv-ves">VES</span>
      </div>
    </div>
  </div>

  <!-- NAVEGACIÓN DE SUBVISTAS (TABS) -->
  <div class="tabs-nav">
    {#each SUBVISTAS as sub}
      <button 
        type="button"
        class="tab-btn {activeSubvista === sub.id ? 'active' : ''}" 
        on:click={() => cambiarSubvista(sub.id)}
      >
        <span class="tab-label">{sub.label}</span>
      </button>
    {/each}
  </div>

  <!-- CONTENIDO DE SUBVISTA: 1. INVENTARIO -->
  {#if activeSubvista === 'inventario'}
    <div class="view-content fade-in">
      <!-- KPIS -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL ARTÍCULOS</span>
            <span class="kpi-val">{articulos.length}</span>
            <span class="kpi-sub">En catálogo</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">VALOR EN EXISTENCIA (USD)</span>
            <span class="kpi-val">
              {fmtUsd(articulos.reduce((acc, a) => acc + (a.stock * a.costo_usd), 0))}
            </span>
            <span class="kpi-sub">Al costo de reposición</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">VALOR EN BOLÍVARES (BCV)</span>
            <span class="kpi-val">
              {fmtBs(articulos.reduce((acc, a) => acc + (a.stock * a.costo_usd), 0) * tasaBcv)}
            </span>
            <span class="kpi-sub">Tasa: {tasaBcv} Bs/USD</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">STOCK MÍNIMO</span>
            <span class="kpi-val">{articulos.filter(a => a.stock <= 20).length}</span>
            <span class="kpi-sub">Artículos por reponer</span>
          </div>
        </div>
      </div>

      <!-- BARRA DE ACCIÓN Y BÚSQUEDA -->
      <div class="action-bar">
        <div class="search-box">
          <input 
            type="text" 
            placeholder="Buscar por código, descripción o categoría..." 
            bind:value={filtroArticulo}
          />
        </div>
        <button class="btn-primary" on:click={() => showModalArticulo = true}>
          <span>Nuevo Artículo</span>
        </button>
      </div>

      <!-- TABLA DE ARTÍCULOS -->
      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>CÓDIGO</th>
              <th>DESCRIPCIÓN</th>
              <th>CATEGORÍA</th>
              <th>UNIDAD</th>
              <th style="text-align: right;">EXISTENCIA</th>
              <th style="text-align: right;">COSTO (USD / BS)</th>
              <th style="text-align: right;">PRECIO VENTA (USD / BS)</th>
              <th style="text-align: center;">ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {#each articulosFiltrados as item (item.uuid)}
              <tr>
                <td><span class="badge-code">{item.codigo}</span></td>
                <td><strong style="color: #0f172a;">{item.nombre}</strong></td>
                <td><span class="category-chip">{item.categoria}</span></td>
                <td>{item.unidad}</td>
                <td style="text-align: right;">
                  <span class="stock-pill {item.stock <= 20 ? 'low' : 'normal'}">
                    {item.stock}
                  </span>
                </td>
                <td style="text-align: right;">
                  <div class="dual-price">
                    <span class="usd">{fmtUsd(item.costo_usd)}</span>
                    <span class="ves">{fmtBs(item.costo_usd * tasaBcv)}</span>
                  </div>
                </td>
                <td style="text-align: right;">
                  <div class="dual-price">
                    <span class="usd green">{fmtUsd(item.precio_usd)}</span>
                    <span class="ves">{fmtBs(item.precio_usd * tasaBcv)}</span>
                  </div>
                </td>
                <td style="text-align: center;">
                  <span class="badge-status active">ACTIVO</span>
                </td>
              </tr>
            {/each}
            {#if articulosFiltrados.length === 0}
              <tr>
                <td colspan="8" class="empty-state">
                  <p>No se encontraron artículos con el criterio de búsqueda</p>
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- CONTENIDO DE SUBVISTA: 2. VENTAS Y FACTURACIÓN -->
  {#if activeSubvista === 'ventas'}
    <div class="view-content fade-in">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">FACTURAS EMITIDAS</span>
            <span class="kpi-val">{facturas.length}</span>
            <span class="kpi-sub">Total registradas</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL FACTURADO (USD)</span>
            <span class="kpi-val">
              {fmtUsd(facturas.reduce((acc, f) => f.estado === 'EMITIDA' ? acc + f.total_usd : acc, 0))}
            </span>
            <span class="kpi-sub">Neto fiscal vigente</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">IGTF 3% PERCIBIDO</span>
            <span class="kpi-val">
              {fmtUsd(facturas.reduce((acc, f) => f.estado === 'EMITIDA' ? acc + f.igtf_usd : acc, 0))}
            </span>
            <span class="kpi-sub">Pago en divisas / efectivo</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">NOTAS DE CRÉDITO</span>
            <span class="kpi-val">{facturas.filter(f => f.estado === 'ANULADA_NC').length}</span>
            <span class="kpi-sub">Anulaciones SENIAT</span>
          </div>
        </div>
      </div>

      <div class="action-bar">
        <div class="notice-fiscal">
          <span><b>Normativa SENIAT:</b> Las facturas emitidas son inmutables. Toda corrección se efectúa mediante Nota de Crédito correlativa.</span>
        </div>
        <button class="btn-primary" on:click={() => showModalFactura = true}>
          <span>Emitir Factura Fiscal</span>
        </button>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>NRO FACTURA</th>
              <th>NRO CONTROL</th>
              <th>CLIENTE / RAZÓN SOCIAL</th>
              <th>RIF</th>
              <th>FECHA</th>
              <th style="text-align: right;">BASE IMP. (USD)</th>
              <th style="text-align: right;">IVA 16%</th>
              <th style="text-align: right;">IGTF 3%</th>
              <th style="text-align: right;">TOTAL A COBRAR</th>
              <th style="text-align: center;">ESTADO</th>
              <th style="text-align: center;">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {#each facturas as fac (fac.uuid)}
              <tr class="{fac.estado === 'ANULADA_NC' ? 'row-cancelled' : ''}">
                <td><strong>{fac.nro}</strong></td>
                <td><span class="badge-code">{fac.control}</span></td>
                <td>{fac.cliente}</td>
                <td><code>{fac.rif}</code></td>
                <td>{fac.fecha}</td>
                <td style="text-align: right;">{fmtUsd(fac.base_usd)}</td>
                <td style="text-align: right;">{fmtUsd(fac.iva_usd)}</td>
                <td style="text-align: right;">
                  {#if fac.igtf_usd > 0}
                    <span style="color: #b45309; font-weight: 700;">{fmtUsd(fac.igtf_usd)}</span>
                  {:else}
                    <span style="color: #94a3b8;">N/A</span>
                  {/if}
                </td>
                <td style="text-align: right;">
                  <div class="dual-price">
                    <span class="usd green" style="font-weight: 800;">{fmtUsd(fac.total_usd)}</span>
                    <span class="ves">{fmtBs(fac.total_usd * tasaBcv)}</span>
                  </div>
                </td>
                <td style="text-align: center;">
                  {#if fac.estado === 'EMITIDA'}
                    <span class="badge-status active">EMITIDA</span>
                  {:else}
                    <span class="badge-status cancelled">ANULADA (NC)</span>
                  {/if}
                </td>
                <td style="text-align: center;">
                  {#if fac.estado === 'EMITIDA'}
                    <button 
                      class="btn-sm danger" 
                      title="Anular con Nota de Crédito SENIAT"
                      on:click={() => anularConNotaCredito(fac)}
                      style="padding: 4px 8px; font-size: 11px; font-weight: 700; border-radius: 4px; border: 1px solid #fca5a5; background: #fee2e2; color: #b91c1c; cursor: pointer;"
                    >
                      Anular NC
                    </button>
                  {:else}
                    <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">NC Aplicada</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- CONTENIDO DE SUBVISTA: 3. COMPRAS Y PROVEEDORES -->
  {#if activeSubvista === 'compras'}
    <div class="view-content fade-in">
      <div class="action-bar">
        <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Directorio de Proveedores y Cuentas por Pagar</h3>
        <button class="btn-primary" on:click={() => triggerToast('Registro de nuevo proveedor habilitado', 'info')}>
          <span>Registrar Proveedor</span>
        </button>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>RAZÓN SOCIAL</th>
              <th>RIF</th>
              <th>TELÉFONO</th>
              <th>RETENCIÓN IVA</th>
              <th style="text-align: right;">SALDO PENDIENTE (USD)</th>
              <th style="text-align: right;">SALDO EN BOLÍVARES</th>
              <th style="text-align: center;">ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {#each proveedores as prv (prv.uuid)}
              <tr>
                <td><strong>{prv.nombre}</strong></td>
                <td><code>{prv.rif}</code></td>
                <td>{prv.telefono}</td>
                <td><span class="badge-code">{prv.retencion_iva}</span></td>
                <td style="text-align: right; font-weight: 700; color: {prv.saldo_pendiente_usd > 0 ? '#b91c1c' : '#15803d'};">
                  {fmtUsd(prv.saldo_pendiente_usd)}
                </td>
                <td style="text-align: right;">
                  {fmtBs(prv.saldo_pendiente_usd * tasaBcv)}
                </td>
                <td style="text-align: center;">
                  <span class="badge-status active">ACTIVO</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- CONTENIDO DE SUBVISTA: 4. CXC / CXP -->
  {#if activeSubvista === 'cxc-cxp'}
    <div class="view-content fade-in">
      <div class="cxc-grid">
        <div class="card-padded">
          <div class="card-header-styled">
            <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 800; color: #0f172a;">Cuentas por Cobrar (Clientes)</h4>
          </div>
          <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b;">Saldos pendientes por facturación a crédito de clientes y salas aliadas.</p>
          <div class="balance-card green">
            <span class="label">TOTAL SALDO POR COBRAR</span>
            <span class="amount">$ 3,420.00 USD</span>
            <span class="amount-bs">{fmtBs(3420 * tasaBcv)}</span>
          </div>
        </div>

        <div class="card-padded">
          <div class="card-header-styled">
            <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 800; color: #0f172a;">Cuentas por Pagar (Proveedores)</h4>
          </div>
          <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b;">Compromisos de compras de insumos, servicios de mantenimiento y papelería fiscal.</p>
          <div class="balance-card red">
            <span class="label">TOTAL SALDO POR PAGAR</span>
            <span class="amount">{fmtUsd(proveedores.reduce((acc, p) => acc + p.saldo_pendiente_usd, 0))}</span>
            <span class="amount-bs">{fmtBs(proveedores.reduce((acc, p) => acc + p.saldo_pendiente_usd, 0) * tasaBcv)}</span>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- CONTENIDO DE SUBVISTA: 5. LIBROS FISCALES SENIAT -->
  {#if activeSubvista === 'reportes-fiscales'}
    <div class="view-content fade-in">
      <div class="action-bar">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Libro de Ventas Fiscal - Formato SENIAT</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Período fiscal en curso. Incluye alícuota 16%, IGTF 3% y desglose según providencia administrativa.</p>
        </div>
        <button class="btn-secondary" on:click={() => triggerToast('Generando reporte PDF del Libro de Ventas...', 'info')}>
          <span>Exportar PDF Oficial</span>
        </button>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom text-xs">
          <thead>
            <tr style="background: #f8fafc;">
              <th>OP</th>
              <th>FECHA</th>
              <th>RIF</th>
              <th>RAZÓN SOCIAL</th>
              <th>NRO FACT</th>
              <th>NRO CTRL</th>
              <th>TOTAL VENTAS BS</th>
              <th>BASE IMPONIBLE BS</th>
              <th>IVA 16% BS</th>
              <th>IGTF 3% BS</th>
            </tr>
          </thead>
          <tbody>
            {#each facturas as fac, i}
              <tr>
                <td>{i + 1}</td>
                <td>{fac.fecha}</td>
                <td><code>{fac.rif}</code></td>
                <td>{fac.cliente}</td>
                <td><strong>{fac.nro}</strong></td>
                <td>{fac.control}</td>
                <td style="text-align: right; font-weight: 700;">{fmtBs(fac.total_usd * tasaBcv)}</td>
                <td style="text-align: right;">{fmtBs(fac.base_usd * tasaBcv)}</td>
                <td style="text-align: right;">{fmtBs(fac.iva_usd * tasaBcv)}</td>
                <td style="text-align: right;">{fmtBs(fac.igtf_usd * tasaBcv)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<!-- MODAL NUEVO ARTÍCULO -->
{#if showModalArticulo}
  <div class="modal-backdrop fade-in" on:click={() => showModalArticulo = false} role="presentation">
    <div class="modal-card" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <h3>Registrar Nuevo Artículo</h3>
        <button class="btn-close" on:click={() => showModalArticulo = false}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label for="f-art-cod">Código / SKU</label>
            <input id="f-art-cod" type="text" bind:value={nuevoArt.codigo} placeholder="Ej: ART-006" />
          </div>
          <div class="form-group">
            <label for="f-art-cat">Categoría</label>
            <select id="f-art-cat" bind:value={nuevoArt.categoria}>
              <option value="Insumos de Juego">Insumos de Juego</option>
              <option value="Papelería y Fiscal">Papelería y Fiscal</option>
              <option value="Accesorios Sala">Accesorios Sala</option>
              <option value="Mantenimiento">Mantenimiento</option>
            </select>
          </div>
          <div class="form-group col-span-2">
            <label for="f-art-nom">Descripción del Artículo *</label>
            <input id="f-art-nom" type="text" bind:value={nuevoArt.nombre} placeholder="Nombre completo del producto o servicio" />
          </div>
          <div class="form-group">
            <label for="f-art-cost">Costo Unitario ($ USD)</label>
            <input id="f-art-cost" type="number" step="0.01" bind:value={nuevoArt.costo_usd} />
          </div>
          <div class="form-group">
            <label for="f-art-prc">Precio Venta ($ USD)</label>
            <input id="f-art-prc" type="number" step="0.01" bind:value={nuevoArt.precio_usd} />
          </div>
          <div class="form-group">
            <label for="f-art-stk">Existencia Inicial</label>
            <input id="f-art-stk" type="number" bind:value={nuevoArt.stock} />
          </div>
          <div class="form-group">
            <label for="f-art-und">Unidad de Medida</label>
            <input id="f-art-und" type="text" bind:value={nuevoArt.unidad} placeholder="Unidad, Mazo, Rollo, etc." />
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => showModalArticulo = false}>Cancelar</button>
        <button class="btn-primary" on:click={guardarArticulo}>Guardar Artículo</button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL EMITIR FACTURA FISCAL -->
{#if showModalFactura}
  <div class="modal-backdrop fade-in" on:click={() => showModalFactura = false} role="presentation">
    <div class="modal-card" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <h3>Emitir Factura Fiscal SENIAT</h3>
        <button class="btn-close" on:click={() => showModalFactura = false}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group col-span-2">
            <label for="f-fac-cli">Cliente / Razón Social *</label>
            <input id="f-fac-cli" type="text" bind:value={nuevaFac.cliente} placeholder="Nombre o Razón Social registrada" />
          </div>
          <div class="form-group">
            <label for="f-fac-rif">RIF del Cliente *</label>
            <input id="f-fac-rif" type="text" bind:value={nuevaFac.rif} placeholder="Ej: J-30495821-0" />
          </div>
          <div class="form-group">
            <label for="f-fac-base">Monto Base Imponible ($ USD)</label>
            <input id="f-fac-base" type="number" step="0.01" bind:value={nuevaFac.monto_base_usd} />
          </div>
          <div class="form-group col-span-2">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={nuevaFac.aplica_igtf} />
              <span><b>Aplica IGTF 3%:</b> Pago efectuado en divisas o moneda extranjera (Art. Ley IGTF)</span>
            </label>
          </div>
        </div>

        <!-- RESUMEN EN VIVO DE CÁLCULO SENIAT -->
        <div class="fiscal-calc-summary">
          <div class="calc-row">
            <span>Base Imponible:</span>
            <span>{fmtUsd(nuevaFac.monto_base_usd)}</span>
          </div>
          <div class="calc-row">
            <span>IVA General (16%):</span>
            <span>{fmtUsd(facIvaUsd)}</span>
          </div>
          {#if nuevaFac.aplica_igtf}
            <div class="calc-row text-amber">
              <span>Perc. IGTF (3% s/ Total Divisas):</span>
              <span>{fmtUsd(facIgtfUsd)}</span>
            </div>
          {/if}
          <div class="calc-row total">
            <span>TOTAL A PAGAR (USD):</span>
            <span class="total-val">{fmtUsd(facTotalUsd)}</span>
          </div>
          <div class="calc-row ves-equiv">
            <span>Equivalente BCV ({tasaBcv} Bs/USD):</span>
            <span>{fmtBs(facTotalBs)}</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => showModalFactura = false}>Cancelar</button>
        <button class="btn-primary" on:click={emitirFactura}>Emitir y Registrar Factura</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .admin-container {
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .erp-view-header {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 18px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    flex-wrap: wrap;
    gap: 16px;
  }

  .erp-title-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .erp-main-title {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    line-height: 1.2;
  }

  .erp-main-desc {
    font-size: 13.5px;
    color: #64748b;
    margin: 0;
    line-height: 1.4;
  }

  .bcv-widget {
    background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    border: 1px solid #86efac;
    border-radius: 10px;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }

  .bcv-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .bcv-label {
    font-size: 11px;
    font-weight: 800;
    color: #166534;
    letter-spacing: 0.5px;
  }

  .bcv-val-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 700;
    color: #14532d;
  }

  .bcv-input {
    width: 80px;
    padding: 3px 6px;
    font-weight: 800;
    border-radius: 6px;
    border: 1px solid #86efac;
    text-align: right;
    background: #ffffff;
    color: #0f172a;
  }

  /* TABS NAVIGATION */
  .tabs-nav {
    display: flex;
    gap: 8px;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 2px;
    overflow-x: auto;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-radius: 8px 8px 0 0;
    border: none;
    background: transparent;
    color: #64748b;
    font-weight: 600;
    font-size: 13.5px;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
    border-bottom: 3px solid transparent;
  }

  .tab-btn:hover {
    color: #2563eb;
    background: #f8fafc;
  }

  .tab-btn.active {
    color: #2563eb;
    background: #ffffff;
    border-bottom: 3px solid #2563eb;
    font-weight: 700;
  }

  .tab-icon {
    font-size: 18px;
  }

  /* KPIS */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }

  .kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 18px;
    display: flex;
    align-items: center;
    gap: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .kpi-icon {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .kpi-icon.blue { background: #eff6ff; color: #2563eb; }
  .kpi-icon.green { background: #f0fdf4; color: #16a34a; }
  .kpi-icon.purple { background: #faf5ff; color: #9333ea; }
  .kpi-icon.amber { background: #fffbeb; color: #d97706; }
  .kpi-icon.red { background: #fef2f2; color: #dc2626; }

  .kpi-info {
    display: flex;
    flex-direction: column;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.5px;
  }

  .kpi-val {
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.3;
  }

  .kpi-sub {
    font-size: 11.5px;
    color: #94a3b8;
  }

  /* ACTION BAR */
  .action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 14px;
    flex: 1;
    max-width: 480px;
  }

  .search-box input {
    border: none;
    outline: none;
    width: 100%;
    font-size: 13.5px;
  }

  .notice-fiscal {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 12.5px;
    color: #1e40af;
  }

  .btn-primary {
    background: #2563eb;
    color: #ffffff;
    border: none;
    padding: 10px 18px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 13.5px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37,99,235,0.25);
    transition: background 0.2s;
  }

  .btn-primary:hover { background: #1d4ed8; }

  .btn-secondary {
    background: #ffffff;
    color: #475569;
    border: 1px solid #cbd5e1;
    padding: 9px 16px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .btn-secondary:hover { background: #f8fafc; }

  /* TABLAS Y TARJETAS */
  .card-flow {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    overflow: hidden;
  }

  .card-padded, .p-4 {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }

  .table-responsive {
    overflow-x: auto;
    width: 100%;
  }

  .table-custom {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .table-custom th {
    background: #f8fafc;
    color: #475569;
    font-weight: 700;
    font-size: 11.5px;
    letter-spacing: 0.5px;
    padding: 12px 16px;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
    white-space: nowrap;
  }

  .table-custom td {
    padding: 12px 16px;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
    vertical-align: middle;
  }

  .table-custom tr:hover td {
    background: #f8fafc;
  }

  .badge-code {
    background: #f1f5f9;
    color: #475569;
    font-family: monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 6px;
    border-radius: 4px;
  }

  .category-chip {
    background: #f3f4f6;
    color: #374151;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11.5px;
    font-weight: 600;
  }

  .stock-pill {
    padding: 4px 10px;
    border-radius: 12px;
    font-weight: 800;
    font-size: 12px;
  }
  .stock-pill.normal { background: #ecfdf5; color: #047857; }
  .stock-pill.low { background: #fef2f2; color: #b91c1c; }

  .dual-price {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.25;
  }

  .dual-price .usd {
    font-weight: 700;
    color: #0f172a;
  }
  .dual-price .usd.green { color: #15803d; }

  .dual-price .ves {
    font-size: 11px;
    color: #64748b;
  }

  .badge-status {
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 10.5px;
    font-weight: 800;
  }
  .badge-status.active { background: #dcfce7; color: #15803d; }
  .badge-status.cancelled { background: #fee2e2; color: #991b1b; }

  .row-cancelled td {
    background: #fff5f5 !important;
    opacity: 0.75;
  }

  .btn-icon {
    background: transparent;
    border: none;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .btn-icon.danger { color: #dc2626; }
  .btn-icon.danger:hover { background: #fee2e2; }

  /* MODALES */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(3px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 14px;
    width: 100%;
    max-width: 540px;
    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);
    overflow: hidden;
  }

  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  .btn-close {
    background: transparent;
    border: none;
    font-size: 24px;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
  }

  .modal-body {
    padding: 20px;
  }

  .modal-footer {
    padding: 14px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group.col-span-2 {
    grid-column: span 2;
  }

  .form-group label {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
  }

  .form-group input, .form-group select {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13.5px;
    outline: none;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: #334155;
    cursor: pointer;
  }

  .fiscal-calc-summary {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px;
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
  }

  .calc-row {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    color: #475569;
  }

  .calc-row.text-amber { color: #b45309; }

  .calc-row.total {
    border-top: 1px dashed #cbd5e1;
    padding-top: 8px;
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
  }

  .total-val { color: #16a34a; }

  .calc-row.ves-equiv {
    font-size: 12px;
    color: #64748b;
  }

  .cxc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 20px;
  }

  .card-header-styled {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .card-header-styled h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  .balance-card {
    border-radius: 10px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .balance-card.green { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .balance-card.red { background: #fef2f2; border: 1px solid #fecaca; }

  .balance-card .label { font-size: 11px; font-weight: 800; color: #64748b; }
  .balance-card .amount { font-size: 26px; font-weight: 900; color: #0f172a; }
  .balance-card .amount-bs { font-size: 13px; font-weight: 700; color: #475569; }

  .fade-in {
    animation: fadeIn 0.2s ease-in-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
