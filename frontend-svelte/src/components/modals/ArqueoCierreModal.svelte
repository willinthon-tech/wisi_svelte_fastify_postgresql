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
  export let cierreRecord = null;
  export let availableDenominaciones = [];

  $: modalVisible = show || isOpen;

  const dispatch = createEventDispatcher();

  let isSaving = false;
  let errorMessage = '';
  let observaciones = '';
  let rows = [];

  $: if (modalVisible && mesa) {
    initModalData();
  }

  function initModalData() {
    errorMessage = '';
    observaciones = cierreRecord?.observaciones || '';

    // Mapa de cantidades en apertura
    const aperturaMap = new Map();
    const aperturaFichas = Array.isArray(aperturaRecord?.fichas)
      ? aperturaRecord.fichas
      : (typeof aperturaRecord?.fichas === 'string' ? JSON.parse(aperturaRecord.fichas || '[]') : []);

    for (const f of aperturaFichas) {
      const v = Number(f.valor ?? f.denominacion);
      const c = Number(f.cantidad ?? 0);
      if (!isNaN(v) && v > 0) {
        aperturaMap.set(v, c);
      }
    }

    // Mapa de cantidades en cierre previo (si existe)
    const cierreMap = new Map();
    const cierreFichas = Array.isArray(cierreRecord?.fichas)
      ? cierreRecord.fichas
      : (typeof cierreRecord?.fichas === 'string' ? JSON.parse(cierreRecord.fichas || '[]') : []);

    for (const f of cierreFichas) {
      const v = Number(f.valor ?? f.denominacion);
      const c = Number(f.cantidad ?? 0);
      if (!isNaN(v) && v > 0) {
        cierreMap.set(v, c);
      }
    }

    // Combinar denominaciones disponibles ordenadas de mayor a menor
    const denomsSet = new Set();
    for (const d of (availableDenominaciones || [])) {
      const num = Number(typeof d === 'object' ? (d.valor ?? d.denominacion) : d);
      if (!isNaN(num) && num > 0) denomsSet.add(num);
    }
    for (const v of aperturaMap.keys()) {
      denomsSet.add(v);
    }
    for (const v of cierreMap.keys()) {
      denomsSet.add(v);
    }

    const sortedDenoms = Array.from(denomsSet).sort((a, b) => b - a);

    rows = sortedDenoms.map(valor => {
      const cantApertura = aperturaMap.get(valor) || 0;
      const cantCierre = cierreMap.has(valor) ? cierreMap.get(valor) : (cantApertura > 0 ? '' : 0);
      return {
        valor,
        cantApertura,
        cantCierre: cantCierre !== '' ? cantCierre : ''
      };
    });
  }

  // Cálculos en tiempo real
  $: allMovements = (() => {
    const raw = aperturaRecord?.rellenos_devoluciones || cierreRecord?.rellenos_devoluciones || [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return []; }
    }
    return [];
  })();

  $: totalRellenosMonto = allMovements.filter(m => m.tipo === 'relleno').reduce((acc, m) => acc + (Number(m.total) || 0), 0);
  $: totalDevolucionesMonto = allMovements.filter(m => m.tipo === 'devolucion').reduce((acc, m) => acc + (Number(m.total) || 0), 0);

  $: totalApertura = rows.reduce((acc, r) => acc + (Number(r.valor) * (Number(r.cantApertura) || 0)), 0);
  $: totalCierre = rows.reduce((acc, r) => acc + (Number(r.valor) * (Number(r.cantCierre) || 0)), 0);
  // Diferencia Neta = (Total Cierre + Total Devoluciones) - (Total Apertura + Total Rellenos)
  $: diferenciaMonto = (totalCierre + totalDevolucionesMonto) - (totalApertura + totalRellenosMonto);

  function formatMoney(num) {
    if (isNaN(num)) return '0.00';
    return Number(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Generar etiqueta de encabezado de movimiento (FILL 1, FILL 2, CRED 1, etc.)
  function getMovHeader(mov) {
    if (!mov) return '';
    const sameType = allMovements.filter(m => m.tipo === mov.tipo);
    const pos = sameType.findIndex(m => (m.id || m.uuid) === (mov.id || mov.uuid));
    const num = pos !== -1 ? (pos + 1) : (mov.numero || (mov.codigo ? String(mov.codigo).replace(/[^0-9]/g, '') : 1));
    return mov.tipo === 'relleno' ? `FILL ${num}` : `CRED ${num}`;
  }

  function handleClose() {
    dispatch('close');
  }

  async function handleGuardar() {
    errorMessage = '';
    isSaving = true;

    try {
      const lId = libro?.uuid || libroId || libro?.id;
      const mId = mesa?.uuid || mesa?.id;
      if (!lId) throw new Error('ID de Libro inválido');
      if (!mId) throw new Error('Mesa no seleccionada');

      const fichasPayload = rows.map(r => ({
        valor: Number(r.valor),
        cantidad: Math.max(0, parseInt(r.cantCierre, 10) || 0),
        total: Number(r.valor) * Math.max(0, parseInt(r.cantCierre, 10) || 0)
      })).filter(f => f.valor > 0).sort((a, b) => b.valor - a.valor);

      const recordUuid = cierreRecord?.uuid || cierreRecord?.id || generateSafeUuid();

      const newCierreRecord = {
        uuid: recordUuid,
        id: recordUuid,
        libro_uuid: lId,
        libro_id: lId,
        mesa_uuid: mId,
        mesa_id: mId,
        multisala_uuid: multisalaUuid || null,
        tipo: 'cierre',
        fichas: fichasPayload,
        rellenos_devoluciones: allMovements,
        total: totalCierre,
        observaciones: observaciones ? observaciones.trim() : null,
        mesa_nombre: mesa.nombre || '',
        juego_nombre: mesa.juego_nombre || '',
        updated_at: new Date().toISOString()
      };

      // 1. Guardar en local DB (<5ms)
      await upsertLocalItem('libro_arqueo_fichas', newCierreRecord);

      // Notificar al padre inmediatamente para respuesta instantánea (0ms)
      dispatch('saved', newCierreRecord);

      // 2. Sincronizar en segundo plano con el backend
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'libro_arqueo_fichas',
          action: 'save',
          endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
          method: 'POST',
          payload: newCierreRecord,
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
              body: JSON.stringify(newCierreRecord),
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
            console.warn('[ArqueoModal] Encolando en Outbox:', syncErr);
            await queueOutboxAction({
              entity: 'libro_arqueo_fichas',
              action: 'save',
              endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
              method: 'POST',
              payload: newCierreRecord,
              uuid: recordUuid
            });
          }
        })();
      }

      triggerToast(`Cierre de mesa "${mesa.nombre}" guardado con éxito ($${formatMoney(totalCierre)}).`, 'success');
      handleClose();
    } catch (err) {
      console.error('Error guardando cierre de mesa:', err);
      errorMessage = err.message || 'Error al guardar el cierre';
      triggerToast(errorMessage, 'error');
    } finally {
      isSaving = false;
    }
  }
