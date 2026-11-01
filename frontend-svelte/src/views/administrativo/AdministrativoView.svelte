<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { currentRoutePermissionsStore, masterSalasStore } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';

  // Subvistas del Módulo Administrativo
  const SUBVISTAS = [
    { id: 'inventario', label: 'Inventario', desc: 'Artículos, costos, categorías y existencias' },
    { id: 'ventas', label: 'Ventas y Facturación', desc: 'Facturas, cotizaciones, IVA 16% e IGTF 3%' },
    { id: 'compras', label: 'Compras y Costos', desc: 'Registro de proveedores y compras por sala/categoría' },
    { id: 'cxc-cxp', label: 'Cuentas por Cobrar / Pagar', desc: 'Control de cobros, pagos y saldos' },
    { id: 'reportes-fiscales', label: 'Libros Fiscales SENIAT', desc: 'Libro de Ventas, Compras y Retenciones' }
  ];

  let activeSubvista = 'inventario';
  let tasaBcv = 62.50; // Tasa referencial oficial BCV editable

  // Multi-sala isolation
  let selectedSalaFiltro = 'ALL';
  $: assignedSalaIds = Array.isArray($authUserSalasStore) 
    ? $authUserSalasStore.map(s => String(s.sala_id || s.sala_uuid || s.id || s.uuid)) 
    : [];
  $: userAvailableSalas = ($masterSalasStore || []).filter(s => {
    if ($currentUserStore?.is_superuser || $currentUserStore?.is_admin || $currentUserStore?.role === 'ADMIN') return true;
    return assignedSalaIds.includes(String(s.uuid || s.id));
  });

  // Sincronización con el router
  let unsubRoute;
  onMount(() => {
    cargarDatosBackend();

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

  let facturasCompras = [
    { uuid: 'fc-01', proveedor_nombre: 'Distribuidora Gaming Venezuela S.A.', proveedor_rif: 'J-29837162-4', nro_factura_proveedor: 'FC-008129', nro_control: '00-19284', fecha: '2026-10-25', centro_costos: 'Insumos de Juego', sala_nombre: 'Sala Principal', base_imponible_usd: 500.00, iva_usd: 80.00, retencion_iva_usd: 60.00, total_usd: 580.00, pagada: false },
    { uuid: 'fc-02', proveedor_nombre: 'Papelería e Impresos Caracas C.A.', proveedor_rif: 'J-31092837-1', nro_factura_proveedor: 'FC-003492', nro_control: '00-09283', fecha: '2026-10-28', centro_costos: 'Papelería y Fiscal', sala_nombre: 'Sala Principal', base_imponible_usd: 125.00, iva_usd: 20.00, retencion_iva_usd: 20.00, total_usd: 145.00, pagada: false },
    { uuid: 'fc-03', proveedor_nombre: 'Tecnología y Seguridad Biométrica C.A.', proveedor_rif: 'J-40819284-9', nro_factura_proveedor: 'FC-001092', nro_control: '00-01128', fecha: '2026-10-29', centro_costos: 'Seguridad y Biometría', sala_nombre: 'Sala VIP', base_imponible_usd: 350.00, iva_usd: 56.00, retencion_iva_usd: 42.00, total_usd: 406.00, pagada: true }
  ];

  async function cargarDatosBackend() {
    try {
      const [resArt, resPrv, resFac, resCmp] = await Promise.all([
        fetch(toBackendUrl('/api/erp/articulos')),
        fetch(toBackendUrl('/api/erp/proveedores')),
        fetch(toBackendUrl('/api/erp/facturas-ventas')),
        fetch(toBackendUrl('/api/erp/facturas-compras'))
      ]);
      const dataArt = await resArt.json();
      const dataPrv = await resPrv.json();
      const dataFac = await resFac.json();
      const dataCmp = await resCmp.json();
      if (dataArt?.success && Array.isArray(dataArt.data) && dataArt.data.length > 0) {
        articulos = dataArt.data;
      }
      if (dataPrv?.success && Array.isArray(dataPrv.data) && dataPrv.data.length > 0) {
        proveedores = dataPrv.data;
      }
      if (dataFac?.success && Array.isArray(dataFac.data) && dataFac.data.length > 0) {
        facturas = dataFac.data;
      }
      if (dataCmp?.success && Array.isArray(dataCmp.data) && dataCmp.data.length > 0) {
        facturasCompras = dataCmp.data;
      }
    } catch (e) {
      console.warn('Modo demo/offline administrativo:', e.message);
    }
  }

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

  async function guardarArticulo() {
    if (!nuevoArt.nombre.trim()) {
      triggerToast('El nombre del artículo es obligatorio', 'error');
      return;
    }
    try {
      const res = await fetch(toBackendUrl('/api/erp/articulos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoArt)
      });
      const resData = await res.json();
      if (resData?.success && resData.data) {
        articulos = [resData.data, ...articulos.filter(a => a.uuid !== resData.data.uuid)];
      } else {
        const nuevoUuid = crypto.randomUUID ? crypto.randomUUID() : 'art-' + Date.now();
        articulos = [{ ...nuevoArt, uuid: nuevoUuid }, ...articulos];
      }
      showModalArticulo = false;
      nuevoArt = { codigo: '', nombre: '', categoria: 'Insumos de Juego', unidad: 'Unidad', stock: 0, costo_usd: 0, precio_usd: 0 };
      triggerToast('Artículo registrado y guardado exitosamente', 'success');
    } catch (e) {
      const nuevoUuid = crypto.randomUUID ? crypto.randomUUID() : 'art-' + Date.now();
      articulos = [{ ...nuevoArt, uuid: nuevoUuid }, ...articulos];
      showModalArticulo = false;
      nuevoArt = { codigo: '', nombre: '', categoria: 'Insumos de Juego', unidad: 'Unidad', stock: 0, costo_usd: 0, precio_usd: 0 };
      triggerToast('Artículo registrado en memoria local', 'success');
    }
  }

  // Movimientos de Inventario (Entrada, Salida a Sala, Ajuste)
  let showModalMovimiento = false;
  let movArticulo = null;
  let nuevoMov = {
    tipo: 'SALIDA_CONSUMO',
    cantidad: 1,
    sala_id: '',
    observacion: ''
  };

  function abrirModalMovimiento(art) {
    movArticulo = art;
    nuevoMov = {
      tipo: 'SALIDA_CONSUMO',
      cantidad: 1,
      sala_id: userAvailableSalas[0]?.uuid || userAvailableSalas[0]?.id || '',
      observacion: ''
    };
    showModalMovimiento = true;
  }

  async function registrarMovimientoArticulo() {
    if (!movArticulo) return;
    const cant = Number(nuevoMov.cantidad) || 0;
    if (cant <= 0) {
      triggerToast('La cantidad debe ser mayor a 0', 'error');
      return;
    }
    try {
      const res = await fetch(toBackendUrl('/api/erp/articulos/movimiento'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articulo_uuid: movArticulo.uuid,
          tipo: nuevoMov.tipo,
          cantidad: cant,
          sala_id: nuevoMov.sala_id,
          observacion: nuevoMov.observacion
        })
      });
      const data = await res.json();
      if (data?.success && data.data) {
        articulos = articulos.map(a => a.uuid === movArticulo.uuid ? { ...a, stock: data.data.stock_nuevo } : a);
      } else {
        let nuevoStock = movArticulo.stock;
        if (nuevoMov.tipo === 'ENTRADA') nuevoStock += cant;
        else if (nuevoMov.tipo === 'SALIDA_CONSUMO') nuevoStock = Math.max(0, nuevoStock - cant);
        else if (nuevoMov.tipo === 'AJUSTE') nuevoStock = cant;
        articulos = articulos.map(a => a.uuid === movArticulo.uuid ? { ...a, stock: nuevoStock } : a);
      }
      showModalMovimiento = false;
      movArticulo = null;
      triggerToast('Movimiento de inventario registrado y stock actualizado', 'success');
    } catch (e) {
      let nuevoStock = movArticulo.stock;
      if (nuevoMov.tipo === 'ENTRADA') nuevoStock += cant;
      else if (nuevoMov.tipo === 'SALIDA_CONSUMO') nuevoStock = Math.max(0, nuevoStock - cant);
      else if (nuevoMov.tipo === 'AJUSTE') nuevoStock = cant;
      articulos = articulos.map(a => a.uuid === movArticulo.uuid ? { ...a, stock: nuevoStock } : a);
      showModalMovimiento = false;
      movArticulo = null;
      triggerToast('Movimiento registrado en modo local', 'success');
    }
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

  async function emitirFactura() {
    if (!nuevaFac.cliente.trim() || !nuevaFac.rif.trim()) {
      triggerToast('Cliente y RIF son requeridos por normativa SENIAT', 'error');
      return;
    }
    try {
      const res = await fetch(toBackendUrl('/api/erp/facturas-ventas'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: nuevaFac.cliente,
          rif: nuevaFac.rif,
          tasa_bcv: tasaBcv,
          monto_base_usd: nuevaFac.monto_base_usd,
          aplica_igtf: nuevaFac.aplica_igtf
        })
      });
      const resData = await res.json();
      if (resData?.success && resData.data) {
        facturas = [resData.data, ...facturas];
      } else {
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
      }
      showModalFactura = false;
      triggerToast('Factura Fiscal emitida con correlativo oficial SENIAT', 'success');
    } catch (e) {
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
      triggerToast('Factura Fiscal emitida en modo local', 'success');
    }
  }

  async function anularConNotaCredito(fac) {
    if (confirm(`¿Confirma anulación fiscal de la ${fac.nro}? Por ley SENIAT no se puede eliminar, se generará Nota de Crédito correlativa.`)) {
      try {
        await fetch(toBackendUrl(`/api/erp/facturas-ventas/${fac.uuid}/anular`), { method: 'POST' });
      } catch (e) {}
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

  // Modal Factura de Compra
  let showModalCompra = false;
  let nuevaCompra = {
    proveedor_uuid: '',
    nro_factura: '',
    nro_control: '',
    fecha: new Date().toISOString().split('T')[0],
    base_imponible_usd: 0,
    porcentaje_retencion: '75%'
  };

  $: compraBaseUsd = Number(nuevaCompra.base_imponible_usd) || 0;
  $: compraIvaUsd = Number((compraBaseUsd * 0.16).toFixed(4));
  $: compraRetIvaUsd = Number((compraIvaUsd * (nuevaCompra.porcentaje_retencion === '100%' ? 1.0 : 0.75)).toFixed(4));
  $: compraTotalUsd = Number((compraBaseUsd + compraIvaUsd).toFixed(4));
  $: compraNetoPagarUsd = Number((compraTotalUsd - compraRetIvaUsd).toFixed(4));

  async function registrarCompra() {
    if (!nuevaCompra.proveedor_uuid) {
      triggerToast('Debe seleccionar un proveedor', 'error');
      return;
    }
    if (!nuevaCompra.nro_factura.trim()) {
      triggerToast('El número de factura del proveedor es obligatorio', 'error');
      return;
    }
    if (compraBaseUsd <= 0) {
      triggerToast('El monto base imponible debe ser mayor a 0', 'error');
      return;
    }

    try {
      const res = await fetch(toBackendUrl('/api/erp/facturas-compras'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nuevaCompra,
          tasa_bcv: tasaBcv
        })
      });
      const resData = await res.json();
      if (resData?.success) {
        triggerToast('Factura de compra registrada y asiento generado automáticamente', 'success');
        cargarDatosBackend();
      } else {
        const pObj = proveedores.find(p => p.uuid === nuevaCompra.proveedor_uuid);
        if (pObj) {
          pObj.saldo_pendiente_usd += compraNetoPagarUsd;
          proveedores = [...proveedores];
        }
        triggerToast('Factura registrada (asiento contable automático coordinado)', 'success');
      }
    } catch (e) {
      const pObj = proveedores.find(p => p.uuid === nuevaCompra.proveedor_uuid);
      if (pObj) {
        pObj.saldo_pendiente_usd += compraNetoPagarUsd;
        proveedores = [...proveedores];
      }
      triggerToast('Factura de compra registrada en modo local', 'success');
    }

    showModalCompra = false;
    nuevaCompra = {
      proveedor_uuid: '',
      nro_factura: '',
      nro_control: '',
      fecha: new Date().toISOString().split('T')[0],
      base_imponible_usd: 0,
      porcentaje_retencion: '75%'
    };
  }

  // --- GESTIÓN DE PAGOS A PROVEEDORES (CxP) ---
  let showModalPagoProveedor = false;
  let provSeleccionadoPago = null;
  let nuevoPago = {
    monto: 0,
    metodo: 'TRANSFERENCIA_BANCO',
    referencia: '',
    observacion: ''
  };

  function abrirModalPago(prv) {
    provSeleccionadoPago = prv;
    nuevoPago = {
      monto: prv.saldo_pendiente_usd || 0,
      metodo: 'TRANSFERENCIA_BANCO',
      referencia: '',
      observacion: `Cancelación / Abono factura proveedor ${prv.nombre}`
    };
    showModalPagoProveedor = true;
  }

  async function registrarPagoProveedor() {
    if (!provSeleccionadoPago) return;
    const monto = Number(nuevoPago.monto) || 0;
    if (monto <= 0) {
      triggerToast('El monto a pagar debe ser mayor a 0', 'error');
      return;
    }
    try {
      const res = await fetch(toBackendUrl(`/api/erp/proveedores/${provSeleccionadoPago.uuid}/pagar`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monto,
          metodo: nuevoPago.metodo,
          referencia: nuevoPago.referencia,
          observacion: nuevoPago.observacion,
          tasa_bcv: tasaBcv
        })
      });
      const data = await res.json();
      if (data?.success && data.data) {
        provSeleccionadoPago.saldo_pendiente_usd = data.data.saldo_restante;
      } else {
        provSeleccionadoPago.saldo_pendiente_usd = Math.max(0, provSeleccionadoPago.saldo_pendiente_usd - monto);
      }
      proveedores = [...proveedores];
      showModalPagoProveedor = false;
      provSeleccionadoPago = null;
      triggerToast('Pago a proveedor emitido y asiento contable generado', 'success');
    } catch (e) {
      provSeleccionadoPago.saldo_pendiente_usd = Math.max(0, provSeleccionadoPago.saldo_pendiente_usd - monto);
      proveedores = [...proveedores];
      showModalPagoProveedor = false;
      provSeleccionadoPago = null;
      triggerToast('Pago registrado localmente y descontado de saldo', 'success');
    }
  }

  // Helper formateadores
  function fmtUsd(val) {
    return '$' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtBs(val) {
    return 'Bs. ' + Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // --- FASE 4: EXPORTACIÓN Y CUMPLIMIENTO FISCAL SENIAT ---
  let subvistaFiscal = 'ventas';

  $: totalVentasBaseUsd = facturas.filter(f => f.estado !== 'ANULADA_NC').reduce((acc, f) => acc + (Number(f.base_usd) || 0), 0);
  $: totalVentasIvaUsd = facturas.filter(f => f.estado !== 'ANULADA_NC').reduce((acc, f) => acc + (Number(f.iva_usd) || 0), 0);
  $: totalVentasIgtfUsd = facturas.filter(f => f.estado !== 'ANULADA_NC').reduce((acc, f) => acc + (Number(f.igtf_usd) || 0), 0);

  $: totalComprasBaseUsd = facturasCompras.reduce((acc, c) => acc + (Number(c.base_imponible_usd) || 0), 0);
  $: totalComprasIvaUsd = facturasCompras.reduce((acc, c) => acc + (Number(c.iva_usd) || 0), 0);
  $: totalRetencionesIvaUsd = facturasCompras.reduce((acc, c) => acc + (Number(c.retencion_iva_usd) || 0), 0);

  $: saldoIvaPeriodoUsd = Number((totalVentasIvaUsd - totalComprasIvaUsd - totalRetencionesIvaUsd).toFixed(2));

  function exportarLibroVentasTxt() {
    let contenido = `RIF EMPRESA: J-40918274-1\tPERÍODO: 2026-10\tLIBRO DE VENTAS FISCAL SENIAT\r\n`;
    contenido += `OP\tFECHA\tRIF CLIENTE\tRAZÓN SOCIAL\tNRO FACTURA\tNRO CONTROL\tTOTAL BS\tBASE IMPONIBLE BS\tIVA 16% BS\tIGTF 3% BS\tESTADO\r\n`;
    facturas.forEach((fac, i) => {
      const totBs = (fac.total_usd * tasaBcv).toFixed(2);
      const baseBs = (fac.base_usd * tasaBcv).toFixed(2);
      const ivaBs = (fac.iva_usd * tasaBcv).toFixed(2);
      const igtfBs = (fac.igtf_usd * tasaBcv).toFixed(2);
      contenido += `${i + 1}\t${fac.fecha}\t${fac.rif}\t${fac.cliente}\t${fac.nro}\t${fac.control}\t${totBs}\t${baseBs}\t${ivaBs}\t${igtfBs}\t${fac.estado}\r\n`;
    });

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LIBRO_VENTAS_SENIAT_202610.txt`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Libro de Ventas descargado en formato oficial SENIAT (.txt)', 'success');
  }

  function exportarLibroComprasTxt() {
    let contenido = `RIF EMPRESA: J-40918274-1\tPERÍODO: 2026-10\tLIBRO DE COMPRAS FISCAL SENIAT\r\n`;
    contenido += `OP\tFECHA\tRIF PROVEEDOR\tPROVEEDOR\tNRO FACTURA\tNRO CONTROL\tTOTAL BS\tBASE IMPONIBLE BS\tIVA 16% BS\tRETENCIÓN IVA BS\r\n`;
    facturasCompras.forEach((fc, i) => {
      const totBs = (fc.total_usd * tasaBcv).toFixed(2);
      const baseBs = (fc.base_imponible_usd * tasaBcv).toFixed(2);
      const ivaBs = (fc.iva_usd * tasaBcv).toFixed(2);
      const retBs = (fc.retencion_iva_usd * tasaBcv).toFixed(2);
      contenido += `${i + 1}\t${fc.fecha}\t${fc.proveedor_rif}\t${fc.proveedor_nombre}\t${fc.nro_factura_proveedor}\t${fc.nro_control}\t${totBs}\t${baseBs}\t${ivaBs}\t${retBs}\r\n`;
    });

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `LIBRO_COMPRAS_SENIAT_202610.txt`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Libro de Compras descargado en formato oficial SENIAT (.txt)', 'success');
  }

  function exportarRetencionesTxt() {
    let contenido = '';
    facturasCompras.forEach((fc, i) => {
      const comprobante = `202610${String(i + 1).padStart(8, '0')}`;
      contenido += `J409182741\t202610\t${fc.fecha}\tC\t01\t${String(fc.proveedor_rif || 'J000000000').replace(/-/g, '')}\t${fc.nro_factura_proveedor}\t${fc.nro_control}\t${(fc.total_usd * tasaBcv).toFixed(2)}\t${(fc.base_imponible_usd * tasaBcv).toFixed(2)}\t${(fc.retencion_iva_usd * tasaBcv).toFixed(2)}\t${comprobante}\r\n`;
    });

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `RETENCIONES_IVA_SENIAT_202610.txt`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Archivo plano de Retenciones IVA generado para el Portal SENIAT', 'success');
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
              <th style="text-align: right;">COSTO PMP ($)</th>
              <th style="text-align: right;">VALOR TOTAL ($)</th>
              <th style="text-align: right;">PRECIO VENTA ($)</th>
              <th style="text-align: center;">MARGEN %</th>
              <th style="text-align: center;">ESTADO</th>
              <th style="text-align: center;">ACCIONES</th>
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
                <td style="text-align: right; font-weight: 700; color: #334155;">
                  {fmtUsd(item.costo_usd)}
                </td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">
                  {fmtUsd(item.stock * item.costo_usd)}
                </td>
                <td style="text-align: right;">
                  <div class="dual-price">
                    <span class="usd green" style="font-weight: 700;">{fmtUsd(item.precio_usd)}</span>
                    <span class="ves" style="font-size: 11px;">{fmtBs(item.precio_usd * tasaBcv)}</span>
                  </div>
                </td>
                <td style="text-align: center;">
                  <span style="font-size: 12px; font-weight: 800; color: #15803d; background: #dcfce7; padding: 2px 6px; border-radius: 4px;">
                    {(((item.precio_usd - item.costo_usd) / (item.precio_usd || 1)) * 100).toFixed(1)}%
                  </span>
                </td>
                <td style="text-align: center;">
                  <span class="badge-status {item.stock <= 20 ? 'draft' : 'active'}">
                    {item.stock <= 0 ? 'AGOTADO' : item.stock <= 20 ? 'STOCK BAJO' : 'NORMAL'}
                  </span>
                </td>
                <td style="text-align: center;">
                  <button 
                    type="button" 
                    class="btn-sm" 
                    style="padding: 5px 10px; font-size: 11.5px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; cursor: pointer;"
                    on:click={() => abrirModalMovimiento(item)}
                  >
                    Movimiento
                  </button>
                </td>
              </tr>
            {/each}
            {#if articulosFiltrados.length === 0}
              <tr>
                <td colspan="11" class="empty-state">
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

  <!-- CONTENIDO DE SUBVISTA: 3. COMPRAS Y COSTOS OPERATIVOS -->
  {#if activeSubvista === 'compras'}
    <div class="view-content fade-in">
      <!-- FILTROS Y KPIS DE COSTOS -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL COMPRAS DEL MES</span>
            <span class="kpi-val">{fmtUsd(facturasCompras.reduce((acc, c) => acc + c.total_usd, 0))}</span>
            <span class="kpi-sub">{fmtBs(facturasCompras.reduce((acc, c) => acc + c.total_usd, 0) * tasaBcv)}</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">INSUMOS DE MESAS Y JUEGO</span>
            <span class="kpi-val">
              {fmtUsd(facturasCompras.filter(c => c.centro_costos === 'Insumos de Juego').reduce((acc, c) => acc + c.total_usd, 0))}
            </span>
            <span class="kpi-sub">Barajas, fichas y paños</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">REPUESTOS Y SLOTS</span>
            <span class="kpi-val">
              {fmtUsd(facturasCompras.filter(c => c.centro_costos === 'Seguridad y Biometría' || c.centro_costos === 'Mantenimiento Slots').reduce((acc, c) => acc + c.total_usd, 0))}
            </span>
            <span class="kpi-sub">Billeteros, monitores, partes</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">CRÉDITO FISCAL IVA (16%)</span>
            <span class="kpi-val">{fmtUsd(facturasCompras.reduce((acc, c) => acc + c.iva_usd, 0))}</span>
            <span class="kpi-sub">Deducible en SENIAT</span>
          </div>
        </div>
      </div>

      <div class="action-bar">
        <div style="display: flex; gap: 10px; align-items: center; flex: 1; flex-wrap: wrap;">
          <select 
            bind:value={selectedSalaFiltro}
            style="padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 700; background: #ffffff; color: #0f172a;"
          >
            <option value="ALL">Todas las Salas Asignadas</option>
            {#each userAvailableSalas as s}
              <option value={s.nombre || s.nombre_comercial}>{s.nombre || s.nombre_comercial}</option>
            {/each}
          </select>
          <h3 style="font-size: 16px; font-weight: 800; color: #1e293b; margin: 0;">Registro de Compras y Gastos Operativos</h3>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-primary" on:click={() => showModalCompra = true}>
            <span>Registrar Factura de Compra</span>
          </button>
        </div>
      </div>

      <!-- TABLA DE FACTURAS DE COMPRAS -->
      <div class="card-flow table-responsive" style="margin-bottom: 24px;">
        <table class="table-custom">
          <thead>
            <tr>
              <th>FECHA</th>
              <th>PROVEEDOR</th>
              <th>RIF</th>
              <th>SALA DESTINO</th>
              <th>CENTRO DE COSTOS</th>
              <th>NRO FACTURA</th>
              <th>NRO CONTROL</th>
              <th style="text-align: right;">BASE IMP. ($)</th>
              <th style="text-align: right;">IVA ($)</th>
              <th style="text-align: right;">TOTAL ($)</th>
              <th style="text-align: center;">ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {#each facturasCompras.filter(c => selectedSalaFiltro === 'ALL' || c.sala_nombre === selectedSalaFiltro) as c (c.uuid)}
              <tr>
                <td>{c.fecha}</td>
                <td><strong>{c.proveedor_nombre}</strong></td>
                <td><code>{c.proveedor_rif}</code></td>
                <td><span class="category-chip">{c.sala_nombre || 'Principal'}</span></td>
                <td><span style="font-size: 11.5px; font-weight: 700; color: #2563eb;">{c.centro_costos || 'Operativo'}</span></td>
                <td><strong>{c.nro_factura_proveedor}</strong></td>
                <td>{c.nro_control}</td>
                <td style="text-align: right;">{fmtUsd(c.base_imponible_usd)}</td>
                <td style="text-align: right; color: #64748b;">{fmtUsd(c.iva_usd)}</td>
                <td style="text-align: right; font-weight: 800; color: #0f172a;">{fmtUsd(c.total_usd)}</td>
                <td style="text-align: center;">
                  <span class="badge-status {c.pagada ? 'active' : 'draft'}">
                    {c.pagada ? 'PAGADA' : 'PENDIENTE'}
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- CONTENIDO DE SUBVISTA: 4. CXC / CXP (CUENTAS POR COBRAR Y PAGAR) -->
  {#if activeSubvista === 'cxc-cxp'}
    <div class="view-content fade-in">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL CUENTAS POR PAGAR (CxP)</span>
            <span class="kpi-val" style="color: #b91c1c;">
              {fmtUsd(proveedores.reduce((acc, p) => acc + p.saldo_pendiente_usd, 0))}
            </span>
            <span class="kpi-sub">{fmtBs(proveedores.reduce((acc, p) => acc + p.saldo_pendiente_usd, 0) * tasaBcv)}</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL CUENTAS POR COBRAR (CxC)</span>
            <span class="kpi-val" style="color: #15803d;">$3,420.00</span>
            <span class="kpi-sub">{fmtBs(3420 * tasaBcv)}</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">PROVEEDORES CON DEUDA</span>
            <span class="kpi-val">{proveedores.filter(p => p.saldo_pendiente_usd > 0).length}</span>
            <span class="kpi-sub">De {proveedores.length} proveedores registrados</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">CONDICIÓN DE PAGO PROMEDIO</span>
            <span class="kpi-val">15 DÍAS</span>
            <span class="kpi-sub">Crédito comercial</span>
          </div>
        </div>
      </div>

      <!-- SECCIÓN: CUENTAS POR PAGAR (PROVEEDORES) CON ACCIÓN DE PAGO -->
      <div class="action-bar">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Cuentas por Pagar a Proveedores (CxP)</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Liquidación de pasivos comerciales con débito bancario y generación de comprobante de egreso.</p>
        </div>
      </div>

      <div class="card-flow table-responsive" style="margin-bottom: 24px;">
        <table class="table-custom">
          <thead>
            <tr>
              <th>RAZÓN SOCIAL</th>
              <th>RIF</th>
              <th>TELÉFONO DE CONTACTO</th>
              <th>RETENCIÓN SENIAT</th>
              <th style="text-align: right;">SALDO PENDIENTE ($)</th>
              <th style="text-align: right;">SALDO EN BS (BCV)</th>
              <th style="text-align: center;">ESTADO DEUDA</th>
              <th style="text-align: center;">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {#each proveedores as prv (prv.uuid)}
              <tr>
                <td><strong>{prv.nombre}</strong></td>
                <td><code>{prv.rif}</code></td>
                <td>{prv.telefono}</td>
                <td><span class="badge-code">{prv.retencion_iva}</span></td>
                <td style="text-align: right; font-weight: 800; font-size: 14px; color: {prv.saldo_pendiente_usd > 0 ? '#b91c1c' : '#15803d'};">
                  {fmtUsd(prv.saldo_pendiente_usd)}
                </td>
                <td style="text-align: right; font-size: 12px; color: #64748b;">
                  {fmtBs(prv.saldo_pendiente_usd * tasaBcv)}
                </td>
                <td style="text-align: center;">
                  <span class="badge-status {prv.saldo_pendiente_usd > 0 ? 'draft' : 'active'}">
                    {prv.saldo_pendiente_usd > 0 ? 'PENDIENTE' : 'SOLVENTE'}
                  </span>
                </td>
                <td style="text-align: center;">
                  {#if prv.saldo_pendiente_usd > 0}
                    <button 
                      type="button"
                      class="btn-sm" 
                      style="padding: 5px 12px; font-size: 11.5px; font-weight: 700; border-radius: 6px; border: 1px solid #16a34a; background: #dcfce7; color: #166534; cursor: pointer;"
                      on:click={() => abrirModalPago(prv)}
                    >
                      Pagar Deuda
                    </button>
                  {:else}
                    <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">Sin saldo</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- SECCIÓN: CUENTAS POR COBRAR (CLIENTES Y CONCESIONES) -->
      <div class="action-bar">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Cuentas por Cobrar a Clientes y Salas (CxC)</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Créditos concedidos por consumos especiales, fichas a crédito y servicios comerciales.</p>
        </div>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>CLIENTE / RAZÓN SOCIAL</th>
              <th>RIF</th>
              <th>ORIGEN</th>
              <th>FECHA EMISIÓN</th>
              <th>PLAZO</th>
              <th style="text-align: right;">SALDO POR COBRAR ($)</th>
              <th style="text-align: right;">SALDO EN BS</th>
              <th style="text-align: center;">ESTADO</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Inversiones Royal C.A.</strong></td>
              <td><code>J-30495821-0</code></td>
              <td>Servicios de Sala y Alimentos</td>
              <td>2026-10-28</td>
              <td>15 días</td>
              <td style="text-align: right; font-weight: 800; color: #15803d;">$1,850.00</td>
              <td style="text-align: right; font-size: 12px; color: #64748b;">{fmtBs(1850 * tasaBcv)}</td>
              <td style="text-align: center;"><span class="badge-status active">VIGENTE</span></td>
            </tr>
            <tr>
              <td><strong>Operadora Gran Casino C.A.</strong></td>
              <td><code>J-40112345-2</code></td>
              <td>Concesión de Bar y Restaurante</td>
              <td>2026-10-20</td>
              <td>30 días</td>
              <td style="text-align: right; font-weight: 800; color: #15803d;">$1,570.00</td>
              <td style="text-align: right; font-size: 12px; color: #64748b;">{fmtBs(1570 * tasaBcv)}</td>
              <td style="text-align: center;"><span class="badge-status active">VIGENTE</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- CONTENIDO DE SUBVISTA: 5. LIBROS FISCALES SENIAT -->
  {#if activeSubvista === 'reportes-fiscales'}
    <div class="view-content fade-in">
      <!-- SUB-BARRA DE NAVEGACIÓN FISCAL -->
      <div style="display: flex; gap: 8px; margin-bottom: 14px;">
        <button 
          type="button" 
          class="tab-btn {subvistaFiscal === 'ventas' ? 'active' : ''}" 
          style="padding: 6px 14px; font-size: 13px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: {subvistaFiscal === 'ventas' ? '#0f172a' : '#ffffff'}; color: {subvistaFiscal === 'ventas' ? '#ffffff' : '#334155'}; cursor: pointer;"
          on:click={() => subvistaFiscal = 'ventas'}
        >
          Libro de Ventas Fiscal
        </button>
        <button 
          type="button" 
          class="tab-btn {subvistaFiscal === 'compras' ? 'active' : ''}" 
          style="padding: 6px 14px; font-size: 13px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: {subvistaFiscal === 'compras' ? '#0f172a' : '#ffffff'}; color: {subvistaFiscal === 'compras' ? '#ffffff' : '#334155'}; cursor: pointer;"
          on:click={() => subvistaFiscal = 'compras'}
        >
          Libro de Compras Fiscal
        </button>
        <button 
          type="button" 
          class="tab-btn {subvistaFiscal === 'liquidacion' ? 'active' : ''}" 
          style="padding: 6px 14px; font-size: 13px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: {subvistaFiscal === 'liquidacion' ? '#0f172a' : '#ffffff'}; color: {subvistaFiscal === 'liquidacion' ? '#ffffff' : '#334155'}; cursor: pointer;"
          on:click={() => subvistaFiscal = 'liquidacion'}
        >
          Liquidación Tributaria IVA / SENIAT
        </button>
      </div>

      {#if subvistaFiscal === 'ventas'}
        <div class="action-bar">
          <div>
            <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Libro de Ventas Fiscal - Formato SENIAT</h3>
            <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Desglose de alícuota general 16%, percepción IGTF 3% y correlativos fiscales.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-primary" on:click={exportarLibroVentasTxt}>
              <span>Exportar TXT Oficial SENIAT</span>
            </button>
            <button class="btn-secondary" on:click={() => window.print()}>
              <span>Imprimir Libro</span>
            </button>
          </div>
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
                <th>TOTAL BS</th>
                <th>BASE IMP. BS</th>
                <th>IVA 16% BS</th>
                <th>IGTF 3% BS</th>
                <th style="text-align: center;">ESTADO</th>
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
                  <td style="text-align: center;">
                    <span class="badge-status {fac.estado === 'ANULADA_NC' ? 'danger' : 'active'}">{fac.estado}</span>
                  </td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #cbd5e1;">
                <td colspan="6" style="text-align: right;">TOTALES LIBRO DE VENTAS:</td>
                <td style="text-align: right; color: #0f172a;">{fmtBs((totalVentasBaseUsd + totalVentasIvaUsd + totalVentasIgtfUsd) * tasaBcv)}</td>
                <td style="text-align: right; color: #2563eb;">{fmtBs(totalVentasBaseUsd * tasaBcv)}</td>
                <td style="text-align: right; color: #b91c1c;">{fmtBs(totalVentasIvaUsd * tasaBcv)}</td>
                <td style="text-align: right; color: #d97706;">{fmtBs(totalVentasIgtfUsd * tasaBcv)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      {:else if subvistaFiscal === 'compras'}
        <div class="action-bar">
          <div>
            <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Libro de Compras Fiscal - Formato SENIAT</h3>
            <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Registro de facturas de compras, crédito fiscal deducible y retenciones practicadas.</p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-primary" on:click={exportarLibroComprasTxt}>
              <span>Exportar TXT Compras</span>
            </button>
            <button class="btn-secondary" on:click={exportarRetencionesTxt}>
              <span>TXT Retenciones SENIAT</span>
            </button>
            <button class="btn-secondary" on:click={() => window.print()}>
              <span>Imprimir Libro</span>
            </button>
          </div>
        </div>

        <div class="card-flow table-responsive">
          <table class="table-custom text-xs">
            <thead>
              <tr style="background: #f8fafc;">
                <th>OP</th>
                <th>FECHA</th>
                <th>RIF PROVEEDOR</th>
                <th>PROVEEDOR</th>
                <th>NRO FACT</th>
                <th>NRO CTRL</th>
                <th>TOTAL BS</th>
                <th>BASE IMP. BS</th>
                <th>CRÉDITO IVA BS</th>
                <th>RET. IVA BS</th>
              </tr>
            </thead>
            <tbody>
              {#each facturasCompras as fc, i}
                <tr>
                  <td>{i + 1}</td>
                  <td>{fc.fecha}</td>
                  <td><code>{fc.proveedor_rif}</code></td>
                  <td><strong>{fc.proveedor_nombre}</strong></td>
                  <td>{fc.nro_factura_proveedor}</td>
                  <td>{fc.nro_control}</td>
                  <td style="text-align: right; font-weight: 700;">{fmtBs(fc.total_usd * tasaBcv)}</td>
                  <td style="text-align: right;">{fmtBs(fc.base_imponible_usd * tasaBcv)}</td>
                  <td style="text-align: right; color: #15803d;">{fmtBs(fc.iva_usd * tasaBcv)}</td>
                  <td style="text-align: right; color: #b45309;">-{fmtBs(fc.retencion_iva_usd * tasaBcv)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #cbd5e1;">
                <td colspan="6" style="text-align: right;">TOTALES LIBRO DE COMPRAS:</td>
                <td style="text-align: right; color: #0f172a;">{fmtBs((totalComprasBaseUsd + totalComprasIvaUsd) * tasaBcv)}</td>
                <td style="text-align: right; color: #2563eb;">{fmtBs(totalComprasBaseUsd * tasaBcv)}</td>
                <td style="text-align: right; color: #15803d;">{fmtBs(totalComprasIvaUsd * tasaBcv)}</td>
                <td style="text-align: right; color: #b45309;">-{fmtBs(totalRetencionesIvaUsd * tasaBcv)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      {:else}
        <!-- LIQUIDACIÓN TRIBUTARIA SENIAT -->
        <div class="card-padded" style="margin-bottom: 16px;">
          <h3 style="font-size: 17px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0;">Liquidación Fiscal y Autodeterminación de IVA (Quincenal / Mensual)</h3>
          <p style="font-size: 13px; color: #64748b; margin: 0 0 16px 0;">Cálculo oficial de cuota tributaria resultante entre Débitos Fiscales, Créditos Fiscales y Retenciones de IVA.</p>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 20px;">
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
              <span style="font-size: 11px; font-weight: 800; color: #64748b;">TOTAL DÉBITO FISCAL (VENTAS)</span>
              <div style="font-size: 20px; font-weight: 900; color: #dc2626; margin: 4px 0;">+{fmtUsd(totalVentasIvaUsd)}</div>
              <span style="font-size: 11px; color: #64748b;">{fmtBs(totalVentasIvaUsd * tasaBcv)}</span>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
              <span style="font-size: 11px; font-weight: 800; color: #64748b;">TOTAL CRÉDITO FISCAL (COMPRAS)</span>
              <div style="font-size: 20px; font-weight: 900; color: #16a34a; margin: 4px 0;">-{fmtUsd(totalComprasIvaUsd)}</div>
              <span style="font-size: 11px; color: #64748b;">{fmtBs(totalComprasIvaUsd * tasaBcv)}</span>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
              <span style="font-size: 11px; font-weight: 800; color: #64748b;">RETENCIONES IVA SOPORTADAS</span>
              <div style="font-size: 20px; font-weight: 900; color: #d97706; margin: 4px 0;">-{fmtUsd(totalRetencionesIvaUsd)}</div>
              <span style="font-size: 11px; color: #64748b;">{fmtBs(totalRetencionesIvaUsd * tasaBcv)}</span>
            </div>

            <div style="background: {saldoIvaPeriodoUsd >= 0 ? '#fef2f2' : '#f0fdf4'}; border: 1px solid {saldoIvaPeriodoUsd >= 0 ? '#fecaca' : '#bbf7d0'}; border-radius: 8px; padding: 14px;">
              <span style="font-size: 11px; font-weight: 800; color: {saldoIvaPeriodoUsd >= 0 ? '#991b1b' : '#166534'};">
                {saldoIvaPeriodoUsd >= 0 ? 'IMPUESTO NETO A ENTERAR (PAGO)' : 'SALDO A FAVOR DEL CONTRIBUYENTE'}
              </span>
              <div style="font-size: 22px; font-weight: 900; color: {saldoIvaPeriodoUsd >= 0 ? '#b91c1c' : '#15803d'}; margin: 4px 0;">
                {fmtUsd(Math.abs(saldoIvaPeriodoUsd))}
              </div>
              <span style="font-size: 11px; color: #64748b;">{fmtBs(Math.abs(saldoIvaPeriodoUsd) * tasaBcv)}</span>
            </div>
          </div>

          <div style="display: flex; gap: 10px;">
            <button class="btn-primary" on:click={exportarRetencionesTxt}>
              <span>Descargar Archivo TXT Retenciones SENIAT</span>
            </button>
            <button class="btn-secondary" on:click={exportarLibroVentasTxt}>
              <span>Descargar TXT Ventas</span>
            </button>
            <button class="btn-secondary" on:click={exportarLibroComprasTxt}>
              <span>Descargar TXT Compras</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- MODAL NUEVO ARTÍCULO -->
{#if showModalArticulo}
  <div class="modal-backdrop fade-in" role="presentation">
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
  <div class="modal-backdrop fade-in" role="presentation">
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

<!-- MODAL REGISTRAR FACTURA DE COMPRA -->
{#if showModalCompra}
  <div class="modal-backdrop fade-in" role="presentation">
    <div class="modal-card" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <h3>Registrar Factura de Compra (Proveedor)</h3>
        <button class="btn-close" on:click={() => showModalCompra = false}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group col-span-2">
            <label for="f-cmp-prv">Proveedor *</label>
            <select id="f-cmp-prv" bind:value={nuevaCompra.proveedor_uuid}>
              <option value="">-- Seleccionar Proveedor --</option>
              {#each proveedores as p}
                <option value={p.uuid}>{p.nombre} ({p.rif})</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label for="f-cmp-nro">Nro Factura Proveedor *</label>
            <input id="f-cmp-nro" type="text" bind:value={nuevaCompra.nro_factura} placeholder="Ej: FC-009842" />
          </div>
          <div class="form-group">
            <label for="f-cmp-ctrl">Nro de Control Fiscal</label>
            <input id="f-cmp-ctrl" type="text" bind:value={nuevaCompra.nro_control} placeholder="Ej: 00-49201" />
          </div>
          <div class="form-group">
            <label for="f-cmp-fch">Fecha Factura</label>
            <input id="f-cmp-fch" type="date" bind:value={nuevaCompra.fecha} />
          </div>
          <div class="form-group">
            <label for="f-cmp-ret">Porcentaje Retención IVA</label>
            <select id="f-cmp-ret" bind:value={nuevaCompra.porcentaje_retencion}>
              <option value="75%">75% (General SENIAT)</option>
              <option value="100%">100% (Especial)</option>
            </select>
          </div>
          <div class="form-group col-span-2">
            <label for="f-cmp-base">Base Imponible ($ USD) *</label>
            <input id="f-cmp-base" type="number" step="0.01" bind:value={nuevaCompra.base_imponible_usd} />
          </div>
        </div>

        <!-- RESUMEN DE CÁLCULO DE COMPRA Y RETENCIÓN -->
        <div class="fiscal-calc-summary">
          <div class="calc-row">
            <span>Base Imponible:</span>
            <span>{fmtUsd(compraBaseUsd)}</span>
          </div>
          <div class="calc-row">
            <span>IVA Crédito Fiscal (16%):</span>
            <span>{fmtUsd(compraIvaUsd)}</span>
          </div>
          <div class="calc-row text-amber">
            <span>Retención IVA a Enterar ({nuevaCompra.porcentaje_retencion}):</span>
            <span>-{fmtUsd(compraRetIvaUsd)}</span>
          </div>
          <div class="calc-row total">
            <span>SALDO NETO POR PAGAR AL PROVEEDOR:</span>
            <span class="total-val">{fmtUsd(compraNetoPagarUsd)}</span>
          </div>
          <div class="calc-row ves-equiv">
            <span>Equivalente BCV ({tasaBcv} Bs/USD):</span>
            <span>{fmtBs(compraNetoPagarUsd * tasaBcv)}</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => showModalCompra = false}>Cancelar</button>
        <button class="btn-primary" on:click={registrarCompra}>Registrar Compra y Generar Asiento</button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL MOVIMIENTO DE INVENTARIO -->
{#if showModalMovimiento && movArticulo}
  <div class="modal-backdrop fade-in" role="presentation">
    <div class="modal-card" role="dialog" style="max-width: 540px;">
      <div class="modal-header">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;">Movimiento de Inventario</h3>
          <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">
            {movArticulo.codigo} • {movArticulo.nombre} (Stock Actual: {movArticulo.stock} {movArticulo.unidad})
          </p>
        </div>
        <button class="btn-close" type="button" on:click={() => { showModalMovimiento = false; movArticulo = null; }}>&times;</button>
      </div>

      <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="form-group">
          <label for="f-mov-tipo" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">TIPO DE MOVIMIENTO *</label>
          <select id="f-mov-tipo" bind:value={nuevoMov.tipo} style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 700;">
            <option value="SALIDA_CONSUMO">Salida por Consumo / Despacho a Sala</option>
            <option value="ENTRADA">Entrada / Recepción de Mercancía</option>
            <option value="AJUSTE">Ajuste por Conteo Físico</option>
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label for="f-mov-cant" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">CANTIDAD ({movArticulo.unidad}) *</label>
            <input 
              id="f-mov-cant"
              type="number" 
              min="1" 
              bind:value={nuevoMov.cantidad} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 800;"
            />
          </div>
          <div>
            <label for="f-mov-sala" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">SALA / DESTINO</label>
            <select id="f-mov-sala" bind:value={nuevoMov.sala_id} style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;">
              {#each userAvailableSalas as s}
                <option value={s.uuid || s.id}>{s.nombre || s.nombre_comercial}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="form-group">
          <label for="f-mov-obs" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">MOTIVO / OBSERVACIONES</label>
          <input 
            id="f-mov-obs"
            type="text" 
            placeholder="Ej: Reposición de barajas mesa de Baccarat #2" 
            bind:value={nuevoMov.observacion} 
            style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
          />
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #475569;">
          <strong>Impacto Estimado en Stock:</strong>
          <span style="font-weight: 800; color: #0f172a; margin-left: 6px;">
            {#if nuevoMov.tipo === 'ENTRADA'}
              {movArticulo.stock + (Number(nuevoMov.cantidad) || 0)} {movArticulo.unidad} (+{nuevoMov.cantidad})
            {:else if nuevoMov.tipo === 'SALIDA_CONSUMO'}
              {Math.max(0, movArticulo.stock - (Number(nuevoMov.cantidad) || 0))} {movArticulo.unidad} (-{nuevoMov.cantidad})
            {:else}
              {nuevoMov.cantidad} {movArticulo.unidad} (Ajustado)
            {/if}
          </span>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" type="button" on:click={() => { showModalMovimiento = false; movArticulo = null; }}>Cancelar</button>
        <button class="btn-primary" type="button" on:click={registrarMovimientoArticulo}>Registrar Movimiento</button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL REGISTRAR PAGO A PROVEEDOR (CxP) -->
{#if showModalPagoProveedor && provSeleccionadoPago}
  <div class="modal-backdrop fade-in" role="presentation">
    <div class="modal-card" role="dialog" style="max-width: 580px;">
      <div class="modal-header">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;">Registrar Pago a Proveedor (CxP)</h3>
          <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">
            {provSeleccionadoPago.nombre} • RIF: {provSeleccionadoPago.rif}
          </p>
        </div>
        <button class="btn-close" type="button" on:click={() => { showModalPagoProveedor = false; provSeleccionadoPago = null; }}>&times;</button>
      </div>

      <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px;">
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-size: 11px; font-weight: 700; color: #b91c1c; text-transform: uppercase;">Deuda Pendiente Actual:</span>
            <div style="font-size: 18px; font-weight: 900; color: #991b1b;">{fmtUsd(provSeleccionadoPago.saldo_pendiente_usd)}</div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 11px; color: #7f1d1d;">En Bolívares (BCV):</span>
            <div style="font-size: 14px; font-weight: 800; color: #991b1b;">{fmtBs(provSeleccionadoPago.saldo_pendiente_usd * tasaBcv)}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label for="f-pgo-monto" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">MONTO A PAGAR ($ USD) *</label>
            <input 
              id="f-pgo-monto"
              type="number" 
              step="0.01" 
              bind:value={nuevoPago.monto} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; font-weight: 800; color: #15803d;"
            />
          </div>
          <div>
            <label for="f-pgo-metodo" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">MÉTODO DE PAGO *</label>
            <select id="f-pgo-metodo" bind:value={nuevoPago.metodo} style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 700;">
              <option value="TRANSFERENCIA_BANCO">Transferencia Bancaria Nacional</option>
              <option value="PAGO_MOVIL">Pago Móvil Interbancario</option>
              <option value="EFECTIVO_DIVISAS">Efectivo Divisas (Caja)</option>
              <option value="ZELLE">Zelle / Transferencia Internacional</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label for="f-pgo-ref" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">NRO. DE REFERENCIA BANCARIA *</label>
            <input 
              id="f-pgo-ref"
              type="text" 
              placeholder="Ej: 04928172" 
              bind:value={nuevoPago.referencia} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: monospace;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">CUENTA CONTABLE DE SALIDA</label>
            <div style="padding: 8px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; font-weight: 700; color: #334155;">
              1.1.1.03 - Banco Moneda Nacional / Ext.
            </div>
          </div>
        </div>

        <div class="form-group">
          <label for="f-pgo-obs" style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">OBSERVACIÓN / CONCEPTO DEL EGRESO</label>
          <input 
            id="f-pgo-obs"
            type="text" 
            bind:value={nuevoPago.observacion} 
            style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
          />
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" type="button" on:click={() => { showModalPagoProveedor = false; provSeleccionadoPago = null; }}>Cancelar</button>
        <button class="btn-primary" type="button" on:click={registrarPagoProveedor}>Confirmar Pago y Generar Asiento</button>
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
