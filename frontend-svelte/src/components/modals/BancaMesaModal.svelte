<script>
  import { createEventDispatcher } from 'svelte';
  import { masterSalasStore, masterMesasActions } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  export let show = false;
  export let isOpen = false;
  export let mesa = null;

  $: modalVisible = show || isOpen;

  const dispatch = createEventDispatcher();

  let isSaving = false;
  let errorMessage = '';

  // Rows of fichas with their quantities
  let rows = [];

  $: salaUuid = mesa?.sala_uuid || mesa?.sala_id || null;
  $: currentSala = ($masterSalasStore || []).find(
    s => String(s.uuid) === String(salaUuid) || String(s.id) === String(salaUuid)
  );

  $: salaNombre = currentSala?.nombre || mesa?.sala_nombre || 'Sala';
  $: juegoNombre = mesa?.juego_nombre || 'Juego en Vivo';

  $: if (modalVisible && mesa) {
    initBanca();
  }

  function getFichasFromSala(sala) {
    if (!sala || !sala.fichas) return [];
    let raw = [];
    if (Array.isArray(sala.fichas)) {
      raw = sala.fichas;
    } else if (typeof sala.fichas === 'string') {
      try {
        raw = JSON.parse(sala.fichas);
      } catch (e) {
        raw = [];
      }
    }
    return (Array.isArray(raw) ? raw : [])
      .map(f => {
        if (typeof f === 'number' || (typeof f === 'string' && !isNaN(Number(f)))) {
          return { valor: Number(f) };
        }
        if (f && typeof f === 'object') {
          const v = Number(f.valor ?? f.value ?? f.denominacion);
          return { valor: isNaN(v) ? 0 : v };
        }
        return null;
      })
      .filter(f => f && !isNaN(f.valor) && f.valor > 0)
      // Ordenar estrictamente de mayor a menor (mayor arriba, menor abajo)
      .sort((a, b) => Number(b.valor) - Number(a.valor));
  }

  function initBanca() {
    errorMessage = '';
    const salaFichas = getFichasFromSala(currentSala);

    // Parse existing mesa banca
    let existingBanca = [];
    if (Array.isArray(mesa?.banca)) {
      existingBanca = mesa.banca;
    } else if (typeof mesa?.banca === 'string') {
      try {
        existingBanca = JSON.parse(mesa.banca);
      } catch (e) {
        existingBanca = [];
      }
    }

    const bancaMap = new Map();
    for (const b of (Array.isArray(existingBanca) ? existingBanca : [])) {
      const v = Number(b.valor ?? b.denominacion);
      const c = Number(b.cantidad ?? 0);
      if (!isNaN(v) && v > 0) {
        bancaMap.set(v, isNaN(c) ? 0 : c);
      }
    }

    // Build rows from salaFichas
    const builtRows = salaFichas.map(f => ({
      valor: f.valor,
      cantidad: bancaMap.has(f.valor) ? bancaMap.get(f.valor) : 0
    }));

    // If there were any saved banca items whose denomination is not currently in sala, keep them too
    for (const [v, c] of bancaMap.entries()) {
      if (!builtRows.some(r => Number(r.valor) === v)) {
        builtRows.push({ valor: v, cantidad: c });
      }
    }

    // Ordenar estrictamente de mayor a menor (mayor arriba, menor abajo)
    builtRows.sort((a, b) => Number(b.valor) - Number(a.valor));
    rows = builtRows;
  }

  $: totalFichasCount = rows.reduce((acc, r) => acc + (Number(r.cantidad) || 0), 0);
  $: totalMontoBanca = rows.reduce((acc, r) => acc + ((Number(r.cantidad) || 0) * Number(r.valor)), 0);

  function formatMoney(num) {
    const val = Number(num);
    if (isNaN(val)) return '0';
    return val.toLocaleString('en-US', {
      minimumFractionDigits: val % 1 !== 0 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function handleCantidadChange(index, newQty) {
    let q = parseInt(newQty, 10);
    if (isNaN(q) || q < 0) q = 0;
    rows[index].cantidad = q;
    rows = [...rows];
  }

  function stepCantidad(index, delta) {
    let current = Number(rows[index].cantidad) || 0;
    let next = Math.max(0, current + delta);
    rows[index].cantidad = next;
    rows = [...rows];
  }

  function handleResetZero() {
    rows = rows.map(r => ({ ...r, cantidad: 0 }));
  }

  async function handleSave() {
    errorMessage = '';
    isSaving = true;

    try {
      // Ordenar de mayor a menor y preparar estructura limpia
      const bancaPayload = rows
        .map(r => ({
          valor: Number(r.valor),
          cantidad: Math.max(0, parseInt(r.cantidad, 10) || 0),
          subtotal: Number(r.valor) * Math.max(0, parseInt(r.cantidad, 10) || 0)
        }))
        .filter(r => !isNaN(r.valor) && r.valor > 0)
        .sort((a, b) => Number(b.valor) - Number(a.valor));

      const targetUuid = mesa.uuid || mesa.id;
      const updatedData = {
        ...mesa,
        banca: bancaPayload
      };

      await masterMesasActions.update(targetUuid, updatedData);

      triggerToast(
        `Banca de la mesa "${mesa.nombre}" guardada con éxito ($${formatMoney(totalMontoBanca)}).`,
        'success'
      );

      dispatch('saved', { uuid: targetUuid, banca: bancaPayload });
      handleClose();
    } catch (err) {
      console.error('Error guardando banca de mesa:', err);
      errorMessage = `Error al guardar: ${err.message || 'Error del servidor'}`;
      triggerToast(errorMessage, 'error');
    } finally {
      isSaving = false;
    }
  }

  function handleClose() {
    dispatch('close');
  }
</script>

{#if modalVisible}
  <!-- Backdrop does NOT close modal on click -->
  <div class="modal-backdrop" on:click|self|preventDefault|stopPropagation={() => {}}>
    <div class="modal-card">
      <!-- Modal Header -->
      <div class="modal-header">
        <div>
          <span class="header-badge">
            Inventario de Banca
          </span>
          <h3 class="header-main-title">
            Banca: <span class="mesa-highlight">{mesa?.nombre || 'Mesa'}</span>
          </h3>
          <p class="header-sub">
            Sala: <strong class="mesa-sub-highlight">{salaNombre}</strong>
            &bull; Juego: <strong class="mesa-sub-highlight">{juegoNombre}</strong>
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

        {#if rows.length === 0}
          <!-- Sin fichas en la sala -->
          <div class="alert-warning-box">
            <div class="warning-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <div class="warning-content">
              <span class="warning-title">Sala sin Fichas Configuradas</span>
              <span class="warning-desc">
                La sala <strong>"{salaNombre}"</strong> no tiene denominaciones de fichas configuradas todavía.
                Para ingresar cantidades de banca para esta mesa, primero configura las fichas de la sala en:
                <strong>Administración &gt; Salas &gt; Botón "Fichas"</strong>.
              </span>
            </div>
          </div>
        {:else}
          <!-- Banner resumen en vivo -->
          <div class="banca-summary-banner">
            <div class="summary-metric">
              <span class="metric-label">TOTAL FICHAS EN BANCA</span>
              <span class="metric-value chips-count">{totalFichasCount.toLocaleString('en-US')} <small>uds.</small></span>
            </div>
            <div class="summary-divider"></div>
            <div class="summary-metric">
              <span class="metric-label">MONTO TOTAL DE BANCA</span>
              <span class="metric-value total-money">${formatMoney(totalMontoBanca)}</span>
            </div>
          </div>

          <!-- Acciones de barra -->
          <div class="table-toolbar">
            <span class="table-caption">
              Fichas de <strong>{salaNombre}</strong> (ordenadas de mayor a menor):
            </span>
            {#if totalFichasCount > 0}
              <button type="button" class="btn-clear-zero" on:click={handleResetZero} title="Poner todas las cantidades en 0">
                Poner en cero
              </button>
            {/if}
          </div>

          <!-- Tabla de Fichas de la Mesa -->
          <div class="table-container">
            <table class="banca-table">
              <thead>
                <tr>
                  <th style="width: 45px; text-align: center;">#</th>
                  <th>Denominación / Ficha</th>
                  <th style="width: 170px; text-align: center;">Cantidad</th>
                  <th style="width: 140px; text-align: right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as row, index (row.valor)}
                  {@const subtotal = (Number(row.cantidad) || 0) * Number(row.valor)}
                  <tr class="table-row {row.cantidad > 0 ? 'has-chips' : ''}">
                    <td class="col-index">{index + 1}</td>
                    <td class="col-ficha">
                      <div class="ficha-badge">
                        <span class="ficha-chip-dot"></span>
                        ${formatMoney(row.valor)}
                      </div>
                    </td>
                    <td class="col-cantidad">
                      <div class="qty-stepper">
                        <button
                          type="button"
                          class="btn-step minus"
                          on:click={() => stepCantidad(index, -1)}
                          title="Restar 1"
                          disabled={row.cantidad <= 0}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          class="input-qty"
                          bind:value={row.cantidad}
                          on:input={(e) => handleCantidadChange(index, e.target.value)}
                          on:focus={(e) => e.target.select()}
                        />
                        <button
                          type="button"
                          class="btn-step plus"
                          on:click={() => stepCantidad(index, 1)}
                          title="Sumar 1"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td class="col-subtotal">
                      <span class="subtotal-amount {subtotal > 0 ? 'active' : ''}">
                        ${formatMoney(subtotal)}
                      </span>
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td colspan="2" class="total-label">TOTALES:</td>
                  <td class="total-qty">{totalFichasCount.toLocaleString('en-US')} fichas</td>
                  <td class="total-amount">${formatMoney(totalMontoBanca)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button
          type="button"
          class="btn-cancel"
          on:click={handleClose}
          disabled={isSaving}
        >
          Cancelar
        </button>
        {#if rows.length > 0}
          <button
            type="button"
            class="btn-save"
            on:click={handleSave}
            disabled={isSaving}
          >
            {#if isSaving}
              <span class="spinner"></span> Guardando...
            {:else}
              Guardar Cambios
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 16px;
    max-width: 620px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    border: 1px solid #e2e8f0;
    overflow: hidden;
    animation: slideUp 0.18s ease-out;
    font-family: inherit;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 22px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    color: #047857;
    font-size: 11px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .header-main-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
  }

  .mesa-highlight {
    color: #059669;
  }

  .header-sub {
    margin: 4px 0 0 0;
    font-size: 12.5px;
    color: #64748b;
  }

  .mesa-sub-highlight {
    color: #1e293b;
  }

  .mesa-id {
    font-family: monospace;
    font-weight: 700;
    color: #475569;
  }

  .btn-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-close:hover {
    background: #fee2e2;
    color: #ef4444;
    border-color: #fca5a5;
  }

  .modal-body {
    padding: 20px 22px;
    overflow-y: auto;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .alert-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
  }

  /* Warning box when sala has no fichas */
  .alert-warning-box {
    display: flex;
    align-items: flex-start;
    padding: 16px 18px;
    background: #fffbeb;
    border: 1.5px solid #fde68a;
    border-radius: 12px;
    gap: 12px;
  }

  .warning-icon {
    color: #d97706;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .warning-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .warning-title {
    font-size: 13.5px;
    font-weight: 800;
    color: #92400e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .warning-desc {
    font-size: 12.5px;
    color: #b45309;
    line-height: 1.45;
  }

  /* Summary Banner */
  .banca-summary-banner {
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 14px 18px;
    background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
    border: 1.5px solid #a7f3d0;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .summary-metric {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .metric-label {
    font-size: 11px;
    font-weight: 800;
    color: #047857;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .metric-value {
    font-size: 20px;
    font-weight: 900;
  }

  .metric-value.chips-count {
    color: #1e293b;
  }

  .metric-value.chips-count small {
    font-size: 12px;
    font-weight: 700;
    color: #64748b;
  }

  .metric-value.total-money {
    color: #059669;
  }

  .summary-divider {
    width: 1px;
    height: 38px;
    background: #a7f3d0;
  }

  /* Toolbar */
  .table-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: #475569;
  }

  .table-caption {
    font-weight: 600;
  }

  .btn-clear-zero {
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-clear-zero:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #94a3b8;
  }

  /* Table */
  .table-container {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    max-height: 320px;
    overflow-y: auto;
  }

  .banca-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .banca-table th {
    background: #f1f5f9;
    color: #475569;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 10px 12px;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
    position: sticky;
    top: 0;
    z-index: 2;
  }

  .table-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .table-row:hover {
    background: #f8fafc;
  }

  .table-row.has-chips {
    background: #fafdfb;
  }

  .col-index {
    text-align: center;
    color: #64748b;
    font-family: monospace;
    font-weight: 700;
    padding: 8px 10px;
  }

  .col-ficha {
    padding: 8px 12px;
  }

  .ficha-badge {
    background: #ecfdf5;
    color: #065f46;
    border: 1.5px solid #a7f3d0;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .ficha-chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #059669;
    display: inline-block;
  }

  .col-cantidad {
    text-align: center;
    padding: 6px 10px;
  }

  .qty-stepper {
    display: inline-flex;
    align-items: center;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  }

  .btn-step {
    width: 28px;
    height: 28px;
    border: none;
    background: #f8fafc;
    color: #334155;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    user-select: none;
  }

  .btn-step:hover:not(:disabled) {
    background: #e2e8f0;
    color: #0f172a;
  }

  .btn-step:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .input-qty {
    width: 58px;
    height: 28px;
    border: none;
    border-left: 1px solid #e2e8f0;
    border-right: 1px solid #e2e8f0;
    text-align: center;
    font-size: 13px;
    font-weight: 800;
    color: #1e293b;
    outline: none;
    padding: 0;
    background: transparent;
  }

  .input-qty::-webkit-inner-spin-button,
  .input-qty::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .input-qty {
    -moz-appearance: textfield;
  }

  .col-subtotal {
    text-align: right;
    padding: 8px 14px;
    font-weight: 800;
    font-size: 13px;
  }

  .subtotal-amount {
    color: #94a3b8;
  }

  .subtotal-amount.active {
    color: #059669;
  }

  /* Footer totals */
  .total-row {
    background: #f8fafc;
    border-top: 2px solid #e2e8f0;
    font-weight: 800;
  }

  .total-label {
    text-align: right;
    padding: 10px 14px;
    font-size: 12px;
    color: #475569;
    letter-spacing: 0.5px;
  }

  .total-qty {
    text-align: center;
    padding: 10px;
    color: #1e293b;
    font-size: 13px;
  }

  .total-amount {
    text-align: right;
    padding: 10px 14px;
    color: #059669;
    font-size: 14px;
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 14px 22px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    gap: 10px;
  }

  .btn-cancel {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #475569;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-save {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: #059669;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(5, 150, 105, 0.25);
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .btn-save:hover:not(:disabled) {
    background: #047857;
    box-shadow: 0 4px 8px rgba(5, 150, 105, 0.35);
  }

  .btn-save:disabled,
  .btn-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    display: inline-block;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
</style>

