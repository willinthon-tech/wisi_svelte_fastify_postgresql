<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';

  export let show = false;
  export let empleado = null;
  export let dia = null;
  export let plantillasSala = [];

  const dispatch = createEventDispatcher();

  let loading = false;
  let selectedValue = '';
  let initialSelectedValue = '';
  let scheduleModified = false;

  let horariosEmpleado = [];
  let plantillasExcepcion = [];

  let marcajesLoading = false;
  let marcajesContext = [];

  $: if (show && dia && plantillasSala) {
    initModalData();
  }

  $: if (show && dia && empleado) {
    fetchMarcajesRapidos();
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
    const currentCodigo = dia?.shift?.codigo || '';
    if (currentCodigo === 'L') {
      selectedValue = 'BASE_L';
    } else if (currentCodigo === 'U') {
      selectedValue = 'BASE_U';
    } else if (dia && dia.isExcepcion && dia.shift) {
      if (dia.shift.id) {
        selectedValue = `PLANTILLA_${dia.shift.id}`;
      } else {
        const pMatch = (plantillasSala || []).find(p => p.codigo === dia.shift.codigo);
        selectedValue = pMatch ? `PLANTILLA_${pMatch.id}` : 'BASE_L';
      }
    } else if (dia && dia.shift && dia.shift.codigo) {
      const pMatch = (plantillasSala || []).find(p => p.codigo === dia.shift.codigo);
      selectedValue = pMatch ? `PLANTILLA_${pMatch.id}` : 'BASE_L';
    } else {
      selectedValue = 'BASE_L';
    }

    initialSelectedValue = selectedValue;
    scheduleModified = false;
  }

  let pendingPunches = {};
  let assignedPlantillasEmp = [];

  function toMinutes(str) {
    if (!str) return null;
    const parts = String(str).trim().split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    return parts[0] * 60 + parts[1];
  }

  async function fetchMarcajesRapidos() {
    if (!empleado || !dia) return;
    marcajesLoading = true;
    marcajesContext = [];
    pendingPunches = {};
    try {
      const res = await fetch(`/api/reports/marcajes-rapidos?empleado_id=${empleado.id}&fecha=${dia.fechaStr}`);
      const json = await res.json();
      if (json && json.success) {
        marcajesContext = json.marcajesContext || [];
        assignedPlantillasEmp = json.assignedPlantillas || [];
      }
    } catch (err) {
      console.error("Error fetching marcajes rapidos:", err);
    } finally {
      marcajesLoading = false;
    }
  }

  function handleLocalPunchChange(punch, newType) {
    if (!punch || !punch.id) return;
    const targetStatus = newType === 'E' ? 'checkIn' : (newType === 'S' ? 'checkOut' : 'undefined');

    // Registrar cambio pendiente
    pendingPunches = {
      ...pendingPunches,
      [punch.id]: {
        id: punch.id,
        targetStatus,
        newType,
        time: punch.time
      }
    };

    // Actualizar reactivamente el contexto local para que el selector y los colores reflejen el cambio
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
  }

  function handleScheduleSelectChange() {
    scheduleModified = (selectedValue !== initialSelectedValue);
    recalculateLocalEntryExit();
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
    pendingPunches = {};
    show = false;
    dispatch('close');
  }

  async function handleSave() {
    if (!empleado || !dia) return;

    const punchUpdates = Object.values(pendingPunches);
    const hasPendingPunches = punchUpdates.length > 0;
    const isBaseU = selectedValue === 'BASE_U';

    if (scheduleModified && isBaseU && !hasPendingPunches) {
      triggerToast('El Horario Único es automático del sistema. Seleccione un horario o excepción válida para guardar.', 'warning');
      return;
    }

    if (!scheduleModified && !hasPendingPunches) {
      triggerToast('No se detectaron cambios para guardar.', 'info');
      closeModal();
      return;
    }

    loading = true;
    try {
      // 1. Guardar cambios en marcajes pendientes en la base de datos
      if (hasPendingPunches) {
        for (const p of punchUpdates) {
          const resPunch = await fetch(`/api/reports/attlogs/${p.id}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: p.targetStatus })
          });
          const punchJson = await resPunch.json();
          if (!punchJson || !punchJson.success) {
            throw new Error(punchJson?.error || `Error al actualizar marcaje ${p.time}`);
          }
        }
        pendingPunches = {};
      }

      // 2. Guardar excepción de horario seleccionada (ÚNICAMENTE si el usuario modificó el select de horario)
      if (scheduleModified && !isBaseU && selectedValue) {
        let plantillaId = null;
        let isLibre = false;

        if (selectedValue === 'BASE_L') {
          plantillaId = null;
          isLibre = true;
        } else {
          plantillaId = Number(selectedValue.replace('PLANTILLA_', ''));
          const pObj = (plantillasSala || []).find(p => Number(p.id) === Number(plantillaId));
          isLibre = pObj ? (pObj.codigo === 'L' || pObj.tipo === 'plantilla' || (!pObj.hora_entrada && !pObj.hora_salida)) : false;
        }

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
          throw new Error(json.error || 'Error al guardar la excepción');
        }
      }

      triggerToast('Cambios guardados correctamente', 'success');
      show = false;
      dispatch('punchUpdated');
      dispatch('saved');
    } catch (err) {
      console.error(err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      loading = false;
    }
  }

  async function handleDelete() {
    if (!dia || !dia.excepcionId) return;
    loading = true;
    try {
      const res = await fetch(`/api/reports/excepciones/${dia.excepcionId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Excepción eliminada correctamente', 'success');
        show = false;
        dispatch('saved');
      } else {
        throw new Error(json.error || 'Error al eliminar la excepción');
      }
    } catch (err) {
      console.error(err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      loading = false;
    }
  }

  function getHorasFormat(p) {
    if (p.hora_entrada && p.hora_salida) {
      return `(${p.hora_entrada.slice(0, 5)} - ${p.hora_salida.slice(0, 5)})`;
    }
    return '';
  }
</script>

{#if show}
  <div style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.55); backdrop-filter: blur(4px); padding: 16px;">
    <div style="background: #ffffff; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); width: 100%; max-width: 580px; overflow: hidden; border: 1px solid #e2e8f0; animation: fadeIn 0.15s ease-out;">
      
      <!-- Header -->
      <div style="padding: 16px 20px; background: linear-gradient(to right, #f8fafc, #f1f5f9); border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: #e0e7ff; color: #4338ca; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0;">
            ⚡
          </div>
          <div>
            <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #0f172a;">
              Excepción Especial de Horario
            </h3>
            <p style="margin: 2px 0 0 0; font-size: 11px; color: #64748b;">
              {empleado?.nombre || 'Empleado'} &bull; <strong style="color: #2563eb;">{dia?.fechaStr || ''}</strong>
            </p>
          </div>
        </div>

        <button 
          on:click={closeModal} 
          type="button" 
          style="background: transparent; border: none; font-size: 18px; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 4px; line-height: 1;"
        >
          &times;
        </button>
      </div>

      <!-- Body -->
      <div style="padding: 20px; display: flex; flex-direction: column; gap: 12px;">
        
        <!-- Select with clear Optgroups: Plantillas Base, Horarios Asignados al Empleado, Horarios de Sala, Plantillas Tipo Excepción -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label for="select-excepcion-horario" style="font-size: 12px; font-weight: 800; color: #1e293b;">
            Seleccionar Excepción o Horario:
          </label>
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
            disabled={loading}
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
          <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
              <thead>
                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #475569; font-weight: 800;">
                  <th style="padding: 6px 10px; width: 120px; white-space: nowrap;">Día / Fecha</th>
                  <th style="padding: 6px 10px;">Marcajes Registrados</th>
                </tr>
              </thead>
              <tbody>
                {#if marcajesLoading}
                  <tr>
                    <td colspan="2" style="padding: 12px; text-align: center; color: #64748b; font-size: 11px;">
                      ⏳ Cargando marcajes...
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
                                  disabled={loading}
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

      <!-- Footer Actions -->
      <div style="padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
        <button
          on:click={closeModal}
          disabled={loading}
          type="button"
          style="padding: 8px 14px; font-size: 11.5px; font-weight: 700; color: #475569; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;"
        >
          Salir
        </button>

        <button
          on:click={handleSave}
          disabled={loading}
          type="button"
          style="padding: 8px 16px; font-size: 11.5px; font-weight: 800; color: #ffffff; background: #2563eb; border: none; border-radius: 6px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.1);"
        >
          {loading ? 'Guardando...' : 'Guardar'}
        </button>
      </div>

    </div>
  </div>
{/if}
