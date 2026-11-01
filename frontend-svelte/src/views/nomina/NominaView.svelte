<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  const SUBVISTAS = [
    { id: 'personal', label: 'Personal y Salarios', icon: 'badge', desc: 'Ficha salarial, cargos y asignación de cuentas' },
    { id: 'conceptos', label: 'Conceptos y Fórmulas', icon: 'functions', desc: 'Asignaciones y deducciones de ley (IVSS, FAOV, INCES)' },
    { id: 'procesamiento', label: 'Procesamiento de Nómina', icon: 'payments', desc: 'Cálculo quincenal/semanal masivo y aprobación' },
    { id: 'prestaciones', label: 'Prestaciones (LOTTT)', icon: 'savings', desc: 'Garantía trimestral Art. 142 LOTTT, vacaciones y utilidades' },
    { id: 'reportes', label: 'Recibos y Reportes', icon: 'description', desc: 'Recibos de pago individuales y sábanas bancarias' }
  ];

  let activeSubvista = 'personal';
  let tasaBcv = 62.50;

  let unsubRoute;
  onMount(() => {
    unsubRoute = currentRouteStore.subscribe(val => {
      const clean = String(val || '').replace(/^#\/?/, '').replace(/^\//, '').trim();
      const parts = clean.split('/');
      if (parts[0] === 'nomina' && parts[1]) {
        if (SUBVISTAS.some(s => s.id === parts[1])) {
          activeSubvista = parts[1];
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubRoute) unsubRoute();
  });

  function cambiarSubvista(id) {
    activeSubvista = id;
    navigateToRoute(`nomina/${id}`);
  }

  // --- DATOS DEMO / ESTADO V1 PERSONAL Y NÓMINA ---
  let empleados = [
    { uuid: 'emp-01', cedula: 'V-18.492.019', nombres: 'Carlos Mendoza', cargo: 'Pitboss / Jefe de Sala', departamento: 'Mesas en Vivo', sueldo_base_usd: 650.00, cestaticket_usd: 40.00, frecuencia: 'QUINCENAL', banco: 'Banesco', nro_cuenta: '0134-0821-49-1029384756', estado: 'ACTIVO' },
    { uuid: 'emp-02', cedula: 'V-20.183.921', nombres: 'Mariana Silva', cargo: 'Croupier Principal Baccarat', departamento: 'Mesas en Vivo', sueldo_base_usd: 480.00, cestaticket_usd: 40.00, frecuencia: 'QUINCENAL', banco: 'Mercantil', nro_cuenta: '0105-0291-83-9102837465', estado: 'ACTIVO' },
    { uuid: 'emp-03', cedula: 'V-23.819.284', nombres: 'Alejandro Ramos', cargo: 'Operador de Monitoreo CECOM', departamento: 'Seguridad Integral', sueldo_base_usd: 420.00, cestaticket_usd: 40.00, frecuencia: 'QUINCENAL', banco: 'Banesco', nro_cuenta: '0134-0192-38-4920192837', estado: 'ACTIVO' },
    { uuid: 'emp-04', cedula: 'V-19.384.712', nombres: 'Dayana Gómez', cargo: 'Cajera Bóveda y Canje', departamento: 'Administración y Caja', sueldo_base_usd: 450.00, cestaticket_usd: 40.00, frecuencia: 'QUINCENAL', banco: 'Banco de Venezuela', nro_cuenta: '0102-0938-12-3920194857', estado: 'ACTIVO' },
    { uuid: 'emp-05', cedula: 'V-25.102.938', nombres: 'José Gregorio Pérez', cargo: 'Técnico de Máquinas y Slots', departamento: 'Mantenimiento Técnico', sueldo_base_usd: 500.00, cestaticket_usd: 40.00, frecuencia: 'QUINCENAL', banco: 'Banesco', nro_cuenta: '0134-0928-11-2019485729', estado: 'ACTIVO' }
  ];

  let filtroPersonal = '';
  $: personalFiltrado = empleados.filter(e => 
    e.nombres.toLowerCase().includes(filtroPersonal.toLowerCase()) ||
    e.cedula.toLowerCase().includes(filtroPersonal.toLowerCase()) ||
    e.cargo.toLowerCase().includes(filtroPersonal.toLowerCase())
  );

  // --- CONCEPTOS DE NÓMINA (LEY VENEZOLANA) ---
  let conceptos = [
    { uuid: 'c-01', codigo: 'ASIG-001', nombre: 'Sueldo Básico Quincenal', tipo: 'ASIGNACION', formula: 'Sueldo Base Mensual / 2', gravable_ivss: true },
    { uuid: 'c-02', codigo: 'ASIG-002', nombre: 'Bono de Alimentación (Cestaticket)', tipo: 'ASIGNACION', formula: '40 USD Oficial BCV / 2', gravable_ivss: false },
    { uuid: 'c-03', codigo: 'ASIG-003', nombre: 'Horas Extras Diurnas (50% Recargo)', tipo: 'ASIGNACION', formula: '(Sueldo Diario / 8) * 1.5 * Horas', gravable_ivss: true },
    { uuid: 'c-04', codigo: 'ASIG-004', nombre: 'Bono de Asistencia y Puntualidad', tipo: 'ASIGNACION', formula: 'Monto Fijo Pactado', gravable_ivss: false },
    { uuid: 'c-05', codigo: 'DED-001', nombre: 'Seguro Social Obligatorio (IVSS 4%)', tipo: 'DEDUCCION', formula: '(Sueldo Básico * 12 / 52) * 4% * Lunes del Mes', gravable_ivss: false },
    { uuid: 'c-06', codigo: 'DED-002', nombre: 'Fondo de Ahorro Habitacional (FAOV 1%)', tipo: 'DEDUCCION', formula: 'Sueldo Integral * 1%', gravable_ivss: false },
    { uuid: 'c-07', codigo: 'DED-003', nombre: 'Anticipos de Sueldo / Préstamos', tipo: 'DEDUCCION', formula: 'Cuota Pactada Empleado', gravable_ivss: false }
  ];

  // --- PROCESAMIENTO DE NÓMINA QUINCENAL ---
  let periodoNomina = {
    nombre: '2da Quincena Octubre 2026',
    desde: '2026-10-16',
    hasta: '2026-10-31',
    estado: 'EN_BORRADOR'
  };

  // Cálculo por trabajador en V1
  $: resumenCalculo = empleados.map(emp => {
    const sueldoQuincena = emp.sueldo_base_usd / 2;
    const cestaQuincena = emp.cestaticket_usd / 2;
    const horasExtras = emp.uuid === 'emp-02' ? 35.00 : 0.00; // Mariana Silva con horas extras de ejemplo
    const totalAsignaciones = sueldoQuincena + cestaQuincena + horasExtras;

    // Deducciones de ley
    const dedIvss = sueldoQuincena * 0.04;
    const dedFaov = sueldoQuincena * 0.01;
    const totalDeducciones = dedIvss + dedFaov;

    const netoPagarUsd = totalAsignaciones - totalDeducciones;
    const netoPagarBs = netoPagarUsd * tasaBcv;

    return {
      ...emp,
      sueldoQuincena,
      cestaQuincena,
      horasExtras,
      totalAsignaciones,
      dedIvss,
      dedFaov,
      totalDeducciones,
      netoPagarUsd,
      netoPagarBs
    };
  });

  $: totalNominaUsd = resumenCalculo.reduce((acc, r) => acc + r.netoPagarUsd, 0);
  $: totalNominaBs = totalNominaUsd * tasaBcv;

  // Visualizador de Recibo de Pago
  let empleadoRecibo = null;

  function abrirRecibo(r) {
    empleadoRecibo = r;
  }

  function aprobarNomina() {
    periodoNomina.estado = 'APROBADA';
    triggerToast('¡Nómina Quincenal Aprobada! Se generaron los pasivos y recibos de pago.', 'success');
  }

  function fmtUsd(val) {
    return '$ ' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtBs(val) {
    return 'Bs. ' + Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
</script>

<div class="nomina-container">
  <!-- ENCABEZADO -->
  <div class="nomina-header">
    <div class="header-left">
      <div class="header-badge">
        <span class="material-icons" style="font-size: 16px;">people</span>
        <span>SISTEMA DE NÓMINA LOTTT V1</span>
      </div>
      <h1 class="header-title">Módulo de Nómina y Pasivos Laborales</h1>
      <p class="header-sub">Cálculo de asignaciones, deducciones de ley venezolana (IVSS, FAOV), prestaciones sociales y recibos.</p>
    </div>

    <!-- TASA BCV -->
    <div class="bcv-widget">
      <div class="bcv-top">
        <span class="material-icons" style="font-size: 18px; color: #10b981;">payments</span>
        <span class="bcv-label">TASA CAMBIO NOMINA</span>
      </div>
      <div class="bcv-val-row">
        <span>1 USD = {tasaBcv.toFixed(2)} VES</span>
      </div>
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
        <span class="material-icons tab-icon">{sub.icon}</span>
        <span class="tab-label">{sub.label}</span>
      </button>
    {/each}
  </div>

  <!-- 1. PERSONAL Y SALARIOS -->
  {#if activeSubvista === 'personal'}
    <div class="view-content fade-in">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-icon blue"><span class="material-icons">badge</span></div>
          <div class="kpi-info">
            <span class="kpi-label">TOTAL PERSONAL ACTIVO</span>
            <span class="kpi-val">{empleados.length}</span>
            <span class="kpi-sub">En plantilla de nómina</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon green"><span class="material-icons">attach_money</span></div>
          <div class="kpi-info">
            <span class="kpi-label">TOTAL SUELDOS BASE (MES)</span>
            <span class="kpi-val">
              {fmtUsd(empleados.reduce((acc, e) => acc + e.sueldo_base_usd, 0))}
            </span>
            <span class="kpi-sub">{fmtBs(empleados.reduce((acc, e) => acc + e.sueldo_base_usd, 0) * tasaBcv)}</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon purple"><span class="material-icons">fastfood</span></div>
          <div class="kpi-info">
            <span class="kpi-label">CESTATICKET MENSUAL</span>
            <span class="kpi-val">{fmtUsd(empleados.length * 40)}</span>
            <span class="kpi-sub">40 USD / trabajador</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-icon amber"><span class="material-icons">schedule</span></div>
          <div class="kpi-info">
            <span class="kpi-label">FRECUENCIA</span>
            <span class="kpi-val">QUINCENAL</span>
            <span class="kpi-sub">Días 15 y último</span>
          </div>
        </div>
      </div>

      <div class="action-bar">
        <div class="search-box">
          <span class="material-icons">search</span>
          <input 
            type="text" 
            placeholder="Buscar por cédula, nombre o cargo..." 
            bind:value={filtroPersonal}
          />
        </div>
        <button class="btn-primary" on:click={() => triggerToast('Integrado con catálogo central de RRHH', 'info')}>
          <span class="material-icons">person_add</span>
          <span>Asignar Ficha Salarial</span>
        </button>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>CÉDULA</th>
              <th>NOMBRES Y APELLIDOS</th>
              <th>CARGO OPERATIVO</th>
              <th>DEPARTAMENTO</th>
              <th style="text-align: right;">SUELDO BASE ($)</th>
              <th style="text-align: right;">SUELDO EN BS</th>
              <th>BANCO / CUENTA</th>
              <th style="text-align: center;">ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {#each personalFiltrado as emp (emp.uuid)}
              <tr>
                <td><code>{emp.cedula}</code></td>
                <td><strong>{emp.nombres}</strong></td>
                <td><span class="category-chip">{emp.cargo}</span></td>
                <td>{emp.departamento}</td>
                <td style="text-align: right; font-weight: 800; color: #15803d;">
                  {fmtUsd(emp.sueldo_base_usd)}
                </td>
                <td style="text-align: right; font-size: 11.5px; color: #64748b;">
                  {fmtBs(emp.sueldo_base_usd * tasaBcv)}
                </td>
                <td>
                  <div style="font-size: 12px; line-height: 1.2;">
                    <strong>{emp.banco}</strong>
                    <div style="font-family: monospace; color: #64748b;">{emp.nro_cuenta}</div>
                  </div>
                </td>
                <td style="text-align: center;">
                  <span class="badge-status active">{emp.estado}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- 2. CONCEPTOS Y FÓRMULAS -->
  {#if activeSubvista === 'conceptos'}
    <div class="view-content fade-in">
      <div class="action-bar">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Motor de Fórmulas y Conceptos de Nómina</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Parámetros legales configurables para deducciones (IVSS, FAOV) y asignaciones salariales.</p>
        </div>
      </div>

      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th style="width: 120px;">CÓDIGO</th>
              <th>CONCEPTO</th>
              <th style="width: 140px;">TIPO</th>
              <th>FÓRMULA / REGLA DE CÁLCULO</th>
              <th style="text-align: center; width: 140px;">GRAVABLE IVSS</th>
            </tr>
          </thead>
          <tbody>
            {#each conceptos as con (con.uuid)}
              <tr>
                <td><code>{con.codigo}</code></td>
                <td><strong>{con.nombre}</strong></td>
                <td>
                  {#if con.tipo === 'ASIGNACION'}
                    <span class="badge-tipo detalle">ASIGNACIÓN (+)</span>
                  {:else}
                    <span class="badge-tipo deduccion">DEDUCCIÓN (-)</span>
                  {/if}
                </td>
                <td><code style="background: #f8fafc; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #0f172a;">{con.formula}</code></td>
                <td style="text-align: center;">
                  {#if con.gravable_ivss}
                    <span class="badge-status active">SÍ APLICA</span>
                  {:else}
                    <span style="font-size: 11px; color: #94a3b8;">NO APLICA</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- 3. PROCESAMIENTO DE NÓMINA -->
  {#if activeSubvista === 'procesamiento'}
    <div class="view-content fade-in">
      <div class="periodo-banner">
        <div class="periodo-info">
          <span class="material-icons" style="color: #2563eb; font-size: 28px;">event_available</span>
          <div>
            <h3 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">{periodoNomina.nombre}</h3>
            <p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">
              Período: <b>{periodoNomina.desde}</b> al <b>{periodoNomina.hasta}</b> • Estatus: 
              <span class="badge-status {periodoNomina.estado === 'APROBADA' ? 'active' : 'draft'}">
                {periodoNomina.estado}
              </span>
            </p>
          </div>
        </div>

        <div style="display: flex; gap: 10px; align-items: center;">
          <div style="text-align: right; margin-right: 12px;">
            <div style="font-size: 11px; font-weight: 800; color: #64748b;">NETO TOTAL NÓMINA</div>
            <div style="font-size: 20px; font-weight: 900; color: #16a34a;">{fmtUsd(totalNominaUsd)}</div>
            <div style="font-size: 11px; color: #64748b;">{fmtBs(totalNominaBs)}</div>
          </div>
          {#if periodoNomina.estado === 'EN_BORRADOR'}
            <button class="btn-primary" on:click={aprobarNomina}>
              <span class="material-icons">check_circle</span>
              <span>Aprobar y Cerrar Nómina</span>
            </button>
          {:else}
            <button class="btn-secondary" on:click={() => triggerToast('Generando archivo de texto TXT para el Banco...', 'info')}>
              <span class="material-icons">download</span>
              <span>Exportar TXT Banco</span>
            </button>
          {/if}
        </div>
      </div>

      <!-- SÁBANA DE CÁLCULO QUINCENAL -->
      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>TRABAJADOR</th>
              <th>CÉDULA</th>
              <th style="text-align: right;">SUELDO Q.</th>
              <th style="text-align: right;">CESTATICKET</th>
              <th style="text-align: right;">H. EXTRAS</th>
              <th style="text-align: right;">TOTAL ASIG.</th>
              <th style="text-align: right; color: #dc2626;">DED. IVSS (4%)</th>
              <th style="text-align: right; color: #dc2626;">DED. FAOV (1%)</th>
              <th style="text-align: right;">NETO PAGAR ($)</th>
              <th style="text-align: right;">NETO PAGAR (BS)</th>
              <th style="text-align: center;">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {#each resumenCalculo as r (r.uuid)}
              <tr>
                <td><strong>{r.nombres}</strong></td>
                <td><code>{r.cedula}</code></td>
                <td style="text-align: right;">{fmtUsd(r.sueldoQuincena)}</td>
                <td style="text-align: right;">{fmtUsd(r.cestaQuincena)}</td>
                <td style="text-align: right; color: {r.horasExtras > 0 ? '#15803d' : '#94a3b8'};">
                  {r.horasExtras > 0 ? fmtUsd(r.horasExtras) : '-'}
                </td>
                <td style="text-align: right; font-weight: 700; color: #2563eb;">
                  {fmtUsd(r.totalAsignaciones)}
                </td>
                <td style="text-align: right; color: #b91c1c;">
                  -{fmtUsd(r.dedIvss)}
                </td>
                <td style="text-align: right; color: #b91c1c;">
                  -{fmtUsd(r.dedFaov)}
                </td>
                <td style="text-align: right; font-weight: 800; color: #15803d; font-size: 14px;">
                  {fmtUsd(r.netoPagarUsd)}
                </td>
                <td style="text-align: right; font-size: 11px; color: #64748b;">
                  {fmtBs(r.netoPagarBs)}
                </td>
                <td style="text-align: center;">
                  <button class="btn-icon" title="Ver Recibo de Pago" on:click={() => abrirRecibo(r)}>
                    <span class="material-icons" style="font-size: 18px; color: #2563eb;">receipt</span>
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- 4. PRESTACIONES SOCIALES LOTTT -->
  {#if activeSubvista === 'prestaciones'}
    <div class="view-content fade-in">
      <div class="card-flow p-4">
        <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px;">
          <h3 style="font-size: 18px; font-weight: 800; color: #0f172a; margin: 0;">Acumulado de Garantía de Prestaciones Sociales (Art. 142 LOTTT)</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Depósito trimestral de 15 días de salario integral con devengo de intereses a tasa fijada por el Banco Central de Venezuela.</p>
        </div>

        <div class="table-responsive">
          <table class="table-custom">
            <thead>
              <tr>
                <th>TRABAJADOR</th>
                <th>CÉDULA</th>
                <th>FECHA INGRESO</th>
                <th style="text-align: right;">DÍAS GARANTÍA</th>
                <th style="text-align: right;">SALARIO INTEGRAL DIARIO</th>
                <th style="text-align: right;">ACUMULADO GARANTÍA ($)</th>
                <th style="text-align: right;">INTERESES ACUMULADOS ($)</th>
                <th style="text-align: right;">TOTAL PRESTACIONES ($)</th>
              </tr>
            </thead>
            <tbody>
              {#each empleados as emp, i}
                {@const salarioDia = (emp.sueldo_base_usd + emp.cestaticket_usd) / 30}
                {@const dias = (i + 2) * 15}
                {@const acumGarantia = dias * salarioDia}
                {@const intereses = acumGarantia * 0.08}
                <tr>
                  <td><strong>{emp.nombres}</strong></td>
                  <td><code>{emp.cedula}</code></td>
                  <td>2024-03-15</td>
                  <td style="text-align: right;">{dias} días</td>
                  <td style="text-align: right;">{fmtUsd(salarioDia)}</td>
                  <td style="text-align: right; font-weight: 700;">{fmtUsd(acumGarantia)}</td>
                  <td style="text-align: right; color: #b45309;">{fmtUsd(intereses)}</td>
                  <td style="text-align: right; font-weight: 800; color: #15803d;">{fmtUsd(acumGarantia + intereses)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  {/if}

  <!-- 5. RECIBOS Y REPORTES -->
  {#if activeSubvista === 'reportes'}
    <div class="view-content fade-in">
      <div class="card-flow p-4">
        <h3 style="font-size: 18px; font-weight: 800; color: #0f172a; margin-bottom: 8px;">Emisión de Recibos de Pago y Reportes a Entes</h3>
        <p style="font-size: 13px; color: #64748b; margin-bottom: 20px;">Descarga masiva de recibos individuales en formato imprimible con firma y constancia de retenciones.</p>

        <div style="display: flex; gap: 14px; flex-wrap: wrap;">
          <button class="btn-secondary" on:click={() => triggerToast('Generando recibos PDF masivos...', 'info')}>
            <span class="material-icons">print</span>
            <span>Imprimir Todos los Recibos de la Quincena</span>
          </button>
          <button class="btn-secondary" on:click={() => triggerToast('Exportando nómina al formato TIUNA (IVSS)...', 'info')}>
            <span class="material-icons">assignment</span>
            <span>Archivo Plano IVSS (TIUNA)</span>
          </button>
          <button class="btn-secondary" on:click={() => triggerToast('Exportando reporte FAOV Banavih...', 'info')}>
            <span class="material-icons">home_work</span>
            <span>Archivo FAOV (Banavih)</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- MODAL VISOR DE RECIBO DE PAGO INDIVIDUAL -->
{#if empleadoRecibo}
  <div class="modal-backdrop fade-in" on:click={() => empleadoRecibo = null} role="presentation">
    <div class="modal-card receipt-modal" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="color: #2563eb;">receipt</span>
          <h3 style="margin: 0; font-size: 16px;">Recibo de Pago Individual</h3>
        </div>
        <button class="btn-close" on:click={() => empleadoRecibo = null}>&times;</button>
      </div>

      <div class="modal-body receipt-body">
        <!-- CABECERA DEL RECIBO -->
        <div class="receipt-header-box">
          <div style="font-size: 15px; font-weight: 900; color: #0f172a;">WISI ROYALE ENTERTAINMENT C.A.</div>
          <div style="font-size: 11px; color: #64748b;">RIF: J-40918274-1 • REPÚBLICA BOLIVARIANA DE VENEZUELA</div>
          <div style="margin-top: 8px; font-weight: 800; font-size: 12.5px; color: #2563eb; text-transform: uppercase;">
            RECIBO DE PAGO DE SUELDO Y SALARIOS • {periodoNomina.nombre}
          </div>
        </div>

        <div class="receipt-emp-grid">
          <div><span class="lbl">Trabajador:</span> <strong>{empleadoRecibo.nombres}</strong></div>
          <div><span class="lbl">Cédula:</span> <code>{empleadoRecibo.cedula}</code></div>
          <div><span class="lbl">Cargo:</span> {empleadoRecibo.cargo}</div>
          <div><span class="lbl">Departamento:</span> {empleadoRecibo.departamento}</div>
          <div><span class="lbl">Período:</span> {periodoNomina.desde} al {periodoNomina.hasta}</div>
          <div><span class="lbl">Frecuencia:</span> {empleadoRecibo.frecuencia}</div>
        </div>

        <!-- TABLA DE ASIGNACIONES Y DEDUCCIONES -->
        <table class="table-custom text-xs" style="margin-top: 12px;">
          <thead>
            <tr style="background: #f8fafc;">
              <th>CONCEPTO</th>
              <th style="text-align: right; width: 110px;">ASIGNACIONES ($)</th>
              <th style="text-align: right; width: 110px;">DEDUCCIONES ($)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sueldo Básico Quincenal</td>
              <td style="text-align: right;">{fmtUsd(empleadoRecibo.sueldoQuincena)}</td>
              <td style="text-align: right;">-</td>
            </tr>
            <tr>
              <td>Bono de Alimentación (Cestaticket)</td>
              <td style="text-align: right;">{fmtUsd(empleadoRecibo.cestaQuincena)}</td>
              <td style="text-align: right;">-</td>
            </tr>
            {#if empleadoRecibo.horasExtras > 0}
              <tr>
                <td>Horas Extras Diurnas / Nocturnas</td>
                <td style="text-align: right;">{fmtUsd(empleadoRecibo.horasExtras)}</td>
                <td style="text-align: right;">-</td>
              </tr>
            {/if}
            <tr>
              <td>Retención Seguro Social (IVSS 4%)</td>
              <td style="text-align: right;">-</td>
              <td style="text-align: right; color: #b91c1c;">{fmtUsd(empleadoRecibo.dedIvss)}</td>
            </tr>
            <tr>
              <td>Retención Fondo de Vivienda (FAOV 1%)</td>
              <td style="text-align: right;">-</td>
              <td style="text-align: right; color: #b91c1c;">{fmtUsd(empleadoRecibo.dedFaov)}</td>
            </tr>
            <tr style="background: #f8fafc; font-weight: 700;">
              <td>SUBTOTALES:</td>
              <td style="text-align: right; color: #16a34a;">{fmtUsd(empleadoRecibo.totalAsignaciones)}</td>
              <td style="text-align: right; color: #b91c1c;">{fmtUsd(empleadoRecibo.totalDeducciones)}</td>
            </tr>
          </tbody>
        </table>

        <!-- TOTAL NETO A RECIBIR -->
        <div class="receipt-neto-box">
          <div class="row">
            <span style="font-size: 13px; font-weight: 800;">NETO A COBRAR EN DIVISAS:</span>
            <span style="font-size: 18px; font-weight: 900; color: #15803d;">{fmtUsd(empleadoRecibo.netoPagarUsd)}</span>
          </div>
          <div class="row" style="font-size: 12px; color: #475569;">
            <span>Equivalente en Bolívares (Tasa BCV {tasaBcv.toFixed(2)}):</span>
            <strong style="color: #0f172a;">{fmtBs(empleadoRecibo.netoPagarBs)}</strong>
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 6px;">
            Abonado en cuenta {empleadoRecibo.banco} • {empleadoRecibo.nro_cuenta}
          </div>
        </div>

        <!-- FIRMAS -->
        <div class="receipt-signatures">
          <div class="sig-box">
            <div class="line"></div>
            <span>CONFORME EMPLEADOR</span>
          </div>
          <div class="sig-box">
            <div class="line"></div>
            <span>CONFORME TRABAJADOR</span>
            <div style="font-size: 10px; color: #94a3b8;">C.I. {empleadoRecibo.cedula}</div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => empleadoRecibo = null}>Cerrar</button>
        <button class="btn-primary" on:click={() => triggerToast('Enviando a impresión...', 'success')}>
          <span class="material-icons">print</span>
          <span>Imprimir Recibo</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .nomina-container {
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .nomina-header {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 22px 26px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #eff6ff;
    color: #2563eb;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .header-title {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 6px 0;
  }

  .header-sub {
    font-size: 13.5px;
    color: #64748b;
    margin: 0;
  }

  .bcv-widget {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 10px;
    padding: 12px 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    font-size: 14px;
    font-weight: 800;
    color: #14532d;
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

  /* ACCIONES */
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

  /* TABLAS */
  .card-flow {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }

  .table-responsive { overflow-x: auto; }

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
    padding: 12px 14px;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
  }

  .table-custom td {
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
    vertical-align: middle;
  }

  .category-chip {
    background: #f1f5f9;
    color: #334155;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 11.5px;
    font-weight: 600;
  }

  .badge-status {
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 10.5px;
    font-weight: 800;
  }
  .badge-status.active { background: #dcfce7; color: #15803d; }
  .badge-status.draft { background: #fef3c7; color: #b45309; }

  .badge-tipo {
    font-size: 11px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
  }
  .badge-tipo.detalle { background: #ecfdf5; color: #047857; }
  .badge-tipo.deduccion { background: #fef2f2; color: #b91c1c; }

  .periodo-banner {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 18px 22px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }

  .periodo-info {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .btn-icon {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
  }
  .btn-icon:hover { background: #eff6ff; }

  /* MODAL Y RECIBO DE PAGO */
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
    max-width: 620px;
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

  .receipt-header-box {
    text-align: center;
    border-bottom: 2px dashed #cbd5e1;
    padding-bottom: 12px;
    margin-bottom: 12px;
  }

  .receipt-emp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
    font-size: 12px;
    background: #f8fafc;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }
  .receipt-emp-grid .lbl { color: #64748b; }

  .receipt-neto-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 14px;
  }
  .receipt-neto-box .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .receipt-signatures {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-top: 28px;
    text-align: center;
  }

  .sig-box .line {
    border-top: 1px solid #94a3b8;
    margin-bottom: 6px;
  }
  .sig-box span {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
  }

  .fade-in {
    animation: fadeIn 0.2s ease-in-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
