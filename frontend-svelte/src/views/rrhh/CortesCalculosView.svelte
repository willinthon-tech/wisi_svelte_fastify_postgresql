<script>
  import { onMount } from 'svelte';
  import { selectedCorteStore } from './CortesView.svelte';
  import { navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';

  let corteId = null;
  let corte = null;
  let isLoading = true;
  let activeTab = 'marcajes'; // 'marcajes' | 'calculos' | 'puntualidad'
  let searchQuery = '';
  let selectedDepartamentos = [];

  // Días y meses del corte
  let diasDelMes = [];
  let mesesAgrupados = [];

  // Fechas patrias base nacionales
  const BASE_FERIADOS = [
    { mes: 1, dia: 1, nombre: 'Año Nuevo' },
    { mes: 4, dia: 19, nombre: 'Declaración de la Independencia' },
    { mes: 5, dia: 1, nombre: 'Día del Trabajador' },
    { mes: 6, dia: 24, nombre: 'Batalla de Carabobo' },
    { mes: 7, dia: 5, nombre: 'Día de la Independencia' },
    { mes: 7, dia: 24, nombre: 'Natalicio del Libertador Simón Bolívar' },
    { mes: 10, dia: 12, nombre: 'Día de la Resistencia Indígena' },
    { mes: 12, dia: 24, nombre: 'Víspera de Navidad' },
    { mes: 12, dia: 25, nombre: 'Navidad' },
    { mes: 12, dia: 31, nombre: 'Fin de Año' }
  ];

  let allCalendarFeriados = [];

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
      // Cargar feriados del calendario (excluyendo cumpleaños)
      try {
        const resFer = await fetch('/api/master/calendario?limit=500');
        const jsonFer = await resFer.json();
        if (jsonFer) {
          allCalendarFeriados = jsonFer.data || jsonFer.items || (Array.isArray(jsonFer) ? jsonFer : []);
        }
      } catch (e) {
        console.warn('Error cargando feriados del calendario:', e);
      }

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

  function isDayFeriado(fechaStr, emp) {
    if (!fechaStr) return false;
    const parts = String(fechaStr).split('-');
    if (parts.length < 3) return false;
    const mes = parseInt(parts[1], 10);
    const dia = parseInt(parts[2], 10);

    // 1. Fechas Patrias Base Nacionales
    if (BASE_FERIADOS.some(bf => bf.mes === mes && bf.dia === dia)) {
      return true;
    }

    // 2. Feriados de sala en base de datos (no aplica cumpleaños)
    const empSalaId = emp && emp.sala_id ? Number(emp.sala_id) : (corte && corte.sala_id ? Number(corte.sala_id) : null);
    return allCalendarFeriados.some(f => {
      if (Number(f.mes) !== mes || Number(f.dia) !== dia) return false;
      const fTipo = String(f.tipo || f.tipo_evento || '').toUpperCase();
      if (fTipo === 'CUMPLEANOS' || fTipo === 'CUMPLEAÑOS' || f.empleado_id) return false;
      if (!f.sala_id) return true; // Feriado global de todas las salas
      if (empSalaId && Number(f.sala_id) === empSalaId) return true; // Feriado de la sala del empleado
      return false;
    });
  }

  function getEntradaSalidaTimes(marcajeStr) {
    if (!marcajeStr || marcajeStr === "Sin Registros") return { entrada: null, salida: null };
    const clean = String(marcajeStr).replace(/ - (Sin descanso|Descanso Automático|Con descanso)/gi, "").trim();
    const parts = clean.split("-").map((s) => s.trim());
    if (parts.length >= 2) {
      return { entrada: parts[0], salida: parts[1] };
    } else if (parts.length === 1 && parts[0]) {
      return { entrada: parts[0], salida: null };
    }
    return { entrada: null, salida: null };
  }

  function toMinutes(timeStr) {
    if (!timeStr) return null;
    const parts = String(timeStr).split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
    }
    return null;
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

  function handleBack() {
    navigateToRoute('rrhh/cortes');
  }

  function computeCalculos(corteObj) {
    if (!corteObj) return;
    let snapshotData = corteObj.data || {};
    if (typeof snapshotData === 'string') {
      try {
        snapshotData = JSON.parse(snapshotData);
      } catch (e) {
        snapshotData = {};
      }
    }

    let rawEmpleados = snapshotData.empleados || [];
    if ((!rawEmpleados || rawEmpleados.length === 0) && snapshotData.reportData) {
      if (snapshotData.reportData.empleados && snapshotData.reportData.empleados.length > 0) {
        rawEmpleados = snapshotData.reportData.empleados;
      } else if (snapshotData.reportData.salas) {
        const flat = [];
        snapshotData.reportData.salas.forEach(s => {
          (s.departamentos || []).forEach(d => {
            (d.empleados || []).forEach(e => {
              flat.push({ ...e, sala_id: s.id, sala_nombre: s.nombre, departamento_id: d.id, departamento_nombre: d.nombre });
            });
          });
        });
        rawEmpleados = flat;
      }
    }

    // 1. Construir lista de días y cabecera de meses
    const MESES = [
      "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
      "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
    ];
    const DIAS = ["D", "L", "M", "M", "J", "V", "S"];

    let savedDiasDelMes = snapshotData.diasDelMes || (snapshotData.reportData && snapshotData.reportData.diasDelMes) || [];
    if (!savedDiasDelMes || savedDiasDelMes.length === 0) {
      if (rawEmpleados.length > 0 && rawEmpleados[0].dias && rawEmpleados[0].dias.length > 0) {
        savedDiasDelMes = rawEmpleados[0].dias.map(d => {
          const parts = String(d.fechaStr).split('-');
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const dayNum = parseInt(parts[2], 10);
          const dateObj = new Date(Date.UTC(y, m, dayNum));
          return {
            fechaStr: d.fechaStr,
            num: dayNum,
            diaSemana: DIAS[dateObj.getUTCDay()],
            rawDate: d.fechaStr
          };
        });
      }
    }

    diasDelMes = savedDiasDelMes;

    // Calcular meses agrupados para el colspan superior
    const monthsMap = new Map();
    diasDelMes.forEach(d => {
      let mIndex = null;
      let anio = '';
      if (d.fechaStr) {
        const parts = d.fechaStr.split('-');
        if (parts.length >= 2) {
          anio = parts[0];
          mIndex = parseInt(parts[1], 10) - 1;
        }
      } else if (d.rawDate) {
        const dt = new Date(d.rawDate);
        mIndex = dt.getUTCMonth();
        anio = dt.getUTCFullYear();
      }
      const key = (mIndex !== null && mIndex >= 0 && mIndex < 12) ? `${MESES[mIndex]} ${anio}`.trim() : 'PERÍODO';
      monthsMap.set(key, (monthsMap.get(key) || 0) + 1);
    });

    mesesAgrupados = Array.from(monthsMap.entries()).map(([nombre, colspan]) => ({
      nombre,
      colspan
    }));

    // 2. Procesar cálculos y puntualidad por empleado
    processedEmployees = rawEmpleados.map(emp => {
      const dias = emp.dias || [];

      let diurnosCount = 0;
      let nocturnosCount = 0;
      let horasDiurnasMins = 0;
      let horasNocturnasMins = 0;
      let diferenciaHorasMins = 0;
      let totalTrabajadosMins = 0;
      let domingosCount = 0;
      let feriadosCount = 0;

      // Novedades y excepciones específicas creadas por el usuario
      let faltaInjustificadaCount = 0;
      let justificativoCount = 0;
      let nuevoIngresoCount = 0;
      let permisoNoRemuneradoCount = 0;
      let permisoRemuneradoCount = 0;
      let reposoIvssCount = 0;
      let retiradoCount = 0;
      let suspendidoCount = 0;
      let otroNegocioCount = 0;
      let vacacionesCount = 0;

      // Métricas de asistencia
      let diasAsistidos = 0;

      // Métricas de Puntualidad (Contadores y Sumadores)
      let entradaTempranaCount = 0;
      let entradaTempranaMins = 0;
      let entradaTardeCount = 0;
      let entradaTardeMins = 0;
      let salidaTempranaCount = 0;
      let salidaTempranaMins = 0;
      let salidaTardeCount = 0;
      let salidaTardeMins = 0;

      dias.forEach(dia => {
        const resStr = String(dia.resultadoStr || '').toUpperCase().trim();
        const shiftCode = String((dia.shift && dia.shift.codigo) || '').toUpperCase().trim();
        const shiftNombre = String((dia.shift && dia.shift.nombre) || '').toUpperCase().trim();
        const mins = Number(dia.trabajadosMins) || 0;

        // Días de la semana (Domingo) y Feriados
        let isSunday = false;
        if (dia.fechaStr) {
          const parts = String(dia.fechaStr).split('-');
          if (parts.length >= 3) {
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10) - 1;
            const dNum = parseInt(parts[2], 10);
            const dateObj = new Date(Date.UTC(y, m, dNum));
            isSunday = dateObj.getUTCDay() === 0;
          }
        }
        const isFeriado = isDayFeriado(dia.fechaStr, emp);

        // Si trabajó
        if (mins > 0 && resStr !== 'LIBRE') {
          totalTrabajadosMins += mins;
          diasAsistidos++;

          // Domingo trabajado
          if (isSunday) domingosCount++;

          // Feriado trabajado (nacionales y de su sala, sin cumpleaños)
          if (isFeriado) feriadosCount++;

          // 1) DIURNOS: contador de días donde la etiqueta dice DIURNO
          if (resStr === 'DIURNO') {
            diurnosCount++;
          }
          // 2) NOCTURNO: contador de días donde la etiqueta dice NOCTURNO
          else if (resStr === 'NOCTURNO') {
            nocturnosCount++;
          }
          // 3) y 4) HORAS DIURNAS Y NOCTURNAS: de los turnos mixtos (D) HH:MM - (N) HH:MM
          else if (resStr.includes('(D)') && resStr.includes('(N)')) {
            const matchD = resStr.match(/\(D\)\s*(\d{1,2}):(\d{2})/);
            const matchN = resStr.match(/\(N\)\s*(\d{1,2}):(\d{2})/);
            if (matchD && matchN) {
              const dM = parseInt(matchD[1], 10) * 60 + parseInt(matchD[2], 10);
              const nM = parseInt(matchN[1], 10) * 60 + parseInt(matchN[2], 10);
              horasDiurnasMins += dM;
              horasNocturnasMins += nM;
            }
          }

          // 5) DIFERENCIA DE HORAS: sumatoria de horas desde las 2am hasta la salida (turnos que cruzan las 2am)
          const times = getEntradaSalidaTimes(dia.marcajeStr);
          if (times.entrada && times.salida) {
            const entM = toMinutes(times.entrada);
            const salM = toMinutes(times.salida);
            if (entM !== null && salM !== null) {
              // Si cruzó medianoche (ej: entra 22:00 y sale 05:30)
              if (salM < entM) {
                // Las 2:00 AM son 120 minutos
                if (salM > 120) {
                  diferenciaHorasMins += (salM - 120);
                }
              } else if (resStr.includes('NOCTURNO')) {
                // Si la jornada nocturna inició después de medianoche
                if (entM < 120 && salM > 120 && salM <= 12 * 60) {
                  diferenciaHorasMins += (salM - 120);
                } else if (entM >= 120 && entM < 6 * 60 && salM > entM && salM <= 12 * 60) {
                  diferenciaHorasMins += (salM - entM);
                }
              }
            }
          }

          // === Puntualidad: ENTRADA (Temprana vs Tarde) ===
          let entDiffFound = false;
          if (dia.entBadge && dia.entBadge.text && dia.entBadge.text !== '00:00') {
            const [eh, em] = String(dia.entBadge.text).split(':').map(Number);
            const badgeMins = (eh || 0) * 60 + (em || 0);
            if (badgeMins > 0) {
              entDiffFound = true;
              if (dia.entBadge.isAlert) {
                entradaTardeCount++;
                entradaTardeMins += badgeMins;
              } else {
                entradaTempranaCount++;
                entradaTempranaMins += badgeMins;
              }
            }
          }
          if (!entDiffFound && dia.shift && dia.shift.hora_entrada && dia.marcajeStr) {
            const times = getEntradaSalidaTimes(dia.marcajeStr);
            if (times.entrada) {
              const schedMins = toMinutes(dia.shift.hora_entrada);
              const realMins = toMinutes(times.entrada);
              if (schedMins !== null && realMins !== null) {
                const diff = realMins - schedMins;
                if (diff > 0) {
                  entradaTardeCount++;
                  entradaTardeMins += diff;
                } else if (diff < 0) {
                  entradaTempranaCount++;
                  entradaTempranaMins += Math.abs(diff);
                }
              }
            }
          }

          // === Puntualidad: SALIDA (Temprana vs Tarde) ===
          let salDiffFound = false;
          if (dia.salBadge && dia.salBadge.text && dia.salBadge.text !== '00:00') {
            const [sh, sm] = String(dia.salBadge.text).split(':').map(Number);
            const badgeMins = (sh || 0) * 60 + (sm || 0);
            if (badgeMins > 0) {
              salDiffFound = true;
              if (dia.salBadge.isAlert) {
                salidaTempranaCount++;
                salidaTempranaMins += badgeMins;
              } else {
                salidaTardeCount++;
                salidaTardeMins += badgeMins;
              }
            }
          }
          if (!salDiffFound && dia.shift && dia.shift.hora_salida && dia.marcajeStr) {
            const times = getEntradaSalidaTimes(dia.marcajeStr);
            if (times.salida) {
              const schedMins = toMinutes(dia.shift.hora_salida);
              const realMins = toMinutes(times.salida);
              if (schedMins !== null && realMins !== null) {
                const diff = schedMins - realMins;
                if (diff > 0) {
                  salidaTempranaCount++;
                  salidaTempranaMins += diff;
                } else if (diff < 0) {
                  salidaTardeCount++;
                  salidaTardeMins += Math.abs(diff);
                }
              }
            }
          }
        }

        // Conteo de novedades y excepciones
        if (shiftCode === 'FI' || resStr.includes('INJUSTIFICADA') || shiftNombre.includes('INJUSTIFICADA')) {
          faltaInjustificadaCount++;
        } else if (shiftCode === 'FJ' || resStr.includes('JUSTIFICAD') || shiftNombre.includes('JUSTIFICAD') || resStr.includes('CONSTANCIA')) {
          justificativoCount++;
        } else if (shiftCode === 'NI' || resStr.includes('NUEVO INGRESO') || shiftNombre.includes('NUEVO INGRESO')) {
          nuevoIngresoCount++;
        } else if (shiftCode === 'PNR' || resStr.includes('NO REMUNERADO') || shiftNombre.includes('NO REMUNERADO')) {
          permisoNoRemuneradoCount++;
        } else if (shiftCode === 'PR' || (resStr.includes('PERMISO') && !resStr.includes('NO REMUNERADO')) || (shiftNombre.includes('PERMISO') && !shiftNombre.includes('NO REMUNERADO'))) {
          permisoRemuneradoCount++;
        } else if (shiftCode === 'IVSS' || resStr.includes('REPOSO') || resStr.includes('IVSS') || shiftNombre.includes('REPOSO')) {
          reposoIvssCount++;
        } else if (shiftCode === 'RET' || resStr.includes('RETIRADO') || shiftNombre.includes('RETIRADO')) {
          retiradoCount++;
        } else if (shiftCode === 'SUS' || resStr.includes('SUSPENDIDO') || shiftNombre.includes('SUSPENDIDO')) {
          suspendidoCount++;
        } else if (shiftCode === 'OTRO' || resStr.includes('OTRO NEGOCIO') || shiftNombre.includes('OTRO NEGOCIO')) {
          otroNegocioCount++;
        } else if (shiftCode === 'VAC' || resStr.includes('VACACION') || shiftNombre.includes('VACACION')) {
          vacacionesCount++;
        }
      });

      return {
        ...emp,
        diurnosCount,
        nocturnosCount,
        horasDiurnasStr: toHHMM(horasDiurnasMins),
        horasNocturnasStr: toHHMM(horasNocturnasMins),
        diffHorasStr: toHHMM(diferenciaHorasMins),
        diferenciaHorasMins,
        domingosCount,
        feriadosCount,
        faltaInjustificadaCount,
        justificativoCount,
        nuevoIngresoCount,
        permisoNoRemuneradoCount,
        permisoRemuneradoCount,
        reposoIvssCount,
        retiradoCount,
        suspendidoCount,
        otroNegocioCount,
        vacacionesCount,
        diasAsistidos,
        // Puntualidad solicitada
        diasTrabajados: diasAsistidos,
        horasTrabajadasStr: toHHMM(totalTrabajadosMins),
        entradaTempranaCount,
        entradaTardeCount,
        salidaTempranaCount,
        salidaTardeCount,
        entradaTempranaStr: toHHMM(entradaTempranaMins),
        entradaTardeStr: toHHMM(entradaTardeMins),
        salidaTempranaStr: toHHMM(salidaTempranaMins),
        salidaTardeStr: toHHMM(salidaTardeMins)
      };
    });
  }

  // Opciones dinámicas de Departamentos extraídas de los empleados asociados al corte
  $: departamentoOptions = (() => {
    if (!processedEmployees || processedEmployees.length === 0) return [];
    const deptoMap = new Map();

    processedEmployees.forEach(emp => {
      const name = (emp.departamento_nombre || emp.departamento || '').trim();
      const id = emp.departamento_id ? String(emp.departamento_id) : (name ? name.toLowerCase() : 'sin_depto');
      const label = name || 'Sin Departamento';

      if (!deptoMap.has(id)) {
        deptoMap.set(id, { id, key: id, label, count: 0 });
      }
      deptoMap.get(id).count++;
    });

    return Array.from(deptoMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
  })();

  $: filteredEmployees = processedEmployees.filter(emp => {
    // 1. Filtro por departamentos seleccionados
    if (selectedDepartamentos && selectedDepartamentos.length > 0) {
      const empDeptoId = emp.departamento_id ? String(emp.departamento_id) : '';
      const empDeptoName = String(emp.departamento_nombre || emp.departamento || '').trim().toLowerCase();
      
      const matchesDepto = selectedDepartamentos.some(sel => {
        const selStr = String(sel).trim();
        if (empDeptoId && selStr === empDeptoId) return true;
        if (empDeptoName && selStr.toLowerCase() === empDeptoName) return true;
        if (selStr === 'sin_depto' && !empDeptoId && !empDeptoName) return true;
        return false;
      });
      if (!matchesDepto) return false;
    }

    // 2. Filtro por término de búsqueda (nombre, cédula, cargo o departamento)
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    return (
      (emp.nombre || '').toLowerCase().includes(term) ||
      (emp.cedula || '').toLowerCase().includes(term) ||
      (emp.cargo || '').toLowerCase().includes(term) ||
      (emp.departamento_nombre || '').toLowerCase().includes(term)
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
        Volver
      </button>
    </div>
  {:else}

    <!-- Purple Header -->
    <div class="purple-header-card">
      <div class="header-left">
        <div class="header-badge-row">
          <span class="corte-id-badge">Corte #{corte.id}</span>
          <span class="corte-sala-badge">{corte.sala_nombre || 'General'}</span>
          <span class="corte-fecha-badge">Desde: {formatDate(corte.fecha_desde)} - Hasta: {formatDate(corte.fecha_hasta)}</span>
          <div class="emp-counter-chip">
            <span class="emp-icon">👥</span>
            <span class="emp-text">
              {#if selectedDepartamentos && selectedDepartamentos.length > 0}
                <strong>{filteredEmployees.length}</strong> de {processedEmployees.length} empleado(s)
              {:else}
                <strong>{filteredEmployees.length}</strong> empleado(s)
              {/if}
            </span>
          </div>

          <!-- Filtro MultiSelect de Departamentos asociados a los empleados del listado -->
          {#if departamentoOptions.length > 0}
            <div class="depto-multiselect-wrap">
              <SmartMultiSelect
                id="corte-filtro-departamentos"
                label="Departamentos"
                icon="🏢"
                options={departamentoOptions}
                bind:selectedValues={selectedDepartamentos}
                placeholder="Filtrar departamentos..."
                on:change={(e) => {
                  selectedDepartamentos = e.detail;
                }}
              />
            </div>
          {/if}
        </div>
      </div>

      <div class="header-right">
        <button type="button" class="btn-volver" on:click={handleBack} title="Volver al listado de cortes">
          Volver
        </button>
      </div>
    </div>

    <!-- Navigation Tabs & Search Controls -->
    <div class="toolbar-card no-print">
      <div class="tabs-group">
        <button
          type="button"
          class="tab-btn {activeTab === 'marcajes' ? 'active' : ''}"
          on:click={() => activeTab = 'marcajes'}
        >
          <span>Marcajes</span>
        </button>

        <button
          type="button"
          class="tab-btn {activeTab === 'calculos' ? 'active' : ''}"
          on:click={() => activeTab = 'calculos'}
        >
          <span>Calculos</span>
        </button>

        <button
          type="button"
          class="tab-btn {activeTab === 'puntualidad' ? 'active' : ''}"
          on:click={() => activeTab = 'puntualidad'}
        >
          <span>Puntualidad</span>
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

    <!-- TAB 1: Marcajes (Histórico Congelado de Asistencia - Matriz Fija) -->
    {#if activeTab === 'marcajes'}
      <div class="table-container">
        <table class="report-matrix-table">
          <thead>
            <!-- Fila 1: Grupos de Meses con Colspan -->
            <tr class="header-months-tr">
              <th rowspan="2" class="th-empleado-sticky">
                EMPLEADO
              </th>
              {#each mesesAgrupados as mes}
                <th
                  colspan={mes.colspan}
                  class="th-month-group"
                  title={mes.nombre}
                >
                  {mes.nombre}
                </th>
              {/each}
            </tr>

            <!-- Fila 2: Días del Mes (Número y Letra) -->
            <tr class="header-days-tr">
              {#each diasDelMes as dia}
                <th class="th-day-col">
                  <div class="th-day-inner">
                    <span class="day-num">{dia.num}</span>
                    <span class="day-letter">{dia.diaSemana}</span>
                  </div>
                </th>
              {/each}
            </tr>
          </thead>

          <tbody>
            {#if filteredEmployees.length === 0}
              <tr>
                <td colspan={diasDelMes.length + 1} class="empty-row">
                  No se encontraron empleados registrados en este corte histórico.
                </td>
              </tr>
            {:else}
              {#each filteredEmployees as emp, idx (emp.id || idx)}
                <tr class="tbody-emp-tr {idx % 2 === 0 ? 'even' : 'odd'}">
                  
                  <!-- Columna Sticky Izquierda del Empleado -->
                  <td class="td-empleado-sticky">
                    <div class="emp-sticky-content">
                      <div class="emp-avatar-box">
                        <img
                          src={toBackendUrl(emp.foto || `/empleados/${emp.id}.jpg`, { thumb: true })}
                          alt=""
                          class="emp-avatar-img"
                          on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      </div>
                      <div class="emp-text-details">
                        <span class="emp-name-text" title={emp.nombre}>{emp.nombre}</span>
                        <span class="emp-cedula-pill" title={emp.cedula || `ID: #${emp.id}`}>
                          {emp.cedula || `ID: #${emp.id}`}
                        </span>
                        <span class="emp-cargo-text" title={emp.cargo || 'Personal'}>
                          {emp.cargo || 'Personal'}
                        </span>
                      </div>
                    </div>
                  </td>

                  <!-- Celdas de cada Día del Corte -->
                  {#each (emp.dias || []) as dia}
                    {@const times = getEntradaSalidaTimes(dia.marcajeStr)}
                    <td class="td-day-matrix-cell">
                      <div class="day-cell-inner-wrap">
                        
                        <!-- Top Row: [ Turno ] [ Horas Entrada / Salida ] [ Horas Trabajadas ] -->
                        <div class="day-top-row">
                          <div
                            class="shift-badge-static"
                            style="background-color: {dia.resultadoStr === 'ERROR' ? '#dc2626' : (dia.resultadoStr === 'EN ESPERA' ? '#2563eb' : (dia.shift ? (dia.shift.color || '#D9D9D9') : '#D9D9D9'))}; color: {dia.resultadoStr === 'ERROR' || dia.resultadoStr === 'EN ESPERA' ? '#ffffff' : (dia.shift && (dia.shift.codigo === 'L' || dia.shift.color === '#D9D9D9' || dia.shift.codigo === 'U' || dia.shift.color === '#86EFAC') ? '#0f172a' : '#ffffff')};"
                            title={dia.shift ? (dia.shift.nombre || dia.shift.codigo) : 'Sin plantilla'}
                          >
                            {dia.shift ? dia.shift.codigo : '-'}
                          </div>

                          <div class="times-stack-center">
                            {#if times.entrada && dia.resultadoStr !== 'LIBRE'}
                              <span>{times.entrada}</span>
                              {#if times.salida}
                                <span>{times.salida}</span>
                              {/if}
                            {:else}
                              <span class="bars-empty">||||||</span>
                            {/if}
                          </div>

                          <div class="worked-hours-pill {dia.resultadoStr === 'ERROR' ? 'error' : (dia.resultadoStr === 'EN ESPERA' ? 'espera' : (dia.trabajadosMins > 0 && dia.resultadoStr !== 'LIBRE' ? 'active' : 'zero'))}">
                            {dia.trabajadoStr || "00:00"}
                          </div>
                        </div>

                        <!-- Middle Row: Resultado / Novedad -->
                        <div
                          class="result-status-title"
                          style="color: {dia.resultadoStr === 'ERROR' ? '#dc2626' : (dia.resultadoStr === 'EN ESPERA' ? '#2563eb' : (dia.resultadoStr === 'LIBRE' ? '#475569' : '#0f172a'))};"
                        >
                          {@html (dia.resultadoStr || "").replace(/\(\s*D\s*\)/gi, "(D)").replace(/\(\s*N\s*\)/gi, "(N)")}
                        </div>

                        <!-- Bottom Row: [ entBadge (Entrada) ] & [ salBadge (Salida) ] -->
                        <div class="badges-bottom-row">
                          <div
                            class="ent-sal-pill {dia.entBadge && dia.entBadge.isAlert ? 'alert' : (dia.entBadge && dia.entBadge.text !== '00:00' ? 'ok' : 'neutral')}"
                            style="background-color: {dia.entBadge ? (dia.entBadge.isAlert ? '#fff1f2' : '#f0fdf4') : '#f8fafc'}; color: {dia.entBadge ? (dia.entBadge.isAlert ? '#dc2626' : '#166534') : '#94a3b8'}; border: 1px solid {dia.entBadge ? (dia.entBadge.isAlert ? '#fecdd3' : '#bbf7d0') : '#e2e8f0'};"
                            title="Entrada: {dia.entBadge && dia.entBadge.isAlert ? 'Retraso' : 'Temprana'}"
                          >
                            {dia.entBadge ? dia.entBadge.text : "00:00"}
                          </div>

                          <div
                            class="ent-sal-pill {dia.salBadge && dia.salBadge.isAlert ? 'alert' : (dia.salBadge && dia.salBadge.text !== '00:00' ? 'ok' : 'neutral')}"
                            style="background-color: {dia.salBadge ? (dia.salBadge.isAlert ? '#fff1f2' : '#f0fdf4') : '#f8fafc'}; color: {dia.salBadge ? (dia.salBadge.isAlert ? '#dc2626' : '#166534') : '#94a3b8'}; border: 1px solid {dia.salBadge ? (dia.salBadge.isAlert ? '#fecdd3' : '#bbf7d0') : '#e2e8f0'};"
                            title="Salida: {dia.salBadge && dia.salBadge.isAlert ? 'Temprana' : 'Tarde'}"
                          >
                            {dia.salBadge ? dia.salBadge.text : "00:00"}
                          </div>
                        </div>

                      </div>
                    </td>
                  {/each}
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- TAB 2: Tabla Oficial de Cálculos (Sin columna Libre) -->
    {#if activeTab === 'calculos'}
      <div class="table-container">
        <table class="calculos-table">
          <thead>
            <tr>
              <th class="col-emp sticky-col">Empleado</th>
              <th class="col-num" title="Total Días Diurnos">Diurnos</th>
              <th class="col-num" title="Total Días Nocturnos">Nocturnos</th>
              <th class="col-hours" title="Horas Diurnas de Turnos Mixtos">Horas Diurnas</th>
              <th class="col-hours" title="Horas Nocturnas de Turnos Mixtos">Horas Nocturnas</th>
              <th class="col-hours" title="Diferencia de Horas (Sumatoria de horas trabajadas desde las 2:00 AM hasta la salida)">Diferencia Horas</th>
              <th class="col-num" title="Domingos Trabajados">Domingos</th>
              <th class="col-num" title="Días Feriados Trabajados (Nacionales y de Sala)">Feriados</th>
              <th class="col-num alert-col" title="Falta Injustificada">Falta Injustificada</th>
              <th class="col-num" title="Justificativo (Falta Justificada, con constancia)">Justificativo (Falta Justificada, con constancia)</th>
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
                <td colspan="18" class="empty-row">
                  No se encontraron empleados en este corte histórico.
                </td>
              </tr>
            {:else}
              {#each filteredEmployees as emp, idx}
                <tr class="data-row {idx % 2 === 0 ? 'even' : 'odd'}">
                  <td class="col-emp sticky-col">
                    <div class="emp-sticky-content">
                      <div class="emp-avatar-box">
                        <img
                          src={toBackendUrl(emp.foto || `/empleados/${emp.id}.jpg`, { thumb: true })}
                          alt=""
                          class="emp-avatar-img"
                          on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      </div>
                      <div class="emp-text-details">
                        <span class="emp-name-text" title={emp.nombre}>{emp.nombre}</span>
                        <span class="emp-cedula-pill" title={emp.cedula || `ID: #${emp.id}`}>
                          {emp.cedula || `ID: #${emp.id}`}
                        </span>
                        <span class="emp-cargo-text" title={emp.cargo || 'Personal'}>
                          {emp.cargo || 'Personal'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td class="col-num {emp.diurnosCount > 0 ? 'val-active' : ''}">{emp.diurnosCount || 0}</td>
                  <td class="col-num {emp.nocturnosCount > 0 ? 'val-active' : ''}">{emp.nocturnosCount || 0}</td>
                  <td class="col-hours font-mono">{emp.horasDiurnasStr}</td>
                  <td class="col-hours font-mono">{emp.horasNocturnasStr}</td>
                  <td class="col-hours font-mono {emp.diferenciaHorasMins > 0 ? 'diff-pos' : ''}">
                    {emp.diffHorasStr}
                  </td>
                  <td class="col-num {emp.domingosCount > 0 ? 'val-sunday' : ''}">{emp.domingosCount || 0}</td>
                  <td class="col-num {emp.feriadosCount > 0 ? 'val-feriado' : ''}">{emp.feriadosCount || 0}</td>
                  <td class="col-num {emp.faltaInjustificadaCount > 0 ? 'val-falta' : ''}">{emp.faltaInjustificadaCount || 0}</td>
                  <td class="col-num {emp.justificativoCount > 0 ? 'val-active' : ''}">{emp.justificativoCount || 0}</td>
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

    <!-- TAB 3: Puntualidad (Contadores y Sumadores de Entrada/Salida) -->
    {#if activeTab === 'puntualidad'}
      <div class="table-container">
        <table class="calculos-table puntualidad-table">
          <thead>
            <!-- Fila Superior de Encabezados -->
            <tr class="super-header-tr">
              <th rowspan="2" class="col-emp sticky-col">Empleado</th>
              <th rowspan="2" class="col-num" title="Total de días trabajados">Días Trabajados</th>
              <th rowspan="2" class="col-hours" title="Total de horas acumuladas trabajadas">Horas Trabajadas</th>
              <th colspan="4" class="col-super-group">Contadores (Días)</th>
              <th colspan="4" class="col-super-group">Sumadores (Tiempo Excedente)</th>
            </tr>

            <!-- Fila Inferior de Columnas Específicas -->
            <tr class="sub-header-tr">
              <!-- Contadores -->
              <th class="col-num" title="Días con Entrada Temprana">Entrada Temprana</th>
              <th class="col-num" title="Días con Entrada Tarde (Retraso)">Entrada Tarde</th>
              <th class="col-num" title="Días con Salida Temprana">Salida Temprana</th>
              <th class="col-num" title="Días con Salida Tarde">Salida Tarde</th>
              <!-- Sumadores -->
              <th class="col-hours" title="Tiempo acumulado de entrada antes de turno">Entrada Temprana</th>
              <th class="col-hours" title="Tiempo acumulado de retraso en entrada">Entrada Tarde</th>
              <th class="col-hours" title="Tiempo acumulado de salida antes de hora">Salida Temprana</th>
              <th class="col-hours" title="Tiempo acumulado después de hora de salida">Salida Tarde</th>
            </tr>
          </thead>

          <tbody>
            {#if filteredEmployees.length === 0}
              <tr>
                <td colspan="11" class="empty-row">
                  No se encontraron empleados en este corte histórico.
                </td>
              </tr>
            {:else}
              {#each filteredEmployees as emp, idx}
                <tr class="data-row {idx % 2 === 0 ? 'even' : 'odd'}">
                  <!-- Empleado Sticky -->
                  <td class="col-emp sticky-col">
                    <div class="emp-sticky-content">
                      <div class="emp-avatar-box">
                        <img
                          src={toBackendUrl(emp.foto || `/empleados/${emp.id}.jpg`, { thumb: true })}
                          alt=""
                          class="emp-avatar-img"
                          on:error={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      </div>
                      <div class="emp-text-details">
                        <span class="emp-name-text" title={emp.nombre}>{emp.nombre}</span>
                        <span class="emp-cedula-pill" title={emp.cedula || `ID: #${emp.id}`}>
                          {emp.cedula || `ID: #${emp.id}`}
                        </span>
                        <span class="emp-cargo-text" title={emp.cargo || 'Personal'}>
                          {emp.cargo || 'Personal'}
                        </span>
                      </div>
                    </div>
                  </td>

                  <!-- 1) Días Trabajados -->
                  <td class="col-num font-bold">{emp.diasTrabajados}</td>

                  <!-- 2) Horas Trabajadas -->
                  <td class="col-hours font-mono font-bold">{emp.horasTrabajadasStr}</td>

                  <!-- 3) Contador Entrada Temprana -->
                  <td class="col-num font-bold {emp.entradaTempranaCount > 0 ? 'val-active' : ''}">
                    {emp.entradaTempranaCount}
                  </td>

                  <!-- 4) Contador Entrada Tarde -->
                  <td class="col-num font-bold {emp.entradaTardeCount > 0 ? 'val-falta' : ''}">
                    {emp.entradaTardeCount}
                  </td>

                  <!-- 5) Contador Salida Temprana -->
                  <td class="col-num font-bold {emp.salidaTempranaCount > 0 ? 'val-falta' : ''}">
                    {emp.salidaTempranaCount}
                  </td>

                  <!-- 6) Contador Salida Tarde -->
                  <td class="col-num font-bold {emp.salidaTardeCount > 0 ? 'val-active' : ''}">
                    {emp.salidaTardeCount}
                  </td>

                  <!-- 7) Sumador Entrada Temprana -->
                  <td class="col-hours font-mono {emp.entradaTempranaStr !== '00:00' ? 'text-green' : ''}">
                    {emp.entradaTempranaStr}
                  </td>

                  <!-- 8) Sumador Entrada Tarde -->
                  <td class="col-hours font-mono {emp.entradaTardeStr !== '00:00' ? 'text-red' : ''}">
                    {emp.entradaTardeStr}
                  </td>

                  <!-- 9) Sumador Salida Temprana -->
                  <td class="col-hours font-mono {emp.salidaTempranaStr !== '00:00' ? 'text-red' : ''}">
                    {emp.salidaTempranaStr}
                  </td>

                  <!-- 10) Sumador Salida Tarde -->
                  <td class="col-hours font-mono {emp.salidaTardeStr !== '00:00' ? 'text-green' : ''}">
                    {emp.salidaTardeStr}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
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

  /* Purple Header */
  .purple-header-card {
    background: linear-gradient(135deg, #581c87 0%, #6b21a8 50%, #7c3aed 100%);
    color: #ffffff;
    border-radius: 14px;
    padding: 16px 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-shadow: 0 10px 15px -3px rgba(88, 28, 135, 0.25);
    position: relative;
    z-index: 60;
  }

  .header-left {
    display: flex;
    align-items: center;
    flex: 1;
  }

  .header-badge-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .corte-id-badge {
    background: rgba(255, 255, 255, 0.22);
    color: #ffffff;
    font-size: 11.5px;
    font-weight: 800;
    padding: 5px 10px;
    border-radius: 8px;
    letter-spacing: 0.5px;
  }

  .corte-sala-badge {
    background: #ffffff;
    color: #581c87;
    font-size: 11.5px;
    font-weight: 800;
    padding: 5px 12px;
    border-radius: 8px;
    text-transform: uppercase;
  }

  .corte-fecha-badge {
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.25);
  }

  .emp-counter-chip {
    background: rgba(255, 255, 255, 0.18);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 8px;
    padding: 5px 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
  }

  /* Filtro MultiSelect de Departamentos en Cabecera */
  .depto-multiselect-wrap {
    min-width: 190px;
    max-width: 240px;
    position: relative;
    z-index: 70;
  }

  .depto-multiselect-wrap :global(.smart-multiselect-trigger) {
    height: 31px !important;
    background: #ffffff !important;
    color: #581c87 !important;
    font-weight: 800 !important;
    font-size: 11.5px !important;
    border: 1px solid rgba(255, 255, 255, 0.4) !important;
    border-radius: 8px !important;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12) !important;
    padding: 0 10px !important;
  }

  .depto-multiselect-wrap :global(.smart-multiselect-trigger:hover) {
    background: #fdf4ff !important;
    border-color: #a855f7 !important;
  }

  .depto-multiselect-wrap :global(.smart-multiselect-trigger.active) {
    background: #fdf4ff !important;
    border-color: #a855f7 !important;
    color: #581c87 !important;
    box-shadow: 0 0 0 1px #a855f7 !important;
  }

  .depto-multiselect-wrap :global(.smart-multiselect-trigger .trigger-badge) {
    background: #7c3aed !important;
    color: #ffffff !important;
  }

  .depto-multiselect-wrap :global(.smart-multiselect-dropdown) {
    z-index: 100 !important;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .btn-volver {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 9px;
    padding: 8px 20px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-volver:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  /* Toolbar and Tabs */
  .toolbar-card {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .tabs-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab-btn {
    border: 1px solid #cbd5e1;
    background: #f1f5f9;
    color: #475569;
    border-radius: 8px;
    padding: 8px 18px;
    font-size: 12.5px;
    font-weight: 800;
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

  /* Table Containers */
  .table-container {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    overflow: auto;
    max-height: calc(100vh - 185px);
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    position: relative;
  }

  .table-container::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .table-container::-webkit-scrollbar-track {
    background: #f1f5f9;
  }

  .table-container::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;
  }

  .table-container::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }

  /* ===== TAB 1: MARCAJES MATRIX TABLE (Verde unificado como Cálculos y Puntualidad) ===== */
  .report-matrix-table {
    width: max-content;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }

  .report-matrix-table thead {
    position: sticky;
    top: 0;
    z-index: 25;
  }

  .header-months-tr {
    background: #166534;
  }

  .th-month-group {
    position: sticky;
    top: 0;
    z-index: 20;
    background: #166534;
    text-align: center;
    padding: 6px 8px;
    font-size: 10.5px;
    font-weight: 800;
    color: #ffffff;
    border-right: 1px solid rgba(255, 255, 255, 0.2);
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.1;
    box-sizing: border-box;
  }

  .header-days-tr {
    background: #15803d;
  }

  .th-day-col {
    position: sticky;
    top: 25px;
    z-index: 20;
    background: #15803d;
    text-align: center;
    width: 110px;
    min-width: 110px;
    max-width: 110px;
    padding: 6px 2px;
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    border-bottom: 2px solid #14532d;
    box-sizing: border-box;
    color: #ffffff;
  }

  .th-day-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    line-height: 1.1;
  }

  .day-num {
    font-weight: 900;
    font-size: 12px;
    color: #ffffff;
  }

  .day-letter {
    font-size: 10.5px;
    color: #dcfce7;
    font-weight: 800;
    text-transform: uppercase;
  }

  .th-empleado-sticky {
    position: sticky;
    top: 0;
    left: 0;
    z-index: 40 !important;
    background: #15803d !important;
    width: 200px;
    min-width: 200px;
    max-width: 200px;
    padding: 8px 10px;
    box-sizing: border-box;
    border-right: 2px solid rgba(255, 255, 255, 0.25);
    border-bottom: 2px solid #14532d;
    vertical-align: middle;
    font-size: 11.5px;
    font-weight: 900;
    color: #ffffff !important;
    letter-spacing: 0.5px;
    text-align: center;
  }

  .td-empleado-sticky {
    position: sticky;
    left: 0;
    z-index: 15;
    background: #ffffff;
    width: 200px;
    min-width: 200px;
    max-width: 200px;
    height: 58px;
    padding: 6px 8px;
    box-sizing: border-box;
    border-right: 2px solid #cbd5e1;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
    box-shadow: 2px 0 5px rgba(0, 0, 0, 0.04);
  }

  .tbody-emp-tr.even .td-empleado-sticky { background: #ffffff; }
  .tbody-emp-tr.odd .td-empleado-sticky { background: #f8fafc; }
  .tbody-emp-tr:hover .td-empleado-sticky { background: #f0fdf4; }

  .emp-sticky-content {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    overflow: hidden;
  }

  .emp-avatar-box {
    flex-shrink: 0;
  }

  .emp-avatar-img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid #cbd5e1;
    display: block;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .emp-text-details {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1.5px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .emp-name-text {
    font-size: 10.5px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  .emp-cedula-pill {
    font-size: 8px;
    color: #334155;
    font-weight: 800;
    background: #f1f5f9;
    padding: 0px 5px;
    line-height: 13px;
    height: 13px;
    border-radius: 3px;
    white-space: nowrap;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .emp-cargo-text {
    font-size: 8px;
    color: #2563eb;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    line-height: 1.1;
  }

  .td-day-matrix-cell {
    padding: 4px 2px;
    text-align: center;
    width: 110px;
    min-width: 110px;
    max-width: 110px;
    height: 58px;
    box-sizing: border-box;
    border-right: 1px solid #f1f5f9;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }

  .day-cell-inner-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    width: 100%;
    gap: 1px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .day-top-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 2px;
    min-height: 18px;
    overflow: hidden;
  }

  .shift-badge-static {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 18px;
    padding: 0 4px;
    border-radius: 4px;
    font-weight: 900;
    font-size: 10px;
    text-transform: uppercase;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
    flex-shrink: 0;
    border: 1px solid rgba(0,0,0,0.08);
  }

  .times-stack-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.05;
    font-size: 7.5px;
    font-weight: 800;
    color: #0f172a;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .bars-empty {
    color: #cbd5e1;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 1px;
  }

  .worked-hours-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 3px;
    border-radius: 2.5px;
    font-size: 8px;
    height: 13px;
    line-height: 1;
    flex-shrink: 0;
    max-width: 48%;
    overflow: hidden;
  }

  .worked-hours-pill.active {
    font-weight: 800;
    background-color: #dcfce7;
    color: #15803d;
    border: 1px solid #86efac;
  }

  .worked-hours-pill.error {
    font-weight: 800;
    background-color: #fff1f2;
    color: #dc2626;
    border: 1px solid #fecdd3;
  }

  .worked-hours-pill.espera {
    font-weight: 800;
    background-color: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
  }

  .worked-hours-pill.zero {
    font-weight: 700;
    background-color: #f8fafc;
    color: #94a3b8;
    border: 1px solid #e2e8f0;
  }

  .result-status-title {
    font-size: 7.5px;
    font-weight: 800;
    line-height: 1.1;
    white-space: normal;
    overflow: hidden;
    width: 100%;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 1px 0;
    padding: 0;
  }

  .badges-bottom-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 2px;
  }

  .ent-sal-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    height: 12px;
    border-radius: 2px;
    font-size: 7px;
    font-weight: 800;
    line-height: 1;
    overflow: hidden;
    white-space: nowrap;
  }

  .ent-sal-pill.alert {
    background-color: #fff1f2 !important;
    color: #dc2626 !important;
    border: 1px solid #fecdd3 !important;
    font-weight: 900;
  }

  .ent-sal-pill.ok {
    background-color: #f0fdf4 !important;
    color: #166534 !important;
    border: 1px solid #bbf7d0 !important;
    font-weight: 800;
  }

  .ent-sal-pill.neutral {
    background-color: #f8fafc !important;
    color: #94a3b8 !important;
    border: 1px solid #e2e8f0 !important;
  }

  /* ===== TAB 2 & 3: CALCULOS & PUNTUALIDAD TABLES ===== */
  .calculos-table {
    width: max-content;
    min-width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 11.5px;
    white-space: nowrap;
  }

  .calculos-table thead {
    position: sticky;
    top: 0;
    z-index: 25;
  }

  .calculos-table thead tr {
    background: #15803d;
    color: #ffffff;
  }

  .calculos-table thead th {
    position: sticky;
    top: 0;
    z-index: 20;
    background: #15803d;
    padding: 10px 12px;
    font-size: 11px;
    font-weight: 800;
    text-align: center;
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    border-bottom: 2px solid #14532d;
    letter-spacing: 0.2px;
    box-sizing: border-box;
  }

  .puntualidad-table thead .super-header-tr th {
    position: sticky;
    top: 0;
    z-index: 20;
    background: #15803d;
    color: #ffffff;
  }

  .col-super-group {
    background: #166534 !important;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 11px;
    padding: 6px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    box-sizing: border-box;
  }

  .puntualidad-table thead .sub-header-tr th {
    position: sticky;
    top: 29px; /* Height of super-header row */
    z-index: 20;
    background: #14532d;
    color: #ffffff;
    font-size: 10.5px;
    padding: 8px 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    border-bottom: 2px solid #14532d;
    box-sizing: border-box;
  }

  .calculos-table td {
    padding: 9px 12px;
    border-bottom: 1px solid #e2e8f0;
    border-right: 1px solid #f1f5f9;
    text-align: center;
  }

  .data-row.even { background: #ffffff; }
  .data-row.odd { background: #f8fafc; }
  .data-row:hover { background: #f0fdf4; }

  /* Sticky Employee Column in Calculos & Puntualidad */
  .col-emp {
    text-align: left !important;
    width: 200px;
    min-width: 200px;
    max-width: 200px;
    box-sizing: border-box;
  }

  .sticky-col {
    position: sticky;
    left: 0;
    z-index: 15;
    box-shadow: 2px 0 5px rgba(0, 0, 0, 0.04);
  }

  .data-row.even .sticky-col { background: #ffffff !important; }
  .data-row.odd .sticky-col { background: #f8fafc !important; }
  .data-row:hover .sticky-col { background: #f0fdf4 !important; }

  thead .sticky-col,
  thead th.sticky-col,
  .puntualidad-table thead .super-header-tr .sticky-col {
    position: sticky;
    top: 0;
    left: 0;
    background: #15803d !important;
    z-index: 40 !important;
    border-right: 2px solid rgba(255, 255, 255, 0.25);
    border-bottom: 2px solid #14532d;
  }

  .emp-cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .emp-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid #cbd5e1;
    background: #f1f5f9;
  }

  .emp-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
  }

  .emp-name {
    font-weight: 800;
    color: #0f172a;
    font-size: 12px;
  }

  .emp-meta {
    font-size: 10px;
    color: #64748b;
    font-weight: 600;
  }

  .col-num {
    font-weight: 700;
    min-width: 60px;
  }

  .col-hours {
    font-weight: 700;
    min-width: 90px;
  }

  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .font-bold { font-weight: 800; }

  .val-active { color: #16a34a; font-weight: 800; }
  .val-sunday { color: #7c3aed; font-weight: 800; }
  .val-feriado { color: #0284c7; font-weight: 800; }
  .val-falta { color: #dc2626; font-weight: 900; background: #fef2f2; }

  .diff-pos { color: #16a34a; font-weight: 800; }

  .text-red { color: #dc2626; font-weight: 800; }
  .text-green { color: #16a34a; font-weight: 800; }

  .empty-row {
    padding: 40px !important;
    text-align: center;
    color: #64748b;
    font-size: 13px;
    font-weight: 600;
  }

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
    .calculos-table thead tr, .report-matrix-table thead tr {
      background: #15803d !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
