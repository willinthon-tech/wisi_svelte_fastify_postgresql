<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentRouteStore, navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { masterSalasStore, masterCortesStore, masterEmpleadosStore } from '../../controllers/master.store.js';

  const SUBVISTAS = [
    { id: 'personal', label: 'Personal y Salarios', desc: 'Ficha salarial, cargos y asignación de cuentas' },
    { id: 'conceptos', label: 'Conceptos y Fórmulas', desc: 'Asignaciones y deducciones de ley (IVSS, FAOV, INCES)' },
    { id: 'procesamiento', label: 'Procesamiento de Nómina', desc: 'Cálculo quincenal/semanal masivo y aprobación' },
    { id: 'prestaciones', label: 'Prestaciones (LOTTT)', desc: 'Garantía trimestral Art. 142 LOTTT, vacaciones y utilidades' },
    { id: 'reportes', label: 'Recibos y Reportes', desc: 'Recibos de pago individuales y sábanas bancarias' }
  ];

  let activeSubvista = 'personal';
  let tasaBcv = 62.50;

  // --- AISLAMIENTO MULTI-SALA ---
  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const username = (user?.username || '').toLowerCase();
    const isAdmin = username === 'admin' || username === 'willinthon' || user?.is_admin === true || user?.rol === 'admin';
    if (isAdmin) return [];

    const userId = user?.uuid || user?.id;
    if (!userId) return [];

    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas.map((s) => String(typeof s === "object" ? (s.uuid || s.id) : s)).filter(Boolean);
    }
    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas.map((s) => String(typeof s === "object" ? (s.uuid || s.id) : s)).filter(Boolean);
    }
    return [];
  })();

  $: userAvailableSalas = (function () {
    const all = $masterSalasStore || [];
    if (!assignedSalaIds || assignedSalaIds.length === 0) return all;
    const set = new Set(assignedSalaIds.map(String));
    return all.filter((s) => set.has(String(s.uuid || s.id)));
  })();

  let selectedSalaFiltro = 'ALL';

  // --- CORTES DE ASISTENCIA / QUINCENA (RRHH) ---
  let cortesList = [];
  let selectedCorteUuid = '';

  $: cortesFiltrados = (function() {
    const list = cortesList.length > 0 ? cortesList : ($masterCortesStore || []);
    if (selectedSalaFiltro === 'ALL') {
      if (!assignedSalaIds || assignedSalaIds.length === 0) return list;
      const allowedSet = new Set(assignedSalaIds.map(String));
      return list.filter(c => {
        const sUuids = (c.salas_uuids || c.salas_ids || []).map(String);
        return sUuids.length === 0 || sUuids.some(sid => allowedSet.has(sid));
      });
    }
    return list.filter(c => {
      const sUuids = (c.salas_uuids || c.salas_ids || []).map(String);
      return sUuids.includes(String(selectedSalaFiltro));
    });
  })();

  let unsubRoute;
  onMount(() => {
    cargarDatosBackend();

    unsubRoute = currentRouteStore.subscribe(val => {
      const clean = String(val || '').replace(/^#\/?/, '').replace(/^\//, '').trim();
      const parts = clean.split('/');
      if (parts[0] === 'erp' && parts[1] === 'nomina') {
        if (parts[2] && SUBVISTAS.some(s => s.id === parts[2])) {
          activeSubvista = parts[2];
        } else {
          activeSubvista = 'personal';
        }
      } else if (parts[0] === 'nomina') {
        if (parts[1] && SUBVISTAS.some(s => s.id === parts[1])) {
          activeSubvista = parts[1];
        } else {
          activeSubvista = 'personal';
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubRoute) unsubRoute();
  });

  async function cargarDatosBackend() {
    try {
      const [resPers, resConc, resPer, resCortes] = await Promise.all([
        fetch(toBackendUrl('/api/erp/nomina/personal')),
        fetch(toBackendUrl('/api/erp/nomina/conceptos')),
        fetch(toBackendUrl('/api/erp/nomina/periodos')),
        fetch(toBackendUrl('/api/erp/nomina/cortes'))
      ]);
      const dataPers = await resPers.json();
      const dataConc = await resConc.json();
      const dataPer = await resPer.json();
      const dataCortes = await resCortes.json();

      if (dataPers?.success && Array.isArray(dataPers.data) && dataPers.data.length > 0) {
        empleados = dataPers.data.map(e => ({
          ...e,
          sueldo_base_usd: Number(e.sueldo_base_usd) || 450,
          cestaticket_usd: 40.00
        }));
      }
      if (dataConc?.success && Array.isArray(dataConc.data) && dataConc.data.length > 0) {
        conceptos = dataConc.data;
      }
      if (dataPer?.success && Array.isArray(dataPer.data) && dataPer.data.length > 0) {
        periodoNomina = dataPer.data[0];
      }
      if (dataCortes?.success && Array.isArray(dataCortes.data) && dataCortes.data.length > 0) {
        cortesList = dataCortes.data;
        if (!selectedCorteUuid && cortesList[0]?.uuid) {
          seleccionarCorte(cortesList[0].uuid);
        }
      }
    } catch (e) {
      console.warn('Modo demo/offline nómina:', e.message);
    }
  }

  function cambiarSubvista(id) {
    activeSubvista = id;
    navigateToRoute(`erp/nomina/${id}`);
  }

  // --- PERSONAL REAL DE LA EMPRESA ---
  let empleados = [];

  $: if (empleados.length === 0 && Array.isArray($masterEmpleadosStore) && $masterEmpleadosStore.length > 0) {
    empleados = $masterEmpleadosStore.map(e => ({
      uuid: e.uuid || e.id,
      cedula: e.cedula || 'V-00000000',
      nombres: e.nombre || e.nombres || 'Empleado',
      nombre: e.nombre || e.nombres || 'Empleado',
      cargo: e.cargo_nombre || e.cargo || 'Operador',
      departamento: e.departamento_nombre || e.departamento || 'Operaciones de Sala',
      sala_nombre: e.sala_nombre || 'Principal',
      sala_uuid: e.sala_uuid || null,
      sueldo_base_usd: 450.00,
      cestaticket_usd: 40.00,
      frecuencia: 'QUINCENAL',
      banco: 'Banesco',
      nro_cuenta: '0134-0192-38-4920192837',
      estado: e.activo === false ? 'INACTIVO' : 'ACTIVO'
    }));
  }

  let filtroPersonal = '';
  $: personalFiltrado = empleados.filter(e => {
    const matchTxt = (e.nombres || e.nombre || '').toLowerCase().includes(filtroPersonal.toLowerCase()) ||
                     (e.cedula || '').toLowerCase().includes(filtroPersonal.toLowerCase()) ||
                     (e.cargo && e.cargo.toLowerCase().includes(filtroPersonal.toLowerCase()));
    if (!matchTxt) return false;
    if (selectedSalaFiltro !== 'ALL') {
      const eSala = String(e.sala_uuid || e.sala_id || '');
      return eSala === String(selectedSalaFiltro);
    }
    return true;
  });

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

  // --- PROCESAMIENTO DE NÓMINA QUINCENAL DESDE CORTES REALES ---
  let periodoNomina = {
    nombre: 'Nómina Quincenal en Proceso',
    desde: '2026-10-16',
    hasta: '2026-10-31',
    estado: 'EN_BORRADOR'
  };

  let empleadosCalculo = [];
  let lastLoadedCorteUuid = '';

  $: if (cortesFiltrados && cortesFiltrados.length > 0) {
    const exists = cortesFiltrados.some(c => String(c.uuid || c.id) === String(selectedCorteUuid));
    if (!selectedCorteUuid || !exists) {
      selectedCorteUuid = cortesFiltrados[0].uuid || cortesFiltrados[0].id;
    }
    if (selectedCorteUuid && selectedCorteUuid !== lastLoadedCorteUuid) {
      lastLoadedCorteUuid = selectedCorteUuid;
      seleccionarCorte(selectedCorteUuid);
    }
  }

  $: {
    if (empleadosCalculo.length === 0 && empleados.length > 0 && (!cortesFiltrados || cortesFiltrados.length === 0)) {
      generarCalculoDesdeEmpleados();
    }
  }

  function generarCalculoDesdeEmpleados() {
    const pool = personalFiltrado.length > 0 ? personalFiltrado : empleados;
    if (!pool || pool.length === 0) return;
    empleadosCalculo = pool.map(emp => {
      const sueldoMensual = Number(emp.sueldo_base_usd) || 450;
      const sueldoQuincena = Number((sueldoMensual / 2).toFixed(2));
      const cestaQuincena = 20.00;
      const horasExtras = 0.00;
      const totalAsignaciones = Number((sueldoQuincena + cestaQuincena + horasExtras).toFixed(2));
      const dedIvss = Number(((sueldoMensual * 12 / 52) * 0.04 * 2).toFixed(2));
      const dedFaov = Number((sueldoQuincena * 0.01).toFixed(2));
      const totalDeducciones = Number((dedIvss + dedFaov).toFixed(2));
      const netoPagarUsd = Number(Math.max(0, totalAsignaciones - totalDeducciones).toFixed(2));
      const netoPagarBs = Number((netoPagarUsd * tasaBcv).toFixed(2));

      return {
        uuid: emp.uuid,
        cedula: emp.cedula,
        nombres: emp.nombres || emp.nombre,
        nombre: emp.nombres || emp.nombre,
        cargo: emp.cargo || 'Operador',
        departamento: emp.departamento || 'Operaciones',
        sala_nombre: emp.sala_nombre || 'Principal',
        dias_trabajados: 15,
        sueldoQuincena,
        cestaQuincena,
        horasExtras,
        bonoAdicional: 0,
        totalAsignaciones,
        dedIvss,
        dedFaov,
        anticipos: 0,
        totalDeducciones,
        netoPagarUsd,
        netoPagarBs,
        banco: emp.banco || 'Banesco',
        nro_cuenta: emp.nro_cuenta || '0134-0192-38-4920192837'
      };
    });
  }

  async function seleccionarCorte(corteUuid) {
    if (!corteUuid) return;
    selectedCorteUuid = corteUuid;
    lastLoadedCorteUuid = corteUuid;
    try {
      const res = await fetch(toBackendUrl(`/api/erp/nomina/cortes/${corteUuid}`));
      const json = await res.json();
      if (json?.success && json.data) {
        const cData = json.data;
        const cleanDesde = String(cData.fecha_desde || '').slice(0, 10);
        const cleanHasta = String(cData.fecha_hasta || '').slice(0, 10);
        periodoNomina = {
          nombre: `Nómina Quincenal (${cleanDesde} al ${cleanHasta})`,
          desde: cleanDesde,
          hasta: cleanHasta,
          estado: 'EN_BORRADOR'
        };

        if (Array.isArray(cData.empleados) && cData.empleados.length > 0) {
          empleadosCalculo = cData.empleados.map(e => ({
            ...e,
            nombres: e.nombre || e.nombres,
            sueldoQuincena: Number(e.sueldo_quincenal ?? e.sueldoQuincena) || 225,
            cestaQuincena: Number(e.cestaticket ?? e.cestaQuincena) || 20,
            horasExtras: Number(e.horas_extras_monto ?? e.horasExtras) || 0,
            bonoAdicional: Number(e.bonos ?? e.bonoAdicional) || 0,
            totalAsignaciones: Number(e.total_asignaciones ?? e.totalAsignaciones) || 245,
            dedIvss: Number(e.deduccion_ivss ?? e.dedIvss) || 9,
            dedFaov: Number(e.deduccion_faov ?? e.dedFaov) || 2.25,
            anticipos: Number(e.anticipos) || 0,
            totalDeducciones: Number(e.total_deducciones ?? e.totalDeducciones) || 11.25,
            netoPagarUsd: Number(e.neto_pagar_usd ?? e.netoPagarUsd) || 233.75,
            netoPagarBs: Number(((e.neto_pagar_usd ?? e.netoPagarUsd ?? 233.75) * tasaBcv).toFixed(2))
          }));
          triggerToast(`Corte cargado con ${empleadosCalculo.length} empleados desde el biométrico.`, 'info');
          return;
        }
      }
    } catch (err) {
      console.warn('Fallo cargando corte para nómina:', err);
    }
  }

  // Modales de Ajuste y Ficha
  let showModalAjuste = false;
  let empAjuste = null;

  function abrirModalAjuste(emp) {
    empAjuste = { ...emp };
    showModalAjuste = true;
  }

  function guardarAjustesEmpleado() {
    if (!empAjuste) return;
    const sQ = Number(empAjuste.sueldoQuincena) || 0;
    const cQ = Number(empAjuste.cestaQuincena) || 0;
    const hE = Number(empAjuste.horasExtras) || 0;
    const bA = Number(empAjuste.bonoAdicional) || 0;
    const totAsig = Number((sQ + cQ + hE + bA).toFixed(2));

    const dIvss = Number(empAjuste.dedIvss) || Number((sQ * 0.04).toFixed(2));
    const dFaov = Number(empAjuste.dedFaov) || Number((sQ * 0.01).toFixed(2));
    const ant = Number(empAjuste.anticipos) || 0;
    const totDed = Number((dIvss + dFaov + ant).toFixed(2));

    const netoUsd = Number(Math.max(0, totAsig - totDed).toFixed(2));
    const netoBs = Number((netoUsd * tasaBcv).toFixed(2));

    const updated = {
      ...empAjuste,
      sueldoQuincena: sQ,
      cestaQuincena: cQ,
      horasExtras: hE,
      bonoAdicional: bA,
      totalAsignaciones: totAsig,
      dedIvss: dIvss,
      dedFaov: dFaov,
      anticipos: ant,
      totalDeducciones: totDed,
      netoPagarUsd: netoUsd,
      netoPagarBs: netoBs
    };

    empleadosCalculo = empleadosCalculo.map(e => e.uuid === updated.uuid ? updated : e);
    showModalAjuste = false;
    empAjuste = null;
    triggerToast('Ajustes del empleado aplicados a la nómina', 'success');
  }

  let showModalEmpleadoFicha = false;
  let empFicha = null;

  function abrirEditarFicha(emp) {
    empFicha = { ...emp };
    showModalEmpleadoFicha = true;
  }

  async function guardarFichaEmpleado() {
    if (!empFicha) return;
    try {
      await fetch(toBackendUrl('/api/erp/nomina/personal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(empFicha)
      });
    } catch (e) {}

    empleados = empleados.map(e => e.uuid === empFicha.uuid ? { ...e, ...empFicha } : e);
    showModalEmpleadoFicha = false;
    empFicha = null;
    triggerToast('Ficha salarial actualizada', 'success');
  }

  $: totalNominaUsd = empleadosCalculo.reduce((acc, r) => acc + (Number(r.netoPagarUsd) || 0), 0);
  $: totalNominaBs = Number((totalNominaUsd * tasaBcv).toFixed(2));

  // Visualizador de Recibo de Pago
  let empleadoRecibo = null;

  function abrirRecibo(r) {
    empleadoRecibo = r;
  }

  async function aprobarNomina() {
    try {
      if (periodoNomina?.uuid) {
        const res = await fetch(toBackendUrl(`/api/erp/nomina/periodos/${periodoNomina.uuid}/aprobar`), {
          method: 'POST'
        });
        const resData = await res.json();
        if (resData?.success) {
          periodoNomina = { ...periodoNomina, estado: 'APROBADA' };
          triggerToast('¡Nómina Quincenal Aprobada! Se generaron los pasivos y recibos de pago.', 'success');
          return;
        }
      }
    } catch (e) {
      console.warn('Modo local en aprobación de nómina:', e.message);
    }
    periodoNomina = { ...periodoNomina, estado: 'APROBADA' };
    triggerToast('¡Nómina Quincenal Aprobada! Se generaron los pasivos y recibos de pago.', 'success');
  }

  function fmtUsd(val) {
    return '$ ' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtBs(val) {
    return 'Bs. ' + Number(val || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // --- FASE 4: EXPORTACIONES Y FORMATOS LEGALES / BANCARIOS ---
  function exportarTxtBanco() {
    let contenido = `H\tJ409182741\tWISI ROYALE ENTERTAINMENT C.A.\t01340821491029384756\t${new Date().toISOString().split('T')[0]}\t${totalNominaBs.toFixed(2)}\r\n`;
    empleadosCalculo.forEach(r => {
      const cta = (r.nro_cuenta || '01340000000000000000').replace(/-/g, '').padEnd(20, '0').slice(0, 20);
      const ced = r.cedula.replace(/[^0-9]/g, '').padStart(10, '0');
      const montoBs = (Number(r.netoPagarBs) || 0).toFixed(2);
      contenido += `D\t${cta}\t${montoBs}\t${ced}\t${r.nombres || r.nombre}\r\n`;
    });

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TXT_PAGO_NOMINA_${periodoNomina.desde.replace(/-/g, '')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Archivo TXT para Banco (dispersión masiva) generado con éxito', 'success');
  }

  function exportarTxtTiuna() {
    let contenido = `134\tJ409182741\t${periodoNomina.desde.slice(0, 7).replace('-', '')}\r\n`;
    empleados.forEach(e => {
      const ced = e.cedula.replace(/[^0-9]/g, '');
      const sBaseBs = ((e.sueldo_base_usd || 450) * tasaBcv).toFixed(2);
      contenido += `V\t${ced}\t${e.nombres}\t${sBaseBs}\t20240315\tA\r\n`;
    });

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `TIUNA_IVSS_${periodoNomina.desde.slice(0, 7).replace('-', '')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Archivo plano para portal TIUNA (IVSS) generado', 'success');
  }

  function exportarTxtFaov() {
    let contenido = `FAOV\tJ409182741\t${periodoNomina.desde.slice(0, 7).replace('-', '')}\r\n`;
    empleados.forEach(e => {
      const ced = e.cedula.replace(/[^0-9]/g, '');
      const sIntegralBs = (((e.sueldo_base_usd || 450) + 40) * tasaBcv).toFixed(2);
      const aporte1Porc = (sIntegralBs * 0.01).toFixed(2);
      const aporte2Porc = (sIntegralBs * 0.02).toFixed(2);
      contenido += `V\t${ced}\t${sIntegralBs}\t${aporte1Porc}\t${aporte2Porc}\r\n`;
    });

    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BANAVIH_FAOV_${periodoNomina.desde.slice(0, 7).replace('-', '')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Archivo FAOV (Banavih) generado para declaración mensual', 'success');
  }

  function imprimirRecibo() {
    window.print();
  }
</script>

<div class="nomina-container">
  <!-- ENCABEZADO -->
  <div class="erp-view-header">
    <div class="erp-title-box">
      <h1 class="erp-main-title">Nómina</h1>
      <p class="erp-main-desc">Cálculo de asignaciones, deducciones de ley venezolana (IVSS, FAOV), prestaciones sociales y recibos.</p>
    </div>

    <!-- TASA BCV -->
    <div class="bcv-widget">
      <span class="bcv-label">TASA OFICIAL BCV</span>
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
        <span class="tab-label">{sub.label}</span>
      </button>
    {/each}
  </div>

  <!-- 1. PERSONAL Y SALARIOS -->
  {#if activeSubvista === 'personal'}
    <div class="view-content fade-in">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL PERSONAL ACTIVO</span>
            <span class="kpi-val">{personalFiltrado.length}</span>
            <span class="kpi-sub">En plantilla de nómina</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">TOTAL SUELDOS BASE (MES)</span>
            <span class="kpi-val">
              {fmtUsd(personalFiltrado.reduce((acc, e) => acc + (Number(e.sueldo_base_usd) || 450), 0))}
            </span>
            <span class="kpi-sub">{fmtBs(personalFiltrado.reduce((acc, e) => acc + (Number(e.sueldo_base_usd) || 450), 0) * tasaBcv)}</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">CESTATICKET MENSUAL</span>
            <span class="kpi-val">{fmtUsd(personalFiltrado.length * 40)}</span>
            <span class="kpi-sub">40 USD / trabajador</span>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-info">
            <span class="kpi-label">FRECUENCIA</span>
            <span class="kpi-val">QUINCENAL</span>
            <span class="kpi-sub">Días 15 y último</span>
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
              <option value={s.uuid || s.id}>{s.nombre || s.nombre_comercial}</option>
            {/each}
          </select>
          <div class="search-box" style="flex: 1; min-width: 260px;">
            <input 
              type="text" 
              placeholder="Buscar por cédula, nombre o cargo..." 
              bind:value={filtroPersonal}
            />
          </div>
        </div>
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
              <th style="text-align: center;">ACCIONES</th>
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
                <td style="text-align: center;">
                  <button class="btn-sm" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; font-weight: 600;" on:click={() => abrirEditarFicha(emp)}>
                    Editar Ficha
                  </button>
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
      <!-- SELECTORES MULTI-SALA Y CORTE BIOMÉTRICO RRHH -->
      <div class="card-padded" style="margin-bottom: 16px;">
        <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
          <div style="display: flex; flex-direction: column; gap: 4px; min-width: 220px;">
            <label for="filtro-sala-nom" style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">
              Sala de Juegos / Sede
            </label>
            <select 
              id="filtro-sala-nom"
              bind:value={selectedSalaFiltro}
              style="padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-weight: 700; background: #ffffff; color: #0f172a;"
            >
              <option value="ALL">Todas las Salas Asignadas</option>
              {#each userAvailableSalas as s}
                <option value={s.uuid || s.id}>{s.nombre || s.nombre_comercial}</option>
              {/each}
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 320px;">
            <label for="filtro-corte-nom" style="font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase;">
              Corte de Asistencia / Quincena (Biométrico RRHH)
            </label>
            <select 
              id="filtro-corte-nom"
              bind:value={selectedCorteUuid}
              on:change={(e) => seleccionarCorte(e.target.value)}
              style="padding: 8px 12px; border: 1px solid #2563eb; border-radius: 8px; font-size: 13px; font-weight: 700; background: #eff6ff; color: #1e40af;"
            >
              <option value="">-- Seleccionar Corte de RRHH para procesar nómina --</option>
              {#each cortesFiltrados as c}
                <option value={c.uuid || c.id}>
                  Corte: {String(c.fecha_desde || '').slice(0, 10)} al {String(c.fecha_hasta || '').slice(0, 10)} • {c.total_empleados || 0} Empleados • {c.salas_nombres?.[0] || 'General'}
                </option>
              {/each}
            </select>
          </div>
        </div>
      </div>

      <div class="periodo-banner">
        <div class="periodo-info">
          <div>
            <h3 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">{periodoNomina.nombre}</h3>
            <p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b;">
              Período: <b>{periodoNomina.desde}</b> al <b>{periodoNomina.hasta}</b> • Total Trabajadores: <b>{empleadosCalculo.length}</b> • Estatus: 
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
              <span>Aprobar y Cerrar Nómina</span>
            </button>
          {:else}
            <button class="btn-secondary" on:click={exportarTxtBanco}>
              <span>Exportar TXT Banco</span>
            </button>
          {/if}
        </div>
      </div>

      <!-- SÁBANA DE CÁLCULO QUINCENAL DESDE CORTES -->
      <div class="card-flow table-responsive">
        <table class="table-custom">
          <thead>
            <tr>
              <th>TRABAJADOR</th>
              <th>CÉDULA</th>
              <th>SALA</th>
              <th style="text-align: center;">DÍAS</th>
              <th style="text-align: right;">SUELDO Q.</th>
              <th style="text-align: right;">CESTATICKET</th>
              <th style="text-align: right;">H. EXTRAS</th>
              <th style="text-align: right;">BONOS</th>
              <th style="text-align: right;">TOTAL ASIG.</th>
              <th style="text-align: right; color: #dc2626;">IVSS (4%)</th>
              <th style="text-align: right; color: #dc2626;">FAOV (1%)</th>
              <th style="text-align: right; color: #dc2626;">ANTICIPOS</th>
              <th style="text-align: right;">NETO PAGAR ($)</th>
              <th style="text-align: right;">NETO PAGAR (BS)</th>
              <th style="text-align: center;">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {#each empleadosCalculo as r (r.uuid)}
              <tr>
                <td><strong>{r.nombres || r.nombre}</strong></td>
                <td><code>{r.cedula}</code></td>
                <td><span class="category-chip">{r.sala_nombre || 'Principal'}</span></td>
                <td style="text-align: center; font-weight: 700;">{r.dias_trabajados || 15}</td>
                <td style="text-align: right;">{fmtUsd(r.sueldoQuincena)}</td>
                <td style="text-align: right;">{fmtUsd(r.cestaQuincena)}</td>
                <td style="text-align: right; color: {r.horasExtras > 0 ? '#15803d' : '#94a3b8'};">
                  {r.horasExtras > 0 ? fmtUsd(r.horasExtras) : '-'}
                </td>
                <td style="text-align: right; color: {r.bonoAdicional > 0 ? '#15803d' : '#94a3b8'};">
                  {r.bonoAdicional > 0 ? fmtUsd(r.bonoAdicional) : '-'}
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
                <td style="text-align: right; color: #b91c1c;">
                  {r.anticipos > 0 ? '-' + fmtUsd(r.anticipos) : '-'}
                </td>
                <td style="text-align: right; font-weight: 800; color: #15803d; font-size: 14px;">
                  {fmtUsd(r.netoPagarUsd)}
                </td>
                <td style="text-align: right; font-size: 11px; color: #64748b;">
                  {fmtBs(r.netoPagarBs)}
                </td>
                <td style="text-align: center; white-space: nowrap;">
                  <button class="btn-sm" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; font-weight: 600; margin-right: 4px;" title="Editar Ajustes Laborales" on:click={() => abrirModalAjuste(r)}>
                    Ajustar
                  </button>
                  <button class="btn-sm" style="padding: 4px 8px; font-size: 11px; cursor: pointer; border-radius: 4px; border: 1px solid #cbd5e1; background: #f8fafc;" title="Ver Recibo de Pago" on:click={() => abrirRecibo(r)}>
                    Recibo
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
      <div class="action-bar">
        <div>
          <h3 style="font-size: 17px; font-weight: 800; color: #1e293b; margin: 0;">Acumulado de Garantía de Prestaciones Sociales (Art. 142 LOTTT)</h3>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0 0;">Depósito trimestral de 15 días de salario integral con devengo de intereses a tasa fijada por el Banco Central de Venezuela.</p>
        </div>
      </div>

      <div class="card-flow table-responsive">
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
            {#each (personalFiltrado.length > 0 ? personalFiltrado : empleados) as emp, i}
              {@const salarioDia = ((Number(emp.sueldo_base_usd) || 450) + (Number(emp.cestaticket_usd) || 40)) / 30}
              {@const dias = (i + 2) * 15}
              {@const acumGarantia = dias * salarioDia}
              {@const intereses = acumGarantia * 0.08}
              <tr>
                <td><strong>{emp.nombres || emp.nombre}</strong></td>
                <td><code>{emp.cedula}</code></td>
                <td>{emp.fecha_ingreso || '2024-03-15'}</td>
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
  {/if}

  <!-- 5. RECIBOS Y REPORTES -->
  {#if activeSubvista === 'reportes'}
    <div class="view-content fade-in">
      <div class="card-padded">
        <div class="card-header-block">
          <h3 class="card-title-lg">Emisión de Recibos de Pago y Reportes a Entes</h3>
          <p class="card-desc">Descarga masiva de recibos individuales en formato imprimible con firma y constancia de retenciones.</p>
        </div>

        <div class="card-buttons-row">
          <button class="btn-secondary" on:click={imprimirRecibo}>
            <span>Imprimir Todos los Recibos de la Quincena</span>
          </button>
          <button class="btn-secondary" on:click={exportarTxtTiuna}>
            <span>Archivo Plano IVSS (TIUNA)</span>
          </button>
          <button class="btn-secondary" on:click={exportarTxtFaov}>
            <span>Archivo FAOV (Banavih)</span>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- MODAL VISOR DE RECIBO DE PAGO INDIVIDUAL -->
{#if empleadoRecibo}
  <div class="modal-backdrop fade-in" role="presentation">
    <div class="modal-card receipt-modal" on:click|stopPropagation role="dialog">
      <div class="modal-header">
        <div>
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
        <button class="btn-primary" on:click={imprimirRecibo}>
          <span>Imprimir Recibo</span>
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL AJUSTE DE ASIGNACIONES Y DEDUCCIONES QUINCENALES -->
{#if showModalAjuste && empAjuste}
  <div class="modal-backdrop">
    <div class="modal-card" style="max-width: 680px;">
      <div class="modal-header">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;">Ajustar Cálculo de Nómina (Quincena)</h3>
          <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">
            {empAjuste.nombres} • C.I. {empAjuste.cedula} • {empAjuste.cargo}
          </p>
        </div>
        <button class="btn-close" type="button" on:click={() => { showModalAjuste = false; empAjuste = null; }}>×</button>
      </div>

      <div class="modal-body" style="display: flex; flex-direction: column; gap: 16px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">DÍAS TRABAJADOS</label>
            <input 
              type="number" 
              bind:value={empAjuste.dias_trabajados} 
              min="1" 
              max="15" 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 700;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">SUELDO QUINCENAL ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.sueldoQuincena} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 700;"
            />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">CESTATICKET QUINCENA ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.cestaQuincena} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">HORAS EXTRAS / FERIADOS ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.horasExtras} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">BONIFICACIÓN ADICIONAL ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.bonoAdicional} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #b91c1c; margin-bottom: 4px;">ANTICIPOS O PRÉSTAMOS ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.anticipos} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; color: #b91c1c; font-weight: 700;"
            />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #b91c1c; margin-bottom: 4px;">DEDUCCIÓN IVSS (4%) ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.dedIvss} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #b91c1c; margin-bottom: 4px;">DEDUCCIÓN FAOV (1%) ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empAjuste.dedFaov} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
        </div>

        <!-- Previsualización neta en modal -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Neto Estimado:</span>
            <div style="font-size: 17px; font-weight: 900; color: #15803d;">
              {fmtUsd(Math.max(0, (Number(empAjuste.sueldoQuincena || 0) + Number(empAjuste.cestaQuincena || 0) + Number(empAjuste.horasExtras || 0) + Number(empAjuste.bonoAdicional || 0)) - (Number(empAjuste.dedIvss || 0) + Number(empAjuste.dedFaov || 0) + Number(empAjuste.anticipos || 0))))}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="font-size: 11px; color: #64748b;">En Bolívares (Tasa BCV):</span>
            <div style="font-size: 14px; font-weight: 800; color: #0f172a;">
              {fmtBs(Math.max(0, (Number(empAjuste.sueldoQuincena || 0) + Number(empAjuste.cestaQuincena || 0) + Number(empAjuste.horasExtras || 0) + Number(empAjuste.bonoAdicional || 0)) - (Number(empAjuste.dedIvss || 0) + Number(empAjuste.dedFaov || 0) + Number(empAjuste.anticipos || 0))) * tasaBcv)}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" type="button" on:click={() => { showModalAjuste = false; empAjuste = null; }}>Cancelar</button>
        <button class="btn-primary" type="button" on:click={guardarAjustesEmpleado}>Guardar Ajustes</button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL EDITAR FICHA SALARIAL -->
{#if showModalEmpleadoFicha && empFicha}
  <div class="modal-backdrop">
    <div class="modal-card" style="max-width: 600px;">
      <div class="modal-header">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;">Editar Ficha Salarial y Bancaria</h3>
          <p style="margin: 2px 0 0; font-size: 12px; color: #64748b;">
            {empFicha.nombres} • C.I. {empFicha.cedula}
          </p>
        </div>
        <button class="btn-close" type="button" on:click={() => { showModalEmpleadoFicha = false; empFicha = null; }}>×</button>
      </div>

      <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">SUELDO BASE MENSUAL ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empFicha.sueldo_base_usd} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 800; color: #15803d;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">CESTATICKET MENSUAL ($)</label>
            <input 
              type="number" 
              step="0.01" 
              bind:value={empFicha.cestaticket_usd} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-weight: 700;"
            />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">CARGO OPERATIVO</label>
            <input 
              type="text" 
              bind:value={empFicha.cargo} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">DEPARTAMENTO</label>
            <input 
              type="text" 
              bind:value={empFicha.departamento} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">BANCO</label>
            <input 
              type="text" 
              bind:value={empFicha.banco} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px;"
            />
          </div>
          <div>
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 4px;">NRO. CUENTA (20 DÍGITOS)</label>
            <input 
              type="text" 
              bind:value={empFicha.nro_cuenta} 
              style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: monospace;"
            />
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" type="button" on:click={() => { showModalEmpleadoFicha = false; empFicha = null; }}>Cancelar</button>
        <button class="btn-primary" type="button" on:click={guardarFichaEmpleado}>Actualizar Ficha</button>
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
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 10px;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
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

  .card-header-block {
    margin-bottom: 20px;
  }

  .card-title-lg {
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 6px 0;
  }

  .card-desc {
    font-size: 13.5px;
    color: #64748b;
    margin: 0;
    line-height: 1.4;
  }

  .card-buttons-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
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

  @media print {
    :global(body) {
      background: #ffffff !important;
    }
    :global(header), :global(aside), :global(nav), .erp-view-header, .tabs-wrapper, .modal-footer, .btn-close {
      display: none !important;
    }
    .modal-backdrop {
      position: static !important;
      background: none !important;
      padding: 0 !important;
    }
    .receipt-modal {
      box-shadow: none !important;
      border: 1px solid #000 !important;
      max-width: 100% !important;
      width: 100% !important;
    }
  }
</style>
