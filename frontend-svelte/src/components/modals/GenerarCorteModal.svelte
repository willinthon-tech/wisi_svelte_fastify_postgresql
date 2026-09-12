<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { getPublicWebUrl } from '../../config/api.config.js';

  export let isOpen = false;
  export let fechaDesde = '';
  export let fechaHasta = '';
  export let salas = [];
  export let totalEmpleados = 0;
  export let payloadData = null;

  const dispatch = createEventDispatcher();

  let savingType = null; // 'guardar' | 'no_guardar' | null
  $: isSaving = savingType !== null;

  // Extraer automáticamente las salas que conforman el corte desde los empleados evaluados
  $: rawEmployees = payloadData?.empleados || [];
  $: salasDetectadas = (() => {
    const map = new Map();
    rawEmployees.forEach(e => {
      const sId = Number(e.sala_id);
      if (sId && !map.has(sId)) {
        const found = (salas || []).find(s => Number(s.id) === sId);
        const name = found ? (found.nombre_comercial || found.nombre) : (e.sala_nombre || `Sala #${sId}`);
        map.set(sId, { id: sId, nombre: name, count: 0 });
      }
      if (sId && map.has(sId)) {
        map.get(sId).count++;
      }
    });
    return Array.from(map.values());
  })();

  $: salasIds = salasDetectadas.map(s => s.id);

  async function compressPayload(rawObj) {
    if (!rawObj) return {};
    try {
      const jsonStr = JSON.stringify(rawObj);
      // Comprimir con GZIP si supera 80 KB para evitar límites de tamaño HTTP / NGINX (413)
      if (jsonStr.length > 80 * 1024 && typeof CompressionStream !== 'undefined') {
        const stream = new Blob([jsonStr]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const response = new Response(compressedStream);
        const arrayBuf = await response.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(arrayBuf);
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return 'gzip:' + btoa(binary);
      }
      return rawObj;
    } catch (errComp) {
      console.warn('Error al comprimir payload, usando directo:', errComp);
      return rawObj;
    }
  }

  async function handleGenerar(guardarVisible) {
    if (!fechaDesde || !fechaHasta) {
      triggerToast('Fechas no válidas para el corte', 'warning');
      return;
    }

    savingType = guardarVisible ? 'guardar' : 'no_guardar';
    try {
      // Optimizar y comprimir el payload del corte para transferencias ultra rápidas
      const finalData = await compressPayload(payloadData || {});

      const body = {
        salas_ids: salasIds,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        total_empleados: totalEmpleados || 0,
        data: finalData,
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
          // Copiar enlace al portapapeles con el dominio web público oficial
          const shareUrl = getPublicWebUrl(`/#/reportes/rrhh/corte/${corteId}`);
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

        <!-- Salas detectadas automáticamente y Resumen de Empleados -->
        <div class="corte-summary-grid">
          <div class="summary-card salas-card">
            <div class="summary-header">
              <span class="summary-icon">🎰</span>
              <span class="summary-title">Salas en este Corte ({salasDetectadas.length}):</span>
            </div>
            <div class="salas-chips-wrap">
              {#if salasDetectadas.length > 0}
                {#each salasDetectadas as s}
                  <span class="sala-chip" title="Sala ID #{s.id}">
                    <strong class="sala-chip-id">#{s.id}</strong> {s.nombre} <span class="sala-chip-count">({s.count} emp.)</span>
                  </span>
                {/each}
              {:else}
                <span class="sala-chip-empty">Consolidado general (todas las salas)</span>
              {/if}
            </div>
          </div>

          <div class="summary-card emp-card">
            <span class="emp-summary-label">Empleados en Corte:</span>
            <span class="emp-summary-value">{totalEmpleados}</span>
            <span class="emp-summary-sub">evaluados</span>
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

  .corte-summary-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
  }

  .summary-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .salas-card {
    gap: 8px;
    min-height: 70px;
  }

  .summary-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .summary-icon {
    font-size: 14px;
  }

  .summary-title {
    font-size: 11.5px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .salas-chips-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .sala-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #eef2ff;
    color: #3730a3;
    border: 1px solid #c7d2fe;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .sala-chip-id {
    color: #4f46e5;
    font-weight: 800;
  }

  .sala-chip-count {
    color: #6366f1;
    font-size: 11px;
    font-weight: 700;
  }

  .sala-chip-empty {
    font-size: 12px;
    color: #94a3b8;
    font-style: italic;
  }

  .emp-card {
    align-items: center;
    min-width: 140px;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .emp-summary-label {
    font-size: 11px;
    font-weight: 700;
    color: #1e40af;
    text-transform: uppercase;
  }

  .emp-summary-value {
    font-size: 22px;
    font-weight: 900;
    color: #1d4ed8;
    line-height: 1.1;
    margin: 2px 0;
  }

  .emp-summary-sub {
    font-size: 11px;
    color: #3b82f6;
    font-weight: 600;
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
