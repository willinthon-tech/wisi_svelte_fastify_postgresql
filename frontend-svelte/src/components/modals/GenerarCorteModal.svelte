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

  let salaId = selectedSalaId;
  let savingType = null; // 'guardar' | 'no_guardar' | null
  $: isSaving = savingType !== null;

  $: if (isOpen) {
    salaId = selectedSalaId || (salas && salas.length > 0 ? salas[0].id : null);
  }

  function handleSalaChange(e) {
    salaId = e.target.value;
  }

  async function handleGenerar(guardarVisible) {
    if (!fechaDesde || !fechaHasta) {
      triggerToast('Fechas no válidas para el corte', 'warning');
      return;
    }

    savingType = guardarVisible ? 'guardar' : 'no_guardar';
    try {
      const salaObj = (salas || []).find(s => Number(s.id) === Number(salaId));
      const salaNombre = salaObj ? (salaObj.nombre_comercial || salaObj.nombre) : null;

      const body = {
        sala_id: salaId ? Number(salaId) : null,
        sala_nombre: salaNombre,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        total_empleados: totalEmpleados || 0,
        data: payloadData || {},
        visible: Boolean(guardarVisible)
      };

      const res = await fetch('/api/master/cortes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      let json = null;
      const responseText = await res.text();
      try {
        json = JSON.parse(responseText);
      } catch (_parseErr) {
        if (res.status === 413) {
          triggerToast('Error 413: El tamaño de los datos es demasiado grande para el servidor.', 'error');
        } else {
          triggerToast(`Error del servidor (${res.status}) al procesar el corte.`, 'error');
        }
        return;
      }

      if (res.ok && json && json.success) {
        const corteId = json.data?.id;
        if (!guardarVisible) {
          // Copiar enlace al portapapeles automáticamente
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          const shareUrl = `${origin}/#/reportes/rrhh/corte/${corteId}`;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(shareUrl);
            } else {
              const input = document.createElement('input');
              input.value = shareUrl;
              document.body.appendChild(input);
              input.select();
              document.execCommand('copy');
              document.body.removeChild(input);
            }
            triggerToast('🎉 Corte generado y enlace copiado al portapapeles', 'success');
          } catch (errCopy) {
            console.error('Error al copiar enlace:', errCopy);
            prompt('Copia el siguiente enlace del reporte público:', shareUrl);
            triggerToast('🎉 Corte generado exitosamente', 'success');
          }
        } else {
          triggerToast('🎉 Corte generado y guardado en el histórico exitosamente', 'success');
        }

        dispatch('saved', { corte: json.data, visible: guardarVisible });
        dispatch('close');
      } else {
        triggerToast(json?.error || `Error (${res.status}) al procesar el corte`, 'error');
      }
    } catch (err) {
      console.error('Error al generar corte:', err);
      triggerToast('Error de red o conexión al generar el corte', 'error');
    } finally {
      savingType = null;
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
  <!-- Backdrop (sin cerrar al hacer click afuera) -->
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:keydown={handleKeydown}
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
            <span><strong>Opciones:</strong> Guardar en el listado de <code class="route-code">/rrhh/cortes</code> o solo generar enlace público para compartir</span>
          </div>
        </div>
      </div>

      <!-- Footer Actions: 2 botones (col-6 y col-6) -->
      <div class="modal-footer">
        <button
          type="button"
          class="btn-action btn-no-guardar"
          on:click={() => handleGenerar(false)}
          disabled={isSaving}
          title="Genera el corte inmutable con enlace público copiado al portapapeles, pero sin mostrarlo en el listado de cortes"
        >
          {#if savingType === 'no_guardar'}
            <span class="spinner-dot spinner-indigo"></span>
            <span>Generando...</span>
          {:else}
            <span class="btn-icon">🔗</span>
            <span>Generar y no guardar</span>
          {/if}
        </button>

        <button
          type="button"
          class="btn-action btn-guardar"
          on:click={() => handleGenerar(true)}
          disabled={isSaving}
          title="Genera y guarda el corte para que aparezca en el listado general de cortes históricos"
        >
          {#if savingType === 'guardar'}
            <span class="spinner-dot"></span>
            <span>Guardando...</span>
          {:else}
            <span class="btn-icon">💾</span>
            <span>Generar y guardar</span>
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
    max-width: 550px;
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
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 16px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    box-sizing: border-box;
  }

  .btn-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
    box-sizing: border-box;
    text-align: center;
    width: 100%;
  }

  .btn-action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-no-guardar {
    background: #eef2ff;
    color: #4338ca;
    border: 1.5px solid #818cf8;
    box-shadow: 0 1px 3px rgba(99, 102, 241, 0.12);
  }

  .btn-no-guardar:hover:not(:disabled) {
    background: #e0e7ff;
    color: #3730a3;
    border-color: #6366f1;
    transform: translateY(-1px);
    box-shadow: 0 3px 6px rgba(99, 102, 241, 0.2);
  }

  .btn-guardar {
    background: #16a34a;
    color: #ffffff;
    border: 1.5px solid #15803d;
    box-shadow: 0 2px 4px rgba(22, 163, 74, 0.25);
  }

  .btn-guardar:hover:not(:disabled) {
    background: #15803d;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(22, 163, 74, 0.35);
  }

  .btn-icon {
    font-size: 15px;
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

  .spinner-indigo {
    border-color: #4338ca;
    border-top-color: transparent;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
