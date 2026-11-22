<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';
  import {
    upsertLocalItem,
    queueOutboxAction,
    generateSafeUuid
  } from '../../services/localDb.service.js';

  export let show = false;
  export let isOpen = false;
  export let mesa = null;
  export let libro = null;
  export let libroId = null;
  export let multisalaUuid = null;
  export let aperturaRecord = null;
  export let availableDenominaciones = [];
  export let initialTipo = 'relleno'; // 'relleno' | 'devolucion'

  $: modalVisible = show || isOpen;

  const dispatch = createEventDispatcher();

  let activeTipo = 'relleno'; // 'relleno' | 'devolucion'
  let isSaving = false;
  let errorMessage = '';
  let formQuantities = {};
  let hora = '';
  let observaciones = '';

  $: if (modalVisible) {
    if (initialTipo === 'devolucion' || initialTipo === 'relleno') {
      activeTipo = initialTipo;
    }
    resetForm();
  }

  function resetForm() {
    formQuantities = {};
    for (const d of (availableDenominaciones || [])) {
      formQuantities[d] = '';
    }
    observaciones = '';
    const now = new Date();
    hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // Lista de movimientos existentes en la mesa
  $: allMovements = Array.isArray(aperturaRecord?.rellenos_devoluciones)
    ? aperturaRecord.rellenos_devoluciones
    : (typeof aperturaRecord?.rellenos_devoluciones === 'string'
      ? (() => { try { return JSON.parse(aperturaRecord.rellenos_devoluciones || '[]'); } catch(e) { return []; } })()
      : []);

  $: rellenosList = allMovements.filter(m => m.tipo === 'relleno');
  $: devolucionesList = allMovements.filter(m => m.tipo === 'devolucion');

  $: currentList = activeTipo === 'relleno' ? rellenosList : devolucionesList;

  $: nextNumero = (activeTipo === 'relleno' ? rellenosList.length : devolucionesList.length) + 1;
  $: nextCodigo = activeTipo === 'relleno' ? `R${nextNumero}` : `D${nextNumero}`;

  // Cálculo en vivo del monto del formulario
  $: formTotal = (availableDenominaciones || []).reduce((acc, denom) => {
    const cant = Math.max(0, parseInt(formQuantities[denom], 10) || 0);
    return acc + (Number(denom) * cant);
  }, 0);

  // Totales acumulados
  $: totalRellenosMonto = rellenosList.reduce((acc, m) => acc + (Number(m.total) || 0), 0);
  $: totalDevolucionesMonto = devolucionesList.reduce((acc, m) => acc + (Number(m.total) || 0), 0);
  $: netoMonto = totalRellenosMonto - totalDevolucionesMonto;

  function formatMoney(num) {
    if (isNaN(num)) return '0.00';
    return Number(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function handleClose() {
    dispatch('close');
  }

  function formatFichasDesglose(fichas) {
    if (!Array.isArray(fichas) || fichas.length === 0) return '—';
    return fichas
      .filter(f => (Number(f.cantidad) || 0) > 0)
      .map(f => `${f.cantidad} × $${f.valor}`)
      .join(', ') || '—';
  }

  async function handleGuardar() {
    errorMessage = '';

    const fichasPayload = (availableDenominaciones || []).map(d => {
      const cant = Math.max(0, parseInt(formQuantities[d], 10) || 0);
      return {
        valor: Number(d),
        cantidad: cant,
        total: Number(d) * cant
      };
    }).filter(f => f.cantidad > 0);

    if (fichasPayload.length === 0) {
      errorMessage = 'Debe indicar al menos una ficha con cantidad mayor a 0.';
      triggerToast(errorMessage, 'warning');
      return;
    }

    const lId = libro?.uuid || libroId || libro?.id;
    const mId = mesa?.uuid || mesa?.id;
    if (!lId || !mId) {
      errorMessage = 'Error: faltan datos del libro o de la mesa.';
      return;
    }

    isSaving = true;
    try {
      const nuevoMovimiento = {
        id: generateSafeUuid(),
        uuid: generateSafeUuid(),
        tipo: activeTipo,
        codigo: nextCodigo,
        numero: nextNumero,
        hora: hora || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        fichas: fichasPayload,
        total: formTotal,
        observaciones: observaciones?.trim() || null,
        created_at: new Date().toISOString()
      };

      const updatedMovements = [...allMovements, nuevoMovimiento];

      // Base record de apertura (o nuevo si no existía)
      const recordUuid = aperturaRecord?.uuid || aperturaRecord?.id || generateSafeUuid();
      const updatedApertura = {
        ...(aperturaRecord || {}),
        uuid: recordUuid,
        id: recordUuid,
        libro_uuid: lId,
        libro_id: lId,
        mesa_uuid: mId,
        mesa_id: mId,
        multisala_uuid: multisalaUuid || null,
        tipo: 'apertura',
        fichas: aperturaRecord?.fichas || [],
        total: aperturaRecord?.total !== undefined ? Number(aperturaRecord.total) : 0,
        rellenos_devoluciones: updatedMovements,
        mesa_nombre: mesa.nombre || '',
        juego_nombre: mesa.juego_nombre || '',
        updated_at: new Date().toISOString()
      };

      // 1. Guardar en local DB (<5ms)
      await upsertLocalItem('libro_arqueo_fichas', updatedApertura);

      // Notificar al componente padre de forma inmediata (0ms)
      dispatch('saved', updatedApertura);

      // 2. Sincronizar en segundo plano con backend
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'libro_arqueo_fichas',
          action: 'save',
          endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
          method: 'POST',
          payload: updatedApertura,
          uuid: recordUuid
        });
      } else {
        (async () => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4500);
            const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedApertura),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
              const json = await res.json();
              if (json?.data) {
                await upsertLocalItem('libro_arqueo_fichas', json.data);
              }
            } else {
              throw new Error(`Server status ${res.status}`);
            }
          } catch (syncErr) {
            console.warn('[RellenoDevolucionModal] Encolando en Outbox:', syncErr);
            await queueOutboxAction({
              entity: 'libro_arqueo_fichas',
              action: 'save',
              endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
              method: 'POST',
              payload: updatedApertura,
              uuid: recordUuid
            });
          }
        })();
      }

      triggerToast(`${activeTipo === 'relleno' ? 'Relleno' : 'Devolución'} ${nextCodigo} registrado con éxito ($ ${formatMoney(formTotal)}).`, 'success');
      resetForm();
    } catch (err) {
      console.error('Error guardando movimiento:', err);
      errorMessage = err.message || 'Error al guardar el movimiento';
      triggerToast(errorMessage, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminarMovimiento(movId) {
    if (!confirm('¿Está seguro de eliminar este registro?')) return;

    const lId = libro?.uuid || libroId || libro?.id;
    const mId = mesa?.uuid || mesa?.id;
    if (!lId || !mId || !aperturaRecord) return;

    const filteredMovements = allMovements.filter(m => (m.id || m.uuid) !== movId);
    
    // Re-indexar los códigos si es necesario o conservarlos
    const updatedApertura = {
      ...aperturaRecord,
      rellenos_devoluciones: filteredMovements,
      updated_at: new Date().toISOString()
    };

    try {
      await upsertLocalItem('libro_arqueo_fichas', updatedApertura);
      dispatch('saved', updatedApertura);

      fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedApertura)
      }).catch(() => {});

      triggerToast('Registro eliminado con éxito', 'success');
    } catch (err) {
      triggerToast('Error eliminando registro', 'error');
    }
  }
