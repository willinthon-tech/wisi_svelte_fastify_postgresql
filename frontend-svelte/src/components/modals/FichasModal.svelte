<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasActions } from '../../controllers/master.store.js';
  import { generateSafeUuid } from '../../services/localDb.service.js';

  export let show = false;
  export let isOpen = false;
  export let sala = null;

  $: modalVisible = show || isOpen;

  const dispatch = createEventDispatcher();

  let fichas = [];
  let newFichasInput = '';
  let editingUuid = null;
  let editingValor = '';
  let isSaving = false;
  let errorMessage = '';

  $: if (modalVisible && sala) {
    initData();
  }

  function initData() {
    errorMessage = '';
    newFichasInput = '';
    editingUuid = null;
    editingValor = '';

    let raw = [];
    if (Array.isArray(sala?.fichas)) {
      raw = sala.fichas;
    } else if (typeof sala?.fichas === 'string') {
      try {
        raw = JSON.parse(sala.fichas);
      } catch (e) {
        raw = [];
      }
    }

    fichas = (Array.isArray(raw) ? raw : [])
      .map((item) => {
        if (typeof item === 'number' || (typeof item === 'string' && !isNaN(Number(item)))) {
          return {
            uuid: generateSafeUuid(),
            valor: Number(item)
          };
        } else if (item && typeof item === 'object') {
          const num = Number(item.valor ?? item.value ?? item.denominacion);
          return {
            uuid: item.uuid || generateSafeUuid(),
            valor: isNaN(num) ? 0 : num
          };
        }
        return null;
      })
      .filter((item) => item !== null && !isNaN(item.valor) && item.valor > 0)
      // Ordenar de mayor a menor (mayor arriba, menor abajo)
      .sort((a, b) => Number(b.valor) - Number(a.valor));
  }

  function formatFicha(val) {
    const num = Number(val);
    if (isNaN(num)) return '$0';
    return '$' + num.toLocaleString('en-US', {
      minimumFractionDigits: num % 1 !== 0 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function handleAddFichas() {
    const raw = newFichasInput.trim();
    if (!raw) {
      errorMessage = 'Por favor ingresa una o varias denominaciones separadas por coma.';
      return;
    }

    // Separar por coma y procesar cada valor
    const tokens = raw.split(',');
    let addedCount = 0;
    let duplicateTokens = [];
    let invalidTokens = [];

    let currentList = [...fichas];

    for (let token of tokens) {
      const clean = token.replace(/[$€bsBs.\s]/g, '').trim();
      // Si tiene punto o coma decimal
      let normalized = token.replace(/[$€bsBs\s]/g, '').trim();
      // Si la coma era separador de miles o decimal
      if (normalized.includes(',')) {
        // En tokens separados por coma, el token en sí no debería tener coma a menos que sea decimal
        normalized = normalized.replace(',', '.');
      }

      const num = parseFloat(normalized);
      if (isNaN(num) || num <= 0) {
        if (token.trim()) invalidTokens.push(token.trim());
        continue;
      }

      // Validar si ya existe en la lista
      const alreadyExists = currentList.some(f => Number(f.valor) === num);
      if (alreadyExists) {
        duplicateTokens.push(num);
        continue;
      }

      currentList.push({
        uuid: generateSafeUuid(),
        valor: num
      });
      addedCount++;
    }

    if (addedCount === 0 && (duplicateTokens.length > 0 || invalidTokens.length > 0)) {
      if (duplicateTokens.length > 0) {
        errorMessage = `La(s) denominación(es) ${duplicateTokens.map(d => '$' + d).join(', ')} ya existen en la lista.`;
      } else {
        errorMessage = `No se encontraron denominaciones válidas mayores a 0 en: "${raw}".`;
      }
      return;
    }

    // Ordenar de mayor a menor (mayor arriba, menor abajo)
    currentList.sort((a, b) => Number(b.valor) - Number(a.valor));
    fichas = currentList;
    newFichasInput = '';
    errorMessage = '';

    if (duplicateTokens.length > 0) {
      triggerToast(`Se insertaron las nuevas fichas. Nota: se omitieron duplicados (${duplicateTokens.map(d => '$' + d).join(', ')}).`, 'info');
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddFichas();
    }
  }

  function startEdit(ficha) {
    editingUuid = ficha.uuid;
    editingValor = ficha.valor;
  }

  function saveEdit(targetUuid) {
    const rawVal = String(editingValor).replace(/[$€bsBs\s]/g, '').replace(',', '.').trim();
    const num = parseFloat(rawVal);
    if (isNaN(num) || num <= 0) {
      errorMessage = 'Por favor ingresa un valor numérico válido mayor a 0.';
      return;
    }

    // Validar si otro registro ya tiene este valor
    if (fichas.some(f => f.uuid !== targetUuid && Number(f.valor) === num)) {
      errorMessage = `Ya existe otra ficha con la denominación $${num}.`;
      return;
    }

    errorMessage = '';
    fichas = fichas
      .map(f => f.uuid === targetUuid ? { ...f, valor: num } : f)
      // Re-ordenar de mayor a menor
      .sort((a, b) => Number(b.valor) - Number(a.valor));

    editingUuid = null;
    editingValor = '';
  }

  function cancelEdit() {
    editingUuid = null;
    editingValor = '';
  }

  function handleDeleteFicha(targetUuid) {
    errorMessage = '';
    fichas = fichas.filter(f => f.uuid !== targetUuid);
  }

  async function handleSave() {
    errorMessage = '';
    isSaving = true;

    try {
      // Formatear payload ordenado de mayor a menor
      const fichasPayload = fichas
        .map(f => ({
          uuid: f.uuid || generateSafeUuid(),
          valor: Number(f.valor)
        }))
        .filter(f => !isNaN(f.valor) && f.valor > 0)
        .sort((a, b) => Number(b.valor) - Number(a.valor));

      const targetUuid = sala.uuid;
      const updatedData = {
        ...sala,
        fichas: fichasPayload
      };

      await masterSalasActions.update(targetUuid, updatedData);

      triggerToast(
        `Fichas actualizadas para "${sala.nombre}" (${fichasPayload.length} denominaciones).`,
        'success'
      );

      dispatch('saved', { uuid: targetUuid, fichas: fichasPayload });
      handleClose();
    } catch (err) {
      console.error('Error guardando fichas:', err);
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
            Configuración de Sala
          </span>
          <h3 class="header-main-title">
            Fichas: <span class="sala-highlight">{sala?.nombre || 'Sala'}</span>
          </h3>
          <p class="header-sub">
            UUID: <span class="sala-id">#{(sala?.uuid ? sala.uuid.slice(0, 8) : '')}</span>
            {#if sala?.nombre_comercial}
              &bull; <span class="sala-comercial">{sala.nombre_comercial}</span>
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

        <!-- Info Card -->
        <div class="info-box">
          <div class="info-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <div class="info-content">
            <span class="info-title">Denominaciones de Fichas</span>
            <span class="info-desc">
              Ingresa los valores de las fichas aplicables a esta sala. Puedes insertar varias denominaciones separadas por coma (ej: <strong>100, 50, 20, 10, 5, 1</strong>). Se ordenan automáticamente de mayor a menor.
            </span>
          </div>
        </div>

        <!-- Input Section -->
        <div class="fichas-section">
          <label class="input-label" for="input-fichas">
            Agregar Fichas / Denominaciones (separadas por coma)
          </label>
          <div class="input-row">
            <input
              id="input-fichas"
              type="text"
              class="form-input-fichas"
              placeholder="Ej. 100, 50, 20, 10, 5, 1"
              bind:value={newFichasInput}
              on:keydown={handleKeydown}
            />
            <button
              type="button"
              class="btn-insert"
              on:click={handleAddFichas}
            >
              Insertar
            </button>
          </div>

          <!-- Tabla de fichas ordenadas de mayor a menor -->
          <div class="table-container">
            <table class="fichas-table">
              <thead>
                <tr>
                  <th style="width: 48px; text-align: center;">#</th>
                  <th>Valor / Denominación</th>
                  <th style="width: 160px; text-align: center;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {#if fichas.length === 0}
                  <tr>
                    <td colspan="3" class="table-empty">
                      <p>No hay fichas configuradas todavía.</p>
                      <small>Escribe una o varias denominaciones arriba y haz clic en "Insertar".</small>
                    </td>
                  </tr>
                {:else}
                  {#each fichas as ficha, index (ficha.uuid)}
                    {@const isEditingRow = editingUuid === ficha.uuid}
                    <tr class="table-row {isEditingRow ? 'editing' : ''}">
                      <td class="col-index">{index + 1}</td>
                      <td class="col-valor">
                        {#if isEditingRow}
                          <div class="edit-wrapper">
                            <span class="currency-symbol">$</span>
                            <input
                              type="number"
                              step="any"
                              min="0.01"
                              class="edit-inline-input"
                              bind:value={editingValor}
                              on:keydown={(e) => {
                                if (e.key === 'Enter') saveEdit(ficha.uuid);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              autoFocus
                            />
                          </div>
                        {:else}
                          <div class="valor-wrapper">
                            <span class="ficha-badge">
                              <span class="ficha-chip-dot"></span>
                              {formatFicha(ficha.valor)}
                            </span>
                            <span class="ficha-tag">Ficha de sala</span>
                          </div>
                        {/if}
                      </td>
                      <td class="col-actions">
                        {#if isEditingRow}
                          <button
                            type="button"
                            class="btn-row-action save"
                            on:click={() => saveEdit(ficha.uuid)}
                            title="Guardar valor"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            class="btn-row-action cancel"
                            on:click={cancelEdit}
                            title="Cancelar edición"
                          >
                            Cancelar
                          </button>
                        {:else}
                          <button
                            type="button"
                            class="btn-row-action edit"
                            on:click={() => startEdit(ficha)}
                            title="Editar valor de la ficha"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            class="btn-row-action delete"
                            on:click={() => handleDeleteFicha(ficha.uuid)}
                            title="Eliminar ficha"
                          >
                            Eliminar
                          </button>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>

          {#if fichas.length > 0}
            <div class="fichas-summary">
              Total denominaciones: <strong>{fichas.length}</strong>
              &bull; Mayor: <strong style="color: #059669;">{formatFicha(fichas[0].valor)}</strong>
              &bull; Menor: <strong style="color: #2563eb;">{formatFicha(fichas[fichas.length - 1].valor)}</strong>
            </div>
          {/if}
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
    max-width: 600px;
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

  .sala-highlight {
    color: #059669;
  }

  .header-sub {
    margin: 4px 0 0 0;
    font-size: 12.5px;
    color: #64748b;
  }

  .sala-id {
    font-family: monospace;
    font-weight: 700;
    color: #334155;
  }

  .sala-comercial {
    color: #475569;
    font-style: italic;
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

  /* Info Card */
  .info-box {
    display: flex;
    align-items: flex-start;
    padding: 14px 18px;
    background: #f0fdf4;
    border: 1.5px solid #bbf7d0;
    border-radius: 12px;
    gap: 12px;
  }

  .info-icon {
    color: #059669;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .info-content {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .info-title {
    font-size: 13px;
    font-weight: 800;
    color: #065f46;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .info-desc {
    font-size: 12.5px;
    color: #166534;
    line-height: 1.4;
  }

  /* Fichas Section */
  .fichas-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .input-label {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    color: #475569;
    letter-spacing: 0.5px;
  }

  .input-row {
    display: flex;
    gap: 8px;
  }

  .form-input-fichas {
    flex: 1;
    padding: 9px 12px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13.5px;
    color: #1e293b;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .form-input-fichas:focus {
    border-color: #059669;
    box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.15);
  }

  .btn-insert {
    padding: 9px 18px;
    background: #059669;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s ease;
  }

  .btn-insert:hover {
    background: #047857;
  }

  /* Table */
  .table-container {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    max-height: 270px;
    overflow-y: auto;
  }

  .fichas-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .fichas-table th {
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

  .table-row.editing {
    background: #f0fdf4;
  }

  .col-index {
    text-align: center;
    color: #64748b;
    font-family: monospace;
    font-weight: 700;
    padding: 8px 10px;
  }

  .col-valor {
    padding: 8px 12px;
    font-weight: 600;
    color: #1e293b;
  }

  .valor-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .ficha-badge {
    background: #ecfdf5;
    color: #065f46;
    border: 1.5px solid #a7f3d0;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 13.5px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .ficha-chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #059669;
    display: inline-block;
  }

  .ficha-tag {
    font-size: 11px;
    color: #94a3b8;
    font-style: italic;
  }

  .edit-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 140px;
  }

  .currency-symbol {
    font-size: 14px;
    font-weight: 700;
    color: #059669;
  }

  .edit-inline-input {
    width: 100%;
    padding: 4px 8px;
    border: 1.5px solid #059669;
    border-radius: 6px;
    font-size: 13px;
    outline: none;
    background: #ffffff;
    font-weight: 700;
  }

  .col-actions {
    text-align: center;
    padding: 6px 10px;
    white-space: nowrap;
  }

  .btn-row-action {
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease;
    margin: 0 2px;
  }

  .btn-row-action.edit {
    background: #ffffff;
    border-color: #cbd5e1;
    color: #334155;
  }

  .btn-row-action.edit:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #94a3b8;
  }

  .btn-row-action.delete {
    background: #fef2f2;
    border-color: #fecaca;
    color: #dc2626;
  }

  .btn-row-action.delete:hover {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fca5a5;
  }

  .btn-row-action.save {
    background: #059669;
    color: #ffffff;
    border-color: #047857;
    font-weight: 800;
  }

  .btn-row-action.cancel {
    background: #e2e8f0;
    color: #475569;
    border-color: #cbd5e1;
    font-weight: 800;
  }

  .table-empty {
    text-align: center;
    padding: 30px 14px;
    color: #64748b;
  }

  .table-empty p {
    margin: 0;
    font-weight: 600;
    color: #475569;
  }

  .table-empty small {
    font-size: 12px;
    color: #94a3b8;
  }

  .fichas-summary {
    font-size: 12.5px;
    color: #64748b;
    text-align: right;
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
