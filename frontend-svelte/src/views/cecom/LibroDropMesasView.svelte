<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMesasStore, 
    masterSalasStore, 
    masterJuegosStore, 
    userSalasStore as masterUserSalasStore,
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  // Estado del formulario
  let selectedMesaId = '';
  let b100 = '';
  let b50 = '';
  let b20 = '';
  let b10 = '';
  let b5 = '';
  let b1 = '';
  let isSaving = false;

  // Lista de registros de drop
  let dropRecords = [];
  let isLoadingRecords = false;

  // Mesas cargadas del servidor o store
  let serverMesas = [];
  let isLoadingMesas = false;

  // Usuario y salas asignadas
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Filtrado de mesas asociadas a la sala del usuario logueado y a la sala del libro
  $: availableMesas = (() => {
    const list = (serverMesas && serverMesas.length > 0) ? serverMesas : ($masterMesasStore || []);
    return list.filter(m => {
      if ((m.active ?? 1) === 0) return false;

      // Si el libro tiene sala_id, debe coincidir con la sala del libro
      if (libro?.sala_id && Number(m.sala_id) !== Number(libro.sala_id)) {
        return false;
      }

      // Si el usuario logueado tiene salas asignadas, la mesa debe pertenecer a esas salas
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        const userSalaNums = assignedSalaIds.map(Number);
        if (!userSalaNums.includes(Number(m.sala_id))) {
          return false;
        }
      }

      return true;
    });
  })();

  // Formato de opción de mesa: BJ 1 - Blackjacks
  function formatMesaOptionLabel(m) {
    const juegoName = m.juego_nombre || ($masterJuegosStore || []).find(j => Number(j.id) === Number(m.juego_id))?.nombre || '';
    if (juegoName) {
      return `${m.nombre} - ${juegoName}`;
    }
    return m.nombre || `Mesa #${m.id}`;
  }

  // Encabezado oscuro de la tabla: Gan Casino PLC - 14/09/2026
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre_comercial || 'Sala';
    const dateFormatted = formatDateDisplay(libro?.descripcion);
    return `${salaName} - ${dateFormatted}`;
  })();

  function formatDateDisplay(d) {
    if (!d) return '—';
    const str = String(d).trim();
    const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      return `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}`;
    }
    const ddmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[1].padStart(2, '0')}/${ddmmyyyy[2].padStart(2, '0')}/${ddmmyyyy[3]}`;
    }
    return str;
  }

  // Totales calculados para el footer
  $: sum100 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_100 ?? r.b100 ?? 0) || 0), 0);
  $: sum50 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_50 ?? r.b50 ?? 0) || 0), 0);
  $: sum20 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_20 ?? r.b20 ?? 0) || 0), 0);
  $: sum10 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_10 ?? r.b10 ?? 0) || 0), 0);
  $: sum5 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_5 ?? r.b5 ?? 0) || 0), 0);
  $: sum1 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_1 ?? r.b1 ?? 0) || 0), 0);

  $: totalMoney100 = sum100 * 100;
  $: totalMoney50 = sum50 * 50;
  $: totalMoney20 = sum20 * 20;
  $: totalMoney10 = sum10 * 10;
  $: totalMoney5 = sum5 * 5;
  $: totalMoney1 = sum1 * 1;

  $: grandTotal = dropRecords.reduce((acc, r) => acc + (Number(r.total) || 0), 0);

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      fetchServerMesas(),
      loadDropRecords()
    ]);
  });

  // Reaccionar a cambios en libroId
  $: if (libroId) {
    loadDropRecords();
  }

  async function fetchServerMesas() {
    isLoadingMesas = true;
    try {
      const q = new URLSearchParams({ limit: '0', active: '1' });
      if (assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (libro?.sala_id) {
        q.set('sala_ids', String(libro.sala_id));
      }
      const res = await fetch(`/api/master/mesas?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          serverMesas = json.data;
        }
      }
    } catch (e) {
      console.warn('Error al cargar mesas del servidor:', e);
    } finally {
      isLoadingMesas = false;
    }
  }

  async function loadDropRecords() {
    const lId = libroId || libro?.id;
    if (!lId) return;
    isLoadingRecords = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/drop-mesas`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          dropRecords = json.data || [];
          if (selectedMesaId) {
            handleMesaChange();
          }
        }
      }
    } catch (err) {
      console.error('Error al cargar drop de mesas:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // Al cambiar la mesa seleccionada, si ya tiene registro guardado, cargar sus valores
  function handleMesaChange() {
    if (!selectedMesaId) {
      limpiarCampos();
      return;
    }

    const existing = dropRecords.find(r => Number(r.mesa_id) === Number(selectedMesaId));
    if (existing) {
      const v100 = Number(existing.denominacion_100 ?? existing.b100 ?? 0);
      const v50 = Number(existing.denominacion_50 ?? existing.b50 ?? 0);
      const v20 = Number(existing.denominacion_20 ?? existing.b20 ?? 0);
      const v10 = Number(existing.denominacion_10 ?? existing.b10 ?? 0);
      const v5 = Number(existing.denominacion_5 ?? existing.b5 ?? 0);
      const v1 = Number(existing.denominacion_1 ?? existing.b1 ?? 0);

      // Si es 0, dejar vacío para no mostrar ceros molestos
      b100 = v100 > 0 ? v100 : '';
      b50 = v50 > 0 ? v50 : '';
      b20 = v20 > 0 ? v20 : '';
      b10 = v10 > 0 ? v10 : '';
      b5 = v5 > 0 ? v5 : '';
      b1 = v1 > 0 ? v1 : '';
    } else {
      limpiarCampos();
    }
  }

  function limpiarCampos() {
    b100 = '';
    b50 = '';
    b20 = '';
    b10 = '';
    b5 = '';
    b1 = '';
  }

  function seleccionarMesaDesdeTabla(mesaId) {
    selectedMesaId = String(mesaId);
    handleMesaChange();
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    if (!selectedMesaId) {
      triggerToast('Seleccione una mesa para registrar el drop', 'warning');
      return;
    }

    isSaving = true;
    try {
      const payload = {
        mesa_id: Number(selectedMesaId),
        denominacion_100: Number(b100) || 0,
        denominacion_50: Number(b50) || 0,
        denominacion_20: Number(b20) || 0,
        denominacion_10: Number(b10) || 0,
        denominacion_5: Number(b5) || 0,
        denominacion_1: Number(b1) || 0
      };

      const res = await fetch(`/api/master/libros/${lId}/drop-mesas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro de drop guardado exitosamente', 'success');
        // Reset form
        selectedMesaId = '';
        limpiarCampos();

        await loadDropRecords();
      } else {
        triggerToast(json?.error || 'Error al guardar registro de drop', 'error');
      }
    } catch (err) {
      console.error('Error al guardar drop:', err);
      triggerToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminar(recordId) {
    const lId = libroId || libro?.id;
    if (!lId || !recordId) return;

    try {
      const res = await fetch(`/api/master/libros/${lId}/drop-mesas/${recordId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro eliminado correctamente', 'info');
        dropRecords = dropRecords.filter(r => Number(r.id) !== Number(recordId));
        if (selectedMesaId && !dropRecords.some(r => Number(r.mesa_id) === Number(selectedMesaId))) {
          limpiarCampos();
        }
      } else {
        triggerToast(json?.error || 'Error al eliminar registro', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar registro de drop:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }
</script>

<div class="drop-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Drop de Mesas" -->
  <div class="card-form-drop">
    <div class="card-title-box">
      <h3 class="card-title">Drop de Mesas</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="drop-form">
      <!-- Selector de Mesas -->
      <div class="form-group">
        <label for="select-mesa" class="form-label">Mesas:</label>
        <select 
          id="select-mesa" 
          class="form-select" 
          bind:value={selectedMesaId}
          on:change={handleMesaChange}
          required
        >
          <option value="">Seleccione una opción</option>
          {#each availableMesas as m}
            <option value={m.id}>
              {formatMesaOptionLabel(m)}
            </option>
          {/each}
        </select>
      </div>

      <!-- Denominaciones de Billetes en 2 Columnas -->
      <div class="denominaciones-grid">
        <!-- Fila 1: $100 y $50 -->
        <div class="denom-field">
          <label for="denom-100" class="denom-label">$ 100:</label>
          <input 
            id="denom-100" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b100} 
          />
        </div>
        <div class="denom-field">
          <label for="denom-50" class="denom-label">$ 50:</label>
          <input 
            id="denom-50" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b50} 
          />
        </div>

        <!-- Fila 2: $20 y $10 -->
        <div class="denom-field">
          <label for="denom-20" class="denom-label">$ 20:</label>
          <input 
            id="denom-20" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b20} 
          />
        </div>
        <div class="denom-field">
          <label for="denom-10" class="denom-label">$ 10:</label>
          <input 
            id="denom-10" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b10} 
          />
        </div>

        <!-- Fila 3: $5 y $1 -->
        <div class="denom-field">
          <label for="denom-5" class="denom-label">$ 5:</label>
          <input 
            id="denom-5" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b5} 
          />
        </div>
        <div class="denom-field">
          <label for="denom-1" class="denom-label">$ 1:</label>
          <input 
            id="denom-1" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b1} 
          />
        </div>
      </div>

      <!-- Botón Guardar -->
      <button 
        type="submit" 
        class="btn-guardar"
        disabled={isSaving}
      >
        {#if isSaving}
          <span>Guardando...</span>
        {:else}
          <span>Guardar</span>
        {/if}
      </button>
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Drop de Mesas -->
  <div class="card-table-drop">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <span>{tableHeaderTitle}</span>
    </div>

    <!-- Tabla de Contenido -->
    <div class="table-wrapper">
      <table class="drop-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-mesa">Mesa</th>
            <th class="th-center">$ 100</th>
            <th class="th-center">$ 50</th>
            <th class="th-center">$ 20</th>
            <th class="th-center">$ 10</th>
            <th class="th-center">$ 5</th>
            <th class="th-center">$ 1</th>
            <th class="th-center th-total">Total</th>
            <th class="th-center th-acciones">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords}
            <tr>
              <td colspan="10" class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando registros de drop...</span>
                </div>
              </td>
            </tr>
          {:else if dropRecords.length === 0}
            <tr>
              <td colspan="10" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">🎲</span>
                  <p class="empty-text">
                    La tabla de drop está vacía para esta fecha. Seleccione una mesa en el formulario de la izquierda e ingrese los billetes para agregar registros.
                  </p>
                </div>
              </td>
            </tr>
          {:else}
            {#each dropRecords as record, idx}
              {@const rec100 = Number(record.denominacion_100 ?? record.b100 ?? 0) || 0}
              {@const rec50 = Number(record.denominacion_50 ?? record.b50 ?? 0) || 0}
              {@const rec20 = Number(record.denominacion_20 ?? record.b20 ?? 0) || 0}
              {@const rec10 = Number(record.denominacion_10 ?? record.b10 ?? 0) || 0}
              {@const rec5 = Number(record.denominacion_5 ?? record.b5 ?? 0) || 0}
              {@const rec1 = Number(record.denominacion_1 ?? record.b1 ?? 0) || 0}
              {@const recTotal = Number(record.total) || 0}
              <tr 
                class="drop-row {Number(selectedMesaId) === Number(record.mesa_id) ? 'row-selected' : ''}"
                on:click={() => seleccionarMesaDesdeTabla(record.mesa_id)}
                title="Haga clic para cargar y editar esta mesa"
                style="cursor: pointer;"
              >
                <td class="td-center td-num">{idx + 1}</td>
                <td class="td-mesa">{record.mesa_nombre || `Mesa #${record.mesa_id}`}</td>
                <td class="td-center">{rec100}</td>
                <td class="td-center">{rec50}</td>
                <td class="td-center">{rec20}</td>
                <td class="td-center">{rec10}</td>
                <td class="td-center">{rec5}</td>
                <td class="td-center">{rec1}</td>
                <td class="td-center td-total-val">${recTotal.toFixed(2)}</td>
                <td class="td-center td-acciones">
                  <button 
                    type="button" 
                    class="btn-eliminar"
                    on:click|stopPropagation={() => handleEliminar(record.id)}
                    title="Eliminar este registro"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>

        <!-- Fila de Totales con línea separadora azul -->
        <tfoot>
          <tr class="divider-row">
            <td colspan="10" class="divider-cell"></td>
          </tr>
          <tr class="total-row">
            <td colspan="2" class="total-label-cell">TOTAL</td>
            <td class="td-center total-val-cell">$ {totalMoney100}</td>
            <td class="td-center total-val-cell">$ {totalMoney50}</td>
            <td class="td-center total-val-cell">$ {totalMoney20}</td>
            <td class="td-center total-val-cell">$ {totalMoney10}</td>
            <td class="td-center total-val-cell">$ {totalMoney5}</td>
            <td class="td-center total-val-cell">$ {totalMoney1}</td>
            <td class="td-center grand-total-cell">$ {grandTotal.toFixed(0)}</td>
            <td class="td-center"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</div>

<style>
  .drop-layout-grid {
    display: grid;
    grid-template-columns: 310px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .drop-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-drop {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card-title-box {
    margin-bottom: 2px;
  }

  .card-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: -0.2px;
  }

  .title-underline {
    margin-top: 8px;
    height: 2px;
    background: #3b82f6;
    width: 100%;
    border-radius: 2px;
  }

  .drop-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 13.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .form-select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .form-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Grilla de Denominaciones */
  .denominaciones-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
  }

  .denom-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .denom-label {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
  }

  .denom-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13.5px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .denom-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Botón Guardar Verde */
  .btn-guardar {
    width: 100%;
    margin-top: 4px;
    padding: 10px 16px;
    background-color: #5bb87e;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(91, 184, 126, 0.25);
  }

  .btn-guardar:hover:not(:disabled) {
    background-color: #4ca66e;
    box-shadow: 0 4px 8px rgba(91, 184, 126, 0.35);
  }

  .btn-guardar:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Derecha: Tabla
  ───────────────────────────────────────────────────────────── */
  .card-table-drop {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  /* Barra Superior Oscura */
  .table-top-bar {
    background: #54626f;
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    text-align: center;
    padding: 12px 16px;
    letter-spacing: 0.3px;
  }

  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }

  .drop-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  /* Cabeceras Oscuras */
  .drop-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .drop-table th {
    padding: 12px 14px;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .th-center {
    text-align: center;
  }

  .th-num {
    width: 50px;
  }

  .th-mesa {
    min-width: 100px;
  }

  .th-total {
    min-width: 90px;
  }

  .th-acciones {
    width: 95px;
  }

  /* Filas de la Tabla */
  .drop-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .drop-row:hover {
    background: #f8fafc;
  }

  .drop-row.row-selected {
    background: #e0f2fe !important;
  }

  .drop-table td {
    padding: 11px 14px;
    color: #1e293b;
    font-size: 13px;
    white-space: nowrap;
  }

  .td-center {
    text-align: center;
  }

  .td-mesa {
    font-weight: 600;
    color: #0f172a;
  }

  .td-total-val {
    font-weight: 600;
    color: #0f172a;
  }

  /* Botón Eliminar Rojo */
  .btn-eliminar {
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(220, 38, 38, 0.25);
  }

  .btn-eliminar:hover {
    background: #b91c1c;
  }

  /* Fila divisoria azul */
  .divider-row {
    height: 3px;
  }

  .divider-cell {
    padding: 0 !important;
    background: #3b82f6 !important;
    height: 3px;
  }

  /* Fila de Totales */
  .total-row {
    background: #f8fafc;
    font-weight: 700;
  }

  .total-row td {
    padding: 12px 14px;
    font-size: 13.5px;
    color: #0f172a;
  }

  .total-label-cell {
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    padding-left: 18px !important;
  }

  .total-val-cell {
    font-weight: 700;
    color: #0f172a;
  }

  .grand-total-cell {
    font-weight: 800;
    color: #16a34a !important;
    font-size: 14.5px;
  }

  /* Estados vacíos */
  .empty-state-cell {
    padding: 48px 24px !important;
    text-align: center;
    background: #fafafa;
  }

  .empty-msg-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 420px;
    margin: 0 auto;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-text {
    margin: 0;
    color: #64748b;
    font-size: 13.5px;
    line-height: 1.5;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #64748b;
    font-size: 13px;
  }

  .spinner-small {
    width: 18px;
    height: 18px;
    border: 2.5px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
