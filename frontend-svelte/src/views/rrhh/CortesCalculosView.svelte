<script>
  import { onMount } from 'svelte';
  import { selectedCorteStore } from './CortesView.svelte';
  import { navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  let corteId = null;
  let corte = null;
  let isLoading = true;
  let activeTab = 'calculos'; // 'calculos' | 'puntualidad'
  let searchQuery = '';

  // Cálculos procesados de los empleados
  let processedEmployees = [];

  onMount(async () => {
    // 1. Obtener ID del store o de la URL hash (#/rrhh/cortes/calculos?id=X)
    let id = null;
    const unsub = selectedCorteStore.subscribe(val => {
      if (val && val.id) id = val.id;
    });
    unsub();

    if (!id && typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const match = hash.match(/[?&]id=(\d+)/);
      if (match) id = match[1];
    }

    if (id) {
      corteId = id;
      await loadCorteData(id);
    } else {
      isLoading = false;
      triggerToast('No se especificó ningún corte histórico para visualizar', 'warning');
    }
  });

  async function loadCorteData(id) {
    isLoading = true;
    try {
      const res = await fetch(`/api/master/cortes/${id}`);
      const json = await res.json();
      if (json && json.success && json.data) {
        corte = json.data;
        computeCalculos(corte);
      } else {
        triggerToast(json?.error || 'No se encontró el corte solicitado', 'error');
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error de conexión al cargar corte histórico', 'error');
    } finally {
      isLoading = false;
    }
  }

  function computeCalculos(corteObj) {
    if (!corteObj) return;
    const snapshotData = corteObj.data || {};
    const rawEmpleados = snapshotData.empleados || (snapshotData.reportData && snapshotData.reportData.empleados) || [];
    const diasDelMes = snapshotData.diasDelMes || (snapshotData.reportData && snapshotData.reportData.diasDelMes) || [];

    processedEmployees = rawEmpleados.map(emp => {
      const dias = emp.dias || [];

      let diurnosCount = 0;
      let nocturnosCount = 0;
      let horasDiurnasMins = 0;
      let horasNocturnasMins = 0;
      let totalTrabajadosMins = 0;
      let domingosCount = 0;
      let feriadosCount = 0;

      // Novedades y excepciones específicas
      let faltaInjustificadaCount = 0;
      let justificativoCount = 0;
      let libreCount = 0;
      let nuevoIngresoCount = 0;
      let permisoNoRemuneradoCount = 0;
      let permisoRemuneradoCount = 0;
      let reposoIvssCount = 0;
      let retiradoCount = 0;
      let suspendidoCount = 0;
      let otroNegocioCount = 0;
      let vacacionesCount = 0;

      // Métricas de puntualidad y score
      let diasAsistidos = 0;
      let aTiempoCount = 0;
      let retrasosCount = 0;
      let retrasosMins = 0;
      let salidasTempranasCount = 0;
      let salidasTempranasMins = 0;
      let horasEsperadasMins = 0;

      dias.forEach(dia => {
        const resStr = String(dia.resultadoStr || '').toUpperCase().trim();
        const shiftCode = String((dia.shift && dia.shift.codigo) || '').toUpperCase().trim();
        const mins = Number(dia.trabajadosMins) || 0;

        // Días de la semana y feriados
        const fechaObj = new Date(dia.fechaStr + 'T00:00:00');
        const isSunday = fechaObj.getDay() === 0;
        const isFeriado = Boolean(dia.isFeriado || dia.feriadoNombre);

        // Si trabajó
        if (mins > 0 && resStr !== 'LIBRE') {
          totalTrabajadosMins += mins;
          diasAsistidos++;

          if (isSunday) domingosCount++;
          if (isFeriado) feriadosCount++;

          // Diurnos vs Nocturnos
          if (resStr.includes('NOCTURNO')) {
            nocturnosCount++;
            horasNocturnasMins += mins;
          } else if (resStr.includes('DIURNO') && !resStr.includes('(N)')) {
            diurnosCount++;
            horasDiurnasMins += mins;
          } else if (resStr.includes('(D)') && resStr.includes('(N)')) {
            diurnosCount++;
            nocturnosCount++;
            // Desglosar si viene formateado como (D) HH:MM - (N) HH:MM
            const matchD = resStr.match(/\(D\)\s*(\d{2}):(\d{2})/);
            const matchN = resStr.match(/\(N\)\s*(\d{2}):(\d{2})/);
            if (matchD && matchN) {
              const dM = parseInt(matchD[1]) * 60 + parseInt(matchD[2]);
              const nM = parseInt(matchN[1]) * 60 + parseInt(matchN[2]);
              horasDiurnasMins += dM;
              horasNocturnasMins += nM;
            } else {
              horasDiurnasMins += Math.floor(mins / 2);
              horasNocturnasMins += Math.ceil(mins / 2);
            }
          } else {
            diurnosCount++;
            horasDiurnasMins += mins;
          }

          // Métricas de puntualidad
          if (dia.entBadge) {
            const entText = String(dia.entBadge.text || '00:00');
            const [h, m] = entText.split(':').map(Number);
            const badgeMins = (h || 0) * 60 + (m || 0);

            if (dia.entBadge.isAlert) {
              retrasosCount++;
              retrasosMins += badgeMins;
            } else {
              aTiempoCount++;
            }
          }

          if (dia.salBadge && dia.salBadge.isAlert) {
            const salText = String(dia.salBadge.text || '00:00');
            const [sh, sm] = salText.split(':').map(Number);
            salidasTempranasCount++;
            salidasTempranasMins += (sh || 0) * 60 + (sm || 0);
          }
        }

        // Horas esperadas por plantilla asignada
        if (dia.shift && dia.shift.hora_entrada && dia.shift.hora_salida) {
          const [eh, em] = dia.shift.hora_entrada.split(':').map(Number);
          const [sh, sm] = dia.shift.hora_salida.split(':').map(Number);
          let dur = ((sh * 60 + sm) - (eh * 60 + em));
          if (dur < 0) dur += 24 * 60;
          horasEsperadasMins += dur;
        } else if (mins > 0) {
          horasEsperadasMins += 8 * 60; // Base estándar 8h
        }

        // Conteo de novedades y excepciones
        if (shiftCode === 'FI' || resStr.includes('INJUSTIFICADA') || resStr.includes('FALTA INJUSTIFICADA')) {
          faltaInjustificadaCount++;
        } else if (shiftCode === 'FJ' || resStr.includes('JUSTIFICADO') || resStr.includes('CONSTANCIA')) {
          justificativoCount++;
        } else if (shiftCode === 'L' || resStr === 'LIBRE') {
          libreCount++;
        } else if (shiftCode === 'NI' || resStr.includes('NUEVO INGRESO')) {
          nuevoIngresoCount++;
        } else if (shiftCode === 'PNR' || resStr.includes('NO REMUNERADO')) {
          permisoNoRemuneradoCount++;
        } else if (shiftCode === 'PR' || resStr.includes('PERMISO REMUNERADO')) {
          permisoRemuneradoCount++;
        } else if (shiftCode === 'IVSS' || resStr.includes('REPOSO') || resStr.includes('IVSS')) {
          reposoIvssCount++;
        } else if (shiftCode === 'RET' || resStr.includes('RETIRADO')) {
          retiradoCount++;
        } else if (shiftCode === 'SUS' || resStr.includes('SUSPENDIDO')) {
          suspendidoCount++;
        } else if (shiftCode === 'OTRO' || resStr.includes('OTRO NEGOCIO')) {
          otroNegocioCount++;
        } else if (shiftCode === 'VAC' || resStr.includes('VACACIONES')) {
          vacacionesCount++;
        }
      });

      // Diferencia de Horas (trabajadas - esperadas)
      const diffMins = totalTrabajadosMins - horasEsperadasMins;
      const diffSign = diffMins >= 0 ? '+' : '-';
      const absDiffMins = Math.abs(diffMins);
      const diffHorasStr = `${diffSign}${toHHMM(absDiffMins)}`;

      // Score de Asistencia y Puntualidad (0 a 100%)
      const totalEvaluados = diasAsistidos + faltaInjustificadaCount;
      let scorePuntualidad = 100;
      if (totalEvaluados > 0) {
        const penalizacionFaltas = (faltaInjustificadaCount / totalEvaluados) * 50;
        const penalizacionRetrasos = Math.min(30, (retrasosMins / 60) * 5);
        scorePuntualidad = Math.max(0, Math.round(100 - penalizacionFaltas - penalizacionRetrasos));
      }

      return {
        ...emp,
        diurnosCount,
        nocturnosCount,
        horasDiurnasStr: toHHMM(horasDiurnasMins),
        horasNocturnasStr: toHHMM(horasNocturnasMins),
        totalTrabajadosStr: toHHMM(totalTrabajadosMins),
        horasEsperadasStr: toHHMM(horasEsperadasMins),
        diffHorasStr,
        diffMins,
        domingosCount,
        feriadosCount,
        faltaInjustificadaCount,
        justificativoCount,
        libreCount,
        nuevoIngresoCount,
        permisoNoRemuneradoCount,
        permisoRemuneradoCount,
        reposoIvssCount,
        retiradoCount,
        suspendidoCount,
        otroNegocioCount,
        vacacionesCount,
        diasAsistidos,
        aTiempoCount,
        retrasosCount,
        retrasosStr: toHHMM(retrasosMins),
        salidasTempranasCount,
        salidasTempranasStr: toHHMM(salidasTempranasMins),
        scorePuntualidad
      };
    });
  }

  function toHHMM(totalMinutes) {
    if (!totalMinutes || isNaN(totalMinutes) || totalMinutes <= 0) return '00:00';
    const h = Math.floor(totalMinutes / 60);
    const m = Math.floor(totalMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function formatDate(dStr) {
    if (!dStr) return '';
    const parts = String(dStr).split('T')[0].split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dStr;
  }

  function handlePrint() {
    window.print();
  }

  function handleBack() {
    navigateToRoute('rrhh/cortes');
  }

  $: filteredEmployees = processedEmployees.filter(emp => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    return (
      (emp.nombre || '').toLowerCase().includes(term) ||
      (emp.cedula || '').toLowerCase().includes(term) ||
      (emp.cargo || '').toLowerCase().includes(term)
    );
  });
</script>

<div class="corte-calculos-wrapper">
  
  {#if isLoading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Cargando datos y cálculos del corte histórico...</p>
    </div>
  {:else if !corte}
    <div class="error-state">
      <span class="error-icon">⚠️</span>
      <h3>Corte no encontrado</h3>
      <p>No se pudo cargar la información del corte histórico solicitado.</p>
      <button type="button" class="btn-back" on:click={handleBack}>
        ← Volver a Cortes
      </button>
    </div>
  {:else}

    <!-- Purple Header matching Image 2 -->
    <div class="purple-header-card">
      <div class="header-left">
        <div class="header-badge-row">
          <span class="corte-id-badge">Corte #{corte.id}</span>
          <span class="corte-sala-badge">{corte.sala_nombre || 'General'}</span>
        </div>
        <h1 class="header-title">Calculos</h1>
        <p class="header-subtitle">
          {corte.sala_nombre || 'Casino'} - Desde: {formatDate(corte.fecha_desde)} - Hasta: {formatDate(corte.fecha_hasta)}
        </p>
      </div>

      <div class="header-right">
        <div class="emp-counter-chip">
          <span class="emp-icon">👥</span>
          <span class="emp-text"><strong>{processedEmployees.length}</strong> empleado(s)</span>
        </div>

        <button type="button" class="btn-print" on:click={handlePrint} title="Imprimir reporte oficial">
          <span>🖨️</span> Imprimir
        </button>

        <button type="button" class="btn-volver" on:click={handleBack} title="Volver al listado de cortes">
          <span>←</span> Volver a Cortes
        </button>
      </div>
    </div>

    <!-- Navigation Tabs & Search Controls -->
    <div class="toolbar-card no-print">
      <div class="tabs-group">
        <button
          type="button"
          class="tab-btn {activeTab === 'calculos' ? 'active' : ''}"
          on:click={() => activeTab = 'calculos'}
        >
          <span class="tab-icon">📊</span>
          <span>Tabla Oficial de Cálculos y Novedades</span>
          <span class="tab-badge">{processedEmployees.length}</span>
        </button>

        <button
          type="button"
          class="tab-btn {activeTab === 'puntualidad' ? 'active' : ''}"
          on:click={() => activeTab = 'puntualidad'}
        >
          <span class="tab-icon">⏱️</span>
          <span>Score y Puntualidad de Asistencia</span>
        </button>
      </div>

      <div class="search-wrap">
        <input
          type="text"
          placeholder="Buscar empleado por nombre, cédula o cargo..."
          bind:value={searchQuery}
          class="search-input"
        />
        {#if searchQuery}
          <button type="button" class="clear-search" on:click={() => searchQuery = ''}>✕</button>
        {/if}
      </div>
    </div>

    <!-- Tab 1: Tabla Oficial de Cálculos (19 Columnas exactas - Verde Imagen 2) -->
    {#if activeTab === 'calculos'}
      <div class="table-container">
        <table class="calculos-table">
          <thead>
            <tr>
              <th class="col-emp sticky-col">Empleado</th>
              <th class="col-num" title="Días Diurnos">Diurnos</th>
              <th class="col-num" title="Días Nocturnos">Nocturnos</th>
              <th class="col-hours" title="Horas Diurnas Acumuladas">Horas Diurnas</th>
              <th class="col-hours" title="Horas Nocturnas Acumuladas">Horas Nocturnas</th>
              <th class="col-hours" title="Diferencia de Horas">Diferencia Horas</th>
              <th class="col-num" title="Domingos Trabajados">Domingos</th>
              <th class="col-num" title="Días Feriados Trabajados">Feriados</th>
              <th class="col-num alert-col" title="Falta Injustificada">Falta Injustificada</th>
              <th class="col-num" title="Justificativo (Falta Justificada, con constancia)">Justificativo (Falta Justificada, con constancia)</th>
              <th class="col-num" title="Días Libres">Libre</th>
              <th class="col-num" title="Nuevo Ingreso">Nuevo Ingreso</th>
              <th class="col-num" title="Permiso No Remunerado">Permiso No Remunerado</th>
              <th class="col-num" title="Permiso Remunerado">Permiso Remunerado</th>
              <th class="col-num" title="Reposo IVSS">Reposo IVSS</th>
              <th class="col-num" title="Retirado">Retirado</th>
              <th class="col-num" title="Suspendido">Suspendido</th>
              <th class="col-num" title="Turno, en otro negocio">Turno, en otro negocio</th>
              <th class="col-num" title="Vacaciones">Vacaciones</th>
            </tr>
          </thead>
          <tbody>
            {#if filteredEmployees.length === 0}
              <tr>
                <td colspan="19" class="empty-row">
                  No se encontraron empleados en este corte histórico.
                </td>
              </tr>
            {:else}
              {#each filteredEmployees as emp, idx}
                <tr class="data-row {idx % 2 === 0 ? 'even' : 'odd'}">
                  <td class="col-emp sticky-col">
                    <div class="emp-cell">
                      <img
                        src={emp.foto || `/empleados/${emp.id}.jpg`}
                        alt=""
                        class="emp-avatar"
                        on:error={(e) => { e.target.style.display = 'none'; }}
                      />
                      <div class="emp-info">
                        <span class="emp-name">{emp.nombre}</span>
                        <span class="emp-meta">V-{emp.cedula || emp.id} • {emp.cargo || 'Personal'}</span>
                      </div>
                    </div>
                  </td>
                  <td class="col-num {emp.diurnosCount > 0 ? 'val-active' : ''}">{emp.diurnosCount || 0}</td>
                  <td class="col-num {emp.nocturnosCount > 0 ? 'val-active' : ''}">{emp.nocturnosCount || 0}</td>
                  <td class="col-hours font-mono">{emp.horasDiurnasStr}</td>
                  <td class="col-hours font-mono">{emp.horasNocturnasStr}</td>
                  <td class="col-hours font-mono {emp.diffMins < 0 ? 'diff-neg' : (emp.diffMins > 0 ? 'diff-pos' : '')}">
                    {emp.diffHorasStr}
                  </td>
                  <td class="col-num {emp.domingosCount > 0 ? 'val-sunday' : ''}">{emp.domingosCount || 0}</td>
                  <td class="col-num {emp.feriadosCount > 0 ? 'val-feriado' : ''}">{emp.feriadosCount || 0}</td>
                  <td class="col-num {emp.faltaInjustificadaCount > 0 ? 'val-falta' : ''}">{emp.faltaInjustificadaCount || 0}</td>
                  <td class="col-num {emp.justificativoCount > 0 ? 'val-active' : ''}">{emp.justificativoCount || 0}</td>
                  <td class="col-num">{emp.libreCount || 0}</td>
                  <td class="col-num">{emp.nuevoIngresoCount || 0}</td>
                  <td class="col-num">{emp.permisoNoRemuneradoCount || 0}</td>
                  <td class="col-num">{emp.permisoRemuneradoCount || 0}</td>
                  <td class="col-num">{emp.reposoIvssCount || 0}</td>
                  <td class="col-num">{emp.retiradoCount || 0}</td>
                  <td class="col-num">{emp.suspendidoCount || 0}</td>
                  <td class="col-num">{emp.otroNegocioCount || 0}</td>
                  <td class="col-num">{emp.vacacionesCount || 0}</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Tab 2: Score y Puntualidad Detallada -->
    {#if activeTab === 'puntualidad'}
      <div class="score-container">
        <div class="score-summary-grid">
          <div class="score-kpi-card">
            <span class="kpi-label">Total Empleados Evaluados</span>
            <span class="kpi-value text-blue">{filteredEmployees.length}</span>
            <span class="kpi-sub">En este corte histórico</span>
          </div>

          <div class="score-kpi-card">
            <span class="kpi-label">Promedio de Puntualidad</span>
            <span class="kpi-value text-green">
              {filteredEmployees.length > 0 ? Math.round(filteredEmployees.reduce((acc, e) => acc + e.scorePuntualidad, 0) / filteredEmployees.length) : 100}%
            </span>
            <span class="kpi-sub">Índice general de la sala</span>
          </div>

          <div class="score-kpi-card">
            <span class="kpi-label">Total Retrasos Acumulados</span>
            <span class="kpi-value text-red">
              {filteredEmployees.reduce((acc, e) => acc + e.retrasosCount, 0)}
            </span>
            <span class="kpi-sub">Incidencias de entrada tarde</span>
          </div>

          <div class="score-kpi-card">
            <span class="kpi-label">Faltas Injustificadas</span>
            <span class="kpi-value text-orange">
              {filteredEmployees.reduce((acc, e) => acc + e.faltaInjustificadaCount, 0)}
            </span>
            <span class="kpi-sub">Sin justificación médica/laboral</span>
          </div>
        </div>

        <div class="table-container">
          <table class="calculos-table score-table">
            <thead>
              <tr>
                <th class="col-emp sticky-col">Empleado</th>
                <th class="col-num">Días Asistidos</th>
                <th class="col-num">A Tiempo</th>
                <th class="col-num">Retrasos</th>
                <th class="col-hours">Minutos Retraso</th>
                <th class="col-num">Salidas Tempranas</th>
                <th class="col-hours">Minutos Sal. Temprana</th>
                <th class="col-hours">Horas Trabajadas</th>
                <th class="col-score">Score de Asistencia</th>
                <th class="col-status">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredEmployees as emp, idx}
                <tr class="data-row {idx % 2 === 0 ? 'even' : 'odd'}">
                  <td class="col-emp sticky-col">
                    <div class="emp-cell">
                      <img
                        src={emp.foto || `/empleados/${emp.id}.jpg`}
                        alt=""
                        class="emp-avatar"
                        on:error={(e) => { e.target.style.display = 'none'; }}
                      />
                      <div class="emp-info">
                        <span class="emp-name">{emp.nombre}</span>
                        <span class="emp-meta">V-{emp.cedula || emp.id} • {emp.cargo || 'Personal'}</span>
                      </div>
                    </div>
                  </td>
                  <td class="col-num font-bold">{emp.diasAsistidos}</td>
                  <td class="col-num val-active font-bold">{emp.aTiempoCount}</td>
                  <td class="col-num {emp.retrasosCount > 0 ? 'val-falta' : ''} font-bold">{emp.retrasosCount}</td>
                  <td class="col-hours font-mono {emp.retrasosCount > 0 ? 'text-red' : ''}">{emp.retrasosStr}</td>
                  <td class="col-num {emp.salidasTempranasCount > 0 ? 'val-falta' : ''} font-bold">{emp.salidasTempranasCount}</td>
                  <td class="col-hours font-mono {emp.salidasTempranasCount > 0 ? 'text-red' : ''}">{emp.salidasTempranasStr}</td>
                  <td class="col-hours font-mono font-bold">{emp.totalTrabajadosStr}</td>
                  <td class="col-score">
                    <div class="score-bar-wrapper">
                      <div class="score-bar-bg">
                        <div
                          class="score-bar-fill {emp.scorePuntualidad >= 85 ? 'fill-green' : (emp.scorePuntualidad >= 65 ? 'fill-yellow' : 'fill-red')}"
                          style="width: {emp.scorePuntualidad}%;"
                        ></div>
                      </div>
                      <span class="score-percent-text">{emp.scorePuntualidad}%</span>
                    </div>
                  </td>
                  <td class="col-status">
                    {#if emp.scorePuntualidad >= 90}
                      <span class="status-badge badge-excelente">🌟 Excelente</span>
                    {:else if emp.scorePuntualidad >= 75}
                      <span class="status-badge badge-bueno">🟢 Bueno</span>
                    {:else if emp.scorePuntualidad >= 60}
                      <span class="status-badge badge-regular">⚠️ Regular</span>
                    {:else}
                      <span class="status-badge badge-alerta">🚨 Alerta</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

  {/if}

</div>

<style>
  .corte-calculos-wrapper {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    width: 100%;
    box-sizing: border-box;
    background: #f8fafc;
    min-height: calc(100vh - 70px);
  }

  /* Purple Header matching Image 2 */
  .purple-header-card {
    background: linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7c3aed 100%);
    color: #ffffff;
    border-radius: 14px;
    padding: 20px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 10px 15px -3px rgba(88, 28, 135, 0.25);
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-badge-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .corte-id-badge {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    font-size: 11px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 6px;
    letter-spacing: 0.5px;
  }

  .corte-sala-badge {
    background: #ffffff;
    color: #581c87;
    font-size: 11px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 6px;
    text-transform: uppercase;
  }

  .header-title {
    font-size: 26px;
    font-weight: 900;
    letter-spacing: -0.5px;
    margin: 4px 0 0 0;
    line-height: 1.1;
  }

  .header-subtitle {
    font-size: 13.5px;
    color: #e9d5ff;
    font-weight: 600;
    margin: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .emp-counter-chip {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 10px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ffffff;
    font-size: 13px;
  }

  .btn-print {
    background: #ffffff;
    color: #581c87;
    border: none;
    border-radius: 9px;
    padding: 9px 18px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.15s ease;
  }

  .btn-print:hover {
    background: #f3e8ff;
    transform: translateY(-1px);
  }

  .btn-volver {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 9px;
    padding: 9px 18px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
  }

  .btn-volver:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /* Toolbar and Tabs */
  .toolbar-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }

  .tabs-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: #f1f5f9;
    color: #475569;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s ease;
  }

  .tab-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .tab-btn.active {
    background: #15803d;
    color: #ffffff;
    border-color: #166534;
    box-shadow: 0 2px 4px rgba(21, 128, 61, 0.25);
  }

  .tab-badge {
    background: rgba(0, 0, 0, 0.15);
    color: inherit;
    font-size: 11px;
    font-weight: 800;
    padding: 1px 6px;
    border-radius: 6px;
  }

  .search-wrap {
    position: relative;
    width: 320px;
  }

  .search-input {
    width: 100%;
    padding: 8px 30px 8px 12px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 12.5px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    border-color: #15803d;
  }

  .clear-search {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 13px;
  }

  /* Table Container */
  .table-container {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    overflow-x: auto;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  }

  .calculos-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
    white-space: nowrap;
  }

  /* Green Table Header matching Image 2 */
  .calculos-table thead tr {
    background: #15803d;
    color: #ffffff;
  }

  .calculos-table th {
    padding: 10px 12px;
    font-size: 11px;
    font-weight: 800;
    text-align: center;
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    letter-spacing: 0.2px;
    user-select: none;
  }

  .sticky-col {
    position: sticky;
    left: 0;
    z-index: 2;
  }

  .calculos-table thead .sticky-col {
    background: #14532d;
    z-index: 3;
  }

  .col-emp {
    text-align: left !important;
    min-width: 220px;
  }

  .col-num {
    min-width: 60px;
  }

  .col-hours {
    min-width: 85px;
  }

  .calculos-table td {
    padding: 6px 10px;
    border-bottom: 1px solid #e2e8f0;
    border-right: 1px solid #f1f5f9;
    text-align: center;
    color: #1e293b;
  }

  .data-row.even {
    background: #ffffff;
  }

  .data-row.odd {
    background: #f8fafc;
  }

  .data-row:hover {
    background: #f1f5f9;
  }

  .data-row.even .sticky-col {
    background: #ffffff;
  }

  .data-row.odd .sticky-col {
    background: #f8fafc;
  }

  .data-row:hover .sticky-col {
    background: #f1f5f9;
  }

  /* Employee Cell */
  .emp-cell {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .emp-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid #cbd5e1;
    background: #e2e8f0;
  }

  .emp-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.15;
  }

  .emp-name {
    font-size: 11.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .emp-meta {
    font-size: 10px;
    color: #64748b;
    font-weight: 600;
  }

  /* Cell Highlight Utilities */
  .font-mono {
    font-family: monospace;
    font-size: 11.5px;
    font-weight: 700;
  }

  .font-bold {
    font-weight: 800;
  }

  .val-active {
    background: #ecfdf5;
    color: #15803d;
    font-weight: 800;
  }

  .val-sunday {
    background: #eff6ff;
    color: #1d4ed8;
    font-weight: 800;
  }

  .val-feriado {
    background: #f5f3ff;
    color: #6b21a8;
    font-weight: 800;
  }

  .val-falta {
    background: #fef2f2;
    color: #dc2626;
    font-weight: 800;
  }

  .diff-pos {
    color: #15803d;
    font-weight: 800;
  }

  .diff-neg {
    color: #dc2626;
    font-weight: 800;
  }

  .text-red {
    color: #dc2626;
  }

  .empty-row {
    padding: 30px !important;
    text-align: center;
    color: #64748b;
    font-size: 13px;
    font-style: italic;
  }

  /* Score Tab */
  .score-container {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .score-summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
  }

  .score-kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .kpi-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
  }

  .kpi-value {
    font-size: 24px;
    font-weight: 900;
    line-height: 1.2;
    margin: 4px 0;
  }

  .text-blue { color: #2563eb; }
  .text-green { color: #16a34a; }
  .text-orange { color: #ea580c; }

  .kpi-sub {
    font-size: 11px;
    color: #94a3b8;
  }

  .col-score {
    min-width: 140px;
  }

  .col-status {
    min-width: 110px;
  }

  .score-bar-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .score-bar-bg {
    flex: 1;
    height: 8px;
    background: #e2e8f0;
    border-radius: 4px;
    overflow: hidden;
  }

  .score-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .fill-green { background: #16a34a; }
  .fill-yellow { background: #eab308; }
  .fill-red { background: #dc2626; }

  .score-percent-text {
    font-size: 11.5px;
    font-weight: 800;
    color: #0f172a;
    width: 34px;
    text-align: right;
  }

  .status-badge {
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 800;
    display: inline-block;
  }

  .badge-excelente { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
  .badge-bueno { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .badge-regular { background: #fef9c3; color: #854d0e; border: 1px solid #fef08a; }
  .badge-alerta { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }

  /* States */
  .loading-state, .error-state {
    background: #ffffff;
    border-radius: 12px;
    padding: 60px 20px;
    text-align: center;
    border: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .spinner {
    width: 36px;
    height: 36px;
    border: 3.5px solid #cbd5e1;
    border-top-color: #6b21a8;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-icon {
    font-size: 36px;
  }

  .btn-back {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
  }

  /* Print Styles */
  @media print {
    .no-print {
      display: none !important;
    }
    .purple-header-card {
      background: #581c87 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .calculos-table thead tr {
      background: #15803d !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
