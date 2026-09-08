<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  // Estado del formulario
  let descripcion = '';
  let isSaving = false;

  // Lista de incidencias
  let records = [];
  let isLoadingRecords = false;

  // Ordenadas de más reciente a más antigua por hora
  $: sortedRecords = [...records].sort((a, b) => {
    const hA = a.hora || '';
    const hB = b.hora || '';
    if (hA !== hB) return hB.localeCompare(hA);
    return Number(b.id) - Number(a.id);
  });

  // Modal para editar hora
  let showModalHora = false;
  let editingRecord = null;
  let modalHora = '';
  let isSavingHora = false;

  // Encabezado oscuro de la tabla con nombre de sala (no comercial) y fecha
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

  function getCurrentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadRecords()
    ]);
  });

  $: if (libroId) {
    loadRecords();
  }

  async function loadRecords() {
    const lId = libroId || libro?.id;
    if (!lId) return;
    isLoadingRecords = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          records = json.data || [];
        }
      }
    } catch (err) {
      console.error('Error al cargar incidencias generales:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    const cleanDesc = (descripcion || '').trim();
    if (!cleanDesc) {
      triggerToast('Debe ingresar la descripción de la incidencia', 'warning');
      return;
    }

    isSaving = true;
    try {
      const payload = {
        descripcion: cleanDesc,
        hora: getCurrentTimeString()
      };

      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Incidencia registrada exitosamente', 'success');
        descripcion = '';
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al guardar incidencia', 'error');
      }
    } catch (err) {
      console.error('Error al guardar incidencia:', err);
      triggerToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminar(recordId) {
    const lId = libroId || libro?.id;
    if (!lId || !recordId) return;

    try {
      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales/${recordId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Incidencia eliminada correctamente', 'info');
        records = records.filter(r => Number(r.id) !== Number(recordId));
      } else {
        triggerToast(json?.error || 'Error al eliminar incidencia', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar incidencia:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  // Modal para editar hora
  function abrirModalHora(record) {
    editingRecord = record;
    modalHora = record.hora || getCurrentTimeString();
    showModalHora = true;
  }

  function cerrarModalHora() {
    showModalHora = false;
    editingRecord = null;
  }

  function ponerHoraActualModal() {
    modalHora = getCurrentTimeString();
  }

  async function handleGuardarHora() {
    if (!editingRecord) return;
    const lId = libroId || libro?.id;
    if (!lId) return;

    if (!modalHora) {
      triggerToast('Debe indicar una hora válida', 'warning');
      return;
    }

    isSavingHora = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales/${editingRecord.id}/hora`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hora: modalHora })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Hora de incidencia actualizada correctamente', 'success');
        cerrarModalHora();
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al actualizar hora', 'error');
      }
    } catch (err) {
      console.error('Error al actualizar hora:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSavingHora = false;
    }
  }
</script>

<div class="incidencias-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Incidencias Generales" -->
  <div class="card-form-incidencia">
    <div class="card-title-box">
      <h3 class="card-title">Incidencias Generales</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="incidencia-form">
      <!-- Campo Descripción Obligatorio -->
      <div class="form-group">
        <label for="input-desc-incidencia" class="form-label">Descripción de la Incidencia: *</label>
        <textarea 
          id="input-desc-incidencia" 
          class="form-textarea" 
          rows="5"
          placeholder="Escriba los detalles de la incidencia ocurrida (campo obligatorio)..."
          bind:value={descripcion}
          required
        ></textarea>
        <span class="field-hint">Se registrará automáticamente con la hora actual de este momento.</span>
      </div>

      <!-- Botón Guardar Verde -->
      <button 
        type="submit" 
        class="btn-guardar"
        disabled={isSaving}
      >
        {#if isSaving}
          <span>Guardando...</span>
        {:else}
          <span>Guardar Registro</span>
        {/if}
      </button>
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Incidencias Generales -->
  <div class="card-table-incidencias">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <span>{tableHeaderTitle}</span>
    </div>

    <!-- Tabla de Contenido -->
    <div class="table-wrapper">
      <table class="incidencias-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-desc">Descripción</th>
            <th class="th-center th-hora">Hora</th>
            <th class="th-center th-acciones">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords}
            <tr>
              <td colspan="4" class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando incidencias generales...</span>
                </div>
              </td>
            </tr>
          {:else if records.length === 0}
            <tr>
              <td colspan="4" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">⚠️</span>
                  <p class="empty-text">
                    No se han reportado incidencias generales para esta fecha. Redacte la novedad en el formulario de la izquierda para registrarla.
                  </p>
                </div>
              </td>
            </tr>
          {:else}
            {#each sortedRecords as record, idx}
              <tr class="incidencia-row">
                <td class="td-center td-num">{idx + 1}</td>
                <td class="td-desc">
                  <span class="desc-content">{record.descripcion}</span>
                </td>
                <td class="td-center td-hora-val">
                  <span class="time-badge">{record.hora || '—'}</span>
                </td>
                <td class="td-center td-acciones">
                  <div class="acciones-btns-row">
                    <button 
                      type="button" 
                      class="btn-hora-accion"
                      on:click={() => abrirModalHora(record)}
                      title="Modificar hora de la incidencia"
                    >
                      🕒 Hora
                    </button>
                    <button 
                      type="button" 
                      class="btn-eliminar"
                      on:click={() => handleEliminar(record.id)}
                      title="Eliminar esta incidencia"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ========================================================
     MODAL: MODIFICAR HORA DE LA INCIDENCIA
======================================================== -->
{#if showModalHora}
  <div class="modal-overlay">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-title-left">
          <span class="modal-header-icon">🕒</span>
          <div>
            <h4 class="modal-heading">Modificar Hora de Incidencia</h4>
            <span class="modal-subheading">Ajustar hora de ocurrencia</span>
          </div>
        </div>
        <button type="button" class="btn-modal-close" on:click={cerrarModalHora}>×</button>
      </div>

      <form on:submit|preventDefault={handleGuardarHora} class="modal-form">
        <div class="modal-body">
          <div class="incidencia-snippet">
            <span class="snippet-label">Incidencia:</span>
            <p class="snippet-text">{editingRecord?.descripcion}</p>
          </div>

          <div class="form-group-modal">
            <div class="label-with-action">
              <label for="m-hora-inc" class="form-label-modal">Hora de la Incidencia:</label>
              <button 
                type="button" 
                class="btn-inline-now" 
                on:click={ponerHoraActualModal}
                title="Poner hora actual ahora"
              >
                ⚡ Usar hora actual
              </button>
            </div>
            <input 
              id="m-hora-inc" 
              type="time" 
              class="form-time-input-modal" 
              bind:value={modalHora} 
              required
            />
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-modal-cancel" on:click={cerrarModalHora}>
            Cancelar
          </button>
          <button type="submit" class="btn-modal-save" disabled={isSavingHora}>
            {#if isSavingHora}
              Guardando...
            {:else}
              Guardar Hora
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .incidencias-layout-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .incidencias-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-incidencia {
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

  .incidencia-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  .field-hint {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
  }

  .form-textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
    resize: vertical;
    line-height: 1.45;
  }

  .form-textarea:focus {
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
  .card-table-incidencias {
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

  .incidencias-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  /* Cabeceras Oscuras */
  .incidencias-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .incidencias-table th {
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

  .th-desc {
    min-width: 250px;
  }

  .th-hora {
    width: 120px;
  }

  .th-acciones {
    width: 160px;
  }

  /* Filas de la Tabla */
  .incidencia-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .incidencia-row:hover {
    background: #f8fafc;
  }

  .incidencias-table td {
    padding: 12px 14px;
    color: #1e293b;
    font-size: 13px;
    vertical-align: middle;
  }

  .td-center {
    text-align: center;
  }

  .desc-content {
    font-weight: 500;
    color: #0f172a;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Badge de Hora */
  .time-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12.5px;
    font-weight: 700;
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  /* Acciones */
  .acciones-btns-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-hora-accion {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-hora-accion:hover {
    background: #2563eb;
  }

  .btn-eliminar {
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-eliminar:hover {
    background: #b91c1c;
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
    gap: 10px;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-text {
    font-size: 13px;
    color: #64748b;
    max-width: 480px;
    line-height: 1.5;
    margin: 0;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #64748b;
    font-size: 13.5px;
  }

  .spinner-small {
    width: 18px;
    height: 18px;
    border: 2.5px solid #cbd5e1;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ─────────────────────────────────────────────────────────────
     MODAL MODIFICAR HORA
  ───────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalPop {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-header {
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .modal-header-icon {
    font-size: 24px;
  }

  .modal-heading {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
  }

  .modal-subheading {
    font-size: 12.5px;
    color: #64748b;
  }

  .btn-modal-close {
    background: none;
    border: none;
    font-size: 22px;
    color: #64748b;
    cursor: pointer;
    line-height: 1;
    padding: 0;
  }

  .btn-modal-close:hover {
    color: #0f172a;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .incidencia-snippet {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
    max-height: 100px;
    overflow-y: auto;
  }

  .snippet-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    display: block;
    margin-bottom: 3px;
  }

  .snippet-text {
    margin: 0;
    font-size: 12.5px;
    color: #1e293b;
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .form-group-modal {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label-with-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .form-label-modal {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
  }

  .btn-inline-now {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
  }

  .btn-inline-now:hover {
    text-decoration: underline;
  }

  .form-time-input-modal {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    box-sizing: border-box;
  }

  .form-time-input-modal:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
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

  .btn-modal-cancel {
    padding: 8px 16px;
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-modal-cancel:hover {
    background: #e2e8f0;
  }

  .btn-modal-save {
    padding: 8px 18px;
    background: #5bb87e;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-modal-save:hover:not(:disabled) {
    background: #4ca66e;
  }

  .btn-modal-save:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
</style>
