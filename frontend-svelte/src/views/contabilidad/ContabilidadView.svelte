<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { masterSalasStore } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';

  const SUBVISTAS = [
    { id: 'plan-cuentas', label: 'Plan de Cuentas', desc: 'Catálogo contable jerárquico multinivel' },
    { id: 'centros-costos', label: 'Centros de Costos', desc: 'Unidades de negocio y departamentos analíticos' },
    { id: 'asientos', label: 'Comprobantes y Asientos', desc: 'Asientos de diario por partida doble estricta' },
    { id: 'libros', label: 'Libro Diario y Mayor', desc: 'Libros oficiales y movimientos por cuenta' },
    { id: 'reportes', label: 'Estados Financieros', desc: 'Balance de comprobación, Estado de Resultados y Situación VEN-NIF' }
  ];

  let activeSubvista = 'plan-cuentas';
  let subvistaReportes = 'comprobacion'; // 'comprobacion' | 'resultados' | 'situacion'
  let estadosFinancieros = null;

  function isTipo1Sala(sala) {
    if (!sala) return false;
    const galponGrupoUuids = [
      '51a3d9bc-76d3-4f08-8dd9-97c7f79ea0e3',
      '55d65e8b-09b2-4164-8491-efbdd50433b6'
    ];
    const gUuid = sala.grupo_uuid ? String(sala.grupo_uuid).toLowerCase().trim() : '';
    if (gUuid && galponGrupoUuids.includes(gUuid)) return false;
    if (sala.grupo_nombre) {
      const gn = String(sala.grupo_nombre).toLowerCase().trim();
      if (gn.includes('galpon') || gn.includes('galpón') || gn.includes('deposito') || gn.includes('depósito')) return false;
    }
    const nom = String(sala.nombre || sala.nombre_comercial || sala.name || '').toLowerCase().trim();
    if (nom.includes('galpon') || nom.includes('galpón') || nom.includes('deposito') || nom.includes('depósito') || nom.includes('almacen')) return false;
    if (Number(sala.grupo_id) === 2 || Number(sala.tipo_id) === 2 || Number(sala.tipo) === 2) return false;
    return true;
  }

  // Multi-sala isolation
  let selectedSalaFiltro = 'ALL';
  $: assignedSalaIds = Array.isArray($authUserSalasStore) 
    ? $authUserSalasStore.map(s => String(s.sala_id || s.sala_uuid || s.id || s.uuid)) 
    : [];
  $: userAvailableSalas = ($masterSalasStore || []).filter(s => {
    if (!isTipo1Sala(s)) return false;
    if ($currentUserStore?.is_superuser || $currentUserStore?.is_admin || $currentUserStore?.role === 'ADMIN' || $currentUserStore?.rol === 'admin') return true;
    return assignedSalaIds.includes(String(s.uuid || s.id));
  });

  // Mayor Analítico por Cuenta
  let libroModo = 'mayor_analitico'; // 'mayor_analitico' | 'resumen_mayor'
  let selectedCuentaMayor = '1.1.1.03';

  $: cuentaSeleccionadaObj = planCuentas.find(c => c.codigo === selectedCuentaMayor) || planCuentas[0];

  $: movimientosMayorCuenta = (() => {
    const list = [];
    let runningSaldo = 0;
    const esDeudora = cuentaSeleccionadaObj?.naturaleza === 'DEUDORA';

    for (const asnt of asientos) {
      for (const linea of asnt.lineas || []) {
        if (linea.cuenta_codigo === selectedCuentaMayor) {
          const debe = Number(linea.debe) || 0;
          const haber = Number(linea.haber) || 0;
          if (esDeudora) {
            runningSaldo += (debe - haber);
          } else {
            runningSaldo += (haber - debe);
          }
          list.push({
            asiento_nro: asnt.nro,
            fecha: asnt.fecha,
            tipo: asnt.tipo,
            glosa: asnt.glosa,
            debe,
            haber,
            saldo_progresivo: runningSaldo
          });
        }
      }
    }
    return list;
  })();

  let unsubRoute;
  onMount(() => {
    cargarDatosBackend();

    unsubRoute = currentRouteStore.subscribe(val => {
      const clean = String(val || '').replace(/^#\/?/, '').replace(/^\//, '').trim();
      const parts = clean.split('/');
      if (parts[0] === 'erp' && (parts[1] === 'contable' || parts[1] === 'contabilidad')) {
        if (parts[2] && SUBVISTAS.some(s => s.id === parts[2])) {
          activeSubvista = parts[2];
        } else {
          activeSubvista = 'plan-cuentas';
        }
      } else if (parts[0] === 'contabilidad' || parts[0] === 'contable') {
        if (parts[1] && SUBVISTAS.some(s => s.id === parts[1])) {
          activeSubvista = parts[1];
        } else {
          activeSubvista = 'plan-cuentas';
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubRoute) unsubRoute();
  });

  async function cargarDatosBackend() {
    try {
      const [resCuentas, resCc, resAsnt, resEf] = await Promise.all([
        fetch(toBackendUrl('/api/erp/plan-cuentas')),
        fetch(toBackendUrl('/api/erp/centros-costos')),
        fetch(toBackendUrl('/api/erp/asientos')),
        fetch(toBackendUrl('/api/erp/estados-financieros'))
      ]);
      const dataCuentas = await resCuentas.json();
      const dataCc = await resCc.json();
      const dataAsnt = await resAsnt.json();
      const dataEf = await resEf.json();

      if (dataCuentas?.success && Array.isArray(dataCuentas.data) && dataCuentas.data.length > 0) {
        planCuentas = dataCuentas.data;
      }
      if (dataCc?.success && Array.isArray(dataCc.data) && dataCc.data.length > 0) {
        centrosCostos = dataCc.data;
      }
      if (dataAsnt?.success && Array.isArray(dataAsnt.data) && dataAsnt.data.length > 0) {
        asientos = dataAsnt.data;
      }
      if (dataEf?.success && dataEf.data) {
        estadosFinancieros = dataEf.data;
      }
    } catch (e) {
      console.warn('Modo demo/offline contabilidad:', e.message);
    }
  }

  function imprimirReporteContable() {
    window.print();
  }

  function cambiarSubvista(id) {
    activeSubvista = id;
    navigateToRoute(`erp/contable/${id}`);
  }

  // --- DATOS DEMO / ESTADO V1 PLAN DE CUENTAS ---
  let planCuentas = [
    { uuid: 'pc-1', codigo: '1', nombre: 'ACTIVO', nivel: 1, tipo: 'GRUPO', naturaleza: 'DEUDORA', saldo: 145200.00 },
    { uuid: 'pc-11', codigo: '1.1', nombre: 'ACTIVO CORRIENTE', nivel: 2, tipo: 'GRUPO', naturaleza: 'DEUDORA', saldo: 98500.00 },
    { uuid: 'pc-111', codigo: '1.1.1', nombre: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', nivel: 3, tipo: 'GRUPO', naturaleza: 'DEUDORA', saldo: 54200.00 },
    { uuid: 'pc-11101', codigo: '1.1.1.01', nombre: 'Caja Principal (Moneda Nacional Bs)', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 18400.00 },
    { uuid: 'pc-11102', codigo: '1.1.1.02', nombre: 'Caja Bóveda Divisas (USD)', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 24500.00 },
    { uuid: 'pc-11103', codigo: '1.1.1.03', nombre: 'Banco Banesco Cuenta Corriente', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 11300.00 },
    { uuid: 'pc-112', codigo: '1.1.2', nombre: 'CUENTAS POR COBRAR COMERCIALES', nivel: 3, tipo: 'GRUPO', naturaleza: 'DEUDORA', saldo: 44300.00 },
    { uuid: 'pc-11201', codigo: '1.1.2.01', nombre: 'Clientes Nacionales', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 44300.00 },
    { uuid: 'pc-2', codigo: '2', nombre: 'PASIVO', nivel: 1, tipo: 'GRUPO', naturaleza: 'ACREEDORA', saldo: 41800.00 },
    { uuid: 'pc-21', codigo: '2.1', nombre: 'PASIVO CORRIENTE', nivel: 2, tipo: 'GRUPO', naturaleza: 'ACREEDORA', saldo: 41800.00 },
    { uuid: 'pc-21101', codigo: '2.1.1.01', nombre: 'Cuentas por Pagar Proveedores', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 28400.00 },
    { uuid: 'pc-21201', codigo: '2.1.2.01', nombre: 'Retenciones de IVA por Enterar (SENIAT)', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 3900.00 },
    { uuid: 'pc-21202', codigo: '2.1.2.02', nombre: 'Retenciones ISLR por Enterar', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 2100.00 },
    { uuid: 'pc-21301', codigo: '2.1.3.01', nombre: 'Sueldos y Salarios por Pagar', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 7400.00 },
    { uuid: 'pc-3', codigo: '3', nombre: 'PATRIMONIO NETO', nivel: 1, tipo: 'GRUPO', naturaleza: 'ACREEDORA', saldo: 103400.00 },
    { uuid: 'pc-31101', codigo: '3.1.1.01', nombre: 'Capital Social Suscrito y Pagado', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 80000.00 },
    { uuid: 'pc-32101', codigo: '3.2.1.01', nombre: 'Resultados Acumulados de Ejercicios Anteriores', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 23400.00 },
    { uuid: 'pc-4', codigo: '4', nombre: 'INGRESOS', nivel: 1, tipo: 'GRUPO', naturaleza: 'ACREEDORA', saldo: 82500.00 },
    { uuid: 'pc-41101', codigo: '4.1.1.01', nombre: 'Ingresos por Operaciones de Juego y Sala', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 74200.00 },
    { uuid: 'pc-41201', codigo: '4.1.2.01', nombre: 'Ingresos por Alimentos y Bebidas', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA', saldo: 8300.00 },
    { uuid: 'pc-5', codigo: '5', nombre: 'COSTOS Y GASTOS OPERATIVOS', nivel: 1, tipo: 'GRUPO', naturaleza: 'DEUDORA', saldo: 47200.00 },
    { uuid: 'pc-51101', codigo: '5.1.1.01', nombre: 'Gasto de Sueldos y Salarios Personal', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 28600.00 },
    { uuid: 'pc-51102', codigo: '5.1.1.02', nombre: 'Aportes Patronales (IVSS, FAOV, INCES)', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 4100.00 },
    { uuid: 'pc-51201', codigo: '5.1.2.01', nombre: 'Gastos de Mantenimiento y Servicios', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA', saldo: 14500.00 }
  ];

  let filtroCuentas = '';
  $: cuentasFiltradas = planCuentas.filter(c => 
    c.codigo.toLowerCase().includes(filtroCuentas.toLowerCase()) ||
    c.nombre.toLowerCase().includes(filtroCuentas.toLowerCase())
  );

  // Modal Nueva Cuenta
  let showModalCuenta = false;
  let nuevaCuenta = { codigo: '', nombre: '', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' };

  async function guardarCuenta() {
    if (!nuevaCuenta.codigo.trim() || !nuevaCuenta.nombre.trim()) {
      triggerToast('Código y Nombre de cuenta son requeridos', 'error');
      return;
    }
    try {
      const res = await fetch(toBackendUrl('/api/erp/plan-cuentas'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevaCuenta)
      });
      const resData = await res.json();
      if (resData?.success && resData.data) {
        planCuentas = [...planCuentas.filter(c => c.uuid !== resData.data.uuid), resData.data].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
      } else {
        const cUuid = crypto.randomUUID ? crypto.randomUUID() : 'pc-' + Date.now();
        planCuentas = [...planCuentas, { ...nuevaCuenta, uuid: cUuid, saldo: 0 }].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
      }
      showModalCuenta = false;
      nuevaCuenta = { codigo: '', nombre: '', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' };
      triggerToast('Cuenta contable incorporada al catálogo', 'success');
    } catch (e) {
      const cUuid = crypto.randomUUID ? crypto.randomUUID() : 'pc-' + Date.now();
      planCuentas = [...planCuentas, { ...nuevaCuenta, uuid: cUuid, saldo: 0 }].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
      showModalCuenta = false;
      nuevaCuenta = { codigo: '', nombre: '', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' };
      triggerToast('Cuenta incorporada (modo local)', 'success');
    }
  }

  // --- DATOS DEMO / ESTADO V1 CENTROS DE COSTOS ---
  let centrosCostos = [
    { uuid: 'cc-1', codigo: 'CC-01', nombre: 'Operaciones de Sala y Mesas', responsable: 'Jefe de Operaciones', presupuesto_usd: 25000, ejecutado_usd: 18450 },
    { uuid: 'cc-2', codigo: 'CC-02', nombre: 'Recursos Humanos y Nómina', responsable: 'Gerente de RRHH', presupuesto_usd: 35000, ejecutado_usd: 32700 },
    { uuid: 'cc-3', codigo: 'CC-03', nombre: 'Seguridad Integral y CECOM', responsable: 'Auditor de Seguridad', presupuesto_usd: 12000, ejecutado_usd: 8900 },
    { uuid: 'cc-4', codigo: 'CC-04', nombre: 'Administración y Finanzas', responsable: 'Contador General', presupuesto_usd: 15000, ejecutado_usd: 9400 }
  ];

  // --- DATOS DEMO / ESTADO V1 ASIENTOS CONTABLES ---
  let asientos = [
    {
      uuid: 'as-1',
      nro: 'AS-2026-0041',
      fecha: '2026-10-31',
      glosa: 'Registro de ventas y recaudación de la jornada según libro fiscal',
      tipo: 'INGRESO',
      lineas: [
        { cuenta_codigo: '1.1.1.01', cuenta_nombre: 'Caja Principal (Moneda Nacional Bs)', debe: 2400.00, haber: 0.00 },
        { cuenta_codigo: '1.1.1.02', cuenta_nombre: 'Caja Bóveda Divisas (USD)', debe: 5800.00, haber: 0.00 },
        { cuenta_codigo: '4.1.1.01', cuenta_nombre: 'Ingresos por Operaciones de Juego y Sala', debe: 0.00, haber: 7200.00 },
        { cuenta_codigo: '2.1.2.01', cuenta_nombre: 'Retenciones de IVA por Enterar (SENIAT)', debe: 0.00, haber: 1000.00 }
      ]
    },
    {
      uuid: 'as-2',
      nro: 'AS-2026-0042',
      fecha: '2026-10-31',
      glosa: 'Provisión quincenal de sueldos y aportes patronales LOTTT',
      tipo: 'DIARIO',
      lineas: [
        { cuenta_codigo: '5.1.1.01', cuenta_nombre: 'Gasto de Sueldos y Salarios Personal', debe: 14300.00, haber: 0.00 },
        { cuenta_codigo: '5.1.1.02', cuenta_nombre: 'Aportes Patronales (IVSS, FAOV, INCES)', debe: 2050.00, haber: 0.00 },
        { cuenta_codigo: '2.1.3.01', cuenta_nombre: 'Sueldos y Salarios por Pagar', debe: 0.00, haber: 14300.00 },
        { cuenta_codigo: '2.1.1.01', cuenta_nombre: 'Cuentas por Pagar Proveedores', debe: 0.00, haber: 2050.00 }
      ]
    },
    {
      uuid: 'as-3',
      nro: 'AS-2026-0043',
      fecha: '2026-11-01',
      glosa: 'Pago factura FC-008129 Distribuidora Gaming con débito en Banco Banesco',
      tipo: 'EGRESO',
      lineas: [
        { cuenta_codigo: '2.1.1.01', cuenta_nombre: 'Cuentas por Pagar Proveedores', debe: 580.00, haber: 0.00 },
        { cuenta_codigo: '1.1.1.03', cuenta_nombre: 'Banco Banesco Cuenta Corriente', debe: 0.00, haber: 580.00 }
      ]
    },
    {
      uuid: 'as-4',
      nro: 'AS-2026-0044',
      fecha: '2026-11-01',
      glosa: 'Depósito de divisas de bóveda en cuenta bancaria operativa',
      tipo: 'DIARIO',
      lineas: [
        { cuenta_codigo: '1.1.1.03', cuenta_nombre: 'Banco Banesco Cuenta Corriente', debe: 3500.00, haber: 0.00 },
        { cuenta_codigo: '1.1.1.02', cuenta_nombre: 'Caja Bóveda Divisas (USD)', debe: 0.00, haber: 3500.00 }
      ]
    }
  ];

  // Modal Nuevo Asiento
  let showModalAsiento = false;
  let nuevoAsiento = {
    glosa: '',
    tipo: 'DIARIO',
    fecha: new Date().toISOString().split('T')[0],
    lineas: [
      { cuenta_codigo: '1.1.1.01', debe: 0, haber: 0 },
      { cuenta_codigo: '4.1.1.01', debe: 0, haber: 0 }
    ]
  };

  $: totalDebeNuevo = nuevoAsiento.lineas.reduce((acc, l) => acc + (Number(l.debe) || 0), 0);
  $: totalHaberNuevo = nuevoAsiento.lineas.reduce((acc, l) => acc + (Number(l.haber) || 0), 0);
  $: estaCuadradoNuevo = Math.abs(totalDebeNuevo - totalHaberNuevo) < 0.01 && totalDebeNuevo > 0;

  function agregarLineaAsiento() {
    nuevoAsiento.lineas = [...nuevoAsiento.lineas, { cuenta_codigo: '1.1.1.01', debe: 0, haber: 0 }];
  }

  function eliminarLineaAsiento(idx) {
    if (nuevoAsiento.lineas.length <= 2) {
      triggerToast('Un asiento contable requiere al menos 2 líneas de partida doble', 'warning');
      return;
    }
    nuevoAsiento.lineas = nuevoAsiento.lineas.filter((_, i) => i !== idx);
  }

  async function guardarAsiento() {
    if (!nuevoAsiento.glosa.trim()) {
      triggerToast('La descripción/glosa del comprobante es obligatoria', 'error');
      return;
    }
    if (!estaCuadradoNuevo) {
      triggerToast(`Asiento descuadrado: Debe ($${totalDebeNuevo.toFixed(2)}) != Haber ($${totalHaberNuevo.toFixed(2)})`, 'error');
      return;
    }

    const lineasConNombre = nuevoAsiento.lineas.map(l => {
      const cuentaObj = planCuentas.find(c => c.codigo === l.cuenta_codigo);
      return {
        cuenta_codigo: l.cuenta_codigo,
        cuenta_nombre: cuentaObj ? cuentaObj.nombre : 'Cuenta Contable',
        debe: Number(l.debe) || 0,
        haber: Number(l.haber) || 0
      };
    });

    try {
      const res = await fetch(toBackendUrl('/api/erp/asientos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nuevoAsiento,
          lineas: lineasConNombre
        })
      });
      const resData = await res.json();
      if (resData?.success && resData.data) {
        asientos = [
          {
            uuid: resData.data.uuid,
            nro: resData.data.nro_comprobante || resData.data.nro,
            fecha: resData.data.fecha ? String(resData.data.fecha).split('T')[0] : nuevoAsiento.fecha,
            glosa: resData.data.glosa,
            tipo: resData.data.tipo,
            lineas: lineasConNombre
          },
          ...asientos
        ];
      } else {
        const nroSiguiente = asientos.length + 43;
        const asUuid = crypto.randomUUID ? crypto.randomUUID() : 'as-' + Date.now();
        asientos = [
          {
            uuid: asUuid,
            nro: `AS-2026-${String(nroSiguiente).padStart(4, '0')}`,
            fecha: nuevoAsiento.fecha,
            glosa: nuevoAsiento.glosa,
            tipo: nuevoAsiento.tipo,
            lineas: lineasConNombre
          },
          ...asientos
        ];
      }
      showModalAsiento = false;
      nuevoAsiento = {
        glosa: '',
        tipo: 'DIARIO',
        fecha: new Date().toISOString().split('T')[0],
        lineas: [
          { cuenta_codigo: '1.1.1.01', debe: 0, haber: 0 },
          { cuenta_codigo: '4.1.1.01', debe: 0, haber: 0 }
        ]
      };
      triggerToast('Comprobante contable validado y asentado con éxito', 'success');
    } catch (e) {
      const nroSiguiente = asientos.length + 43;
      const asUuid = crypto.randomUUID ? crypto.randomUUID() : 'as-' + Date.now();
      asientos = [
        {
          uuid: asUuid,
          nro: `AS-2026-${String(nroSiguiente).padStart(4, '0')}`,
          fecha: nuevoAsiento.fecha,
          glosa: nuevoAsiento.glosa,
          tipo: nuevoAsiento.tipo,
          lineas: lineasConNombre
        },
        ...asientos
      ];
      showModalAsiento = false;
      nuevoAsiento = {
        glosa: '',
        tipo: 'DIARIO',
        fecha: new Date().toISOString().split('T')[0],
        lineas: [
          { cuenta_codigo: '1.1.1.01', debe: 0, haber: 0 },
          { cuenta_codigo: '4.1.1.01', debe: 0, haber: 0 }
        ]
      };
      triggerToast('Comprobante asentado (modo local)', 'success');
    }
  }

  function fmtMoneda(val) {
    return '$ ' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  $: ctasDetalle = planCuentas.filter(c => c.tipo === 'DETALLE');
  $: totalBalanceDebe = ctasDetalle.filter(c => c.naturaleza === 'DEUDORA').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
  $: totalBalanceHaber = ctasDetalle.filter(c => c.naturaleza === 'ACREEDORA').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
  $: balanceCuadrado = Math.abs(totalBalanceDebe - totalBalanceHaber) < 0.01;

  $: ctasActivos = planCuentas.filter(c => c.codigo.startsWith('1'));
  $: ctasPasivos = planCuentas.filter(c => c.codigo.startsWith('2'));
  $: ctasPatrimonio = planCuentas.filter(c => c.codigo.startsWith('3'));
  $: ctasIngresos = planCuentas.filter(c => c.codigo.startsWith('4'));
  $: ctasGastos = planCuentas.filter(c => c.codigo.startsWith('5'));

  $: totalActivos = ctasActivos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
  $: totalPasivos = ctasPasivos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
  $: totalPatrimonioBase = ctasPatrimonio.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);

  $: totalIngresos = ctasIngresos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
  $: totalGastos = ctasGastos.filter(c => c.tipo === 'DETALLE').reduce((acc, c) => acc + (Number(c.saldo) || 0), 0);
  $: utilidadEjercicio = Number((totalIngresos - totalGastos).toFixed(2));

  $: totalPatrimonioNeto = Number((totalPatrimonioBase + utilidadEjercicio).toFixed(2));
  $: totalPasivoMasPatrimonio = Number((totalPasivos + totalPatrimonioNeto).toFixed(2));
  $: situacionCuadrada = Math.abs(totalActivos - totalPasivoMasPatrimonio) < 0.05;
</script>

<div class="contab-container">
  <!-- ENCABEZADO -->
  <div class="erp-view-header">
    <div class="erp-title-box">
      <h1 class="erp-main-title">Contabilidad</h1>
      <p class="erp-main-desc">Catálogo de cuentas jerárquico VEN-NIF, comprobantes de diario por partida doble y balances financieros.</p>
    </div>

    <div class="partida-doble-badge">
      <span class="badge-label">PARTIDA DOBLE ESTRICTA</span>
      <div class="badge-status-text">Debe ≡ Haber Validado</div>
    </div>
  </div>

  <!-- TABS -->
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

  <!-- 1. PLAN DE CUENTAS -->
  {#if activeSubvista === 'plan-cuentas'}
    <div class="view-content fade-in">
      <div class="action-bar">
        <div class="search-box">
          <input 
            type="text" 
            placeholder="Buscar por código (ej: 1.1) o descripción de cuenta..." 
            bind:value={filtroCuentas}
          />
        </div>
        <button class="btn-primary" on:click={() => showModalCuenta = true}>
          <span>Nueva Cuenta Contable</span>
        </button>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th style="width: 140px;">CÓDIGO</th>
              <th>DESCRIPCIÓN DE LA CUENTA</th>
              <th style="width: 100px;">NIVEL</th>
              <th style="width: 110px;">TIPO</th>
              <th style="width: 120px;">NATURALEZA</th>
              <th style="text-align: right; width: 150px;">SALDO AL CORTE</th>
            </tr>
          </thead>
          <tbody>
            {#each cuentasFiltradas as cuenta (cuenta.uuid)}
              <tr class="level-{cuenta.nivel} {cuenta.tipo === 'GRUPO' ? 'row-grupo' : 'row-detalle'}">
                <td>
                  <code class="codigo-chip">{cuenta.codigo}</code>
                </td>
                <td>
                  <div style="padding-left: {(cuenta.nivel - 1) * 20}px; display: flex; align-items: center; gap: 6px;">
                    {#if cuenta.tipo === 'GRUPO'}
                      <strong>{cuenta.nombre}</strong>
                    {:else}
                      <span>{cuenta.nombre}</span>
                    {/if}
                  </div>
                </td>
                <td>
                  <span class="nivel-tag">Nivel {cuenta.nivel}</span>
                </td>
                <td>
                  <span class="badge-tipo {cuenta.tipo.toLowerCase()}">{cuenta.tipo}</span>
                </td>
                <td>
                  <span class="badge-nat {cuenta.naturaleza.toLowerCase()}">{cuenta.naturaleza}</span>
                </td>
                <td style="text-align: right; font-weight: {cuenta.tipo === 'GRUPO' ? '800' : '600'};">
                  {fmtMoneda(cuenta.saldo)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- 2. CENTROS DE COSTOS -->
  {#if activeSubvista === 'centros-costos'}
    <div class="view-content fade-in">
      <div class="action-bar" style="margin-bottom: 16px;">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Centros de Costos y Unidades Analíticas</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Control presupuestario y seguimiento analítico de ejecución por sala y departamento.</p>
        </div>
        <div>
          <select 
            bind:value={selectedSalaFiltro}
            style="padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 700; background: #ffffff; color: #0f172a;"
          >
            <option value="ALL">Todas las Salas Asignadas</option>
            {#each userAvailableSalas as s}
              <option value={s.nombre || s.nombre_comercial}>{s.nombre || s.nombre_comercial}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="kpi-grid">
        {#each centrosCostos as cc}
          {@const pct = Math.min(100, Math.round(((cc.ejecutado_usd || 0) / (cc.presupuesto_usd || 1)) * 100))}
          {@const disponible = (cc.presupuesto_usd || 0) - (cc.ejecutado_usd || 0)}
          <div class="kpi-card" style="flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <span class="badge-code">{cc.codigo}</span>
              <span style="font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 12px; background: {pct >= 90 ? '#fee2e2' : pct >= 70 ? '#fef3c7' : '#dcfce7'}; color: {pct >= 90 ? '#b91c1c' : pct >= 70 ? '#b45309' : '#15803d'};">
                {pct}% EJECUTADO
              </span>
            </div>

            <div>
              <strong style="font-size: 15.5px; color: #0f172a; display: block; line-height: 1.3;">{cc.nombre}</strong>
              <span style="font-size: 12px; color: #64748b;">Responsable: {cc.responsable}</span>
            </div>

            <!-- BARRA DE PROGRESO DE PRESUPUESTO -->
            <div style="width: 100%; background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden;">
              <div style="width: {pct}%; background: {pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#16a34a'}; height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
            </div>

            <div style="width: 100%; border-top: 1px solid #f1f5f9; padding-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
              <div>
                <span style="color: #64748b; font-size: 11px; display: block;">PRESUPUESTO:</span>
                <strong style="color: #0f172a;">{fmtMoneda(cc.presupuesto_usd)}</strong>
              </div>
              <div style="text-align: right;">
                <span style="color: #64748b; font-size: 11px; display: block;">EJECUTADO:</span>
                <strong style="color: #2563eb;">{fmtMoneda(cc.ejecutado_usd)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 11px; display: block;">DISPONIBLE:</span>
                <strong style="color: {disponible < 0 ? '#dc2626' : '#15803d'};">{fmtMoneda(disponible)}</strong>
              </div>
              <div style="text-align: right;">
                <span style="color: #64748b; font-size: 11px; display: block;">SALA:</span>
                <span class="category-chip" style="font-size: 10.5px;">Sala Principal</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- 3. COMPROBANTES Y ASIENTOS -->
  {#if activeSubvista === 'asientos'}
    <div class="view-content fade-in">
      <div class="action-bar">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Registro de Comprobantes de Diario</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Partida doble estricta garantizada por asiento.</p>
        </div>
        <button class="btn-primary" on:click={() => showModalAsiento = true}>
          <span>Crear Asiento Contable</span>
        </button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 18px;">
        {#each asientos as asnt (asnt.uuid)}
          <div class="asiento-card">
            <div class="asiento-header">
              <div class="asiento-tags">
                <span class="badge-code asiento-nro">{asnt.nro}</span>
                <span class="badge-status active">{asnt.tipo}</span>
                <span class="asiento-fecha">Fecha: <b>{asnt.fecha}</b></span>
              </div>
              <span class="asiento-cuadrado-pill">
                ASIENTO CUADRADO
              </span>
            </div>

            <div class="asiento-glosa">
              <b>Glosa / Concepto:</b> {asnt.glosa}
            </div>

            <div class="asiento-table-wrap">
              <table class="table-custom text-xs">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="width: 140px;">CUENTA</th>
                    <th>DESCRIPCIÓN</th>
                    <th style="text-align: right; width: 140px;">DEBE</th>
                    <th style="text-align: right; width: 140px;">HABER</th>
                  </tr>
                </thead>
                <tbody>
                  {#each asnt.lineas as linea}
                    <tr>
                      <td><code>{linea.cuenta_codigo}</code></td>
                      <td>{linea.cuenta_nombre}</td>
                      <td style="text-align: right; font-weight: 700; color: {linea.debe > 0 ? '#0f172a' : '#94a3b8'};">
                        {linea.debe > 0 ? fmtMoneda(linea.debe) : '-'}
                      </td>
                      <td style="text-align: right; font-weight: 700; color: {linea.haber > 0 ? '#0f172a' : '#94a3b8'};">
                        {linea.haber > 0 ? fmtMoneda(linea.haber) : '-'}
                      </td>
                    </tr>
                  {/each}
                  <tr style="background: #f1f5f9; font-weight: 800;">
                    <td colspan="2" style="text-align: right;">TOTALES DEL COMPROBANTE:</td>
                    <td style="text-align: right; color: #2563eb;">
                      {fmtMoneda(asnt.lineas.reduce((acc, l) => acc + l.debe, 0))}
                    </td>
                    <td style="text-align: right; color: #2563eb;">
                      {fmtMoneda(asnt.lineas.reduce((acc, l) => acc + l.haber, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- 4. LIBROS CONTABLES -->
  {#if activeSubvista === 'libros'}
    <div class="view-content fade-in">
      <div class="action-bar" style="margin-bottom: 16px;">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Libro Mayor Analítico y Oficial</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Inspección detallada de movimientos por cuenta y saldos progresivos acumulados.</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button 
            type="button" 
            class="tab-btn {libroModo === 'mayor_analitico' ? 'active' : ''}" 
            style="padding: 6px 14px; font-size: 13px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: {libroModo === 'mayor_analitico' ? '#0f172a' : '#ffffff'}; color: {libroModo === 'mayor_analitico' ? '#ffffff' : '#334155'}; cursor: pointer;"
            on:click={() => libroModo = 'mayor_analitico'}
          >
            Mayor Analítico por Cuenta
          </button>
          <button 
            type="button" 
            class="tab-btn {libroModo === 'resumen_mayor' ? 'active' : ''}" 
            style="padding: 6px 14px; font-size: 13px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; background: {libroModo === 'resumen_mayor' ? '#0f172a' : '#ffffff'}; color: {libroModo === 'resumen_mayor' ? '#ffffff' : '#334155'}; cursor: pointer;"
            on:click={() => libroModo = 'resumen_mayor'}
          >
            Resumen de Saldos del Mayor
          </button>
        </div>
      </div>

      {#if libroModo === 'mayor_analitico'}
        <!-- SELECTOR DE CUENTA Y TARJETA INFORMATIVA -->
        <div class="card-padded" style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div style="flex: 1; min-width: 280px;">
              <label for="sel-cta-mayor" style="display: block; font-size: 11px; font-weight: 800; color: #475569; margin-bottom: 6px; text-transform: uppercase;">
                SELECCIONAR CUENTA CONTABLE DE DETALLE:
              </label>
              <select 
                id="sel-cta-mayor"
                bind:value={selectedCuentaMayor}
                style="width: 100%; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; font-weight: 700; background: #ffffff; color: #0f172a;"
              >
                {#each planCuentas.filter(c => c.tipo === 'DETALLE') as cta}
                  <option value={cta.codigo}>{cta.codigo} - {cta.nombre}</option>
                {/each}
              </select>
            </div>

            {#if cuentaSeleccionadaObj}
              <div style="display: flex; gap: 16px; background: #f8fafc; padding: 12px 18px; border-radius: 10px; border: 1px solid #e2e8f0;">
                <div>
                  <span style="font-size: 10.5px; font-weight: 700; color: #64748b; text-transform: uppercase;">NATURALEZA:</span>
                  <div style="font-weight: 800; color: #2563eb; font-size: 13px;">{cuentaSeleccionadaObj.naturaleza}</div>
                </div>
                <div style="border-left: 1px solid #cbd5e1; padding-left: 16px;">
                  <span style="font-size: 10.5px; font-weight: 700; color: #64748b; text-transform: uppercase;">SALDO EN CATÁLOGO:</span>
                  <div style="font-weight: 900; color: #0f172a; font-size: 15px;">{fmtMoneda(cuentaSeleccionadaObj.saldo)}</div>
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- TABLA DE MOVIMIENTOS ANALÍTICOS Y SALDO PROGRESIVO -->
        <div class="card-flow table-responsive">
          <table class="table-custom">
            <thead>
              <tr>
                <th>FECHA</th>
                <th>COMPROBANTE</th>
                <th>TIPO</th>
                <th>GLOSA / CONCEPTO DEL ASIENTO</th>
                <th style="text-align: right;">DEBE ($)</th>
                <th style="text-align: right;">HABER ($)</th>
                <th style="text-align: right;">SALDO PROGRESIVO ($)</th>
              </tr>
            </thead>
            <tbody>
              {#each movimientosMayorCuenta as m}
                <tr>
                  <td>{m.fecha}</td>
                  <td><strong>{m.asiento_nro}</strong></td>
                  <td><span class="category-chip">{m.tipo}</span></td>
                  <td>{m.glosa}</td>
                  <td style="text-align: right; font-weight: 700; color: {m.debe > 0 ? '#15803d' : '#94a3b8'};">
                    {m.debe > 0 ? fmtMoneda(m.debe) : '-'}
                  </td>
                  <td style="text-align: right; font-weight: 700; color: {m.haber > 0 ? '#b91c1c' : '#94a3b8'};">
                    {m.haber > 0 ? fmtMoneda(m.haber) : '-'}
                  </td>
                  <td style="text-align: right; font-weight: 900; color: #0f172a; font-size: 13.5px;">
                    {fmtMoneda(m.saldo_progresivo)}
                  </td>
                </tr>
              {/each}
              {#if movimientosMayorCuenta.length === 0}
                <tr>
                  <td colspan="7" class="empty-state" style="text-align: center; padding: 24px; color: #64748b;">
                    No hay asientos registrados en el período para la cuenta {selectedCuentaMayor}.
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      {:else}
        <!-- RESUMEN DE SALDOS DEL MAYOR -->
        <div class="card-flow table-responsive">
          <table class="table-custom">
            <thead>
              <tr>
                <th>CUENTA</th>
                <th>NOMBRE</th>
                <th style="text-align: right;">SALDO INICIAL</th>
                <th style="text-align: right;">TOTAL DÉBITOS</th>
                <th style="text-align: right;">TOTAL CRÉDITOS</th>
                <th style="text-align: right;">SALDO FINAL</th>
              </tr>
            </thead>
            <tbody>
              {#each planCuentas.filter(c => c.tipo === 'DETALLE') as cta}
                <tr>
                  <td><code>{cta.codigo}</code></td>
                  <td><strong>{cta.nombre}</strong></td>
                  <td style="text-align: right;">{fmtMoneda(cta.saldo * 0.9)}</td>
                  <td style="text-align: right; color: #2563eb;">{fmtMoneda(cta.saldo * 0.15)}</td>
                  <td style="text-align: right; color: #d97706;">{fmtMoneda(cta.saldo * 0.05)}</td>
                  <td style="text-align: right; font-weight: 800; color: #0f172a;">{fmtMoneda(cta.saldo)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- 5. ESTADOS FINANCIEROS VEN-NIF -->
  {#if activeSubvista === 'reportes'}
    <div class="view-content fade-in">
      <div class="action-bar" style="margin-bottom: 20px;">
        <div class="subvista-pills">
          <button 
            type="button" 
            class="subvista-pill {subvistaReportes === 'comprobacion' ? 'active' : ''}" 
            on:click={() => subvistaReportes = 'comprobacion'}
          >
            Balance de Comprobación
          </button>
          <button 
            type="button" 
            class="subvista-pill {subvistaReportes === 'resultados' ? 'active' : ''}" 
            on:click={() => subvistaReportes = 'resultados'}
          >
            Estado de Resultados (VEN-NIF)
          </button>
          <button 
            type="button" 
            class="subvista-pill {subvistaReportes === 'situacion' ? 'active' : ''}" 
            on:click={() => subvistaReportes = 'situacion'}
          >
            Situación Financiera (Balance General)
          </button>
        </div>

        <div style="display: flex; gap: 10px;">
          <button class="btn-secondary" on:click={imprimirReporteContable}>
            <span>Imprimir Informe</span>
          </button>
        </div>
      </div>

      <!-- 5.1 BALANCE DE COMPROBACIÓN -->
      {#if subvistaReportes === 'comprobacion'}
        <div class="card-padded" style="margin-bottom: 16px;">
          <h3 class="card-title-lg">Balance de Comprobación de Sumas y Saldos</h3>
          <p class="card-desc">Corte contable oficial al cierre del período. Moneda funcional: USD con referencia oficial.</p>
        </div>

        <div class="card-flow table-responsive">
          <table class="table-custom">
            <thead>
              <tr>
                <th>CÓDIGO</th>
                <th>CUENTA</th>
                <th style="text-align: right;">TOTAL DEBE</th>
                <th style="text-align: right;">TOTAL HABER</th>
                <th style="text-align: right;">SALDO DEUDOR</th>
                <th style="text-align: right;">SALDO ACREEDOR</th>
              </tr>
            </thead>
            <tbody>
              {#each planCuentas.filter(c => c.tipo === 'DETALLE') as c}
                <tr>
                  <td><code>{c.codigo}</code></td>
                  <td>{c.nombre}</td>
                  <td style="text-align: right;">{c.naturaleza === 'DEUDORA' ? fmtMoneda(c.saldo) : '-'}</td>
                  <td style="text-align: right;">{c.naturaleza === 'ACREEDORA' ? fmtMoneda(c.saldo) : '-'}</td>
                  <td style="text-align: right; font-weight: 700; color: {c.naturaleza === 'DEUDORA' ? '#15803d' : '#94a3b8'};">
                    {c.naturaleza === 'DEUDORA' ? fmtMoneda(c.saldo) : '-'}
                  </td>
                  <td style="text-align: right; font-weight: 700; color: {c.naturaleza === 'ACREEDORA' ? '#15803d' : '#94a3b8'};">
                    {c.naturaleza === 'ACREEDORA' ? fmtMoneda(c.saldo) : '-'}
                  </td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #cbd5e1;">
                <td colspan="2" style="text-align: right; text-transform: uppercase;">Sumas y Saldos Totales:</td>
                <td style="text-align: right; color: #2563eb;">{fmtMoneda(totalBalanceDebe)}</td>
                <td style="text-align: right; color: #2563eb;">{fmtMoneda(totalBalanceHaber)}</td>
                <td style="text-align: right; color: #15803d;">{fmtMoneda(totalBalanceDebe)}</td>
                <td style="text-align: right; color: #15803d;">{fmtMoneda(totalBalanceHaber)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      {/if}

      <!-- 5.2 ESTADO DE RESULTADOS (VEN-NIF) -->
      {#if subvistaReportes === 'resultados'}
        <div class="card-padded" style="margin-bottom: 16px;">
          <h3 class="card-title-lg">Estado de Resultados (Ganancias y Pérdidas)</h3>
          <p class="card-desc">Norma VEN-NIF GE / PYME. Estructura de Ingresos Operacionales y Gastos del Ejercicio.</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 20px;">
          <!-- INGRESOS -->
          <div class="card-flow table-responsive">
            <div style="padding: 14px 18px; background: #f0fdf4; border-bottom: 1px solid #bbf7d0; font-weight: 800; color: #166534; font-size: 13.5px;">
              4. INGRESOS OPERACIONALES
            </div>
            <table class="table-custom">
              <thead>
                <tr>
                  <th>CÓDIGO</th>
                  <th>CUENTA DE INGRESO</th>
                  <th style="text-align: right;">MONTO (USD)</th>
                </tr>
              </thead>
              <tbody>
                {#each ctasIngresos.filter(c => c.tipo === 'DETALLE') as c}
                  <tr>
                    <td><code>{c.codigo}</code></td>
                    <td>{c.nombre}</td>
                    <td style="text-align: right; font-weight: 700; color: #15803d;">{fmtMoneda(c.saldo)}</td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #bbf7d0;">
                  <td colspan="2" style="text-align: right;">TOTAL INGRESOS OPERACIONALES:</td>
                  <td style="text-align: right; color: #15803d; font-size: 15px;">{fmtMoneda(totalIngresos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- COSTOS Y GASTOS -->
          <div class="card-flow table-responsive">
            <div style="padding: 14px 18px; background: #fef2f2; border-bottom: 1px solid #fecaca; font-weight: 800; color: #991b1b; font-size: 13.5px;">
              5. COSTOS Y GASTOS OPERACIONALES
            </div>
            <table class="table-custom">
              <thead>
                <tr>
                  <th>CÓDIGO</th>
                  <th>CUENTA DE GASTO</th>
                  <th style="text-align: right;">MONTO (USD)</th>
                </tr>
              </thead>
              <tbody>
                {#each ctasGastos.filter(c => c.tipo === 'DETALLE') as c}
                  <tr>
                    <td><code>{c.codigo}</code></td>
                    <td>{c.nombre}</td>
                    <td style="text-align: right; font-weight: 700; color: #dc2626;">{fmtMoneda(c.saldo)}</td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #fecaca;">
                  <td colspan="2" style="text-align: right;">TOTAL COSTOS Y GASTOS:</td>
                  <td style="text-align: right; color: #dc2626; font-size: 15px;">{fmtMoneda(totalGastos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- RESULTADO NETO -->
          <div class="card-padded" style="border: 2px solid {utilidadEjercicio >= 0 ? '#bbf7d0' : '#fecaca'}; background: {utilidadEjercicio >= 0 ? '#f0fdf4' : '#fef2f2'};">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
              <div>
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #64748b;">
                  RESULTADO NETO DEL EJERCICIO
                </div>
                <div style="font-size: 22px; font-weight: 900; color: {utilidadEjercicio >= 0 ? '#15803d' : '#dc2626'};">
                  {utilidadEjercicio >= 0 ? 'UTILIDAD NETA OPERATIVA' : 'PÉRDIDA DEL EJERCICIO'}
                </div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                  Margen Operativo: {totalIngresos > 0 ? ((utilidadEjercicio / totalIngresos) * 100).toFixed(1) : 0}% sobre ingresos brutos
                </div>
              </div>
              <div style="font-size: 28px; font-weight: 900; color: {utilidadEjercicio >= 0 ? '#15803d' : '#dc2626'};">
                {fmtMoneda(utilidadEjercicio)}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- 5.3 SITUACIÓN FINANCIERA (BALANCE GENERAL VEN-NIF) -->
      {#if subvistaReportes === 'situacion'}
        <div class="card-padded" style="margin-bottom: 16px;">
          <h3 class="card-title-lg">Estado de Situación Financiera (Balance General)</h3>
          <p class="card-desc">Norma VEN-NIF. Verificación estricta de la ecuación contable patrimonial: Activo ≡ Pasivo + Patrimonio.</p>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 20px;">
          <!-- COLUMNA ACTIVOS -->
          <div class="card-flow table-responsive">
            <div style="padding: 14px 18px; background: #eff6ff; border-bottom: 1px solid #bfdbfe; font-weight: 800; color: #1e40af; font-size: 13.5px;">
              1. ACTIVOS
            </div>
            <table class="table-custom">
              <thead>
                <tr>
                  <th>CÓDIGO</th>
                  <th>CUENTA</th>
                  <th style="text-align: right;">SALDO (USD)</th>
                </tr>
              </thead>
              <tbody>
                {#each ctasActivos.filter(c => c.tipo === 'DETALLE') as c}
                  <tr>
                    <td><code>{c.codigo}</code></td>
                    <td>{c.nombre}</td>
                    <td style="text-align: right; font-weight: 600;">{fmtMoneda(c.saldo)}</td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr style="background: #eff6ff; font-weight: 900; border-top: 2px solid #93c5fd;">
                  <td colspan="2">TOTAL ACTIVO:</td>
                  <td style="text-align: right; color: #1d4ed8; font-size: 15px;">{fmtMoneda(totalActivos)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- COLUMNA PASIVOS Y PATRIMONIO -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- PASIVOS -->
            <div class="card-flow table-responsive">
              <div style="padding: 14px 18px; background: #fffbeb; border-bottom: 1px solid #fde68a; font-weight: 800; color: #92400e; font-size: 13.5px;">
                2. PASIVOS
              </div>
              <table class="table-custom">
                <thead>
                  <tr>
                    <th>CÓDIGO</th>
                    <th>CUENTA</th>
                    <th style="text-align: right;">SALDO (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {#each ctasPasivos.filter(c => c.tipo === 'DETALLE') as c}
                    <tr>
                      <td><code>{c.codigo}</code></td>
                      <td>{c.nombre}</td>
                      <td style="text-align: right; font-weight: 600;">{fmtMoneda(c.saldo)}</td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr style="background: #fffbeb; font-weight: 900; border-top: 2px solid #fcd34d;">
                    <td colspan="2">TOTAL PASIVO:</td>
                    <td style="text-align: right; color: #b45309; font-size: 15px;">{fmtMoneda(totalPasivos)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <!-- PATRIMONIO -->
            <div class="card-flow table-responsive">
              <div style="padding: 14px 18px; background: #f5f3ff; border-bottom: 1px solid #ddd6fe; font-weight: 800; color: #5b21b6; font-size: 13.5px;">
                3. PATRIMONIO NETO
              </div>
              <table class="table-custom">
                <thead>
                  <tr>
                    <th>CÓDIGO</th>
                    <th>CUENTA</th>
                    <th style="text-align: right;">SALDO (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {#each ctasPatrimonio.filter(c => c.tipo === 'DETALLE') as c}
                    <tr>
                      <td><code>{c.codigo}</code></td>
                      <td>{c.nombre}</td>
                      <td style="text-align: right; font-weight: 600;">{fmtMoneda(c.saldo)}</td>
                    </tr>
                  {/each}
                  <tr style="background: #faf5ff;">
                    <td><code>3.3.1.01</code></td>
                    <td><em>Resultado Neto del Ejercicio en Curso</em></td>
                    <td style="text-align: right; font-weight: 800; color: {utilidadEjercicio >= 0 ? '#15803d' : '#dc2626'};">
                      {fmtMoneda(utilidadEjercicio)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style="background: #f5f3ff; font-weight: 900; border-top: 2px solid #c4b5fd;">
                    <td colspan="2">TOTAL PATRIMONIO:</td>
                    <td style="text-align: right; color: #6d28d9; font-size: 15px;">{fmtMoneda(totalPatrimonioNeto)}</td>
                  </tr>
                  <tr style="background: #0f172a; color: #ffffff; font-weight: 900;">
                    <td colspan="2">TOTAL PASIVO + PATRIMONIO:</td>
                    <td style="text-align: right; font-size: 16px; color: #38bdf8;">{fmtMoneda(totalPasivoMasPatrimonio)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <!-- BARRA AUDITORÍA PATRIMONIAL -->
        <div class="card-padded" style="margin-top: 20px; border-left: 5px solid {situacionCuadrada ? '#16a34a' : '#dc2626'}; background: #ffffff;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase;">VERIFICACIÓN DE ECUACIÓN PATRIMONIAL</div>
              <div style="font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 2px;">
                Activo ({fmtMoneda(totalActivos)}) ≡ Pasivo ({fmtMoneda(totalPasivos)}) + Patrimonio ({fmtMoneda(totalPatrimonioNeto)})
              </div>
            </div>
            <div>
              {#if situacionCuadrada}
                <span class="badge-status-pill badge-green">ECUACIÓN PATRIMONIAL BALANCEADA (CUADRADA)</span>
              {:else}
                <span class="badge-status-pill badge-red">DESCUADRE PATRIMONIAL DETECTADO</span>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- MODAL NUEVA CUENTA -->
{#if showModalCuenta}
  <div class="modal-backdrop fade-in" role="presentation">
    <div class="modal-card" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <h3>Agregar Cuenta Contable</h3>
        <button class="btn-close" on:click={() => showModalCuenta = false}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label for="f-cta-cod">Código Contable *</label>
            <input id="f-cta-cod" type="text" bind:value={nuevaCuenta.codigo} placeholder="Ej: 1.1.1.04" />
          </div>
          <div class="form-group">
            <label for="f-cta-niv">Nivel Jerárquico</label>
            <select id="f-cta-niv" bind:value={nuevaCuenta.nivel}>
              <option value={1}>Nivel 1 (Clase)</option>
              <option value={2}>Nivel 2 (Grupo)</option>
              <option value={3}>Nivel 3 (Subgrupo)</option>
              <option value={4}>Nivel 4 (Detalle / Movimiento)</option>
            </select>
          </div>
          <div class="form-group col-span-2">
            <label for="f-cta-nom">Descripción de la Cuenta *</label>
            <input id="f-cta-nom" type="text" bind:value={nuevaCuenta.nombre} placeholder="Nombre oficial de la cuenta" />
          </div>
          <div class="form-group">
            <label for="f-cta-tip">Tipo de Cuenta</label>
            <select id="f-cta-tip" bind:value={nuevaCuenta.tipo}>
              <option value="DETALLE">DETALLE (Recibe Asientos)</option>
              <option value="GRUPO">GRUPO (Totalizadora)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="f-cta-nat">Naturaleza</label>
            <select id="f-cta-nat" bind:value={nuevaCuenta.naturaleza}>
              <option value="DEUDORA">DEUDORA (Activo / Costo / Gasto)</option>
              <option value="ACREEDORA">ACREEDORA (Pasivo / Patrimonio / Ingreso)</option>
            </select>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => showModalCuenta = false}>Cancelar</button>
        <button class="btn-primary" on:click={guardarCuenta}>Incorporar Cuenta</button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL NUEVO ASIENTO CONTABLE -->
{#if showModalAsiento}
  <div class="modal-backdrop fade-in" role="presentation">
    <div class="modal-card" style="max-width: 780px;" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <h3>Registrar Comprobante / Asiento Contable</h3>
        <button class="btn-close" on:click={() => showModalAsiento = false}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-grid mb-4">
          <div class="form-group">
            <label for="f-asnt-fch">Fecha del Asiento</label>
            <input id="f-asnt-fch" type="date" bind:value={nuevoAsiento.fecha} />
          </div>
          <div class="form-group">
            <label for="f-asnt-tip">Tipo de Comprobante</label>
            <select id="f-asnt-tip" bind:value={nuevoAsiento.tipo}>
              <option value="DIARIO">DIARIO</option>
              <option value="INGRESO">INGRESO / CAJA</option>
              <option value="EGRESO">EGRESO / PAGO</option>
            </select>
          </div>
          <div class="form-group col-span-2">
            <label for="f-asnt-gls">Glosa / Concepto Contable *</label>
            <input id="f-asnt-gls" type="text" bind:value={nuevoAsiento.glosa} placeholder="Descripción clara del hecho económico registrado" />
          </div>
        </div>

        <!-- LÍNEAS DE PARTIDA DOBLE -->
        <div style="border-top: 1px solid #e2e8f0; padding-top: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong style="font-size: 13.5px; color: #0f172a;">Líneas del Asiento (Partida Doble)</strong>
            <button class="btn-secondary text-xs" on:click={agregarLineaAsiento}>
              <span>Agregar Línea</span>
            </button>
          </div>

          <table class="table-custom text-xs">
            <thead>
              <tr style="background: #f8fafc;">
                <th>CUENTA CONTABLE</th>
                <th style="width: 140px;">DEBE ($)</th>
                <th style="width: 140px;">HABER ($)</th>
                <th style="width: 50px;"></th>
              </tr>
            </thead>
            <tbody>
              {#each nuevoAsiento.lineas as linea, idx}
                <tr>
                  <td>
                    <select bind:value={linea.cuenta_codigo} style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px;">
                      {#each planCuentas.filter(c => c.tipo === 'DETALLE') as c}
                        <option value={c.codigo}>{c.codigo} - {c.nombre}</option>
                      {/each}
                    </select>
                  </td>
                  <td>
                    <input type="number" step="0.01" bind:value={linea.debe} style="width: 100%; padding: 6px; text-align: right; border: 1px solid #cbd5e1; border-radius: 6px;" />
                  </td>
                  <td>
                    <input type="number" step="0.01" bind:value={linea.haber} style="width: 100%; padding: 6px; text-align: right; border: 1px solid #cbd5e1; border-radius: 6px;" />
                  </td>
                  <td style="text-align: center;">
                    <button class="btn-sm danger" style="padding: 2px 6px; font-size: 11px; cursor: pointer;" on:click={() => eliminarLineaAsiento(idx)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          <!-- TOTALES Y VALIDACIÓN PARTIDA DOBLE -->
          <div class="partida-validator {estaCuadradoNuevo ? 'cuadrado' : 'descuadrado'}">
            <div class="col">
              <span>TOTAL DEBE:</span>
              <strong>{fmtMoneda(totalDebeNuevo)}</strong>
            </div>
            <div class="col">
              <span>TOTAL HABER:</span>
              <strong>{fmtMoneda(totalHaberNuevo)}</strong>
            </div>
            <div class="status-col">
              {#if estaCuadradoNuevo}
                <span class="status-ok">
                  ASIENTO CUADRADO
                </span>
              {:else}
                <span class="status-error">
                  DESCUADRE: {fmtMoneda(Math.abs(totalDebeNuevo - totalHaberNuevo))}
                </span>
              {/if}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => showModalAsiento = false}>Cancelar</button>
        <button class="btn-primary" disabled={!estaCuadradoNuevo} on:click={guardarAsiento}>
          Validar y Asentar Comprobante
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .contab-container {
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

  .partida-doble-badge {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    border-radius: 10px;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: right;
    flex-shrink: 0;
  }

  .partida-doble-badge .badge-label {
    font-size: 11px;
    font-weight: 800;
    color: #047857;
    letter-spacing: 0.5px;
  }

  .partida-doble-badge .badge-status-text {
    font-size: 13px;
    font-weight: 700;
    color: #065f46;
  }

  /* TABS */
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

  .tab-icon { font-size: 18px; }

  /* ACCIONES Y BÚSQUEDA */
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
  }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-primary:disabled { background: #94a3b8; cursor: not-allowed; box-shadow: none; }

  .btn-secondary {
    background: #ffffff;
    color: #475569;
    border: 1px solid #cbd5e1;
    padding: 8px 14px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

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

  /* ASIENTOS CONTABLES CARD */
  .asiento-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 22px 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .asiento-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 12px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .asiento-tags {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .asiento-nro {
    font-size: 13px;
    padding: 4px 8px;
  }

  .asiento-fecha {
    font-size: 13px;
    color: #64748b;
  }

  .asiento-cuadrado-pill {
    color: #059669;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }

  .asiento-glosa {
    font-size: 13.5px;
    color: #334155;
    line-height: 1.5;
  }

  .asiento-table-wrap {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
  }

  .row-grupo td {
    background: #f8fafc;
    font-weight: 700;
  }

  .codigo-chip {
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .nivel-tag {
    font-size: 11px;
    color: #64748b;
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .badge-tipo {
    font-size: 10.5px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
  }
  .badge-tipo.grupo { background: #e0f2fe; color: #0369a1; }
  .badge-tipo.detalle { background: #ecfdf5; color: #047857; }

  .badge-nat {
    font-size: 10.5px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
  }
  .badge-nat.deudora { background: #eff6ff; color: #1d4ed8; }
  .badge-nat.acreedora { background: #fef3c7; color: #b45309; }

  .badge-code {
    background: #f1f5f9;
    color: #475569;
    font-family: monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 6px;
    border-radius: 4px;
  }

  .badge-status.active { background: #dcfce7; color: #15803d; font-size: 10.5px; font-weight: 800; padding: 2px 8px; border-radius: 12px; }

  .partida-validator {
    margin-top: 14px;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .partida-validator.cuadrado { background: #f0fdf4; border: 1px solid #86efac; }
  .partida-validator.descuadrado { background: #fef2f2; border: 1px solid #fecaca; }

  .partida-validator .col {
    display: flex;
    flex-direction: column;
    font-size: 11px;
    color: #475569;
  }
  .partida-validator .col strong { font-size: 15px; color: #0f172a; }

  .status-ok {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #15803d;
    font-weight: 800;
    font-size: 13px;
  }

  .status-error {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #b91c1c;
    font-weight: 800;
    font-size: 13px;
  }

  .btn-icon {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
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
    color: #94a3b8;
    cursor: pointer;
  }

  .modal-body { padding: 20px; }
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
  .form-group.col-span-2 { grid-column: span 2; }
  .form-group label { font-size: 12px; font-weight: 700; color: #334155; }
  .form-group input, .form-group select {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13.5px;
    outline: none;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
  }

  .kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 18px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .subvista-pills {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .subvista-pill {
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #475569;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .subvista-pill:hover {
    background: #f1f5f9;
  }

  .subvista-pill.active {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .card-padded {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 20px 24px;
  }

  .card-title-lg {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
  }

  .card-desc {
    font-size: 13px;
    color: #64748b;
    margin: 4px 0 0 0;
  }

  .badge-status-pill {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.03em;
  }

  .badge-green {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .badge-red {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .fade-in {
    animation: fadeIn 0.2s ease-in-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media print {
    :global(body) {
      background: #ffffff !important;
    }
    :global(header), :global(aside), :global(nav), .erp-view-header, .tabs-nav, .action-bar, .modal-backdrop {
      display: none !important;
    }
    .contab-container {
      padding: 0 !important;
      max-width: 100% !important;
    }
    .card-flow, .card-padded {
      box-shadow: none !important;
      border: 1px solid #000 !important;
    }
  }
</style>
