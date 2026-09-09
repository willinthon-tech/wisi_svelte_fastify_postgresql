<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';

  export let show = false;
  export let empleado = null;
  export let plantillasSala = [];
  export let defaultFechaDesde = '';
  export let defaultFechaHasta = '';

  const dispatch = createEventDispatcher();

  let selectedValue = '';
  let fechaDesde = '';
  let fechaHasta = '';
  let isSaving = false;
  let loadingExceptions = false;

  let plantillasExcepcion = [];
  let rangosAsignados = [];
  let loadingRangos = false;
  let deletingIds = [];
  let lastEmpleadoId = null;

  $: if (show && empleado) {
    if (lastEmpleadoId !== empleado.id) {
      lastEmpleadoId = empleado.id;
      initData();
    }
    fetchExceptions();
    fetchEmpleadoRangos();
  }

  function ensureSelectedValue() {
    if (!selectedValue && plantillasExcepcion.length > 0) {
      const first = plantillasExcepcion[0];
      selectedValue = first.codigo ? `EXCEPCION_${first.id}` : `PLANTILLA_${first.id}`;
    }
  }

  function initData() {
    // 1. Días por defecto
    if (defaultFechaDesde) {
      fechaDesde = defaultFechaDesde;
    } else if (empleado?.dias && empleado.dias.length > 0) {
      fechaDesde = empleado.dias[0].fechaStr;
    } else {
      fechaDesde = new Date().toISOString().slice(0, 10);
    }

    if (defaultFechaHasta) {
      fechaHasta = defaultFechaHasta;
    } else if (empleado?.dias && empleado.dias.length > 0) {
      fechaHasta = empleado.dias[empleado.dias.length - 1].fechaStr;
    } else {
      fechaHasta = new Date().toISOString().slice(0, 10);
    }

    ensureSelectedValue();
  }

  async function fetchExceptions() {
    loadingExceptions = true;
    try {
      const res = await fetch('/api/master/excepciones?limit=1000');
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        plantillasExcepcion = json.data.filter(p => p.tipo === 'Asignable');
        ensureSelectedValue();
      }
    } catch (err) {
      console.error("Error loading master excepciones:", err);
    } finally {
      loadingExceptions = false;
    }
  }

  $: daysCount = calculateDays(fechaDesde, fechaHasta);
  $: isValidRange = fechaDesde && fechaHasta && fechaDesde <= fechaHasta;

  function calculateDays(d1, d2) {
    if (!d1 || !d2) return 0;
    const start = new Date(d1 + 'T00:00:00');
    const end = new Date(d2 + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 0;
  }

  function closeModal() {
    lastEmpleadoId = null;
    show = false;
    dispatch('close');
  }

  function formatDateDisplay(d) {
    if (!d) return '';
    const clean = String(d).split('T')[0].split(' ')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return d;
  }

  async function fetchEmpleadoRangos() {
    if (!empleado || !empleado.id) {
      rangosAsignados = [];
      return;
    }
    loadingRangos = true;
    try {
      const res = await fetch(`/api/reports/excepciones-empleado?empleado_id=${empleado.id}`);
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        rangosAsignados = json.data;
      } else {
        rangosAsignados = [];
      }
    } catch (err) {
      console.error("Error loading employee exception ranges:", err);
      rangosAsignados = [];
    } finally {
      loadingRangos = false;
    }
  }

  async function handleDeleteRange(rango) {
    if (!rango || !rango.ids || rango.ids.length === 0) return;

    const desc = rango.nombre || rango.codigo || 'esta excepción';
    const rangoStr = `${formatDateDisplay(rango.fecha_desde)} al ${formatDateDisplay(rango.fecha_hasta)}`;
    const confirmMsg = `¿Deseas eliminar el rango de excepción [${rango.codigo}] ${desc} (${rangoStr}, ${rango.dias_count} días)?`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    deletingIds = [...rango.ids];
    try {
      const res = await fetch('/api/reports/excepciones-rango/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: rango.ids,
          empleado_id: empleado?.id,
          fecha_desde: rango.fecha_desde,
          fecha_hasta: rango.fecha_hasta
        })
      });
      const json = await res.json();
      if (!json || !json.success) {
        throw new Error(json?.error || 'Error al eliminar el rango de excepciones');
      }

      triggerToast(`✓ Rango de excepción [${rango.codigo}] eliminado (${json.count || rango.dias_count} días).`, 'success');
      await fetchEmpleadoRangos();
      dispatch('saved', { empleado, deletedRange: rango });
    } catch (err) {
      console.error("Error deleting range exception:", err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      deletingIds = [];
    }
  }

  async function handleSave() {
    if (!empleado || !empleado.id) {
      triggerToast('No se ha especificado el empleado.', 'error');
      return;
    }

    if (!isValidRange || daysCount <= 0) {
      triggerToast('Por favor selecciona un rango de fechas válido.', 'warning');
      return;
    }

    isSaving = true;
    try {
      let plantillaId = null;
      let excepcionId = null;

      if (selectedValue && selectedValue.startsWith('EXCEPCION_')) {
        excepcionId = Number(selectedValue.replace('EXCEPCION_', ''));
      } else if (selectedValue && selectedValue.startsWith('PLANTILLA_')) {
        plantillaId = Number(selectedValue.replace('PLANTILLA_', ''));
      }

      if (!excepcionId && !plantillaId) {
        triggerToast('Por favor selecciona una excepción de la lista.', 'warning');
        return;
      }

      const payload = {
        empleado_id: empleado.id,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        plantilla_horario_id: plantillaId,
        excepcion_id: excepcionId
      };

      const res = await fetch('/api/reports/excepciones-rango', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json || !json.success) {
        throw new Error(json?.error || 'Error al aplicar excepción por rango');
      }

      triggerToast(`✓ Excepción aplicada a ${json.count || daysCount} días correctamente.`, 'success');
      dispatch('saved', { 
        empleado, 
        count: json.count || daysCount, 
        fechaDesde, 
        fechaHasta,
        plantillaId
      });
      await fetchEmpleadoRangos();
    } catch (err) {
      console.error("Error saving range exception:", err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSaving = false;
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

{#if show}
  <div class="modal-overlay">
    <div class="modal-card">
      
      <!-- Header exacto con foto ampliada e información del empleado -->
      <div class="modal-header">
        <div class="emp-profile-left">
          <!-- Foto del Empleado -->
          <div class="emp-avatar-wrapper">
            {#if getFotoUrl(empleado)}
              <img
                src={getFotoUrl(empleado)}
                alt={empleado?.nombre || 'Empleado'}
                class="emp-avatar-image"
                on:error={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              <div class="emp-avatar-fallback-initials" style="display: none;">
                {(empleado?.nombre || 'E').charAt(0).toUpperCase()}
              </div>
            {:else}
              <div class="emp-avatar-fallback-initials">
                {(empleado?.nombre || 'E').charAt(0).toUpperCase()}
              </div>
            {/if}
          </div>

          <!-- Información del Empleado: Nombre, Sala, Cargo, Cédula con Badge -->
          <div class="emp-details-col">
            <h3 class="emp-title-name" title={empleado?.nombre || ''}>
              {empleado?.nombre || 'Empleado'}
            </h3>
            
            <div class="emp-subtext">
              Sala: <span class="emp-subtext-bold">{empleado?.sala_nombre || (plantillasSala && plantillasSala[0]?.sala_nombre) || 'Principal'}</span>
            </div>

            <div class="emp-subtext">
              Cargo: <span class="emp-subtext-bold">{empleado?.cargo_nombre || 'Sin Cargo'}</span>
            </div>

            <div style="margin-top: 2px;">
              <span class="emp-cedula-badge">
                🪪 {empleado?.cedula || (empleado?.id ? `ID: #${empleado.id}` : '')}
              </span>
            </div>
          </div>
        </div>

        <!-- Derecha: Badge de Rango y Botón Cerrar -->
        <div class="header-right-actions">
          <span class="badge-rango-indicator">
            📅 Rango de Fechas
          </span>

          <button 
            on:click={closeModal} 
            type="button" 
            class="btn-close-modal"
            title="Cerrar (Esc)"
          >
            &times;
          </button>
        </div>
      </div>

      <!-- Formulario del Rango -->
      <div class="modal-body">
        
        <!-- 1. Selección de la Excepción u Horario -->
        <div class="form-group">
          <label for="select-rango-excepcion" class="form-label">
            Seleccionar Excepción a Asignar:
          </label>
          <select 
            id="select-rango-excepcion"
            bind:value={selectedValue}
            class="form-select"
          >
            {#if plantillasExcepcion.length === 0}
              <option value="" disabled>Cargando excepciones de asistencia...</option>
            {:else}
              {#each plantillasExcepcion as p}
                <option value={p.descripcion ? `EXCEPCION_${p.id}` : `PLANTILLA_${p.id}`}>
                  [{p.codigo}] {p.descripcion || p.nombre}
                </option>
              {/each}
            {/if}
          </select>
          <span class="form-hint">
            {#if loadingExceptions}
              Cargando excepciones de asistencia...
            {:else}
              Esta excepción se establecerá para cada uno de los días del rango seleccionado.
            {/if}
          </span>
        </div>

        <!-- 2. Inputs de Fechas Desde - Hasta -->
        <div class="dates-row">
          <div class="form-group" style="flex: 1;">
            <label for="input-rango-desde" class="form-label">
              Fecha Desde:
            </label>
            <input 
              id="input-rango-desde"
              type="date"
              bind:value={fechaDesde}
              class="form-input-date"
            />
          </div>

          <div class="form-group" style="flex: 1;">
            <label for="input-rango-hasta" class="form-label">
              Fecha Hasta:
            </label>
            <input 
              id="input-rango-hasta"
              type="date"
              bind:value={fechaHasta}
              class="form-input-date"
            />
          </div>
        </div>

        <!-- 3. Indicador de Total de Días Seleccionados -->
        <div class="status-box {isValidRange ? 'status-box-valid' : 'status-box-invalid'}">
          {#if isValidRange}
            <span style="font-size: 15px;">🗓️</span>
            <span>
              Se aplicará a <strong>{daysCount} {daysCount === 1 ? 'día' : 'días'}</strong> de forma simultánea.
            </span>
          {:else}
            <span style="font-size: 15px;">⚠️</span>
            <span>
              La fecha 'Desde' no puede ser posterior a la fecha 'Hasta'.
            </span>
          {/if}
        </div>

        <!-- 4. Sección y Tabla de Excepciones Rango Asignadas -->
        <div class="section-divider">
          <div class="section-title-wrap">
            <h4 class="section-title">
              <span>📑</span> Excepciones en Rango Asignadas ({rangosAsignados.length})
            </h4>
            <span class="section-subtitle">
              Listado de excepciones asignadas por rango a este empleado. Puedes eliminar el rango completo.
            </span>
          </div>
          <button 
            type="button" 
            class="btn-refresh-sm" 
            on:click={fetchEmpleadoRangos} 
            disabled={loadingRangos}
            title="Actualizar listado de rangos"
          >
            {#if loadingRangos}
              <span class="spinner-inline-sm"></span>
            {:else}
              🔄
            {/if}
          </button>
        </div>

        {#if loadingRangos}
          <div class="empty-state-card">
            <span class="spinner-inline-blue"></span>
            <span>Cargando excepciones asignadas al empleado...</span>
          </div>
        {:else if rangosAsignados.length === 0}
          <div class="empty-state-card">
            <span style="font-size: 20px;">ℹ️</span>
            <span>Este empleado no tiene excepciones asignadas por rango.</span>
          </div>
        {:else}
          <div class="table-container">
            <table class="rangos-table">
              <thead>
                <tr>
                  <th>Excepción</th>
                  <th>Rango de Fechas</th>
                  <th style="text-align: center;">Días</th>
                  <th style="text-align: right;">Acción</th>
                </tr>
              </thead>
              <tbody>
                {#each rangosAsignados as rango (rango.fecha_desde + '_' + rango.codigo)}
                  <tr class="rango-row">
                    <td>
                      <div class="excep-badge-cell">
                        <span 
                          class="badge-code" 
                          style="background-color: {rango.color || '#3b82f6'}; color: #ffffff;"
                        >
                          {rango.codigo}
                        </span>
                        <span class="excep-name-text" title={rango.nombre}>
                          {rango.nombre}
                        </span>
                      </div>
                      {#if rango.observacion}
                        <div class="rango-obs-text">📝 {rango.observacion}</div>
                      {/if}
                    </td>
                    <td>
                      <div class="rango-dates-cell">
                        <span class="date-badge">{formatDateDisplay(rango.fecha_desde)}</span>
                        <span class="date-arrow">➔</span>
                        <span class="date-badge">{formatDateDisplay(rango.fecha_hasta)}</span>
                      </div>
                    </td>
                    <td style="text-align: center;">
                      <span class="days-count-pill">
                        {rango.dias_count} {rango.dias_count === 1 ? 'día' : 'días'}
                      </span>
                    </td>
                    <td style="text-align: right;">
                      <button
                        type="button"
                        class="btn-delete-rango"
                        on:click={() => handleDeleteRange(rango)}
                        disabled={deletingIds.length > 0}
                        title="Eliminar este rango de excepciones"
                      >
                        {#if deletingIds.includes(rango.ids[0])}
                          <span class="spinner-inline-sm"></span>
                          <span>Borrando...</span>
                        {:else}
                          <span>🗑️</span>
                          <span>Eliminar Rango</span>
                        {/if}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      </div>

      <!-- Footer con botones Salir y Guardar -->
      <div class="modal-footer">
        <button 
          type="button" 
          on:click={closeModal}
          class="btn-secondary"
          disabled={isSaving}
        >
          Cerrar
        </button>

        <button 
          type="button" 
          on:click={handleSave}
          disabled={!isValidRange || daysCount <= 0 || isSaving}
          class="btn-primary"
        >
          {#if isSaving}
            <span class="spinner-inline"></span>
            Guardando...
          {:else}
            💾 Guardar en Rango
          {/if}
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(4px);
    padding: 16px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 14px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    width: 100%;
    max-width: 680px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    animation: modalPop 0.15s ease-out;
  }

  @keyframes modalPop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-header {
    padding: 14px 18px;
    background: linear-gradient(to right, #f8fafc, #f1f5f9);
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .emp-profile-left {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .emp-avatar-wrapper {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    overflow: hidden;
    border: 2.5px solid #3b82f6;
    background: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 5px rgba(0,0,0,0.14);
  }

  .emp-avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  .emp-avatar-fallback-initials {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    background: #e0e7ff;
    color: #4338ca;
    font-size: 22px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .emp-details-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .emp-title-name {
    margin: 0;
    font-size: 14px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .emp-subtext {
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
    line-height: 1.2;
  }

  .emp-subtext-bold {
    color: #1e293b;
    font-weight: 800;
  }

  .emp-cedula-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 6px;
    background: #eff6ff;
    border: 1.5px solid #3b82f6;
    color: #1d4ed8;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.4px;
    box-shadow: 0 1px 2px rgba(59, 130, 246, 0.15);
  }

  .header-right-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .badge-rango-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 7px;
    background: #eff6ff;
    border: 1.5px solid #3b82f6;
    color: #1d4ed8;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.5px;
    box-shadow: 0 1px 3px rgba(59, 130, 246, 0.15);
  }

  .btn-close-modal {
    background: transparent;
    border: none;
    font-size: 22px;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.15s ease;
  }

  .btn-close-modal:hover {
    color: #0f172a;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    flex: 1;
    max-height: calc(92vh - 145px);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 800;
    color: #1e293b;
  }

  .form-select {
    width: 100%;
    padding: 9px 12px;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    background-color: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .form-select:focus {
    border-color: #3b82f6;
  }

  .form-hint {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
  }

  .dates-row {
    display: flex;
    gap: 12px;
  }

  .form-input-date {
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    background-color: #f8fafc;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .form-input-date:focus {
    background-color: #ffffff;
    border-color: #3b82f6;
  }

  .status-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
  }

  .status-box-valid {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
  }

  .status-box-invalid {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }

  .modal-footer {
    padding: 14px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  .btn-secondary {
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 800;
    color: #475569;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    font-size: 12.5px;
    font-weight: 800;
    color: #ffffff;
    background: #2563eb;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
    transition: all 0.15s ease;
  }

  .btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
    box-shadow: 0 4px 8px rgba(37, 99, 235, 0.35);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner-inline {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .section-divider {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 16px;
    border-top: 1.5px dashed #cbd5e1;
    margin-top: 4px;
    gap: 12px;
  }

  .section-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .section-title {
    margin: 0;
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .section-subtitle {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
  }

  .btn-refresh-sm {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-refresh-sm:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .table-container {
    width: 100%;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .rangos-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .rangos-table th {
    background: #f8fafc;
    color: #475569;
    font-weight: 800;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 9px 12px;
    border-bottom: 1.5px solid #e2e8f0;
    text-align: left;
  }

  .rangos-table td {
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }

  .rango-row:hover {
    background-color: #f8fafc;
  }

  .excep-badge-cell {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-code {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2.5px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.4px;
    min-width: 32px;
    text-align: center;
    box-shadow: 0 1px 2px rgba(0,0,0,0.12);
  }

  .excep-name-text {
    font-size: 12px;
    font-weight: 700;
    color: #1e293b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
  }

  .rango-obs-text {
    font-size: 10.5px;
    color: #64748b;
    margin-top: 3px;
    font-style: italic;
  }

  .rango-dates-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: monospace;
    font-size: 11.5px;
  }

  .date-badge {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #0f172a;
    padding: 2px 6px;
    border-radius: 5px;
    font-weight: 700;
  }

  .date-arrow {
    color: #94a3b8;
    font-size: 11px;
    font-weight: 900;
  }

  .days-count-pill {
    display: inline-block;
    padding: 3px 8px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1d4ed8;
    border-radius: 12px;
    font-weight: 800;
    font-size: 11px;
    white-space: nowrap;
  }

  .btn-delete-rango {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 800;
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .btn-delete-rango:hover:not(:disabled) {
    background: #dc2626;
    border-color: #b91c1c;
    color: #ffffff;
    box-shadow: 0 2px 5px rgba(220, 38, 38, 0.25);
    transform: translateY(-1px);
  }

  .btn-delete-rango:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-state-card {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    background: #f8fafc;
    border: 1.5px dashed #cbd5e1;
    border-radius: 10px;
    color: #64748b;
    font-size: 12px;
    font-weight: 700;
    text-align: center;
  }

  .spinner-inline-sm {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(220, 38, 38, 0.3);
    border-top-color: #dc2626;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .spinner-inline-blue {
    width: 16px;
    height: 16px;
    border: 2.5px solid rgba(59, 130, 246, 0.25);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
</style>
