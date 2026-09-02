<script>
  import { createEventDispatcher } from 'svelte';

  export let isOpen = false;
  export let item = null;
  export let entityType = 'registro';

  const dispatch = createEventDispatcher();

  $: displayName = item ? (item.nombre || item.title || item.nombre_comercial || item.usuario || item.name || 'Sin nombre') : '';
  $: displayId = item ? item.id : '';

  function handleConfirm() {
    if (item && item.id) {
      dispatch('confirm', item.id);
    }
  }

  function handleCancel() {
    dispatch('close');
  }

  function capitalize(str) {
    if (!str) return 'Registro';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
</script>

{#if isOpen}
  <div class="modal-backdrop">
    <div class="modal-container">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="modal-title">
          <span style="color: #d97706;">⚠️</span> Confirmar Eliminación
        </div>
        <button type="button" class="close-btn" on:click={handleCancel}>✕</button>
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        <h4 class="question-text">
          ¿Está seguro de que desea eliminar esta {entityType.toLowerCase()}?
        </h4>

        <!-- Highlight Box (Yellow Left Border) -->
        <div class="highlight-box">
          <span class="entity-label">{capitalize(entityType)}:</span>
          <span class="entity-value">{displayName} (ID: {displayId})</span>
        </div>

        <!-- Red Alert Box -->
        <div class="red-alert-box">
          <div class="alert-title">
            <span>⚠️</span> Esta acción no se puede deshacer.
          </div>
          <div class="alert-subtext">
            Esta acción eliminará permanentemente el {entityType.toLowerCase()} y todos sus datos asociados.
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button type="button" class="btn-cancel" on:click={handleCancel}>
          Cancelar
        </button>
        <button type="button" class="btn-confirm" on:click={handleConfirm}>
          Sí, Confirmar
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-container {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    border: 1px solid #e2e8f0;
    color: #0f172a;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .modal-header {
    padding: 14px 20px;
    background: #fffbeb;
    border-bottom: 1px solid #fef3c7;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font-size: 15px;
    font-weight: 800;
    color: #92400e;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: #92400e;
    padding: 4px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: #fef3c7;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .question-text {
    margin: 0;
    font-size: 14.5px;
    font-weight: 800;
    color: #1e293b;
  }

  .highlight-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4px solid #f59e0b;
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 13.5px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .entity-label {
    font-weight: 800;
    color: #0f172a;
  }

  .entity-value {
    color: #334155;
    font-weight: 600;
  }

  .red-alert-box {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .alert-title {
    font-size: 13.5px;
    font-weight: 800;
    color: #991b1b;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .alert-subtext {
    font-size: 12.5px;
    color: #b91c1c;
    line-height: 1.4;
  }

  .modal-footer {
    padding: 12px 20px;
    background: #ffffff;
    border-top: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  .btn-cancel {
    padding: 8px 20px;
    background: #64748b;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-cancel:hover {
    background: #475569;
  }

  .btn-confirm {
    padding: 8px 20px;
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: 0 2px 4px rgba(220, 38, 38, 0.2);
  }

  .btn-confirm:hover {
    background: #b91c1c;
  }
</style>
