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

  let isMultisalas = false;
  let subsalas = [];
  let newSubsalaNombre = '';
  let editingSubUuid = null;
  let editingSubNombre = '';
  let isSaving = false;
  let errorMessage = '';

  $: if (modalVisible && sala) {
    initData();
  }

  function initData() {
    errorMessage = '';
    newSubsalaNombre = '';
    editingSubUuid = null;
    editingSubNombre = '';

    let raw = [];
    if (Array.isArray(sala?.multisalas)) {
      raw = sala.multisalas;
    } else if (typeof sala?.multisalas === 'string') {
      try {
        raw = JSON.parse(sala.multisalas);
      } catch (e) {
        raw = [];
      }
    }

    subsalas = (Array.isArray(raw) ? raw : []).map((item) => {
      if (typeof item === 'string') {
        return {
          uuid: generateSafeUuid(),
          nombre: item,
          active: 1
        };
      } else if (item && typeof item === 'object') {
        const isActive = (item.active === 0 || item.active === '0' || item.active === false) ? 0 : 1;
        return {
          uuid: item.uuid || generateSafeUuid(),
          nombre: item.nombre || '',
          active: isActive
        };
      }
      return {
        uuid: generateSafeUuid(),
        nombre: String(item),
        active: 1
      };
    });

    isMultisalas = subsalas.length > 0;
  }

  function handleToggleSwitch() {
    isMultisalas = !isMultisalas;
    errorMessage = '';
  }

  function handleAddSubsala() {
    const trimmed = newSubsalaNombre.trim();
    if (!trimmed) {
      errorMessage = 'Por favor ingresa un nombre para la sala hija.';
      return;
    }

    if (subsalas.some(s => s.nombre.toLowerCase() === trimmed.toLowerCase())) {
      errorMessage = `Ya existe una sala hija con el nombre "${trimmed}".`;
      return;
    }

    errorMessage = '';
    const newUuid = generateSafeUuid();
    subsalas = [
      ...subsalas,
      {
        uuid: newUuid,
        nombre: trimmed,
        active: 1
      }
    ];
    newSubsalaNombre = '';
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSubsala();
    }
  }

  function startEdit(sub) {
    editingSubUuid = sub.uuid;
    editingSubNombre = sub.nombre;
  }

  function saveEdit(targetUuid) {
    const trimmed = editingSubNombre.trim();
    if (!trimmed) return;

    if (subsalas.some(s => s.uuid !== targetUuid && s.nombre.toLowerCase() === trimmed.toLowerCase())) {
      errorMessage = `Ya existe otra sala hija llamada "${trimmed}".`;
      return;
    }

    errorMessage = '';
    subsalas = subsalas.map(s => s.uuid === targetUuid ? { ...s, nombre: trimmed } : s);
    editingSubUuid = null;
    editingSubNombre = '';
  }

  function cancelEdit() {
    editingSubUuid = null;
    editingSubNombre = '';
  }

  function toggleSubsalaActive(targetUuid) {
    errorMessage = '';
    subsalas = subsalas.map(s => {
      if (s.uuid === targetUuid) {
        const nextActive = s.active === 0 ? 1 : 0;
        return { ...s, active: nextActive };
      }
      return s;
    });
  }

  async function handleSave() {
    if (isMultisalas && subsalas.length === 0) {
      errorMessage = 'Si activa el modo Multisalas, debe insertar al menos una sala hija. Si desea operar como sala única, cambie el switch a Sala Única.';
      return;
    }

    errorMessage = '';
    isSaving = true;

    try {
      const multisalasPayload = isMultisalas
        ? subsalas.map(s => ({
            uuid: s.uuid,
            nombre: s.nombre.trim(),
            active: (s.active === 0 || s.active === '0' || s.active === false) ? 0 : 1
          })).filter(s => s.nombre)
        : [];

      const targetUuid = sala.uuid;
      const updatedData = {
        ...sala,
        multisalas: multisalasPayload
      };

      await masterSalasActions.update(targetUuid, updatedData);

      triggerToast(
        isMultisalas
          ? `Sala "${sala.nombre}" configurada como Multisalas con ${multisalasPayload.length} sucursales.`
          : `Sala "${sala.nombre}" configurada como Sala Única.`,
        'success'
      );

      dispatch('saved', { uuid: targetUuid, multisalas: multisalasPayload });
      handleClose();
    } catch (err) {
      console.error('Error guardando multisalas:', err);
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
            Configuración de Estructura
          </span>
          <h3 class="header-main-title">
            Multisalas: <span class="sala-highlight">{sala?.nombre || 'Sala'}</span>
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

        <!-- Switch Card -->
        <div class="switch-box">
          <div class="switch-info">
            <span class="switch-title">Modo de Instalación</span>
            <span class="switch-desc">
              {#if isMultisalas}
                <strong style="color: #059669;">Multisalas Activo:</strong> Esta sala opera con múltiples sucursales hijas independientes.
              {:else}
                <strong style="color: #64748b;">Sala Única:</strong> Modo por defecto. La sala opera como una sola unidad sin divisiones.
              {/if}
            </span>
          </div>

          <button
            type="button"
            class="toggle-switch {isMultisalas ? 'active' : ''}"
            on:click={handleToggleSwitch}
            role="switch"
            aria-checked={isMultisalas}
            title={isMultisalas ? "Cambiar a Sala Única" : "Cambiar a Multisalas"}
          >
            <span class="switch-track">
              <span class="switch-thumb"></span>
            </span>
            <span class="switch-label">
              {isMultisalas ? 'MULTISALAS' : 'SALA ÚNICA'}
            </span>
          </button>
        </div>

        {#if !isMultisalas}
          <!-- Estado Sala Única (OFF) -->
          <div class="single-room-state">
            <h4>Configuración como Sala Única</h4>
            <p>
              Al estar en <strong>Sala Única</strong>, no se requieren salas hijas.
              Si esta sala cuenta con sucursales o áreas que manejan libros contables separados,
              activa el switch superior a <strong>Multisalas</strong>.
            </p>
          </div>
        {:else}
          <!-- Estado Multisalas (ON) -->
          <div class="multisalas-section">
            <label class="input-label" for="input-subsala">
              Agregar Nueva Sala Hija / Sucursal
            </label>
            <div class="input-row">
              <input
                id="input-subsala"
                type="text"
                class="form-input-sub"
                placeholder="Ej. Sucursal 1, Sucursal Centro, etc."
                bind:value={newSubsalaNombre}
                on:keydown={handleKeydown}
              />
              <button
                type="button"
                class="btn-insert"
                on:click={handleAddSubsala}
              >
                Insertar
              </button>
            </div>

            <!-- Tabla de subsalas insertadas -->
            <div class="table-container">
              <table class="subsalas-table">
                <thead>
                  <tr>
                    <th style="width: 45px; text-align: center;">#</th>
                    <th style="width: 100px;">UUID</th>
                    <th>Nombre de la Sala Hija / Sucursal</th>
                    <th style="width: 160px; text-align: center;">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {#if subsalas.length === 0}
                    <tr>
                      <td colspan="4" class="table-empty">
                        <p>No hay salas hijas insertadas todavía.</p>
                        <small>Escribe un nombre arriba y haz clic en "Insertar".</small>
                      </td>
                    </tr>
                  {:else}
                    {#each subsalas as sub, index (sub.uuid)}
                      {@const isEditingRow = editingSubUuid === sub.uuid}
                      {@const isInactive = sub.active === 0}
                      <tr class="table-row {isEditingRow ? 'editing' : ''} {isInactive ? 'inactive-row' : ''}">
                        <td class="col-index">{index + 1}</td>
                        <td class="col-uuid" title={sub.uuid}>
                          #{(sub.uuid ? sub.uuid.slice(0, 8) : '')}
                        </td>
                        <td class="col-name">
                          {#if isEditingRow}
                            <input
                              type="text"
                              class="edit-inline-input"
                              bind:value={editingSubNombre}
                              on:keydown={(e) => {
                                if (e.key === 'Enter') saveEdit(sub.uuid);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              autoFocus
                            />
                          {:else}
                            <div class="name-wrapper">
                              <span class="sub-nombre-badge {isInactive ? 'inactive-badge' : ''}">{sub.nombre}</span>
                              {#if isInactive}
                                <span class="status-pill-inactive">(Desactivada)</span>
                              {/if}
                            </div>
                          {/if}
                        </td>
                        <td class="col-actions">
                          {#if isEditingRow}
                            <button
                              type="button"
                              class="btn-row-action save"
                              on:click={() => saveEdit(sub.uuid)}
                              title="Guardar nombre"
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
                              on:click={() => startEdit(sub)}
                              title="Editar nombre"
                            >
                              Editar
                            </button>
                            {#if isInactive}
                              <button
                                type="button"
                                class="btn-row-action activate"
                                on:click={() => toggleSubsalaActive(sub.uuid)}
                                title="Activar sala hija"
                              >
                                Activar
                              </button>
                            {:else}
                              <button
                                type="button"
                                class="btn-row-action deactivate"
                                on:click={() => toggleSubsalaActive(sub.uuid)}
                                title="Desactivar sala hija"
                              >
                                Desactivar
                              </button>
                            {/if}
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  {/if}
                </tbody>
              </table>
            </div>

            {#if subsalas.length > 0}
              <div class="subsalas-summary">
                Total salas hijas: <strong>{subsalas.length}</strong>
                &bull; Activas: <strong style="color: #059669;">{subsalas.filter(s => s.active !== 0).length}</strong>
                {#if subsalas.some(s => s.active === 0)}
                  &bull; Desactivadas: <strong style="color: #d97706;">{subsalas.filter(s => s.active === 0).length}</strong>
                {/if}
              </div>
            {/if}
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
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1d4ed8;
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
    color: #2563eb;
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

  /* Switch Box */
  .switch-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    gap: 14px;
  }

  .switch-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .switch-title {
    font-size: 13px;
    font-weight: 800;
    color: #1e293b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .switch-desc {
    font-size: 12.5px;
    color: #64748b;
    line-height: 1.35;
  }

  .toggle-switch {
    display: flex;
    align-items: center;
    gap: 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
  }

  .switch-track {
    width: 48px;
    height: 26px;
    background: #cbd5e1;
    border-radius: 20px;
    position: relative;
    transition: background 0.2s ease;
    display: block;
  }

  .switch-thumb {
    width: 20px;
    height: 20px;
    background: #ffffff;
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .toggle-switch.active .switch-track {
    background: #059669;
  }

  .toggle-switch.active .switch-thumb {
    transform: translateX(22px);
  }

  .switch-label {
    font-size: 12px;
    font-weight: 800;
    color: #475569;
    min-width: 85px;
    text-align: left;
    letter-spacing: 0.5px;
  }

  .toggle-switch.active .switch-label {
    color: #059669;
  }

  /* Single Room Empty State */
  .single-room-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 28px 20px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    gap: 8px;
  }

  .single-room-state h4 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
  }

  .single-room-state p {
    margin: 0;
    font-size: 13px;
    color: #64748b;
    max-width: 420px;
    line-height: 1.45;
  }

  /* Multisalas Section */
  .multisalas-section {
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

  .form-input-sub {
    flex: 1;
    padding: 8px 12px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13.5px;
    color: #1e293b;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .form-input-sub:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }

  .btn-insert {
    padding: 8px 16px;
    background: #2563eb;
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
    background: #1d4ed8;
  }

  /* Table */
  .table-container {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
    max-height: 250px;
    overflow-y: auto;
  }

  .subsalas-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .subsalas-table th {
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

  /* Desactivada: Row opaca excepto la columna de acciones */
  .table-row.inactive-row td:not(.col-actions) {
    opacity: 0.45;
    filter: grayscale(40%);
  }

  .table-row.inactive-row .col-actions {
    opacity: 1 !important;
  }

  .col-index {
    text-align: center;
    color: #64748b;
    font-family: monospace;
    font-weight: 700;
    padding: 8px 10px;
  }

  .col-uuid {
    padding: 8px 10px;
    font-family: monospace;
    font-size: 11.5px;
    color: #475569;
    font-weight: 700;
  }

  .col-name {
    padding: 8px 12px;
    font-weight: 600;
    color: #1e293b;
  }

  .name-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sub-nombre-badge {
    background: #eff6ff;
    color: #1e40af;
    border: 1px solid #bfdbfe;
    padding: 3px 8px;
    border-radius: 6px;
    display: inline-block;
  }

  .sub-nombre-badge.inactive-badge {
    background: #f1f5f9;
    color: #64748b;
    border-color: #cbd5e1;
  }

  .status-pill-inactive {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    font-style: italic;
  }

  .edit-inline-input {
    width: 100%;
    padding: 4px 8px;
    border: 1.5px solid #059669;
    border-radius: 6px;
    font-size: 13px;
    outline: none;
    background: #ffffff;
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

  .btn-row-action.deactivate {
    background: #fffbeb;
    border-color: #fde68a;
    color: #b45309;
  }

  .btn-row-action.deactivate:hover {
    background: #fef3c7;
    color: #92400e;
    border-color: #fcd34d;
  }

  .btn-row-action.activate {
    background: #f0fdf4;
    border-color: #86efac;
    color: #047857;
    font-weight: 800;
    opacity: 1 !important;
  }

  .btn-row-action.activate:hover {
    background: #dcfce7;
    color: #065f46;
    border-color: #4ade80;
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

  .subsalas-summary {
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
    background: #2563eb;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .btn-save:hover:not(:disabled) {
    background: #1d4ed8;
    box-shadow: 0 4px 8px rgba(37, 99, 235, 0.35);
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