</script>

{#if modalVisible}
  <div class="modal-backdrop" on:click|self|preventDefault|stopPropagation={() => {}}>
    <div class="modal-card">
      <!-- Modal Header -->
      <div class="modal-header">
        <div>
          <div class="header-badges-row">
            <span class="header-badge">Control de Fichas</span>
            <span class="header-type-pill" class:pill-relleno={activeTipo === 'relleno'} class:pill-devolucion={activeTipo === 'devolucion'}>
              {activeTipo === 'relleno' ? 'Fill (Relleno de Mesa)' : 'Cred (Devolución de Mesa)'}
            </span>
          </div>
          <h3 class="header-main-title">
            {activeTipo === 'relleno' ? 'Fill (Relleno)' : 'Cred (Devolución)'}: 
            <span class="mesa-highlight">{mesa?.nombre || 'Mesa'}</span>
          </h3>
          <p class="header-sub">
            Juego: <strong class="mesa-sub-highlight">{mesa?.juego_nombre || 'Mesa en Vivo'}</strong>
            {#if mesa?.uuid}
              &bull; ID: <span class="mesa-id">#{mesa.uuid.slice(0, 8)}</span>
            {/if}
          </p>
        </div>
        <button type="button" class="btn-close" on:click={handleClose} title="Cerrar">✕</button>
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        {#if errorMessage}
          <div class="alert-error">
            <span>{errorMessage}</span>
          </div>
        {/if}

        <!-- Resumen de totales de este movimiento -->
        <div class="comparative-banner" class:banner-fill={activeTipo === 'relleno'} class:banner-cred={activeTipo === 'devolucion'}>
          <div class="comp-col">
            <span class="comp-label">{activeTipo === 'relleno' ? 'Total Fills (Rellenos)' : 'Total Credits (Devoluciones)'}</span>
            <span class="comp-val {activeTipo === 'relleno' ? 'text-blue' : 'text-purple'}">
              $ {formatMoney(activeTipo === 'relleno' ? totalRellenosMonto : totalDevolucionesMonto)}
            </span>
            <span class="comp-sub">{currentList.length} {currentList.length === 1 ? 'operación' : 'operaciones'}</span>
          </div>
          <div class="comp-sep">&bull;</div>
          <div class="comp-col">
            <span class="comp-label">Neto Mesa (R - D)</span>
            <span class="comp-val font-bold {netoMonto >= 0 ? 'text-blue' : 'text-purple'}">
              {netoMonto < 0 ? `( - $${formatMoney(Math.abs(netoMonto))} )` : `$ ${formatMoney(netoMonto)}`}
            </span>
            <span class="comp-sub">{allMovements.length} movs en total</span>
          </div>
        </div>

        <!-- Formulario para agregar nuevo movimiento -->
        <div class="form-section-box">
          <div class="form-section-header">
            <h4 class="form-section-title">
              Nuevo {activeTipo === 'relleno' ? 'Fill (Relleno)' : 'Cred (Devolución)'}: 
              <span class="badge-code" class:code-relleno={activeTipo === 'relleno'} class:code-devolucion={activeTipo === 'devolucion'}>
                {nextCodigo}
              </span>
            </h4>
            <div class="hora-input-container">
              <label for="input-rd-hora" class="hora-label">HORA:</label>
              <input id="input-rd-hora" type="time" class="hora-input" bind:value={hora} />
            </div>
          </div>

          <!-- Cuadrícula de denominaciones -->
          <div class="denoms-grid">
            {#each (availableDenominaciones || []) as denom}
              <div class="denom-card">
                <span class="denom-label">${denom}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  class="denom-input"
                  bind:value={formQuantities[denom]}
                />
                <span class="denom-subtotal">
                  $ {formatMoney((Math.max(0, parseInt(formQuantities[denom], 10) || 0)) * Number(denom))}
                </span>
              </div>
            {/each}
          </div>

          <!-- Total del formulario y botón de guardar -->
          <div class="form-actions-row">
            <div class="form-total-box">
              <span class="total-label">TOTAL {activeTipo === 'relleno' ? 'FILL' : 'CRED'} ({nextCodigo}):</span>
              <span class="total-monto {activeTipo === 'relleno' ? 'text-blue' : 'text-purple'}">
                $ {formatMoney(formTotal)}
              </span>
            </div>

            <div class="form-btn-group">
              <button 
                type="button" 
                class="btn-guardar-mov"
                class:btn-guardar-relleno={activeTipo === 'relleno'}
                class:btn-guardar-devolucion={activeTipo === 'devolucion'}
                disabled={isSaving || formTotal <= 0}
                on:click={handleGuardar}
              >
                {#if isSaving}
                  <span>Guardando...</span>
                {:else}
                  <span>+ Agregar {activeTipo === 'relleno' ? 'Fill' : 'Cred'} ({nextCodigo})</span>
                {/if}
              </button>
            </div>
          </div>
        </div>

        <!-- Tabla de historial de movimientos de este tipo -->
        <div class="history-section-box">
          <h4 class="history-title">
            Historial de {activeTipo === 'relleno' ? 'Fills (Rellenos)' : 'Credits (Devoluciones)'} de esta mesa
          </h4>

          {#if currentList.length === 0}
            <div class="empty-movs-box">
              <p>No hay {activeTipo === 'relleno' ? 'fills (rellenos)' : 'credits (devoluciones)'} registrados aún para esta mesa.</p>
            </div>
          {:else}
            <div class="table-container">
              <table class="rd-table">
                <thead>
                  <tr>
                    <th class="th-center th-code">Código</th>
                    <th class="th-center th-hora">Hora</th>
                    <th class="th-left th-desglose">Desglose de Fichas</th>
                    <th class="th-right th-total">Total</th>
                    <th class="th-center th-acc">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {#each currentList as mov, idx (mov.id || mov.uuid || idx)}
                    <tr>
                      <td class="td-center">
                        <span class="badge-code" class:code-relleno={mov.tipo === 'relleno'} class:code-devolucion={mov.tipo === 'devolucion'}>
                          {mov.codigo || (mov.tipo === 'relleno' ? `R${mov.numero}` : `D${mov.numero}`)}
                        </span>
                      </td>
                      <td class="td-center font-mono">{mov.hora || '—'}</td>
                      <td class="td-left desglose-cell">
                        {formatFichasDesglose(mov.fichas)}
                      </td>
                      <td class="td-right td-total-val font-mono font-bold {mov.tipo === 'relleno' ? 'text-blue' : 'text-purple'}">
                        $ {formatMoney(mov.total)}
                      </td>
                      <td class="td-center">
                        <button
                          type="button"
                          class="btn-delete-mov"
                          title="Eliminar este movimiento"
                          on:click={() => handleEliminarMovimiento(mov.id || mov.uuid)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button type="button" class="btn-cancelar" on:click={handleClose}>
          Cerrar
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
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 14px;
    width: 100%;
    max-width: 820px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    animation: modalScale 0.18s ease-out;
  }

  @keyframes modalScale {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* Header */
  .modal-header {
    padding: 16px 22px 14px 22px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: #f8fafc;
  }

  .header-badges-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .header-badge {
    display: inline-block;
    padding: 3px 8px;
    background: #e2e8f0;
    color: #475569;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .header-type-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 700;
  }

  .pill-relleno {
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
  }

  .pill-devolucion {
    background: #fbf5ff;
    color: #9333ea;
    border: 1px solid #e9d5ff;
  }

  .header-main-title {
    margin: 2px 0 3px 0;
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
  }

  .mesa-highlight {
    color: #0284c7;
  }

  .header-sub {
    margin: 0;
    font-size: 12px;
    color: #64748b;
  }

  .mesa-sub-highlight {
    color: #334155;
  }

  .mesa-id {
    font-family: monospace;
    color: #94a3b8;
  }

  .btn-close {
    background: transparent;
    border: none;
    font-size: 20px;
    line-height: 1;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-close:hover {
    color: #0f172a;
    background: #e2e8f0;
  }

  /* Body */
  .modal-body {
    padding: 16px 22px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .alert-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
  }

  /* Comparative Banner */
  .comparative-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 18px;
  }

  .banner-fill {
    background: #f0f7ff;
    border-color: #bfdbfe;
  }

  .banner-cred {
    background: #faf5ff;
    border-color: #e9d5ff;
  }

  .comp-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .comp-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
  }

  .comp-val {
    font-size: 16px;
    font-weight: 800;
    font-family: monospace;
    font-variant-numeric: tabular-nums;
  }

  .comp-sub {
    font-size: 11px;
    color: #94a3b8;
  }

  .comp-sep {
    font-size: 14px;
    font-weight: 700;
    color: #94a3b8;
  }

  .text-blue {
    color: #2563eb !important;
  }

  .text-purple {
    color: #9333ea !important;
  }

  /* Form Section Box */
  .form-section-box {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 14px 18px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .form-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .form-section-title {
    margin: 0;
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-code {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
    font-family: monospace;
  }

  .code-relleno {
    background: #dbeafe;
    color: #1e40af;
  }

  .code-devolucion {
    background: #f3e8ff;
    color: #7e22ce;
  }

  .hora-input-container {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hora-label {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
  }

  .hora-input {
    padding: 4px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
  }

  /* Denominations Grid */
  .denoms-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }

  .denom-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .denom-label {
    font-size: 12px;
    font-weight: 800;
    color: #0f172a;
  }

  .denom-input {
    width: 100%;
    text-align: center;
    padding: 6px 4px;
    border: 1.5px solid #cbd5e1;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    font-family: monospace;
  }

  .denom-input:focus {
    outline: none;
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  }

  .denom-subtotal {
    font-size: 10.5px;
    font-weight: 700;
    color: #64748b;
    font-family: monospace;
  }

  /* Form Actions Row */
  .form-actions-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid #e2e8f0;
    padding-top: 12px;
  }

  .form-total-box {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .total-label {
    font-size: 12px;
    font-weight: 800;
    color: #475569;
  }

  .total-monto {
    font-size: 18px;
    font-weight: 800;
    font-family: monospace;
  }

  .btn-guardar-mov {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 9px 18px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
    color: #ffffff;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-guardar-relleno {
    background: #2563eb;
  }

  .btn-guardar-relleno:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-guardar-devolucion {
    background: #9333ea;
  }

  .btn-guardar-devolucion:hover:not(:disabled) {
    background: #7e22ce;
  }

  .btn-guardar-mov:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* History Section */
  .history-section-box {
    border-top: 1px solid #e2e8f0;
    padding-top: 12px;
  }

  .history-title {
    margin: 0 0 10px 0;
    font-size: 13px;
    font-weight: 800;
    color: #334155;
  }

  .empty-movs-box {
    padding: 16px;
    text-align: center;
    color: #94a3b8;
    font-size: 12.5px;
    font-style: italic;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px dashed #cbd5e1;
  }

  .table-container {
    overflow-x: auto;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
  }

  .rd-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .rd-table th {
    background: #0f172a;
    color: #ffffff;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .rd-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
  }

  .th-center, .td-center {
    text-align: center;
  }

  .th-right, .td-right {
    text-align: right;
  }

  .th-left, .td-left {
    text-align: left;
  }

  .desglose-cell {
    font-size: 11.5px;
    color: #475569;
  }

  .btn-delete-mov {
    background: transparent;
    border: none;
    color: #ef4444;
    font-weight: bold;
    cursor: pointer;
    font-size: 13px;
    padding: 3px 6px;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .btn-delete-mov:hover {
    background: #fee2e2;
  }

  /* Footer */
  .modal-footer {
    padding: 12px 22px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    background: #f8fafc;
  }

  .btn-cancelar {
    padding: 8px 18px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancelar:hover {
    background: #f1f5f9;
    color: #0f172a;
  }
</style>
