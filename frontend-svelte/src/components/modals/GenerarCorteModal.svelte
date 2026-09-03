<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';

  export let isOpen = false;
  export let fechaDesde = '';
  export let fechaHasta = '';
  export let salas = [];
  export let selectedSalaId = null;
  export let totalEmpleados = 0;
  export let payloadData = null;

  const dispatch = createEventDispatcher();

  let titulo = '';
  let salaId = selectedSalaId;
  let isSaving = false;

  // Actualizar título sugerido reactivamente al abrir o cambiar parámetros
  $: if (isOpen) {
    salaId = selectedSalaId || (salas && salas.length > 0 ? salas[0].id : null);
    const salaObj = (salas || []).find(s => Number(s.id) === Number(salaId));
    const salaNombre = salaObj ? (salaObj.nombre_comercial || salaObj.nombre) : 'Todas las salas';
    titulo = `${salaNombre} - Desde: ${fechaDesde} - Hasta: ${fechaHasta}`;
  }

  function handleSalaChange(e) {
    salaId = e.target.value;
    const salaObj = (salas || []).find(s => Number(s.id) === Number(salaId));
    const salaNombre = salaObj ? (salaObj.nombre_comercial || salaObj.nombre) : 'Corte General';
    titulo = `${salaNombre} - Desde: ${fechaDesde} - Hasta: ${fechaHasta}`;
  }

  async function handleConfirm() {
    if (!titulo || !titulo.trim()) {
      triggerToast('El título del corte es obligatorio', 'warning');
      return;
    }
    if (!fechaDesde || !fechaHasta) {
      triggerToast('Fechas no válidas para el corte', 'warning');
      return;
    }

    isSaving = true;
    try {
      const salaObj = (salas || []).find(s => Number(s.id) === Number(salaId));
      const salaNombre = salaObj ? (salaObj.nombre_comercial || salaObj.nombre) : null;

      const body = {
        titulo: titulo.trim(),
        sala_id: salaId ? Number(salaId) : null,
        sala_nombre: salaNombre,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        total_empleados: totalEmpleados || 0,
        data: payloadData || {}
      };

      const res = await fetch('/api/master/cortes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();

      if (json && json.success) {
        triggerToast('🎉 Corte generado y guardado en el histórico exitosamente', 'success');
        dispatch('saved', { corte: json.data });
        dispatch('close');
      } else {
        triggerToast(json?.error || 'Error al guardar el corte histórico', 'error');
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error de conexión al generar el corte', 'error');
    } finally {
      isSaving = false;
    }
  }

  function handleCancel() {
    if (isSaving) return;
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && !isSaving) {
      handleCancel();
    }
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:keydown={handleKeydown}
    on:click={handleCancel}
  >
    <div
      class="modal-card"
      role="document"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <!-- Header -->
      <div class="modal-header">
        <div class="modal-title">
          <span class="header-icon">📑</span>
          <span>Generar Corte Histórico</span>
        </div>
        {#if !isSaving}
          <button type="button" class="close-btn" on:click={handleCancel} title="Cerrar modal">✕</button>
        {/if}
      </div>

      <!-- Body -->
      <div class="modal-body">
        <p class="modal-subtitle">
          Al generar este corte, se congelará y guardará el histórico completo con todos los empleados evaluados, turnos, excepciones y horas calculadas en este rango de fechas.
        </p>

        <!-- Form Fields -->
        <div class="form-group">
          <label for="corte-titulo" class="input-label">Título del Corte:</label>
          <input
            id="corte-titulo"
            type="text"
            bind:value={titulo}
            placeholder="Ej. Monagas Royal Casino - Desde: 2026-09-01 - Hasta: 2026-09-15"
            class="text-input"
            disabled={isSaving}
          />
        </div>

        <div class="form-row">
          <div class="form-group flex-1">
            <label for="corte-sala" class="input-label">Sala Asignada:</label>
            <select
              id="corte-sala"
              value={salaId}
              on:change={handleSalaChange}
              class="select-input"
              disabled={isSaving}
            >
              <option value="">-- Sin Sala / Consolidado --</option>
              {#each salas as sala}
                <option value={sala.id}>{sala.nombre_comercial || sala.nombre}</option>
              {/each}
            </select>
          </div>

          <div class="form-group badge-summary-box">
            <span class="summary-label">Empleados en Corte:</span>
            <span class="summary-badge">{totalEmpleados} empleados</span>
          </div>
        </div>

        <!-- Info Box -->
        <div class="info-box">
          <div class="info-item">
            <span class="info-dot"></span>
            <span><strong>Rango de Fechas:</strong> {fechaDesde} al {fechaHasta}</span>
          </div>
          <div class="info-item">
            <span class="info-dot"></span>
            <span><strong>Estado:</strong> Se creará una captura inmutable accesible desde <code class="route-code">/rrhh/cortes</code></span>
          </div>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="modal-footer">
        <button
          type="button"
          class="btn-cancel"
          on:click={handleCancel}
          disabled={isSaving}
        >
          Cancelar
        </button>

        <button
          type="button"
          class="btn-confirm"
          on:click={handleConfirm}
          disabled={isSaving || !titulo.trim()}
        >
          {#if isSaving}
            <span class="spinner-dot"></span> Guardando Histórico...
          {:else}
            <span>💾 Confirmar y Guardar Corte</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    padding: 16px;
    box-sizing: border-box;
    animation: fadeIn 0.18s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-card {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-width: 540px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: scaleUp 0.18s ease-out;
  }

  @keyframes scaleUp {
    from { transform: scale(0.96); opacity: 0.7; }
    to { transform: scale(1); opacity: 1; }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  .header-icon {
    font-size: 20px;
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 16px;
    color: #64748b;
    cursor: pointer;
    border-radius: 6px;
    padding: 4px 8px;
    line-height: 1;
    transition: all 0.15s;
  }

  .close-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-subtitle {
    font-size: 13px;
    color: #475569;
    line-height: 1.45;
    margin: 0;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-row {
    display: flex;
    align-items: flex-end;
    gap: 14px;
  }

  .flex-1 {
    flex: 1;
  }

  .input-label {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .text-input,
  .select-input {
    width: 100%;
    padding: 10px 14px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13.5px;
    color: #0f172a;
    background: #ffffff;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.15s;
  }

  .text-input:focus,
  .select-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }

  .badge-summary-box {
    background: #f1f5f9;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 130px;
  }

  .summary-label {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
  }

  .summary-badge {
    font-size: 14px;
    font-weight: 800;
    color: #2563eb;
    margin-top: 2px;
  }

  .info-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .info-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: #1e3a8a;
  }

  .info-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #3b82f6;
  }

  .route-code {
    background: #dbeafe;
    padding: 1px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-weight: 700;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 14px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .btn-cancel {
    padding: 9px 18px;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-confirm {
    padding: 9px 20px;
    font-size: 13px;
    font-weight: 800;
    color: #ffffff;
    background: #16a34a;
    border: 1px solid #15803d;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);
    transition: all 0.15s;
  }

  .btn-confirm:hover:not(:disabled) {
    background: #15803d;
    box-shadow: 0 4px 6px rgba(22, 163, 74, 0.3);
  }

  .btn-confirm:disabled,
  .btn-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner-dot {
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
