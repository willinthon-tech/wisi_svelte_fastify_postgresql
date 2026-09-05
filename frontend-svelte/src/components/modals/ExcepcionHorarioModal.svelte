<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';

  export let show = false;
  export let empleado = null;
  export let dia = null;
  export let plantillasSala = [];
  export let empleadosList = [];

  const dispatch = createEventDispatcher();

  let loading = false;
  let selectedValue = '';
  let initialSelectedValue = '';

  let horariosEmpleado = [];
  let plantillasExcepcion = [];

  let marcajesLoading = false;
  let marcajesContext = [];
  let assignedPlantillasEmp = [];

  let saveStatusText = '';
  let saveStatusType = 'idle'; // 'idle' | 'saving' | 'saved' | 'error'
  let saveStatusTimer = null;

  function showStatus(text, type = 'saved', duration = 1800) {
    saveStatusText = text;
    saveStatusType = type;
    if (saveStatusTimer) clearTimeout(saveStatusTimer);
    if (duration > 0) {
      saveStatusTimer = setTimeout(() => {
        saveStatusType = 'idle';
        saveStatusText = '';
      }, duration);
    }
  }

  let lastLoadedEmpId = null;
  let lastLoadedFechaStr = null;
  let currentFetchId = 0;

  $: if (show && dia && plantillasSala) {
    const currentEmpId = empleado?.id;
    const currentFechaStr = dia?.fechaStr;
    if (currentEmpId !== lastLoadedEmpId || currentFechaStr !== lastLoadedFechaStr) {
      lastLoadedEmpId = currentEmpId;
      lastLoadedFechaStr = currentFechaStr;
      initModalData();
      fetchMarcajesRapidos();
    }
  }

  $: currentDayIndex = (empleado?.dias || []).findIndex(d => d.fechaStr === dia?.fechaStr);
  $: canPrevDay = currentDayIndex > 0;
  $: canNextDay = currentDayIndex >= 0 && currentDayIndex < (empleado?.dias || []).length - 1;

  $: currentEmpIndex = (empleadosList || []).findIndex(e => e.id === empleado?.id);
  $: canPrevEmp = currentEmpIndex > 0;
  $: canNextEmp = currentEmpIndex >= 0 && currentEmpIndex < (empleadosList || []).length - 1;

  function goToPrevDay() {
    if (!canPrevDay || !empleado?.dias) return;
    const prevDia = empleado.dias[currentDayIndex - 1];
    if (prevDia) {
      dia = prevDia;
      dispatch('changeDia', { dia: prevDia });
    }
  }

  function goToNextDay() {
    if (!canNextDay || !empleado?.dias) return;
    const nextDia = empleado.dias[currentDayIndex + 1];
    if (nextDia) {
      dia = nextDia;
      dispatch('changeDia', { dia: nextDia });
    }
  }

  function goToPrevEmp() {
    if (!canPrevEmp || !empleadosList) return;
    const prevEmp = empleadosList[currentEmpIndex - 1];
    if (prevEmp) {
      const matchingDia = (prevEmp.dias || []).find(d => d.fechaStr === dia?.fechaStr) || (prevEmp.dias ? prevEmp.dias[0] : null);
      empleado = prevEmp;
      dia = matchingDia;
      dispatch('changeEmpleado', { empleado: prevEmp, dia: matchingDia });
    }
  }

  function goToNextEmp() {
    if (!canNextEmp || !empleadosList) return;
    const nextEmp = empleadosList[currentEmpIndex + 1];
    if (nextEmp) {
      const matchingDia = (nextEmp.dias || []).find(d => d.fechaStr === dia?.fechaStr) || (nextEmp.dias ? nextEmp.dias[0] : null);
      empleado = nextEmp;
      dia = matchingDia;
      dispatch('changeEmpleado', { empleado: nextEmp, dia: matchingDia });
    }
  }

  function handleKeyDown(e) {
    if (!show) return;

    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const isEditingInput = tag === 'input' || tag === 'textarea';
    if (isEditingInput) return;

    if (e.key === 'ArrowLeft') {
      if (canPrevDay) {
        e.preventDefault();
        goToPrevDay();
      }
    } else if (e.key === 'ArrowRight') {
      if (canNextDay) {
        e.preventDefault();
        goToNextDay();
      }
    } else if (e.key === 'ArrowUp') {
      if (tag !== 'select') {
        if (canPrevEmp) {
          e.preventDefault();
          goToPrevEmp();
        }
      }
    } else if (e.key === 'ArrowDown') {
      if (tag !== 'select') {
        if (canNextEmp) {
          e.preventDefault();
          goToNextEmp();
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    }
  }

  function initModalData() {
    // 1. Mapeo de IDs de horarios directamente asignados al empleado
    const assignedMap = new Map();
    (empleado?.horarios_asignados || []).forEach(h => {
      if (h && h.id) assignedMap.set(Number(h.id), h);
    });

    // 2. Horarios asignados al empleado (tipo === 'horario')
    if (assignedMap.size > 0) {
      const foundInSala = (plantillasSala || []).filter(p => p.tipo === 'horario' && assignedMap.has(Number(p.id)));
      const foundIds = new Set(foundInSala.map(p => Number(p.id)));
      const missingFromSala = [];
      assignedMap.forEach((h, id) => {
        if (!foundIds.has(id) && (h.tipo === 'horario' || (!h.tipo && h.hora_entrada))) {
          missingFromSala.push(h);
        }
      });
      horariosEmpleado = [...foundInSala, ...missingFromSala];
    } else {
      horariosEmpleado = [];
    }

    // 3. Plantillas Tipo Excepción (tipo === 'plantilla', excluyendo códigos base L y U)
    plantillasExcepcion = (plantillasSala || []).filter(p => p.tipo === 'plantilla' && p.codigo !== 'L' && p.codigo !== 'U');

    // Pre-selección del valor según el estado actual del día
    if (dia && dia.isExcepcion) {
      if (dia.shift && dia.shift.id) {
        selectedValue = `PLANTILLA_${dia.shift.id}`;
      } else if (dia.shift && dia.shift.codigo === 'L') {
        selectedValue = 'BASE_L';
      } else if (dia.shift && dia.shift.codigo) {
        const pMatch = (plantillasSala || []).find(p => p.codigo === dia.shift.codigo);
        selectedValue = pMatch ? `PLANTILLA_${pMatch.id}` : 'BASE_L';
      } else {
        selectedValue = 'BASE_L';
      }
    } else {
      const currentCodigo = dia?.shift?.codigo || '';
      if (currentCodigo === 'L') {
        selectedValue = 'BASE_L';
      } else if (currentCodigo === 'U') {
        selectedValue = 'BASE_U';
      } else if (dia && dia.shift && dia.shift.id) {
        selectedValue = `PLANTILLA_${dia.shift.id}`;
      } else if (dia && dia.shift && dia.shift.codigo) {
        const pMatch = (plantillasSala || []).find(p => p.codigo === dia.shift.codigo);
        selectedValue = pMatch ? `PLANTILLA_${pMatch.id}` : 'BASE_L';
      } else {
        selectedValue = 'BASE_L';
      }
    }

    initialSelectedValue = selectedValue;
  }

  function toMinutes(str) {
    if (!str) return null;
    const parts = String(str).trim().split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
  }

  async function fetchMarcajesRapidos() {
    if (!empleado || !dia) return;
    const thisFetchId = ++currentFetchId;
    marcajesLoading = true;
    try {
      const res = await fetch(`/api/reports/marcajes-rapidos?empleado_id=${empleado.id}&fecha=${dia.fechaStr}`);
      const json = await res.json();
      if (thisFetchId !== currentFetchId) return;
      if (json && json.success) {
        marcajesContext = json.marcajesContext || [];
        assignedPlantillasEmp = json.assignedPlantillas || [];
        recalculateLocalEntryExit();
      }
    } catch (err) {
      if (thisFetchId === currentFetchId) {
        console.error("Error fetching marcajes rapidos:", err);
      }
    } finally {
      if (thisFetchId === currentFetchId) {
        marcajesLoading = false;
      }
    }
  }

  async function handleLocalPunchChange(punch, newType) {
    if (!punch || !punch.id) return;
    const targetStatus = newType === 'E' ? 'checkIn' : (newType === 'S' ? 'checkOut' : 'undefined');

    // 1. Actualización inmediata y reactiva del contexto local
    marcajesContext = marcajesContext.map(ctx => ({
      ...ctx,
      punches: (ctx.punches || []).map(p => {
        if (p.id === punch.id) {
          return {
            ...p,
            type: newType,
            tipoTexto: newType === 'E' ? 'Entrada' : (newType === 'S' ? 'Salida' : 'Otros'),
            isCheckIn: newType === 'E',
            isCheckOut: newType === 'S',
            isOther: newType === 'O'
          };
        }
        return p;
      })
    }));

    recalculateLocalEntryExit();

    // 2. Guardado inmediato en segundo plano
    showStatus('Guardando marcaje...', 'saving', 0);
    try {
      const res = await fetch(`/api/reports/attlogs/${punch.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus })
      });
      const json = await res.json();
      if (!json || !json.success) {
        throw new Error(json?.error || 'Error al actualizar marcaje');
      }
      showStatus('✓ Marcaje guardado', 'saved', 1500);
      dispatch('punchUpdated', { punchId: punch.id, targetStatus });
    } catch (err) {
      console.error("Error updating punch status:", err);
      showStatus('Error al guardar marcaje', 'error', 2500);
      triggerToast(`Error al guardar marcaje: ${err.message}`, 'error');
    }
  }

  async function handleScheduleSelectChange(e) {
    if (e && e.target && typeof e.target.blur === 'function') {
      e.target.blur();
    }
    const newVal = selectedValue;
    if (newVal === 'BASE_U') {
      triggerToast('El Horario Único es asignado automáticamente por el sistema.', 'info');
      selectedValue = initialSelectedValue;
      return;
    }
    if (newVal === initialSelectedValue) {
      return;
    }
    await autoSaveSchedule(newVal);
  }

  async function autoSaveSchedule(val) {
    if (!empleado || !dia) return;
    showStatus('Guardando...', 'saving', 0);
    try {
      let plantillaId = null;
      let isLibre = false;
      let selectedShiftObj = null;

      if (val === 'BASE_L') {
        plantillaId = null;
        isLibre = true;
        selectedShiftObj = {
          id: null,
          codigo: 'L',
          nombre: 'Libre',
          color: '#D9D9D9',
          es_libre: true
        };
      } else {
        plantillaId = Number(val.replace('PLANTILLA_', ''));
        const pObj = (plantillasSala || []).find(p => Number(p.id) === Number(plantillaId));
        isLibre = pObj ? (pObj.codigo === 'L' || pObj.nombre?.toUpperCase() === 'LIBRE') : false;
        selectedShiftObj = pObj ? { ...pObj, es_libre: isLibre } : null;
      }

      // Actualización optimista local
      dia.isExcepcion = true;
      if (selectedShiftObj) {
        dia.shift = selectedShiftObj;
      }
      initialSelectedValue = val;
      recalculateLocalEntryExit();

      const payload = {
        empleado_id: empleado.id,
        fecha: dia.fechaStr,
        plantilla_horario_id: plantillaId,
        es_libre: isLibre
      };

      const res = await fetch('/api/reports/excepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json || !json.success) {
        throw new Error(json?.error || 'Error al guardar la excepción');
      }

      if (json.data && json.data.id) {
        dia.excepcionId = json.data.id;
      }

      showStatus('✓ Guardado', 'saved', 1500);
      dispatch('saved', { dia, empleado });
    } catch (err) {
      console.error("Error auto-saving schedule:", err);
      showStatus('Error al guardar', 'error', 2500);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  function recalculateLocalEntryExit() {
    // Reset flags
    marcajesContext = marcajesContext.map(ctx => ({
      ...ctx,
      punches: (ctx.punches || []).map(p => ({
        ...p,
        isUsedEntry: false,
        isUsedExit: false,
        consumed: false
      }))
    }));

    for (let i = 0; i < marcajesContext.length; i++) {
      const ctx = marcajesContext[i];
      const nextCtx = i + 1 < marcajesContext.length ? marcajesContext[i + 1] : null;

      const availableToday = (ctx.punches || []).filter(p => !p.consumed);
      const checkinPunches = availableToday.filter(p => p.isCheckIn || p.type === 'E');

      // REGLA 1: No puede existir salida sin entrada. Si no hay 'E', no se coteja turno
      if (checkinPunches.length === 0) {
        continue;
      }

      // Si este día se seleccionó como Libre o una plantilla sin horas, no cotejar turno
      if (ctx.fechaStr === dia?.fechaStr) {
        if (selectedValue === 'BASE_L') {
          continue;
        }
        if (selectedValue && selectedValue.startsWith('PLANTILLA_')) {
          const pId = Number(selectedValue.replace('PLANTILLA_', ''));
          const pObj = (plantillasSala || []).find(p => Number(p.id) === pId);
          if (pObj && !pObj.hora_entrada && !pObj.hora_salida) {
            continue;
          }
        }
      }

      // REGLA 2: Selección de Entrada (únicamente marcajes tipo 'E')
      let targetPlantillas = [];
      if (ctx.fechaStr === dia?.fechaStr && selectedValue && selectedValue.startsWith('PLANTILLA_')) {
        const pId = Number(selectedValue.replace('PLANTILLA_', ''));
        const pObj = (plantillasSala || []).find(p => Number(p.id) === pId);
        if (pObj && pObj.hora_entrada) {
          targetPlantillas = [pObj];
        }
      } else if (assignedPlantillasEmp && assignedPlantillasEmp.length > 0) {
        targetPlantillas = assignedPlantillasEmp;
      }

      let selectedEntry = null;
      let matchedPlantilla = null;

      if (targetPlantillas.length === 0) {
        // Horario Único: primer entrada del día
        selectedEntry = checkinPunches[0];
      } else {
        // Horario Asignado: entrada más lógica cercana a una de las plantillas asignadas
        let bestEntry = null;
        let minEntryDiff = Infinity;
        let bestPlant = null;

        for (const cp of checkinPunches) {
          const punchMins = toMinutes(cp.time);
          for (const plant of targetPlantillas) {
            if (!plant.hora_entrada) continue;
            const plantMins = toMinutes(plant.hora_entrada);
            let diff = Math.abs(punchMins - plantMins);
            if (diff > 720) diff = 1440 - diff;
            if (diff < minEntryDiff) {
              minEntryDiff = diff;
              bestEntry = cp;
              bestPlant = plant;
            }
          }
        }
        selectedEntry = bestEntry || checkinPunches[0];
        matchedPlantilla = bestPlant;
      }

      selectedEntry.isUsedEntry = true;
      selectedEntry.consumed = true;

      // REGLA 3: Selección de Salida (únicamente marcajes tipo 'S')
      const sameDayCandidates = availableToday.filter(p => !p.consumed && (p.isCheckOut || p.type === 'S') && p.timestamp > selectedEntry.timestamp);

      const nextDayPunches = nextCtx ? (nextCtx.punches || []) : [];
      const nextDayFirstEntry = nextDayPunches.find(p => (p.isCheckIn || p.type === 'E') && !p.consumed);
      const nextDayCandidates = nextDayPunches.filter(p => {
        if (p.consumed) return false;
        if (!p.isCheckOut && p.type !== 'S') return false;
        if (p.timestamp <= selectedEntry.timestamp) return false;
        if (nextDayFirstEntry && p.timestamp >= nextDayFirstEntry.timestamp) return false;
        const diffH = (p.timestamp - selectedEntry.timestamp) / (1000 * 3600);
        return diffH >= 0 && diffH <= 18;
      });

      const allExitCandidates = [...sameDayCandidates, ...nextDayCandidates];
      let selectedExit = null;

      if (allExitCandidates.length > 0) {
        if (matchedPlantilla && matchedPlantilla.hora_salida && matchedPlantilla.codigo !== 'U') {
          const schedSalMins = toMinutes(matchedPlantilla.hora_salida);
          let bestExit = null;
          let minExitDiff = Infinity;

          for (const cand of allExitCandidates) {
            const candMins = toMinutes(cand.time);
            let diff = Math.abs(candMins - schedSalMins);
            if (diff > 720) diff = 1440 - diff;
            if (diff < minExitDiff) {
              minExitDiff = diff;
              bestExit = cand;
            }
          }
          selectedExit = bestExit || allExitCandidates[0];
        } else {
          const candidatesGte4h = allExitCandidates.filter(cand => {
            const diffMins = Math.floor((cand.timestamp - selectedEntry.timestamp) / 60000);
            return diffMins >= 240;
          });

          if (candidatesGte4h.length > 0) {
            const firstValid = candidatesGte4h[0];
            const cluster = candidatesGte4h.filter(c => Math.abs(c.timestamp - firstValid.timestamp) <= 15 * 60 * 1000);
            selectedExit = cluster[cluster.length - 1];
          } else {
            selectedExit = allExitCandidates[0];
          }
        }
      }

      if (selectedExit) {
        selectedExit.isUsedExit = true;
        selectedExit.consumed = true;

        // Consumir marcajes intermedios
        (ctx.punches || []).forEach(p => {
          if (p.timestamp >= selectedEntry.timestamp && p.timestamp <= selectedExit.timestamp) {
            p.consumed = true;
          }
        });
        (nextDayPunches || []).forEach(p => {
          if (p.timestamp >= selectedEntry.timestamp && p.timestamp <= selectedExit.timestamp) {
            p.consumed = true;
          }
        });
      }
    }

    marcajesContext = [...marcajesContext];
  }

  function closeModal() {
    lastLoadedEmpId = null;
    lastLoadedFechaStr = null;
    show = false;
    dispatch('close');
  }

  async function handleDelete() {
    if (!dia || !dia.excepcionId) return;
    showStatus('Borrando excepción...', 'saving', 0);
    try {
      const res = await fetch(`/api/reports/excepciones/${dia.excepcionId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json && json.success) {
        dia.isExcepcion = false;
        dia.excepcionId = null;
        showStatus('✓ Excepción eliminada', 'saved', 1500);
        triggerToast('Excepción eliminada correctamente', 'success');
        initModalData();
        recalculateLocalEntryExit();
        dispatch('saved', { dia, empleado });
      } else {
        throw new Error(json.error || 'Error al eliminar la excepción');
      }
    } catch (err) {
      console.error(err);
      showStatus('Error al eliminar', 'error', 2500);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  function getHorasFormat(p) {
    if (p.hora_entrada && p.hora_salida) {
      return `(${p.hora_entrada.slice(0, 5)} - ${p.hora_salida.slice(0, 5)})`;
    }
    return '';
  }

  function getFotoUrl(emp) {
    if (!emp) return null;
    let foto = emp.foto;
    if (!foto && emp.id) foto = `${emp.id}.jpg`;
    if (!foto) return null;

    if (foto.startsWith('http') || foto.startsWith('data:')) return foto;

    let cleanFoto = String(foto)
      .replace(/^\/+/, '')
      .replace(/^empleados\//, '')
      .replace(/^photos\//, '')
      .trim();
    return toBackendUrl(`/empleados/${cleanFoto}`, { thumb: true });
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if show}
  <div style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px); padding: 16px;">
    <div style="background: #ffffff; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); width: 100%; max-width: 580px; overflow: hidden; border: 1px solid #e2e8f0;">
      
      <!-- Header -->
      <div style="padding: 12px 18px; background: linear-gradient(to right, #f8fafc, #f1f5f9); border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
          <!-- Foto Ligera del Empleado con Fallback de Inicial -->
          <div style="width: 52px; height: 52px; border-radius: 50%; overflow: hidden; border: 2.5px solid #3b82f6; background: #e2e8f0; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.12); position: relative;">
            {#if getFotoUrl(empleado)}
              <img
                src={getFotoUrl(empleado)}
                alt={empleado?.nombre || 'Empleado'}
                style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;"
                on:error={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: #e0e7ff; color: #4338ca; font-size: 16px; font-weight: 900; text-transform: uppercase;">
                {(empleado?.nombre || 'E').charAt(0).toUpperCase()}
              </div>
            {:else}
              <div style="display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; background: #e0e7ff; color: #4338ca; font-size: 16px; font-weight: 900; text-transform: uppercase;">
                {(empleado?.nombre || 'E').charAt(0).toUpperCase()}
              </div>
            {/if}
          </div>

          <!-- Información del Empleado: Nombre arriba, Sala, Cargo, y Cédula debajo de cargo con estilos -->
          <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">
            <!-- 1. Nombre arriba -->
            <h3 style="margin: 0; font-size: 13.5px; font-weight: 900; color: #0f172a; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title={empleado?.nombre || ''}>
              {empleado?.nombre || 'Empleado'}
            </h3>
            
            <!-- 2. Sala con estilo badge -->
            <div style="display: flex; align-items: center; gap: 4px; line-height: 1;">
              <span style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 5px; background: #f0fdf4; border: 1px solid #86efac; color: #166534; font-size: 10px; font-weight: 800; letter-spacing: 0.2px;">
                🏢 {empleado?.sala_nombre || (plantillasSala && plantillasSala[0]?.sala_nombre) || 'Principal'}
              </span>
            </div>

            <!-- 3. Cargo con estilo badge -->
            <div style="display: flex; align-items: center; gap: 4px; line-height: 1;">
              <span style="display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 5px; background: #f5f3ff; border: 1px solid #c4b5fd; color: #5b21b6; font-size: 10px; font-weight: 800; letter-spacing: 0.2px;">
                💼 {empleado?.cargo_nombre || 'Sin Cargo'}
              </span>
            </div>

            <!-- 4. Cédula debajo de cargo con estilo pill como la fecha -->
            <div style="display: flex; align-items: center; gap: 4px; line-height: 1;">
              <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2.5px 8px; border-radius: 6px; background: #f8fafc; border: 1.5px solid #64748b; color: #0f172a; font-size: 11px; font-weight: 900; letter-spacing: 0.4px; box-shadow: 0 1px 2px rgba(0,0,0,0.06);">
                🪪 {empleado?.cedula || (empleado?.id ? `ID: #${empleado.id}` : '')}
              </span>
            </div>
          </div>
        </div>

        <!-- Derecha (otra esquina): Fecha en badge azul y botón cerrar -->
        <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
          <span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 7px; background: #eff6ff; border: 1.5px solid #3b82f6; color: #1d4ed8; font-size: 13px; font-weight: 900; letter-spacing: 0.5px; box-shadow: 0 1px 3px rgba(59, 130, 246, 0.15);">
            📅 {dia?.fechaStr || ''}
          </span>

          <button 
            on:click={closeModal} 
            type="button" 
            style="background: transparent; border: none; font-size: 20px; color: #94a3b8; cursor: pointer; padding: 4px 6px; border-radius: 4px; line-height: 1; transition: color 0.15s ease;"
            on:mouseenter={(e) => e.currentTarget.style.color = '#0f172a'}
            on:mouseleave={(e) => e.currentTarget.style.color = '#94a3b8'}
            title="Cerrar (Esc)"
          >
            &times;
          </button>
        </div>
      </div>

      <!-- Body -->
      <div style="padding: 20px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- Select with clear Optgroups: Plantillas Base, Horarios Asignados al Empleado, Horarios de Sala, Plantillas Tipo Excepción -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            <label for="select-excepcion-horario" style="font-size: 12px; font-weight: 800; color: #1e293b;">
              Seleccionar Excepción o Horario:
            </label>
            {#if saveStatusType !== 'idle'}
              <span style="font-size: 11px; font-weight: 800; transition: all 0.2s ease; {
                saveStatusType === 'saving' ? 'color: #2563eb;' : saveStatusType === 'saved' ? 'color: #16a34a;' : 'color: #dc2626;'
              }">
                {saveStatusText}
              </span>
            {/if}
          </div>
          <select 
            id="select-excepcion-horario"
            bind:value={selectedValue}
            on:change={handleScheduleSelectChange}
            style="width: 100%; padding: 8px 10px; font-size: 11.5px; font-weight: 700; color: #0f172a; background-color: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 8px; outline: none; cursor: pointer;"
          >
            <!-- Optgroup 1: Plantillas Base del Sistema -->
            <optgroup label="⚙️ Plantillas Base del Sistema">
              <option value="BASE_L">[L] Libre</option>
              <option value="BASE_U" disabled style="font-size: 10.5px;">[U] Horario Único (Asignado automáticamente por el sistema si no le establecen uno)</option>
            </optgroup>

            <!-- Optgroup 2: Horarios Asignados al Empleado (tipo 'horario') -->
            {#if horariosEmpleado.length > 0}
              <optgroup label="⏰ Horarios Asignados al Empleado">
                {#each horariosEmpleado as p}
                  <option value="PLANTILLA_{p.id}">
                    [{p.codigo}] {p.nombre} {getHorasFormat(p)}
                  </option>
                {/each}
              </optgroup>
            {/if}

            <!-- Optgroup 3: Plantillas Tipo Excepción (tipo 'plantilla': Falta, Permiso, Reposo, etc.) -->
            {#if plantillasExcepcion.length > 0}
              <optgroup label="📋 Plantillas Tipo Excepción (Falta, Permiso, Reposo, etc.)">
                {#each plantillasExcepcion as p}
                  <option value="PLANTILLA_{p.id}">
                    [{p.codigo}] {p.nombre}
                  </option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </div>

        <!-- Button to delete exception (shown directly below select if exception exists) -->
        {#if dia?.isExcepcion && dia?.excepcionId}
          <button
            on:click={handleDelete}
            disabled={saveStatusType === 'saving'}
            type="button"
            style="width: 100%; padding: 8px 12px; font-size: 11.5px; font-weight: 800; color: #dc2626; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 6px; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 4px;"
          >
            🗑️ Borrar Excepción Creada
          </button>
        {/if}

        <!-- Tabla de Marcajes Rápidos (On Demand) -->
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
            <span style="font-size: 11.5px; font-weight: 800; color: #334155; display: flex; align-items: center; gap: 5px;">
              📌 Marcajes Rápidos del Empleado:
              {#if marcajesLoading}
                <span style="font-size: 10px; color: #2563eb; font-weight: 600;">(actualizando...)</span>
              {/if}
            </span>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 800;">
              <span style="display: inline-flex; align-items: center; gap: 3px; color: #15803d;">
                <span style="width: 9px; height: 9px; border-radius: 2.5px; background: #15803d; display: inline-block;"></span> Entrada
              </span>
              <span style="display: inline-flex; align-items: center; gap: 3px; color: #1d4ed8;">
                <span style="width: 9px; height: 9px; border-radius: 2.5px; background: #1d4ed8; display: inline-block;"></span> Salida
              </span>
            </div>
          </div>
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.03); min-height: 125px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
              <thead>
                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #475569; font-weight: 800;">
                  <th style="padding: 6px 10px; width: 120px; white-space: nowrap;">Día / Fecha</th>
                  <th style="padding: 6px 10px;">Marcajes Registrados</th>
                </tr>
              </thead>
              <tbody style="transition: opacity 0.15s ease; {marcajesLoading ? 'opacity: 0.55;' : 'opacity: 1;'}">
                {#if marcajesLoading && marcajesContext.length === 0}
                  <tr>
                    <td colspan="2" style="padding: 24px 12px; text-align: center; color: #64748b; font-size: 11.5px; font-weight: 600;">
                      Cargando marcajes...
                    </td>
                  </tr>
                {:else if marcajesContext && marcajesContext.length > 0}
                  {#each marcajesContext as ctx}
                    <tr style="border-bottom: 1px solid #f1f5f9; background-color: {ctx.fechaStr === dia?.fechaStr ? '#eff6ff' : '#ffffff'};">
                      <td style="padding: 6px 10px; font-weight: {ctx.fechaStr === dia?.fechaStr ? '900' : '700'}; color: {ctx.fechaStr === dia?.fechaStr ? '#1d4ed8' : '#334155'}; white-space: nowrap;">
                        {ctx.label}
                        <span style="display: block; font-size: 9.5px; color: #64748b; font-weight: 500;">{ctx.fechaStr}</span>
                      </td>
                      <td style="padding: 6px 10px; font-weight: 800; font-size: 11px;">
                        {#if ctx.punches && ctx.punches.length > 0}
                          <div style="display: flex; flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap;">
                            {#each ctx.punches as punch}
                              <div
                                style="display: inline-flex; align-items: center; gap: 4px; font-family: monospace; padding: 2.5px 6px; border-radius: 6px; white-space: nowrap; transition: all 0.15s ease; {
                                  punch.type === 'E' && punch.isUsedEntry
                                    ? 'background: #15803d; border: 1.5px solid #14532d; box-shadow: 0 2px 4px rgba(21, 128, 61, 0.35);'
                                    : punch.type === 'S' && punch.isUsedExit
                                    ? 'background: #1d4ed8; border: 1.5px solid #1e3a8a; box-shadow: 0 2px 4px rgba(29, 78, 216, 0.35);'
                                    : punch.type === 'E'
                                    ? 'background: #f0fdf4; border: 1px dashed #86efac;'
                                    : punch.type === 'S'
                                    ? 'background: #eff6ff; border: 1px dashed #93c5fd;'
                                    : 'background: #f1f5f9; border: 1px solid #cbd5e1;'
                                }"
                                title={
                                  punch.type === 'E' && punch.isUsedEntry
                                    ? 'Entrada tomada para el cálculo del turno'
                                    : punch.type === 'S' && punch.isUsedExit
                                    ? 'Salida tomada para el cálculo del turno'
                                    : punch.type === 'O'
                                    ? 'Marcaje tipo Otros (cambie a E o S si desea tomarlo)'
                                    : 'Marcaje no cotejado'
                                }
                              >
                                <!-- Hora del marcaje -->
                                <span
                                  style="font-size: 11.5px; font-weight: 900; {
                                    (punch.type === 'E' && punch.isUsedEntry) || (punch.type === 'S' && punch.isUsedExit)
                                      ? 'color: #ffffff;'
                                      : punch.type === 'E'
                                      ? 'color: #166534;'
                                      : punch.type === 'S'
                                      ? 'color: #1e40af;'
                                      : 'color: #334155;'
                                  }"
                                >
                                  {punch.time}
                                </span>

                                <!-- Selector desplegable para cambiar tipo E, S o O -->
                                <select
                                  value={punch.type}
                                  on:change={(e) => handleLocalPunchChange(punch, e.target.value)}
                                  style="cursor: pointer; font-size: 10px; font-weight: 900; border-radius: 4px; padding: 1px 3px; outline: none; margin-left: 2px; {
                                    punch.type === 'E' && punch.isUsedEntry
                                      ? 'background: #ffffff; color: #15803d; border: 1.5px solid #14532d;'
                                      : punch.type === 'S' && punch.isUsedExit
                                      ? 'background: #ffffff; color: #1d4ed8; border: 1.5px solid #1e3a8a;'
                                      : punch.type === 'E'
                                      ? 'background: #ffffff; color: #166534; border: 1px solid #86efac;'
                                      : punch.type === 'S'
                                      ? 'background: #ffffff; color: #1e40af; border: 1px solid #93c5fd;'
                                      : 'background: #ffffff; color: #475569; border: 1px solid #cbd5e1;'
                                  }"
                                  title="Corregir clasificación: E (Entrada), S (Salida), O (Otros)"
                                >
                                  <option value="E">E</option>
                                  <option value="S">S</option>
                                  <option value="O">O</option>
                                </select>
                              </div>
                            {/each}
                          </div>
                        {:else}
                          <span style="color: #94a3b8; font-family: monospace; font-size: 11px;">
                            {ctx.marcajesStr || 'Sin Registros'}
                          </span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                {:else}
                  <tr>
                    <td colspan="2" style="padding: 10px; text-align: center; color: #94a3b8;">
                      Sin información de marcajes
                    </td>
                  </tr>
                {/if}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- Footer Actions: Navigation Buttons (Left) & Salir Button with Auto-save Status (Right) -->
      <div style="padding: 10px 18px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        
        <!-- Left: D-Pad Navigation Buttons (Matching Keyboard Arrow Cluster) -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <!-- Up: Empleado anterior -->
            <button
              type="button"
              on:click={goToPrevEmp}
              disabled={!canPrevEmp}
              title="Empleado anterior (↑ Flecha Arriba)"
              class="btn-nav-arrow"
            >
              ▲
            </button>
            <!-- Row: Left (Día anterior), Down (Empleado siguiente), Right (Día siguiente) -->
            <div style="display: flex; align-items: center; gap: 2px;">
              <button
                type="button"
                on:click={goToPrevDay}
                disabled={!canPrevDay}
                title="Día anterior (← Flecha Izquierda)"
                class="btn-nav-arrow"
              >
                ◀
              </button>
              <button
                type="button"
                on:click={goToNextEmp}
                disabled={!canNextEmp}
                title="Empleado siguiente (↓ Flecha Abajo)"
                class="btn-nav-arrow"
              >
                ▼
              </button>
              <button
                type="button"
                on:click={goToNextDay}
                disabled={!canNextDay}
                title="Día siguiente (→ Flecha Derecha)"
                class="btn-nav-arrow"
              >
                ▶
              </button>
            </div>
          </div>

          <!-- Position Indicators -->
          <div style="display: flex; flex-direction: column; gap: 2px; font-size: 10.5px; font-weight: 700; color: #64748b;">
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="color: #475569; font-size: 10px; text-transform: uppercase;">Día:</span>
              <span style="color: #2563eb; background: #eff6ff; padding: 1px 6px; border-radius: 4px; border: 1px solid #bfdbfe; font-weight: 800; font-size: 11px;">
                {currentDayIndex >= 0 ? currentDayIndex + 1 : 1} / {(empleado?.dias || []).length || 1}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="color: #475569; font-size: 10px; text-transform: uppercase;">Emp:</span>
              <span style="color: #059669; background: #ecfdf5; padding: 1px 6px; border-radius: 4px; border: 1px solid #a7f3d0; font-weight: 800; font-size: 11px;">
                {currentEmpIndex >= 0 ? currentEmpIndex + 1 : 1} / {(empleadosList || []).length || 1}
              </span>
            </div>
          </div>
        </div>

        <!-- Right: Status Indicator & Salir Button -->
        <div style="display: flex; align-items: center; gap: 8px;">
          {#if saveStatusType !== 'idle'}
            <div style="display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 6px; transition: all 0.2s ease; {
              saveStatusType === 'saving'
                ? 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;'
                : saveStatusType === 'saved'
                ? 'background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;'
                : 'background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;'
            }">
              <span>{saveStatusText}</span>
            </div>
          {/if}

          <button
            on:click={closeModal}
            type="button"
            style="padding: 8px 18px; font-size: 12px; font-weight: 800; color: #334155; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;"
            on:mouseenter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#94a3b8'; }}
            on:mouseleave={(e) => { e.currentTarget.style.background = '#ffffff'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
          >
            Salir
          </button>
        </div>

      </div>

    </div>
  </div>
{/if}

<style>
  .btn-nav-arrow {
    width: 28px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 900;
    border-radius: 5px;
    border: 1.5px solid #cbd5e1;
    background: #ffffff;
    color: #1e293b;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .btn-nav-arrow:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #0f172a;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12);
  }

  .btn-nav-arrow:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: none;
    background: #e2e8f0;
  }

  .btn-nav-arrow:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    background: #f8fafc;
    border-color: #e2e8f0;
    color: #94a3b8;
  }
</style>