</script>

{#if modalVisible}
  <div class="modal-backdrop" on:click|self|preventDefault|stopPropagation={() => {}}>
    <div class="modal-card">
      <!-- Modal Header -->
      <div class="modal-header">
        <div>
          <span class="header-badge">Control de Cierre</span>
          <h3 class="header-main-title">
            Cierre: <span class="mesa-highlight">{mesa?.nombre || 'Mesa'}</span>
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

        <!-- Resumen comparativo de totales -->
        <div class="comparative-banner">
          <div class="comp-col">
            <span class="comp-label">Total Apertura</span>
            <span class="comp-val apertura">$ {formatMoney(totalApertura)}</span>
          </div>
          {#if totalRellenosMonto > 0}
            <div class="comp-sep">+</div>
            <div class="comp-col">
              <span class="comp-label">Rellenos (R)</span>
              <span class="comp-val text-blue">$ {formatMoney(totalRellenosMonto)}</span>
            </div>
          {/if}
          {#if totalDevolucionesMonto > 0}
            <div class="comp-sep">-</div>
            <div class="comp-col">
              <span class="comp-label">Devoluciones (D)</span>
              <span class="comp-val text-purple">$ {formatMoney(totalDevolucionesMonto)}</span>
            </div>
          {/if}
          <div class="comp-sep">➔</div>
          <div class="comp-col">
            <span class="comp-label">Total Cierre</span>
            <span class="comp-val cierre">$ {formatMoney(totalCierre)}</span>
          </div>
          <div class="comp-sep">=</div>
          <div class="comp-col">
            <span class="comp-label">Diferencia Neta</span>
            <span 
              class="comp-val diff" 
              class:positive={diferenciaMonto > 0} 
              class:negative={diferenciaMonto < 0}
              class:neutral={diferenciaMonto === 0}
            >
              {diferenciaMonto < 0 ? `( - $${formatMoney(Math.abs(diferenciaMonto))} )` : `$ ${formatMoney(diferenciaMonto)}`}
            </span>
          </div>
        </div>

        {#if rows.length === 0}
          <div class="empty-chips-box">
            <p>No se encontraron fichas configuradas para esta sala.</p>
          </div>
        {:else}
          <!-- Tabla de fichas ordenadas de mayor a menor -->
          <div class="table-container">
            <table class="cierre-table">
              <thead>
                <tr>
                  <th class="th-denom">Ficha</th>
                  <th class="th-center">Cant. Apertura</th>
                  {#each allMovements as mov}
                    <th class="th-center th-mov-header" class:th-mov-relleno={mov.tipo === 'relleno'} class:th-mov-devolucion={mov.tipo === 'devolucion'} title="{mov.tipo === 'relleno' ? 'Relleno' : 'Devolución'} {getMovHeader(mov)}: $ {formatMoney(mov.total)}">
                      {getMovHeader(mov)}
                    </th>
                  {/each}
                  <th class="th-center">Cant. Cierre</th>
                  <th class="th-right">Subtotal</th>
                  <th class="th-center">Dif. Fichas</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as r (r.valor)}
                  {@const rellenosChips = allMovements.filter(m => m.tipo === 'relleno').reduce((acc, m) => acc + ((m.fichas || []).find(f => Number(f.valor ?? f.denominacion) === Number(r.valor))?.cantidad || 0), 0)}
                  {@const devolucionesChips = allMovements.filter(m => m.tipo === 'devolucion').reduce((acc, m) => acc + ((m.fichas || []).find(f => Number(f.valor ?? f.denominacion) === Number(r.valor))?.cantidad || 0), 0)}
                  {@const expectedChips = (Number(r.cantApertura) || 0) + rellenosChips - devolucionesChips}
                  {@const difChips = (Number(r.cantCierre) || 0) - expectedChips}
                  {@const subtotal = Number(r.valor) * (Number(r.cantCierre) || 0)}
                  <tr>
                    <td class="td-denom">
                      <span class="chip-badge">${r.valor}</span>
                    </td>
                    <td class="td-center">
                      <span class="apertura-badge">{r.cantApertura || 0}</span>
                    </td>
                    {#each allMovements as mov}
                      {@const mCount = (mov.fichas || []).find(f => Number(f.valor ?? f.denominacion) === Number(r.valor))?.cantidad || 0}
                      <td class="td-center count-rd-cell" class:cell-relleno={mov.tipo === 'relleno'} class:cell-devolucion={mov.tipo === 'devolucion'}>
                        {#if mCount > 0}
                          <span class="badge-mov-count {mov.tipo === 'relleno' ? 'badge-r-count' : 'badge-d-count'}">
                            {mCount}
                          </span>
                        {:else}
                          <span class="zero-dash">—</span>
                        {/if}
                      </td>
                    {/each}
                    <td class="td-center">
                      <input 
                        type="number" 
                        min="0" 
                        step="1"
                        placeholder="0"
                        class="input-cierre"
                        bind:value={r.cantCierre}
                      />
                    </td>
                    <td class="td-right subtotal-cell font-mono font-bold">
                      $ {formatMoney(subtotal)}
                    </td>
                    <td class="td-center">
                      <span 
                        class="diff-chips-badge"
                        class:diff-pos={difChips > 0}
                        class:diff-neg={difChips < 0}
                      >
                        {Math.abs(difChips)}
                      </span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <!-- Observaciones -->
        <div class="obs-group">
          <label for="cierre-obs" class="obs-label">Observaciones (Opcional):</label>
          <input 
            id="cierre-obs"
            type="text" 
            class="obs-input" 
            placeholder="Novedad o detalle relevante sobre el arqueo de cierre..."
            bind:value={observaciones}
          />
        </div>
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
        <button 
          type="button" 
          class="btn-save-cierre" 
          on:click={handleGuardar}
          disabled={isSaving || rows.length === 0}
        >
          {#if isSaving}
            <span>Guardando...</span>
          {:else}
            <span>Guardar Cierre</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
    animation: fadeIn 0.2s ease-out;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 820px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    animation: slideUp 0.22s ease-out;
  }

  .modal-header {
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 24px 16px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .header-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #4f46e5;
    background: #eef2ff;
    padding: 2px 8px;
    border-radius: 6px;
    margin-bottom: 4px;
    letter-spacing: 0.5px;
  }

  .header-main-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
  }

  .mesa-highlight {
    color: #2563eb;
  }

  .header-sub {
    margin: 4px 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .mesa-sub-highlight {
    color: #334155;
  }

  .mesa-id {
    font-family: monospace;
    font-size: 12px;
    color: #94a3b8;
  }

  .btn-close {
    background: transparent;
    border: none;
    font-size: 18px;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-close:hover {
    color: #0f172a;
    background: #e2e8f0;
  }

  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .alert-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
  }

  /* Comparativa de Totales */
  .comparative-banner {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 12px 18px;
  }

  .comp-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .comp-label {
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.5px;
  }

  .comp-val {
    font-size: 16px;
    font-weight: 800;
  }

  .comp-val.apertura {
    color: #0284c7;
  }

  .comp-val.cierre {
    color: #4f46e5;
  }

  .comp-val.diff.positive {
    color: #16a34a;
  }

  .comp-val.diff.negative {
    color: #dc2626;
  }

  .comp-val.diff.neutral {
    color: #64748b;
  }

  .comp-sep {
    font-size: 16px;
    font-weight: 700;
    color: #94a3b8;
  }

  /* Tabla de Cierre */
  .table-container {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    max-height: 320px;
    overflow-y: auto;
    position: relative;
  }

  .cierre-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .cierre-table thead {
    background: #0f172a;
    color: #ffffff;
  }

  .cierre-table th {
    position: sticky;
    top: 0;
    z-index: 5;
    background: #0f172a;
    padding: 10px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .th-denom {
    text-align: left;
  }

  .th-center {
    text-align: center;
  }

  .th-right {
    text-align: right;
  }

  .cierre-table tbody tr {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s;
  }

  .cierre-table tbody tr:hover {
    background: #f8fafc;
  }

  .cierre-table td {
    padding: 8px 12px;
    vertical-align: middle;
  }

  .td-denom {
    text-align: left;
  }

  .td-center {
    text-align: center;
  }

  .td-right {
    text-align: right;
  }

  .chip-badge {
    display: inline-block;
    background: #1e293b;
    color: #f8fafc;
    font-weight: 800;
    font-size: 13px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 2px solid #e2e8f0;
  }

  .apertura-badge {
    display: inline-block;
    background: #e0f2fe;
    color: #0369a1;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    min-width: 28px;
  }

  .input-cierre {
    width: 80px;
    text-align: center;
    padding: 6px 8px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
    transition: all 0.15s;
  }

  .input-cierre:focus {
    border-color: #4f46e5;
    outline: none;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
  }

  .subtotal-cell {
    font-weight: 700;
    color: #334155;
  }

  .diff-chips-badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 6px;
    color: #64748b;
    background: #f1f5f9;
  }

  .diff-chips-badge.diff-pos {
    color: #16a34a;
    background: #dcfce7;
  }

  .diff-chips-badge.diff-neg {
    color: #dc2626;
    background: #fee2e2;
  }

  /* Observaciones */
  .obs-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .obs-label {
    font-size: 12px;
    font-weight: 700;
    color: #475569;
  }

  .obs-input {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    color: #1e293b;
    box-sizing: border-box;
  }

  .obs-input:focus {
    border-color: #2563eb;
    outline: none;
  }

  /* Footer */
  .modal-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    padding: 16px 24px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .btn-cancel {
    padding: 9px 18px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    color: #475569;
    font-weight: 600;
    font-size: 13px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancel:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-save-cierre {
    padding: 9px 20px;
    background: #16a34a;
    border: none;
    color: #ffffff;
    font-weight: 700;
    font-size: 13px;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);
    transition: all 0.15s;
  }

  .btn-save-cierre:hover:not(:disabled) {
    background: #15803d;
  }

  .btn-save-cierre:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .text-blue { color: #2563eb !important; }
  .text-purple { color: #9333ea !important; }

  .th-mov-header {
    background: #1e293b;
    font-size: 11px;
    font-weight: 800;
    padding: 8px 8px;
    min-width: 65px;
    white-space: nowrap;
    text-align: center;
    letter-spacing: 0.3px;
  }
  .th-mov-relleno {
    color: #60a5fa !important;
  }
  .th-mov-devolucion {
    color: #c084fc !important;
  }

  .count-rd-cell {
    padding: 6px 4px !important;
    min-width: 65px;
  }

  .badge-mov-count {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 800;
    font-family: monospace;
  }
  .badge-r-count {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }
  .badge-d-count {
    background: #faf5ff;
    color: #7e22ce;
    border: 1px solid #e9d5ff;
  }

  .zero-dash {
    color: #cbd5e1;
    font-weight: 700;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { transform: translateY(12px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>

