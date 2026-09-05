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

  let horariosEmpleado = [];
  let plantillasEspeciales = [];

  let marcajesLoading = false;
  let marcajesContext = [];

  $: if (show && dia && plantillasSala) {
    initModalData();
  }

  $: if (show && dia && empleado) {
    fetchMarcajesRapidos();
  }

  function initModalData() {
    // Filter 1: Horarios asignados al empleado (tipo === 'horario')
    const assignedIds = new Set((empleado?.horarios_asignados || []).map(h => Number(h.id)));
    if (assignedIds.size > 0) {
      horariosEmpleado = (plantillasSala || []).filter(p => p.tipo === 'horario' && assignedIds.has(Number(p.id)));
    } else {
      horariosEmpleado = [];
    }

    // Filter 2: Plantillas Especiales / Conceptos de sala (excluyendo L y U base)
    plantillasEspeciales = (plantillasSala || []).filter(p => p.codigo !== 'L' && p.codigo !== 'U');

    // Pre-select current plantilla if active
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
  }

  async function fetchMarcajesRapidos() {
    if (!empleado || !dia) return;
    marcajesLoading = true;
    marcajesContext = [];
    try {
      const res = await fetch(`/api/reports/marcajes-rapidos?empleado_id=${empleado.id}&fecha=${dia.fechaStr}`);
      const json = await res.json();
      if (json && json.success) {
        marcajesContext = json.marcajesContext || [];
      }
    } catch (err) {
      console.error("Error fetching marcajes rapidos:", err);
    } finally {
      marcajesLoading = false;
    }
  }

  let updatingPunchId = null;

  async function handleChangePunchType(punch, targetStatus) {
    if (!punch || !punch.id) {
      triggerToast("Identificador de marcaje no disponible", "warning");
      return;
    }
    updatingPunchId = punch.id;
    try {
      const res = await fetch(`/api/reports/attlogs/${punch.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus })
      });
      const json = await res.json();
      if (json && json.success) {
        const label = targetStatus === 'checkIn' ? '(E) Entrada' : (targetStatus === 'checkOut' ? '(S) Salida' : '(O) Otros');
        triggerToast(`Marcaje ${punch.time} actualizado a ${label}`, "success");
        // Refrescar los marcajes rápidos y re-cotejar inmediatamente
        await fetchMarcajesRapidos();
        // Notificar a ReportesView para actualizar la cuadrícula en vivo
        dispatch("punchUpdated");
      } else {
        triggerToast(json?.error || "Error al actualizar estado del marcaje", "error");
      }
    } catch (err) {
      console.error("Error updating punch type:", err);
      triggerToast("Error al actualizar marcaje", "error");
    } finally {
      updatingPunchId = null;
    }
  }

  function closeModal() {
    show = false;
    dispatch('close');
  }

  async function handleSave() {
    if (!empleado || !dia || !selectedValue) {
      triggerToast('Seleccione una plantilla u horario', 'warning');
      return;
    }
    loading = true;
    try {
      let plantillaId = null;
      let isLibre = false;

      if (selectedValue === 'BASE_L') {
        plantillaId = null;
        isLibre = true;
      } else if (selectedValue === 'BASE_U') {
        const pU = (plantillasSala || []).find(p => p.codigo === 'U');
        plantillaId = pU ? Number(pU.id) : null;
        isLibre = false;
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
      if (json && json.success) {
        triggerToast('Excepción especial guardada correctamente', 'success');
        show = false;
        dispatch('saved');
      } else {
        throw new Error(json.error || 'Error al guardar la excepción');
      }
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
    <div style="background: #ffffff; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); width: 100%; max-width: 550px; overflow: hidden; border: 1px solid #e2e8f0; animation: fadeIn 0.15s ease-out;">
      
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
        
        <!-- Select with 3 Optgroups: Plantillas Base del Sistema, Horarios Asignados & Plantillas Especiales -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label for="select-excepcion-horario" style="font-size: 12px; font-weight: 800; color: #1e293b;">
            Seleccionar Excepción o Horario:
          </label>
          <select 
            id="select-excepcion-horario"
            bind:value={selectedValue}
            style="width: 100%; padding: 9px 12px; font-size: 12px; font-weight: 700; color: #0f172a; background-color: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 8px; outline: none; cursor: pointer;"
          >
            <!-- Optgroup 1: Plantillas Base del Sistema (Hardcoded L y U) -->
            <optgroup label="⚙️ Plantillas Base del Sistema">
              <option value="BASE_L">[L] Libre</option>
              <option value="BASE_U">[U] Horario Único</option>
            </optgroup>

            <!-- Optgroup 2: Horarios Asignados al Empleado -->
            {#if horariosEmpleado.length > 0}
              <optgroup label="⏰ Horarios Asignados del Empleado">
                {#each horariosEmpleado as p}
                  <option value="PLANTILLA_{p.id}">
                    [{p.codigo}] {p.nombre} {getHorasFormat(p)}
                  </option>
                {/each}
              </optgroup>
            {/if}

            <!-- Optgroup 3: Plantillas Especiales y Conceptos -->
            {#if plantillasEspeciales.length > 0}
              <optgroup label="📋 Plantillas Especiales y Conceptos">
                {#each plantillasEspeciales as p}
                  <option value="PLANTILLA_{p.id}">
                    [{p.codigo}] {p.nombre} {getHorasFormat(p)}
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
          <span style="font-size: 11.5px; font-weight: 800; color: #334155; display: flex; align-items: center; gap: 5px;">
            📌 Marcajes Rápidos del Empleado:
          </span>
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
                                style="display: inline-flex; align-items: center; gap: 4px; font-family: monospace; padding: 2px 6px; border-radius: 6px; white-space: nowrap; transition: all 0.15s ease; {
                                  punch.isUsedEntry
                                    ? 'background: #f0fdf4; border: 1.5px solid #86efac; box-shadow: 0 1px 2px rgba(0,0,0,0.05);'
                                    : punch.isUsedExit
                                    ? 'background: #eff6ff; border: 1.5px solid #93c5fd; box-shadow: 0 1px 2px rgba(0,0,0,0.05);'
                                    : punch.type === 'E'
                                    ? 'background: #f0fdf4; border: 1px solid #bbf7d0;'
                                    : punch.type === 'S'
                                    ? 'background: #eff6ff; border: 1px solid #bfdbfe;'
                                    : 'background: #f8fafc; border: 1px solid #cbd5e1;'
                                }"
                                title={
                                  punch.isUsedEntry
                                    ? 'Entrada tomada para el cálculo del turno'
                                    : punch.isUsedExit
                                    ? 'Salida tomada para el cálculo del turno'
                                    : 'Marcaje no cotejado (cambie a E o S si desea tomarlo)'
                                }
                              >
                                <!-- Hora del marcaje -->
                                <span
                                  style="font-size: 11.5px; font-weight: 800; {
                                    punch.isUsedEntry
                                      ? 'color: #14532d;'
                                      : punch.isUsedExit
                                      ? 'color: #1e3a8a;'
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
                                  disabled={updatingPunchId === punch.id}
                                  on:change={(e) => {
                                    const val = e.target.value;
                                    const targetStatus = val === 'E' ? 'checkIn' : (val === 'S' ? 'checkOut' : 'undefined');
                                    handleChangePunchType(punch, targetStatus);
                                  }}
                                  style="cursor: pointer; font-size: 10px; font-weight: 800; border: 1px solid {
                                    punch.type === 'E' ? '#86efac' : (punch.type === 'S' ? '#93c5fd' : '#cbd5e1')
                                  }; border-radius: 4px; background: #ffffff; color: {
                                    punch.type === 'E' ? '#166534' : (punch.type === 'S' ? '#1e40af' : '#475569')
                                  }; padding: 1px 3px; outline: none; margin-left: 2px;"
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
          {loading ? 'Guardando...' : 'Guardar Excepción'}
        </button>
      </div>

    </div>
  </div>
{/if}
